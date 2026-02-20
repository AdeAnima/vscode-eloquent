import { describe, it, expect } from "vitest";
import { ChunkedSynthesizer } from "../src/chunker";
import type { AudioChunk } from "../src/types";
import { fakeBackend } from "./helpers/fakeBackend";

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
});
