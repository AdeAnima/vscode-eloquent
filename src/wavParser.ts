import type { AudioChunk } from "./types";

/**
 * Parse a WAV buffer into an AudioChunk (Float32 PCM data + sample rate).
 * Supports 16-bit and 32-bit PCM WAV files.
 */
export function parseWav(buffer: Buffer): AudioChunk {
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);

  let dataOffset = 12;
  while (dataOffset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);
    if (chunkId === "data") {
      dataOffset += 8;
      const pcmData = buffer.subarray(dataOffset, dataOffset + chunkSize);
      const samples = pcmToFloat32(pcmData, bitsPerSample);
      return { samples, sampleRate };
    }
    dataOffset += 8 + chunkSize;
  }
  throw new Error("Invalid WAV: no data chunk");
}

/** Convert raw PCM bytes to Float32Array. Supports 16-bit and 32-bit. */
export function pcmToFloat32(pcm: Buffer, bitsPerSample: number): Float32Array {
  if (bitsPerSample === 16) {
    const samples = new Float32Array(pcm.length / 2);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = pcm.readInt16LE(i * 2) / 32768;
    }
    return samples;
  }
  if (bitsPerSample === 32) {
    return new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
  }
  throw new Error(`Unsupported WAV bits per sample: ${bitsPerSample}`);
}
