import type { AudioChunk, TtsBackend } from "../types";
import { chunkText } from "../chunker";
import * as http from "http";
import * as https from "https";

/**
 * Custom TTS backend — bring your own HTTP endpoint.
 *
 * Expects:
 *   POST /synthesize  { "text": "..." }
 *   → 200 with WAV body (audio/wav) or JSON { "audio": base64, "sample_rate": 24000 }
 */
export class CustomBackend implements TtsBackend {
  readonly name = "Custom Endpoint";

  constructor(private readonly endpoint: string) {}

  async initialize(): Promise<void> {
    // Validate endpoint is reachable
    const url = new URL(this.endpoint);
    const client = url.protocol === "https:" ? https : http;

    await new Promise<void>((resolve, reject) => {
      const req = client.get(
        `${url.origin}/health`,
        { timeout: 5000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else
            reject(
              new Error(
                `Custom TTS endpoint health check failed: ${res.statusCode}`
              )
            );
        }
      );
      req.on("error", () => {
        // /health may not exist — that's okay, just warn
        resolve();
      });
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Custom TTS endpoint timed out"));
      });
    });
  }

  async *synthesize(
    text: string,
    signal: AbortSignal
  ): AsyncIterable<AudioChunk> {
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      if (signal.aborted) return;

      const url = new URL(this.endpoint);
      const client = url.protocol === "https:" ? https : http;
      const body = JSON.stringify({ text: chunk });

      const wavBuffer = await new Promise<Buffer>((resolve, reject) => {
        const req = client.request(
          `${url.origin}/synthesize`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            timeout: 120_000,
          },
          (res) => {
            const parts: Buffer[] = [];
            res.on("data", (chunk: Buffer) => parts.push(chunk));
            res.on("end", () => {
              if (res.statusCode === 200) {
                resolve(Buffer.concat(parts));
              } else {
                reject(
                  new Error(
                    `Custom TTS returned ${res.statusCode}: ${Buffer.concat(parts).toString()}`
                  )
                );
              }
            });
          }
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("Custom TTS request timed out"));
        });
        req.write(body);
        req.end();
      });

      if (signal.aborted) return;

      const audioData = this.parseWav(wavBuffer);
      yield audioData;
    }
  }

  dispose(): void {
    // Nothing to clean up
  }

  private parseWav(buffer: Buffer): AudioChunk {
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);

    let dataOffset = 12;
    while (dataOffset < buffer.length - 8) {
      const chunkId = buffer.toString("ascii", dataOffset, dataOffset + 4);
      const chunkSize = buffer.readUInt32LE(dataOffset + 4);
      if (chunkId === "data") {
        dataOffset += 8;
        const pcmData = buffer.subarray(dataOffset, dataOffset + chunkSize);
        const samples = this.pcmToFloat32(pcmData, bitsPerSample);
        return { samples, sampleRate };
      }
      dataOffset += 8 + chunkSize;
    }
    throw new Error("Invalid WAV: no data chunk");
  }

  private pcmToFloat32(pcm: Buffer, bitsPerSample: number): Float32Array {
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
}
