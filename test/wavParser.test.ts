import { describe, it, expect } from "vitest";
import { parseWav, pcmToFloat32 } from "../src/wavParser";
import { encodeWav } from "../src/player";

/** Build a minimal valid WAV buffer with the given PCM data. */
function buildWav(
  samples: Float32Array,
  sampleRate = 24000,
  bitsPerSample = 16
): Buffer {
  // Use encodeWav to produce a known-good WAV, then parseWav should round-trip
  if (bitsPerSample === 16) {
    return encodeWav({ samples, sampleRate });
  }
  // For 32-bit, build manually
  const numChannels = 1;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = samples.length * bytesPerSample;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // IEEE float
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
  buf.writeUInt16LE(numChannels * bytesPerSample, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < samples.length; i++) {
    buf.writeFloatLE(samples[i], 44 + i * 4);
  }
  return buf;
}

// ─── parseWav ─────────────────────────────────────────────────────────────────

describe("parseWav", () => {
  it("round-trips 16-bit WAV through encodeWav → parseWav", () => {
    const original = new Float32Array([0.0, 0.5, -0.5, 1.0, -1.0]);
    const wavBuf = encodeWav({ samples: original, sampleRate: 24000 });
    const result = parseWav(wavBuf);

    expect(result.sampleRate).toBe(24000);
    expect(result.samples.length).toBe(original.length);

    // 16-bit quantization loses precision, check within tolerance
    for (let i = 0; i < original.length; i++) {
      expect(result.samples[i]).toBeCloseTo(original[i], 2);
    }
  });

  it("parses 32-bit float WAV", () => {
    const original = new Float32Array([0.25, -0.75, 0.0]);
    const wavBuf = buildWav(original, 48000, 32);
    const result = parseWav(wavBuf);

    expect(result.sampleRate).toBe(48000);
    expect(result.samples.length).toBe(3);
    for (let i = 0; i < original.length; i++) {
      expect(result.samples[i]).toBeCloseTo(original[i], 5);
    }
  });

  it("parses WAV with extra chunks before data", () => {
    // Build a WAV with a fake "LIST" chunk before "data"
    const samples = new Float32Array([0.1, 0.2]);
    const standardWav = encodeWav({ samples, sampleRate: 24000 });

    // Insert a dummy chunk after fmt (at offset 36) before data
    const dummyChunk = Buffer.alloc(16);
    dummyChunk.write("LIST", 0);
    dummyChunk.writeUInt32LE(8, 4); // chunk size = 8 bytes of data
    dummyChunk.write("testdata", 8);

    const extended = Buffer.concat([
      standardWav.subarray(0, 36), // RIFF + fmt
      dummyChunk,
      standardWav.subarray(36),     // data chunk
    ]);
    // Fix RIFF size
    extended.writeUInt32LE(extended.length - 8, 4);

    const result = parseWav(extended);
    expect(result.sampleRate).toBe(24000);
    expect(result.samples.length).toBe(2);
  });

  it("throws on buffer with no data chunk", () => {
    // Minimal RIFF header with no data chunk
    const buf = Buffer.alloc(44);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(24000, 24);
    buf.writeUInt32LE(48000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    // No "data" chunk — fill with zeros
    buf.write("xxxx", 36);

    expect(() => parseWav(buf)).toThrow("Invalid WAV: no data chunk");
  });

  it("handles empty PCM data", () => {
    const emptyWav = encodeWav({ samples: new Float32Array([]), sampleRate: 24000 });
    const result = parseWav(emptyWav);
    expect(result.samples.length).toBe(0);
    expect(result.sampleRate).toBe(24000);
  });
});

// ─── pcmToFloat32 ─────────────────────────────────────────────────────────────

describe("pcmToFloat32", () => {
  it("converts 16-bit PCM to float", () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(0, 0);     // 0.0
    pcm.writeInt16LE(16384, 2); // 0.5

    const result = pcmToFloat32(pcm, 16);
    expect(result.length).toBe(2);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(0.5, 2);
  });

  it("converts 32-bit float PCM", () => {
    const pcm = Buffer.alloc(8);
    pcm.writeFloatLE(0.25, 0);
    pcm.writeFloatLE(-0.75, 4);

    const result = pcmToFloat32(pcm, 32);
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0.25, 5);
    expect(result[1]).toBeCloseTo(-0.75, 5);
  });

  it("throws on unsupported bit depth", () => {
    const pcm = Buffer.alloc(3);
    expect(() => pcmToFloat32(pcm, 24)).toThrow("Unsupported WAV bits per sample: 24");
  });
});
