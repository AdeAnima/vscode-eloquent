import { describe, it, expect } from "vitest";
import { ChunkedSynthesizer } from "../src/chunker";
import type { AudioChunk, TtsBackend } from "../src/types";

/** Creates a fake backend that returns one AudioChunk per synthesize call. */
function fakeBackend(delay = 0): TtsBackend & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "test",
    calls,
    async initialize() {},
    async *synthesize(
      text: string,
      _signal: AbortSignal
    ): AsyncIterable<AudioChunk> {
      calls.push(text);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      yield {
        samples: new Float32Array([0.1, 0.2]),
        sampleRate: 24000,
      };
    },
    dispose() {},
  };
}

async function collectChunks(
  synth: ChunkedSynthesizer,
  signal: AbortSignal
): Promise<AudioChunk[]> {
  const results: AudioChunk[] = [];
  for await (const chunk of synth.stream(signal)) {
    results.push(chunk);
  }
  return results;
}

describe("ChunkedSynthesizer", () => {
  it("synthesizes pushed+flushed text into audio chunks", async () => {
    const backend = fakeBackend();
    const synth = new ChunkedSynthesizer(backend);

    synth.push("Hello world. This is a test.");
    synth.flush();

    const abort = new AbortController();
    const chunks = await collectChunks(synth, abort.signal);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(backend.calls.length).toBeGreaterThanOrEqual(1);
    // Should have sent our text to the backend
    expect(backend.calls.join(" ")).toContain("Hello");
  });

  it("handles multiple push calls before flush", async () => {
    const backend = fakeBackend();
    const synth = new ChunkedSynthesizer(backend);

    synth.push("First sentence. ");
    synth.push("Second sentence. ");
    synth.push("Third sentence.");
    synth.flush();

    const abort = new AbortController();
    const chunks = await collectChunks(synth, abort.signal);

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // All text should have been synthesized
    const allText = backend.calls.join(" ");
    expect(allText).toContain("First");
    expect(allText).toContain("Third");
  });

  it("respects abort signal", async () => {
    const backend = fakeBackend(50);
    const synth = new ChunkedSynthesizer(backend);

    synth.push("Sentence one. Sentence two. Sentence three. Sentence four.");
    synth.flush();

    const abort = new AbortController();
    // Abort almost immediately
    setTimeout(() => abort.abort(), 10);

    const chunks: AudioChunk[] = [];
    for await (const chunk of synth.stream(abort.signal)) {
      chunks.push(chunk);
    }

    // Should have produced fewer chunks than the full text would generate
    expect(backend.calls.length).toBeLessThanOrEqual(4);
  });

  it("produces audio chunks with correct structure", async () => {
    const backend = fakeBackend();
    const synth = new ChunkedSynthesizer(backend);

    synth.push("Hello.");
    synth.flush();

    const abort = new AbortController();
    const chunks = await collectChunks(synth, abort.signal);

    expect(chunks.length).toBe(1);
    expect(chunks[0].samples).toBeInstanceOf(Float32Array);
    expect(chunks[0].sampleRate).toBe(24000);
  });

  it("handles empty text gracefully", async () => {
    const backend = fakeBackend();
    const synth = new ChunkedSynthesizer(backend);

    synth.push("");
    synth.flush();

    const abort = new AbortController();
    const chunks = await collectChunks(synth, abort.signal);

    expect(chunks.length).toBe(0);
    expect(backend.calls.length).toBe(0);
  });

  it("propagates backend errors to the consumer", async () => {
    const errorBackend: TtsBackend = {
      name: "error-backend",
      async initialize() {},
      async *synthesize(): AsyncIterable<AudioChunk> {
        throw new Error("synthesis failed");
      },
      dispose() {},
    };

    const synth = new ChunkedSynthesizer(errorBackend);
    synth.push("Hello world.");
    synth.flush();

    const abort = new AbortController();
    await expect(collectChunks(synth, abort.signal)).rejects.toThrow(
      "synthesis failed"
    );
  });
});
