import * as vscode from "vscode";
import { ChildProcess, spawn, execFile } from "child_process";
import * as http from "http";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

export class TtsServerManager {
  private process: ChildProcess | null = null;
  private playbackProcess: ChildProcess | null = null;
  private ready = false;
  private starting = false;
  private pythonPath: string;
  private port: number;
  private statusBar: vscode.StatusBarItem;
  private outputChannel: vscode.OutputChannel;

  constructor(
    context: vscode.ExtensionContext,
    pythonPath: string,
    port: number
  ) {
    this.pythonPath = pythonPath;
    this.port = port;
    this.outputChannel = vscode.window.createOutputChannel("F5 Speech");
    context.subscriptions.push(this.outputChannel);

    this.statusBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBar.command = "f5Speech.startServer";
    this.updateStatusBar("$(mic) F5", "Click to start F5 TTS server");
    this.statusBar.show();
    context.subscriptions.push(this.statusBar);
  }

  updateConfig(pythonPath: string, port: number) {
    const needsRestart =
      this.pythonPath !== pythonPath || this.port !== port;
    this.pythonPath = pythonPath;
    this.port = port;
    if (needsRestart && this.ready) {
      this.stop();
      this.start();
    }
  }

  async start(): Promise<void> {
    if (this.ready || this.starting) {
      return;
    }

    this.starting = true;
    this.updateStatusBar("$(loading~spin) F5", "Starting TTS server...");
    this.outputChannel.appendLine(
      `Starting F5-TTS server on port ${this.port}...`
    );

    const serverScript = path.join(__dirname, "..", "server", "tts_server.py");

    const config = vscode.workspace.getConfiguration("f5Speech");
    const refAudio = config.get<string>("refAudioPath", "");
    const refText = config.get<string>("refText", "");
    const quantization = config.get<string>("quantization", "none");

    const args = [serverScript, "--port", String(this.port)];
    if (refAudio) {
      args.push("--ref-audio", refAudio);
    }
    if (refText) {
      args.push("--ref-text", refText);
    }
    if (quantization !== "none") {
      args.push("--quantize", quantization);
    }

    this.process = spawn(this.pythonPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      const msg = data.toString().trim();
      this.outputChannel.appendLine(`[server] ${msg}`);
      if (msg.includes("READY")) {
        this.ready = true;
        this.starting = false;
        this.updateStatusBar("$(mic) F5 ✓", "F5 TTS server running");
        vscode.window.showInformationMessage("F5 Speech: TTS server started.");
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.appendLine(`[server:err] ${data.toString().trim()}`);
    });

    this.process.on("exit", (code) => {
      this.outputChannel.appendLine(`Server exited with code ${code}`);
      this.ready = false;
      this.starting = false;
      this.process = null;
      this.updateStatusBar("$(mic) F5 ✗", "TTS server stopped. Click to restart.");
    });

    // Wait for server to become ready (max 60s — model loading can take a while)
    const started = await this.waitForReady(60_000);
    if (!started) {
      this.starting = false;
      this.updateStatusBar("$(mic) F5 ✗", "TTS server failed to start.");
      vscode.window.showErrorMessage(
        "F5 Speech: Server failed to start. Check the output channel for details."
      );
    }
  }

  stop() {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
    this.stopPlayback();
    this.ready = false;
    this.starting = false;
    this.updateStatusBar("$(mic) F5", "Click to start F5 TTS server");
  }

  stopPlayback() {
    if (this.playbackProcess) {
      this.playbackProcess.kill("SIGTERM");
      this.playbackProcess = null;
    }
  }

  async synthesizeAndPlay(text: string): Promise<void> {
    if (!this.ready) {
      await this.start();
    }
    if (!this.ready) {
      throw new Error("TTS server is not running.");
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `f5-speech-${Date.now()}.wav`
    );

    try {
      await this.requestSynthesis(text, tmpFile);
      await this.playAudio(tmpFile);
    } finally {
      // Clean up temp file
      fs.unlink(tmpFile, () => {});
    }
  }

  private requestSynthesis(text: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ text, output_path: outputPath });

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: this.port,
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
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              reject(new Error(`Server returned ${res.statusCode}: ${data}`));
            }
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Synthesis request timed out."));
      });
      req.write(body);
      req.end();
    });
  }

  private playAudio(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // macOS: use afplay. Linux: use aplay or paplay. Windows: use powershell.
      let cmd: string;
      let args: string[];

      if (process.platform === "darwin") {
        cmd = "afplay";
        args = [filePath];
      } else if (process.platform === "linux") {
        cmd = "aplay";
        args = [filePath];
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
          // SIGTERM from stopPlayback is expected
          if ((err as NodeJS.ErrnoException).signal === "SIGTERM") {
            resolve();
          } else {
            reject(err);
          }
        } else {
          resolve();
        }
      });
    });
  }

  private waitForReady(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (this.ready) {
          resolve(true);
          return;
        }
        if (Date.now() - start > timeoutMs || !this.process) {
          resolve(false);
          return;
        }
        setTimeout(check, 500);
      };
      check();
    });
  }

  private updateStatusBar(text: string, tooltip: string) {
    this.statusBar.text = text;
    this.statusBar.tooltip = tooltip;
  }
}
