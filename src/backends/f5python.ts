import type { AudioChunk, F5Config, TtsBackend } from "../types";
import { parseWav } from "../wavParser";
import { ensurePythonEnvironment } from "../installer";
import { ChildProcess, spawn } from "child_process";
import * as http from "http";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

/**
 * F5-TTS-MLX backend via python-build-standalone.
 *
 * Auto-downloads a self-contained Python runtime on first use
 * (no user-installed Python required), installs f5-tts-mlx into it,
 * then runs the existing tts_server.py as an HTTP subprocess.
 */
export class F5PythonBackend implements TtsBackend {
  readonly name = "F5-TTS (Python)";

  private process: ChildProcess | null = null;
  private ready = false;

  constructor(private readonly config: F5Config) {}

  async initialize(): Promise<void> {
    const pythonPath = await this.ensurePython();
    await this.startServer(pythonPath);
  }

  async *synthesize(
    text: string,
    signal: AbortSignal
  ): AsyncIterable<AudioChunk> {
    if (!this.ready) {
      throw new Error("F5-TTS server not ready");
    }

    if (signal.aborted) return;

    const tmpFile = path.join(os.tmpdir(), `eloquent-${Date.now()}.wav`);
    try {
      await this.requestSynthesis(text, tmpFile);
      if (signal.aborted) return;

      const wavBuffer = fs.readFileSync(tmpFile);
      yield parseWav(wavBuffer);
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  }

  dispose(): void {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.ready = false;
  }

  // --- Python runtime management ---

  private async ensurePython(): Promise<string> {
    return ensurePythonEnvironment(this.config.storageDir);
  }

  // --- Server lifecycle ---

  private startServer(pythonPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [this.config.serverScript, "--port", String(this.config.port)];
      if (this.config.refAudioPath) {
        args.push("--ref-audio", this.config.refAudioPath);
      }
      if (this.config.refText) {
        args.push("--ref-text", this.config.refText);
      }
      if (this.config.quantization !== "none") {
        args.push("--quantize", this.config.quantization);
      }

      this.process = spawn(pythonPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });

      const timeout = setTimeout(() => {
        reject(new Error("F5-TTS server failed to start within 60s"));
      }, 60_000);

      this.process.stdout?.on("data", (data: Buffer) => {
        if (data.toString().includes("READY")) {
          this.ready = true;
          clearTimeout(timeout);
          resolve();
        }
      });

      this.process.on("exit", () => {
        this.ready = false;
        this.process = null;
        clearTimeout(timeout);
      });

      this.process.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // --- HTTP synthesis ---

  private requestSynthesis(
    text: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ text, output_path: outputPath });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.config.port,
          path: "/synthesize",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 120_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: string) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) resolve();
            else reject(new Error(`Server returned ${res.statusCode}: ${data}`));
          });
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Synthesis request timed out"));
      });
      req.write(body);
      req.end();
    });
  }
}
