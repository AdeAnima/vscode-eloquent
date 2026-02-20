import * as vscode from "vscode";
import type { AudioChunk, TtsBackend } from "./types";
import { preprocessForSpeech } from "./textPreprocessor";
import { extractNarration, hasIncompleteNarration } from "./narrationExtractor";

/**
 * Splits text into sentence-level chunks suitable for TTS.
 * Splits at sentence boundaries (. ! ? ; newlines) while keeping
 * chunks under maxChars. The first chunk is kept shorter for low latency.
 */
export function chunkText(
  text: string,
  maxChars = 135,
  firstChunkMax = 60
): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  // Split on sentence boundaries, keeping the delimiter attached
  const raw = trimmed.split(/(?<=[.!?;:\n])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const segment of raw) {
    const seg = segment.trim();
    if (!seg) continue;
    const limit = chunks.length === 0 ? firstChunkMax : maxChars;

    if (current && (current + " " + seg).length > limit) {
      chunks.push(current);
      current = seg;
    } else {
      current = current ? current + " " + seg : seg;
    }
  }
  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * ChunkedSynthesizer with prefetch buffering.
 *
 * It accumulates text from potentially many `synthesize()` calls (as Copilot
 * Chat streams its response), splits the accumulated text into speakable
 * sentence-level chunks, and prefetches audio into a ring buffer so playback
 * can proceed without waiting for generation.
 *
 * The buffer depth is configurable via `eloquent.prefetchBufferSize` (default 2).
 * A producer coroutine fills the buffer, and the consumer yields chunks for
 * playback as they become ready.
 */
export class ChunkedSynthesizer {
  private buffer = "";
  private flushed = false;
  private pendingChange = false;
  private changeResolve: (() => void) | null = null;

  constructor(private readonly backend: TtsBackend) {}

  /** Append more text (called as Copilot streams in tokens). */
  push(text: string): void {
    this.buffer += text;
    this.notifyChange();
  }

  /** Signal that no more text will arrive. */
  flush(): void {
    this.flushed = true;
    this.notifyChange();
  }

  /** Wake the producer if it's waiting, or set a flag for the next wait. */
  private notifyChange(): void {
    this.pendingChange = true;
    const fn = this.changeResolve;
    this.changeResolve = null;
    fn?.();
  }

  /** Wait until push() or flush() is called. Returns immediately if a change is already pending. */
  private waitForChange(): Promise<void> {
    if (this.pendingChange) {
      this.pendingChange = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.changeResolve = resolve;
    });
  }

  /**
   * Yields AudioChunks as they become ready, with prefetch buffering.
   *
   * A producer task synthesizes chunks ahead of playback into a bounded queue.
   * The consumer yields from the queue. This means while chunk N is playing,
   * chunks N+1..N+bufferSize are already being synthesized.
   */
  async *stream(signal: AbortSignal): AsyncIterable<AudioChunk> {
    const prefetchSize = vscode.workspace
      .getConfiguration("eloquent")
      .get<number>("prefetchBufferSize", 2);
    const narrationMode = vscode.workspace
      .getConfiguration("eloquent")
      .get<boolean>("narrationMode", false);

    const queue: AudioChunk[] = [];
    let producerDone = false;
    let producerError: Error | undefined;

    // Wake the consumer when a new chunk is enqueued or producer finishes
    let wakeConsumer: (() => void) | null = null;
    const waitForChunk = () =>
      new Promise<void>((resolve) => {
        wakeConsumer = resolve;
      });

    // Wake the producer when there's space in the buffer
    let wakeProducer: (() => void) | null = null;
    const waitForSpace = () =>
      new Promise<void>((resolve) => {
        wakeProducer = resolve;
      });

    const notifyConsumer = () => { const fn = wakeConsumer; wakeConsumer = null; fn?.(); };
    const notifyProducer = () => { const fn = wakeProducer; wakeProducer = null; fn?.(); };

    // --- Producer: synthesize chunks into queue ---
    const produce = async () => {
      let emittedUpTo = 0;

      try {
        while (!signal.aborted) {
          // In narration mode, only speak content inside <speak> tags
          const raw = narrationMode ? extractNarration(this.buffer) : this.buffer;
          const processed = preprocessForSpeech(raw);
          const chunks = chunkText(processed);

          // Only synthesize sentence-terminated chunks unless flushed.
          // In narration mode, also wait for incomplete <speak> tags to close.
          const waitForMore = narrationMode && hasIncompleteNarration(this.buffer);
          const ready = this.flushed && !waitForMore
            ? chunks.slice(emittedUpTo)
            : chunks.slice(emittedUpTo, Math.max(0, chunks.length - 1));

          for (const chunk of ready) {
            if (signal.aborted) return;

            for await (const audio of this.backend.synthesize(
              chunk,
              signal
            )) {
              if (signal.aborted) return;

              // Wait if buffer is full
              while (queue.length >= prefetchSize && !signal.aborted) {
                await waitForSpace();
              }
              if (signal.aborted) return;

              queue.push(audio);
              notifyConsumer();
            }
            emittedUpTo++;
          }

          if (this.flushed && emittedUpTo >= chunks.length) {
            return;
          }

          // Wait for more text (event-driven via push/flush notification)
          this.pendingChange = false;
          await this.waitForChange();
        }
      } catch (err) {
        producerError = err instanceof Error ? err : new Error(String(err));
      } finally {
        producerDone = true;
        notifyConsumer();
      }
    };

    // Start producer (fire-and-forget, runs concurrently)
    const producerPromise = produce();

    // --- Consumer: yield from queue ---
    try {
      while (!signal.aborted) {
        if (queue.length > 0) {
          yield queue.shift()!;
          notifyProducer();
        } else if (producerDone) {
          if (producerError) throw producerError;
          return;
        } else {
          await waitForChunk();
        }
      }
    } finally {
      // Ensure producer settles
      await producerPromise.catch(() => {});
    }
  }
}
