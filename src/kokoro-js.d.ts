declare module "kokoro-js" {
  interface KokoroTTSOptions {
    dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
    device?: "cpu" | "wasm" | "webgpu";
  }

  interface GenerateOptions {
    voice?: string;
    speed?: number;
  }

  interface GenerateResult {
    audio: Float32Array;
    sampling_rate: number;
  }

  export class KokoroTTS {
    static from_pretrained(
      modelId: string,
      options?: KokoroTTSOptions
    ): Promise<KokoroTTS>;

    generate(text: string, options?: GenerateOptions): Promise<GenerateResult>;
    list_voices(): string[];
  }

  export class TextSplitterStream {
    push(text: string): void;
    flush(): void;
    close(): void;
  }
}
