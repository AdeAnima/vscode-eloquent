import { describe, it, expect, vi, beforeEach } from "vitest";
import { KokoroBackend } from "../src/backends/kokoro";
import type { AudioChunk } from "../src/types";

// Mock the installer so initialize doesn't try to npm install
vi.mock("../src/installer", () => ({
  ensureKokoroInstalled: vi.fn().mockResolvedValue(undefined),
}));

describe("KokoroBackend", () => {
  it("has correct name", () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "" });
    expect(backend.name).toBe("Kokoro");
  });

  it("synthesize throws when not initialized", async () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "" });
    const abort = new AbortController();

    await expect(async () => {
      for await (const _chunk of backend.synthesize("Hello.", abort.signal)) {
        // should not reach here
      }
    }).rejects.toThrow("Kokoro backend not initialized");
  });

  it("synthesize yields chunks from the TTS model", async () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "/tmp/fake" });

    // Directly set the internal tts object to a mock
    (backend as any).tts = {
      generate: vi.fn().mockResolvedValue({
        audio: new Float32Array([0.1, 0.2, 0.3]),
        sampling_rate: 24000,
      }),
    };

    const abort = new AbortController();
    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize("Hello.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    expect(chunks[0].samples).toBeInstanceOf(Float32Array);
    expect(chunks[0].sampleRate).toBe(24000);
    expect((backend as any).tts.generate).toHaveBeenCalledWith("Hello.", {
      voice: "af_heart",
    });
  });

  it("synthesize handles non-Float32Array audio result", async () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "am_michael", extensionPath: "/tmp/fake" });

    // Some kokoro-js versions return a plain array
    (backend as any).tts = {
      generate: vi.fn().mockResolvedValue({
        audio: [0.4, 0.5, 0.6],
        sampling_rate: 22050,
      }),
    };

    const abort = new AbortController();
    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize("Test.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    expect(chunks[0].samples).toBeInstanceOf(Float32Array);
    expect(chunks[0].sampleRate).toBe(22050);
  });

  it("synthesize defaults to 24000 when sampling_rate missing", async () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "" });

    (backend as any).tts = {
      generate: vi.fn().mockResolvedValue({
        audio: new Float32Array([0.1]),
        // no sampling_rate
      }),
    };

    const abort = new AbortController();
    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize("Hi.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks[0].sampleRate).toBe(24000);
  });

  it("synthesize respects abort signal", async () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "" });

    const generateFn = vi.fn().mockResolvedValue({
      audio: new Float32Array([0.1]),
      sampling_rate: 24000,
    });
    (backend as any).tts = { generate: generateFn };

    const abort = new AbortController();
    abort.abort(); // Pre-abort

    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize(
      "Hello. World. Test.",
      abort.signal
    )) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(0);
    expect(generateFn).not.toHaveBeenCalled();
  });

  it("synthesize stops after abort mid-generation", async () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "" });

    const generateFn = vi.fn().mockImplementation(async () => {
      return {
        audio: new Float32Array([0.1]),
        sampling_rate: 24000,
      };
    });
    (backend as any).tts = { generate: generateFn };

    const abort = new AbortController();
    // Backend now receives pre-chunked text, so a single call yields one chunk.
    // Abort after first chunk means it still produces one.
    const chunks: AudioChunk[] = [];

    for await (const chunk of backend.synthesize(
      "Sentence one.",
      abort.signal
    )) {
      chunks.push(chunk);
      abort.abort(); // Abort after first chunk
    }

    expect(chunks.length).toBe(1);
  });

  it("dispose nulls the tts instance", () => {
    const backend = new KokoroBackend({ dtype: "q8", voice: "af_heart", extensionPath: "" });
    (backend as any).tts = { generate: vi.fn() };

    backend.dispose();
    expect((backend as any).tts).toBeNull();
  });
});
