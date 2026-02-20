import * as vscode from "vscode";
import { TtsServerManager } from "./server";

export class F5SpeechProvider implements vscode.SpeechProvider {
  constructor(private readonly server: TtsServerManager) {}

  provideSpeechToTextSession(
    _token: vscode.CancellationToken,
    _options?: vscode.SpeechToTextOptions
  ): vscode.ProviderResult<vscode.SpeechToTextSession> {
    // STT not implemented — let the default provider handle it
    return undefined;
  }

  provideTextToSpeechSession(
    token: vscode.CancellationToken,
    _options?: vscode.TextToSpeechOptions
  ): vscode.ProviderResult<vscode.TextToSpeechSession> {
    return new F5TextToSpeechSession(this.server, token);
  }

  provideKeywordRecognitionSession(
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.KeywordRecognitionSession> {
    // Keyword recognition not implemented
    return undefined;
  }
}

class F5TextToSpeechSession implements vscode.TextToSpeechSession {
  private readonly _onDidChange =
    new vscode.EventEmitter<vscode.TextToSpeechEvent>();
  readonly onDidChange = this._onDidChange.event;

  private queue: string[] = [];
  private processing = false;
  private cancelled = false;

  constructor(
    private readonly server: TtsServerManager,
    token: vscode.CancellationToken
  ) {
    token.onCancellationRequested(() => {
      this.cancelled = true;
      this.server.stopPlayback();
      this._onDidChange.fire({
        status: vscode.TextToSpeechStatus.Stopped,
      });
    });
  }

  synthesize(text: string): void {
    if (this.cancelled) {
      return;
    }

    this.queue.push(text);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.cancelled) {
      return;
    }

    this.processing = true;
    this._onDidChange.fire({
      status: vscode.TextToSpeechStatus.Started,
    });

    while (this.queue.length > 0 && !this.cancelled) {
      const text = this.queue.shift()!;
      try {
        await this.server.synthesizeAndPlay(text);
        this._onDidChange.fire({
          status: vscode.TextToSpeechStatus.Started,
          text,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[F5 Speech] TTS error:", msg);
        this._onDidChange.fire({
          status: vscode.TextToSpeechStatus.Error,
          text: msg,
        });
        break;
      }
    }

    if (!this.cancelled) {
      this._onDidChange.fire({
        status: vscode.TextToSpeechStatus.Stopped,
      });
    }

    this.processing = false;
  }
}
