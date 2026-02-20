import type { AudioChunk, KokoroConfig, TtsBackend } from "../types";
import { ensureKokoroInstalled } from "../installer";

/**
 * Kokoro.js TTS backend — pure Node.js, ONNX Runtime, no Python dependency.
 *
 * Uses the `kokoro-js` npm package which bundles ONNX Runtime and runs
 * the Kokoro-82M model with CPU inference.  Auto-installs the npm package
 * on first use if not already present.
 */
export class KokoroBackend implements TtsBackend {
  readonly name = "Kokoro";
  private tts: any = null;

  constructor(private readonly config: KokoroConfig) {}

  async initialize(): Promise<void> {
    // Install kokoro-js if not yet in node_modules
    await ensureKokoroInstalled(this.config.extensionPath);

    // Dynamic import — kokoro-js is an ESM-only package
    const { KokoroTTS } = await import("kokoro-js");
    this.tts = await KokoroTTS.from_pretrained(
      "onnx-community/Kokoro-82M-v1.0-ONNX",
      {
        dtype: this.config.dtype as any,
        device: "cpu",
      }
    );
  }

  async *synthesize(
    text: string,
    signal: AbortSignal
  ): AsyncIterable<AudioChunk> {
    if (!this.tts) {
      throw new Error("Kokoro backend not initialized");
    }

    if (signal.aborted) return;

    const result = await this.tts.generate(text, { voice: this.config.voice });

    if (signal.aborted) return;

    // kokoro-js returns { audio: Float32Array, sampling_rate: number }
    // or an object with a .toWav() / data property — normalize here
    const samples =
      result.audio instanceof Float32Array
        ? result.audio
        : new Float32Array(result.audio);

    yield { samples, sampleRate: result.sampling_rate ?? 24000 };
  }

  dispose(): void {
    this.tts = null;
  }
}
