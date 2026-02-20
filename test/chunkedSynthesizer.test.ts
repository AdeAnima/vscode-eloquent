import { describe, it, expect, vi } from "vitest";
import { ChunkedSynthesizer } from "../src/chunker";
import type { AudioChunk, TtsBackend } from "../src/types";
import { fakeBackend } from "./helpers/fakeBackend";
import { setMockConfig } from "./__mocks__/vscode";

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
    const backend = fakeBackend({ delay: 50 });
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

  it("wakes producer immediately on push (no polling delay)", async () => {
    const backend = fakeBackend();
    const synth = new ChunkedSynthesizer(backend);
    const abort = new AbortController();

    // Start streaming without flushing — producer will await new text
    const chunksPromise = collectChunks(synth, abort.signal);

    // Push a complete sentence then flush; producer should wake up promptly
    synth.push("Hello world.");
    synth.flush();

    const chunks = await chunksPromise;
    expect(chunks.length).toBe(1);
    expect(backend.calls[0]).toContain("Hello");
  });

  it("handles push() during synthesis without losing text", async () => {
    const calls: string[] = [];
    const slowBackend: TtsBackend = {
      name: "slow",
      async initialize() {},
      async *synthesize(text: string): AsyncIterable<AudioChunk> {
        calls.push(text);
        // Simulate slow synthesis
        await new Promise((r) => setTimeout(r, 20));
        yield { samples: new Float32Array([0.1]), sampleRate: 24000 };
      },
      dispose() {},
    };

    const synth = new ChunkedSynthesizer(slowBackend);
    const abort = new AbortController();

    const chunksPromise = collectChunks(synth, abort.signal);

    // Push first sentence, then push more text while first may be synthesizing
    synth.push("First sentence. ");
    await new Promise((r) => setTimeout(r, 5));
    synth.push("Second sentence.");
    synth.flush();

    const chunks = await chunksPromise;
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Both sentences must have been synthesized (possibly merged into one chunk)
    const allText = calls.join(" ");
    expect(allText).toContain("First");
    expect(allText).toContain("Second");
  });

  it("applies backpressure when prefetch buffer is full", async () => {
    // Backend that yields multiple audio chunks per text segment
    let synthesizeCalls = 0;
    const multiChunkBackend: TtsBackend = {
      name: "multi",
      async initialize() {},
      async *synthesize(_text: string): AsyncIterable<AudioChunk> {
        synthesizeCalls++;
        // Yield 3 chunks per synthesize call
        for (let i = 0; i < 3; i++) {
          yield { samples: new Float32Array([0.1 * i]), sampleRate: 24000 };
        }
      },
      dispose() {},
    };

    setMockConfig("eloquent", "prefetchBufferSize", 1);
    const synth = new ChunkedSynthesizer(multiChunkBackend);
    synth.push("First. Second.");
    synth.flush();

    const abort = new AbortController();
    const chunks = await collectChunks(synth, abort.signal);

    // Should have collected all chunks despite small buffer
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(synthesizeCalls).toBeGreaterThanOrEqual(1);
    setMockConfig("eloquent", "prefetchBufferSize");
  });

  it("propagates non-Error throws from backend", async () => {
    const stringThrowBackend: TtsBackend = {
      name: "string-throw",
      async initialize() {},
      async *synthesize(): AsyncIterable<AudioChunk> {
        throw "raw string error";
      },
      dispose() {},
    };

    const synth = new ChunkedSynthesizer(stringThrowBackend);
    synth.push("Hello.");
    synth.flush();

    const abort = new AbortController();
    await expect(collectChunks(synth, abort.signal)).rejects.toThrow(
      "raw string error"
    );
  });

  it("abort during active synthesis stops the producer", async () => {
    let chunkCount = 0;
    const infiniteBackend: TtsBackend = {
      name: "infinite",
      async initialize() {},
      async *synthesize(): AsyncIterable<AudioChunk> {
        // Yield many chunks slowly — abort should interrupt
        for (let i = 0; i < 100; i++) {
          chunkCount++;
          await new Promise((r) => setTimeout(r, 5));
          yield { samples: new Float32Array([0.1]), sampleRate: 24000 };
        }
      },
      dispose() {},
    };

    setMockConfig("eloquent", "prefetchBufferSize", 1);
    const synth = new ChunkedSynthesizer(infiniteBackend);
    synth.push("Hello.");
    synth.flush();

    const abort = new AbortController();
    const chunks: AudioChunk[] = [];
    // Consume one chunk then abort
    for await (const chunk of synth.stream(abort.signal)) {
      chunks.push(chunk);
      if (chunks.length >= 2) {
        abort.abort();
        break;
      }
    }

    expect(chunks.length).toBeLessThanOrEqual(3);
    expect(chunkCount).toBeLessThan(100);
    setMockConfig("eloquent", "prefetchBufferSize");
  });

  describe("narration mode", () => {
    it("only synthesizes text within <speak> tags when enabled", async () => {
      setMockConfig("eloquent", "narrationMode", true);
      const backend = fakeBackend();
      const synth = new ChunkedSynthesizer(backend);

      synth.push("Here is code:\n```js\nconsole.log('hi');\n```\n<speak>I added a console log.</speak>");
      synth.flush();

      const abort = new AbortController();
      const chunks = await collectChunks(synth, abort.signal);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const allText = backend.calls.join(" ");
      expect(allText).toContain("console log");
      expect(allText).not.toContain("```");
      setMockConfig("eloquent", "narrationMode");
    });

    it("produces no audio when narration mode is on but no <speak> tags present", async () => {
      setMockConfig("eloquent", "narrationMode", true);
      const backend = fakeBackend();
      const synth = new ChunkedSynthesizer(backend);

      synth.push("Just regular text without any speak tags.");
      synth.flush();

      const abort = new AbortController();
      const chunks = await collectChunks(synth, abort.signal);

      expect(chunks.length).toBe(0);
      expect(backend.calls.length).toBe(0);
      setMockConfig("eloquent", "narrationMode");
    });

    it("synthesizes everything when narration mode is off", async () => {
      setMockConfig("eloquent", "narrationMode", false);
      const backend = fakeBackend();
      const synth = new ChunkedSynthesizer(backend);

      synth.push("Hello world. <speak>Narration here.</speak>");
      synth.flush();

      const abort = new AbortController();
      const chunks = await collectChunks(synth, abort.signal);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Both regular text and speak content should be present since narration mode is off
      const allText = backend.calls.join(" ");
      expect(allText).toContain("Hello");
      setMockConfig("eloquent", "narrationMode");
    });

    it("waits for incomplete <speak> blocks before synthesizing", async () => {
      setMockConfig("eloquent", "narrationMode", true);
      const backend = fakeBackend();
      const synth = new ChunkedSynthesizer(backend);
      const abort = new AbortController();

      const chunksPromise = collectChunks(synth, abort.signal);

      // Push incomplete <speak> tag — should not synthesize yet
      synth.push("Code here.\n<speak>Starting to narrate");
      await new Promise((r) => setTimeout(r, 30));
      expect(backend.calls.length).toBe(0);

      // Complete the tag and flush
      synth.push("... done.</speak>");
      synth.flush();

      const chunks = await chunksPromise;
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const allText = backend.calls.join(" ");
      expect(allText).toContain("narrate");
      setMockConfig("eloquent", "narrationMode");
    });
  });
});
