import type { AudioChunk, TtsBackend } from "../types";
import { parseWav } from "../wavParser";
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
    if (signal.aborted) return;

    const url = new URL(this.endpoint);
    const client = url.protocol === "https:" ? https : http;
    const body = JSON.stringify({ text });

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

    yield parseWav(wavBuffer);
  }

  dispose(): void {
    // Nothing to clean up
  }
}
