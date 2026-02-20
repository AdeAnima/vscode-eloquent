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
   * Synthesize text into audio chunks.
   * The backend splits text into speakable pieces internally and yields
   * one AudioChunk per piece — this is chunk-level streaming.
   *
   * @param text Full text to synthesize
   * @param signal Abort signal — backend must stop generating when triggered
   */
  synthesize(text: string, signal: AbortSignal): AsyncIterable<AudioChunk>;

  /** Release resources (model, processes, temp files). */
  dispose(): void;
}

export type BackendId = "kokoro" | "f5-python" | "custom";

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
