/**
 * Audio chunk produced by a TTS backend.
 * PCM data at 24 kHz, mono, 32-bit float.
 */
export interface AudioChunk {
  /** Raw PCM samples (Float32Array) at 24 kHz mono */
  samples: Float32Array;
  sampleRate: number;
}

/**
 * Common interface every TTS backend must implement.
 * Each backend handles its own model loading and lifecycle.
 */
export interface TtsBackend {
  /** Human-readable name for status bar / logs */
  readonly name: string;

  /** Load the model. Resolves when ready to synthesize. */
  initialize(): Promise<void>;

  /**
   * Synthesize a single pre-chunked text segment into audio.
   * Callers are responsible for splitting text into sentence-level chunks
   * (via `chunkText()` or `ChunkedSynthesizer`) before calling this method.
   *
   * @param text Pre-chunked text segment to synthesize
   * @param signal Abort signal — backend must stop generating when triggered
   */
  synthesize(text: string, signal: AbortSignal): AsyncIterable<AudioChunk>;

  /** Release resources (model, processes, temp files). */
  dispose(): void;
}

export type BackendId = "kokoro" | "f5-python" | "custom";

/** Kokoro ONNX backend configuration. */
export interface KokoroConfig {
  dtype: string;
  voice: string;
  extensionPath: string;
}

/** F5-TTS Python/MLX backend configuration. */
export interface F5Config {
  storageDir: string;
  serverScript: string;
  port: number;
  refAudioPath: string;
  refText: string;
  quantization: string;
  /** Synthesis HTTP request timeout in ms. Defaults to 120000 (2 min). */
  synthesisTimeout?: number;
}

/** Custom HTTP endpoint backend configuration. */
export interface CustomConfig {
  endpoint: string;
  /** Health-check timeout in ms. Defaults to 5000 (5 s). */
  healthCheckTimeout?: number;
  /** Synthesis HTTP request timeout in ms. Defaults to 120000 (2 min). */
  synthesisTimeout?: number;
}

export interface BackendConfig {
  id: BackendId;
  label: string;
  description: string;
  requiresPython: boolean;
}

export const BACKENDS: BackendConfig[] = [
  {
    id: "kokoro",
    label: "Kokoro (Recommended)",
    description:
      "82M-param model, runs in Node.js via ONNX Runtime. No Python needed. 50+ voices. ~80 MB download.",
    requiresPython: false,
  },
  {
    id: "f5-python",
    label: "F5-TTS (Voice Cloning)",
    description:
      "330M-param model on Apple Silicon via MLX. Supports voice cloning. Auto-downloads a standalone Python runtime (~1.5 GB total).",
    requiresPython: true,
  },
  {
    id: "custom",
    label: "Custom Endpoint",
    description:
      "Bring your own TTS server. Point the extension at any HTTP endpoint that accepts POST /synthesize with { text } and returns WAV audio.",
    requiresPython: false,
  },
];
