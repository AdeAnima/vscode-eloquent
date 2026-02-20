import { ChildProcess, execFile } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as vscode from "vscode";
import type { AudioChunk } from "./types";

/**
 * Plays AudioChunks sequentially using platform-native commands.
 * Writes each chunk to a temp WAV file and plays it, then cleans up.
 * Reads eloquent.speed setting for playback rate control.
 *
 * Cancellation: call stop() to kill the current playback process.
 */
export class AudioPlayer {
  private playbackProcess: ChildProcess | null = null;
  private stopped = false;
  private _paused = false;
  private resumeResolve: (() => void) | null = null;

  get paused(): boolean {
    return this._paused;
  }

  pause(): void {
    this._paused = true;
    if (this.playbackProcess) {
      this.playbackProcess.kill("SIGSTOP");
    }
  }

  resume(): void {
    this._paused = false;
    if (this.playbackProcess) {
      this.playbackProcess.kill("SIGCONT");
    }
    const fn = this.resumeResolve;
    this.resumeResolve = null;
    fn?.();
  }

  stop(): void {
    this.stopped = true;
    this._paused = false;
    const fn = this.resumeResolve;
    this.resumeResolve = null;
    fn?.();
    if (this.playbackProcess) {
      // Resume first (SIGTERM on a stopped process is deferred on macOS)
      this.playbackProcess.kill("SIGCONT");
      this.playbackProcess.kill("SIGTERM");
      this.playbackProcess = null;
    }
  }

  async play(chunk: AudioChunk): Promise<void> {
    if (this.stopped) return;

    // If paused between chunks, wait until resumed
    if (this._paused) {
      await new Promise<void>((resolve) => {
        this.resumeResolve = resolve;
      });
    }

    if (this.stopped) return;

    const tmpFile = path.join(os.tmpdir(), `eloquent-${Date.now()}.wav`);
    try {
      fs.writeFileSync(tmpFile, this.encodeWav(chunk));
      await this.playFile(tmpFile);
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  }

  private playFile(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        resolve();
        return;
      }

      let cmd: string;
      let args: string[];

      const speed = vscode.workspace
        .getConfiguration("eloquent")
        .get<number>("speed", 1.0);

      if (process.platform === "darwin") {
        cmd = "afplay";
        args = ["-r", String(speed), filePath];
      } else if (process.platform === "linux") {
        cmd = "aplay";
        args = ["-q", filePath];
      } else {
        cmd = "powershell";
        args = [
          "-c",
          `(New-Object Media.SoundPlayer '${filePath}').PlaySync()`,
        ];
      }

      this.playbackProcess = execFile(cmd, args, (err) => {
        this.playbackProcess = null;
        if (err) {
          if ((err as any).signal === "SIGTERM") {
            resolve(); // Expected from stop()
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  }

  private encodeWav(chunk: AudioChunk): Buffer {
    const { samples, sampleRate } = chunk;
    const bitsPerSample = 16;
    const numChannels = 1;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = samples.length * bytesPerSample;
    const headerSize = 44;
    const buffer = Buffer.alloc(headerSize + dataSize);

    // RIFF header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    // fmt chunk
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28);
    buffer.writeUInt16LE(numChannels * bytesPerSample, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // Convert float32 → int16
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      buffer.writeInt16LE(Math.round(clamped * 32767), headerSize + i * 2);
    }

    return buffer;
  }
}
