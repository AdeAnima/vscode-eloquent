import { vi } from "vitest";
import type { AudioChunk, TtsBackend } from "../../src/types";

export interface FakeBackendOptions {
  /** Delay in ms before yielding audio (simulates slow synthesis). */
  delay?: number;
  /** If set, synthesize() throws when text contains this substring. */
  failOnText?: string;
  /** If true, initialize() rejects with "init failed". */
  initFail?: boolean;
}

export interface FakeBackend extends TtsBackend {
  /** All text strings passed to synthesize(). */
  calls: string[];
  /** Whether dispose() has been called. */
  disposed: boolean;
}

/**
 * Configurable fake TTS backend for tests.
 *
 * Covers all test scenarios: delay, failure injection, init failure,
 * call tracking, and dispose tracking.
 */
export function fakeBackend(opts?: FakeBackendOptions): FakeBackend {
  const calls: string[] = [];
  let disposed = false;

  return {
    name: "FakeBackend",
    calls,
    get disposed() { return disposed; },
    initialize: opts?.initFail
      ? vi.fn().mockRejectedValue(new Error("init failed"))
      : vi.fn().mockResolvedValue(undefined),
    async *synthesize(
      text: string,
      signal: AbortSignal
    ): AsyncIterable<AudioChunk> {
      calls.push(text);
      if (opts?.failOnText && text.includes(opts.failOnText)) {
        throw new Error(`synthesis failed: ${opts.failOnText}`);
      }
      if (opts?.delay) await new Promise((r) => setTimeout(r, opts.delay));
      if (signal.aborted) return;
      yield { samples: new Float32Array([0.1, 0.2]), sampleRate: 24000 };
    },
    dispose: vi.fn(() => { disposed = true; }),
  };
}
