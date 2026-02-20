declare module "kokoro-js" {
  interface KokoroTTSOptions {
    dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
    device?: "cpu" | "wasm" | "webgpu";
  }

  interface GenerateOptions {
    voice?: string;
    speed?: number;
  }

  interface StreamGenerateOptions extends GenerateOptions {
    split_pattern?: RegExp | null;
  }

  interface GenerateResult {
    audio: Float32Array;
    sampling_rate: number;
  }

  interface StreamResult {
    text: string;
    phonemes: string;
    audio: RawAudio;
  }

  export class RawAudio {
    readonly data: Float32Array;
    readonly sampling_rate: number;
    constructor(data: Float32Array, sampling_rate: number);
    save(path: string): void;
  }

  export class KokoroTTS {
    static from_pretrained(
      modelId: string,
      options?: KokoroTTSOptions
    ): Promise<KokoroTTS>;

    generate(text: string, options?: GenerateOptions): Promise<GenerateResult>;
    stream(
      text: string | TextSplitterStream,
      options?: StreamGenerateOptions
    ): AsyncGenerator<StreamResult, void, void>;
    list_voices(): string[];
  }

  export class TextSplitterStream {
    push(...texts: string[]): void;
    flush(): void;
    close(): void;
    readonly sentences: string[];
    [Symbol.asyncIterator](): AsyncIterator<string>;
  }
}
