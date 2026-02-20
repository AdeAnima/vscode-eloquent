import { describe, it, expect, vi, beforeEach } from "vitest";
import { AudioPlayer, encodeWav } from "../src/player";
import type { AudioChunk } from "../src/types";

// ─── encodeWav ────────────────────────────────────────────────────────────────

describe("encodeWav", () => {
  const chunk: AudioChunk = {
    samples: new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]),
    sampleRate: 24000,
  };

  it("produces a valid WAV header", () => {
    const buf = encodeWav(chunk);

    // RIFF header
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");

    // fmt chunk
    expect(buf.toString("ascii", 12, 16)).toBe("fmt ");
    expect(buf.readUInt32LE(16)).toBe(16); // fmt chunk size
    expect(buf.readUInt16LE(20)).toBe(1); // PCM format
    expect(buf.readUInt16LE(22)).toBe(1); // mono
    expect(buf.readUInt32LE(24)).toBe(24000); // sample rate
    expect(buf.readUInt16LE(34)).toBe(16); // bits per sample

    // data chunk
    expect(buf.toString("ascii", 36, 40)).toBe("data");
    expect(buf.readUInt32LE(40)).toBe(chunk.samples.length * 2); // data size
  });

  it("has correct total buffer size", () => {
    const buf = encodeWav(chunk);
    expect(buf.length).toBe(44 + chunk.samples.length * 2);
  });

  it("writes correct RIFF file size", () => {
    const buf = encodeWav(chunk);
    const dataSize = chunk.samples.length * 2;
    expect(buf.readUInt32LE(4)).toBe(36 + dataSize);
  });

  it("converts float samples to int16 correctly", () => {
    const buf = encodeWav(chunk);
    const headerSize = 44;

    // 0.0 → 0
    expect(buf.readInt16LE(headerSize + 0)).toBe(0);
    // 0.5 → ~16384
    expect(buf.readInt16LE(headerSize + 2)).toBe(Math.round(0.5 * 32767));
    // -0.5 → ~-16384
    expect(buf.readInt16LE(headerSize + 4)).toBe(Math.round(-0.5 * 32767));
    // 1.0 → 32767 (clamped)
    expect(buf.readInt16LE(headerSize + 6)).toBe(32767);
    // -1.0 → -32767 (clamped)
    expect(buf.readInt16LE(headerSize + 8)).toBe(-32767);
  });

  it("clamps values beyond [-1, 1]", () => {
    const overdriven: AudioChunk = {
      samples: new Float32Array([2.0, -3.0]),
      sampleRate: 24000,
    };
    const buf = encodeWav(overdriven);
    const headerSize = 44;

    // 2.0 clamped to 1.0 → 32767
    expect(buf.readInt16LE(headerSize + 0)).toBe(32767);
    // -3.0 clamped to -1.0 → -32767
    expect(buf.readInt16LE(headerSize + 2)).toBe(-32767);
  });

  it("handles empty samples", () => {
    const empty: AudioChunk = {
      samples: new Float32Array([]),
      sampleRate: 24000,
    };
    const buf = encodeWav(empty);
    expect(buf.length).toBe(44); // header only
    expect(buf.readUInt32LE(40)).toBe(0); // data size = 0
  });

  it("encodes different sample rates", () => {
    const chunk48k: AudioChunk = {
      samples: new Float32Array([0.1]),
      sampleRate: 48000,
    };
    const buf = encodeWav(chunk48k);
    expect(buf.readUInt32LE(24)).toBe(48000);
    // byte rate = sampleRate * channels * bytesPerSample = 48000 * 1 * 2
    expect(buf.readUInt32LE(28)).toBe(96000);
  });
});

// ─── AudioPlayer state machine ──────────────────────────────────────────────

describe("AudioPlayer", () => {
  let player: AudioPlayer;

  beforeEach(() => {
    player = new AudioPlayer();
  });

  it("starts in unpaused state", () => {
    expect(player.paused).toBe(false);
  });

  it("sets paused state on pause()", () => {
    player.pause();
    expect(player.paused).toBe(true);
  });

  it("clears paused state on resume()", () => {
    player.pause();
    player.resume();
    expect(player.paused).toBe(false);
  });

  it("clears paused state on stop()", () => {
    player.pause();
    player.stop();
    expect(player.paused).toBe(false);
  });

  it("play() returns immediately after stop()", async () => {
    player.stop();
    // Should not throw or hang
    await player.play({
      samples: new Float32Array([0.1]),
      sampleRate: 24000,
    });
  });

  it("play() resolves when resumed after being paused then stopped", async () => {
    player.pause();
    // Stop should resolve the pause wait
    setTimeout(() => player.stop(), 10);
    await player.play({
      samples: new Float32Array([0.1]),
      sampleRate: 24000,
    });
  });
});
