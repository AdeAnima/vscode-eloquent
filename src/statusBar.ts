import * as vscode from "vscode";

/**
 * Manages the two status bar items: main toggle and pause button.
 */
export class StatusBarManager implements vscode.Disposable {
  readonly main: vscode.StatusBarItem;
  readonly pause: vscode.StatusBarItem;

  constructor() {
    this.main = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.main.command = "eloquent.toggle";

    this.pause = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      99
    );
    this.pause.command = "eloquent.pause";
    this.pause.hide();
  }

  /** Show the first-run setup prompt. */
  showSetup(): void {
    this.main.text = "$(megaphone) Eloquent Setup";
    this.main.tooltip = "Eloquent: Click to set up text-to-speech";
    this.main.show();
    this.pause.hide();
  }

  /** Update status bar to reflect TTS active/disabled/loading state. */
  update(active: boolean, loading = false): void {
    if (loading) {
      this.main.text = "$(loading~spin) EQ";
      this.main.tooltip = "Eloquent: Loading TTS backend...";
      this.pause.hide();
    } else if (active) {
      this.main.text = "$(unmute) EQ";
      this.main.tooltip = "Eloquent: TTS active — click to toggle";
      this.pause.text = "$(debug-pause) Pause";
      this.pause.tooltip = "Eloquent: Pause playback";
      this.pause.show();
    } else {
      this.main.text = "$(mute) EQ";
      this.main.tooltip = "Eloquent: TTS disabled — click to toggle";
      this.pause.hide();
    }
    this.main.show();
  }

  /** Update pause button text to reflect paused/resumed state. */
  updatePauseState(paused: boolean): void {
    if (paused) {
      this.pause.text = "$(debug-continue) Resume";
      this.pause.tooltip = "Eloquent: Resume playback";
    } else {
      this.pause.text = "$(debug-pause) Pause";
      this.pause.tooltip = "Eloquent: Pause playback";
    }
  }

  /** Hide the pause button (when session ends). */
  hidePause(): void {
    this.pause.hide();
  }

  dispose(): void {
    this.main.dispose();
    this.pause.dispose();
  }
}
