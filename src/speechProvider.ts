import * as vscode from "vscode";
import type { TtsBackend } from "./types";
import { ChunkedSynthesizer } from "./chunker";
import { AudioPlayer } from "./player";

export class EloquentProvider implements vscode.SpeechProvider {
  private backend: TtsBackend | undefined;
  private activeSession: StreamingTextToSpeechSession | undefined;
  private _paused = false;

  private readonly _onDidChangePauseState = new vscode.EventEmitter<boolean>();
  readonly onDidChangePauseState = this._onDidChangePauseState.event;

  private readonly _onDidEndSession = new vscode.EventEmitter<void>();
  readonly onDidEndSession = this._onDidEndSession.event;

  get paused(): boolean {
    return this._paused;
  }

  /** Replace the active backend (e.g. after setup wizard or config change). */
  setBackend(backend: TtsBackend): void {
    this.backend?.dispose();
    this.backend = backend;
  }

  getBackend(): TtsBackend | undefined {
    return this.backend;
  }

  /** Stop the active TTS session (e.g. when disabling TTS). */
  stopActiveSession(): void {
    if (this.activeSession) {
      this.activeSession.stop();
      this.activeSession = undefined;
      this._paused = false;
      this._onDidChangePauseState.fire(false);
      this._onDidEndSession.fire();
    }
  }

  /** Toggle pause/resume on the active TTS session. Returns new paused state. */
  togglePause(): boolean {
    if (!this.activeSession) return this._paused;

    if (this._paused) {
      this.activeSession.resume();
      this._paused = false;
    } else {
      this.activeSession.pause();
      this._paused = true;
    }
    this._onDidChangePauseState.fire(this._paused);
    return this._paused;
  }

  provideSpeechToTextSession(
    _token: vscode.CancellationToken,
    _options?: vscode.SpeechToTextOptions
  ): vscode.ProviderResult<vscode.SpeechToTextSession> {
    return undefined;
  }

  provideTextToSpeechSession(
    token: vscode.CancellationToken,
    _options?: vscode.TextToSpeechOptions
  ): vscode.ProviderResult<vscode.TextToSpeechSession> {
    if (!this.backend) {
      return undefined;
    }
    this._paused = false;
    this._onDidChangePauseState.fire(false);

    const onSessionDone = () => {
      if (this.activeSession === session) {
        this.activeSession = undefined;
        this._paused = false;
        this._onDidChangePauseState.fire(false);
        this._onDidEndSession.fire();
      }
    };

    const session = new StreamingTextToSpeechSession(this.backend, token, onSessionDone);
    this.activeSession = session;
    token.onCancellationRequested(() => {
      onSessionDone();
    });
    return session;
  }

  provideKeywordRecognitionSession(
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.KeywordRecognitionSession> {
    return undefined;
  }
}

/**
 * Streaming TTS session using chunk-level synthesis.
 *
 * Copilot Chat calls synthesize() many times as tokens stream in.
 * We accumulate text, split into sentence-level chunks, synthesize each
 * chunk separately, and play audio as soon as each chunk is ready.
 * This gives incremental audio output without requiring model-level streaming.
 *
 * Cancellation immediately stops both generation and playback.
 */
class StreamingTextToSpeechSession implements vscode.TextToSpeechSession {
  private readonly _onDidChange =
    new vscode.EventEmitter<vscode.TextToSpeechEvent>();
  readonly onDidChange = this._onDidChange.event;

  private readonly synthesizer: ChunkedSynthesizer;
  private readonly player = new AudioPlayer();
  private readonly abortController = new AbortController();
  private started = false;

  constructor(
    backend: TtsBackend,
    token: vscode.CancellationToken,
    private readonly onDone: () => void,
  ) {
    this.synthesizer = new ChunkedSynthesizer(backend);

    token.onCancellationRequested(() => {
      this.abortController.abort();
      this.player.stop();
      this._onDidChange.fire({
        status: vscode.TextToSpeechStatus.Stopped,
      });
    });
  }

  stop(): void {
    this.abortController.abort();
    this.player.stop();
  }

  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.resume();
  }

  synthesize(text: string): void {
    if (this.abortController.signal.aborted) return;

    this.synthesizer.push(text);

    if (!this.started) {
      this.started = true;
      this._onDidChange.fire({ status: vscode.TextToSpeechStatus.Started });
      this.runPlaybackLoop();
    }
  }

  private async runPlaybackLoop(): Promise<void> {
    try {
      // Brief pause to accumulate initial tokens from Copilot streaming.
      // The prefetch buffer in ChunkedSynthesizer handles the rest.
      const batchDelay = vscode.workspace
        .getConfiguration("eloquent")
        .get<number>("initialBatchDelay", 150);
      if (batchDelay > 0) {
        await new Promise((r) => setTimeout(r, batchDelay));
      }
      this.synthesizer.flush();

      for await (const chunk of this.synthesizer.stream(
        this.abortController.signal
      )) {
        if (this.abortController.signal.aborted) return;
        await this.player.play(chunk);
      }

      if (!this.abortController.signal.aborted) {
        this._onDidChange.fire({
          status: vscode.TextToSpeechStatus.Stopped,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Eloquent] TTS error:", msg);
      this._onDidChange.fire({
        status: vscode.TextToSpeechStatus.Error,
        text: msg,
      });
    } finally {
      this.onDone();
    }
  }
}
