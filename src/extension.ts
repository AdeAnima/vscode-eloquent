import * as vscode from "vscode";
import { EloquentProvider } from "./speechProvider";
import { runSetupWizard, createBackend, showVoicePicker } from "./setup";
import { AudioPlayer } from "./player";
import { chunkText } from "./chunker";
import { preprocessForSpeech } from "./textPreprocessor";
import type { BackendId, TtsBackend } from "./types";

let provider: EloquentProvider;
let outputChannel: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;
let pauseBar: vscode.StatusBarItem;
let speechRegistration: vscode.Disposable | undefined;

export async function activate(context: vscode.ExtensionContext) {
  try {
    outputChannel = vscode.window.createOutputChannel("Eloquent");
    outputChannel.appendLine("Eloquent extension activating...");
    context.subscriptions.push(outputChannel);

  // Status bar — main toggle
  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBar.command = "eloquent.toggle";
  context.subscriptions.push(statusBar);

  // Status bar — pause button (hidden until TTS active)
  pauseBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  pauseBar.command = "eloquent.pause";
  pauseBar.hide();

  // Provider (no backend yet — set during setup)
  provider = new EloquentProvider();
  context.subscriptions.push(
    provider.onDidChangePauseState((paused) => {
      if (paused) {
        pauseBar.text = "$(debug-continue) Resume";
        pauseBar.tooltip = "Eloquent: Resume playback";
      } else {
        pauseBar.text = "$(debug-pause) Pause";
        pauseBar.tooltip = "Eloquent: Pause playback";
      }
    })
  );
  context.subscriptions.push(
    provider.onDidEndSession(() => {
      pauseBar.hide();
    })
  );

  // --- Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand("eloquent.setup", () =>
      setupBackend(context)
    ),
    vscode.commands.registerCommand("eloquent.toggle", () =>
      toggleTts(context)
    ),
    vscode.commands.registerCommand("eloquent.enable", () =>
      enableTts(context)
    ),
    vscode.commands.registerCommand("eloquent.disable", () => disableTts()),
    vscode.commands.registerCommand("eloquent.pause", () => togglePause()),
    vscode.commands.registerCommand("eloquent.readAloud", () =>
      readSelectionAloud()
    ),
    vscode.commands.registerCommand("eloquent.changeVoice", () =>
      changeVoice(context)
    )
  );

  // --- First-run / restore ---
  const config = vscode.workspace.getConfiguration("eloquent");
  const backendId = config.get<string>("backend", "") as BackendId | "";
  const enabled = config.get<boolean>("enabled", true);

  if (!backendId) {
    // First install — show setup wizard
    statusBar.text = "$(megaphone) Eloquent Setup";
    statusBar.tooltip = "Eloquent: Click to set up text-to-speech";
    statusBar.show();

    outputChannel.appendLine("No backend configured — opening walkthrough.");
    vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      "adeanima.vscode-eloquent#eloquent.welcome",
      true
    );
  } else if (enabled) {
    await enableTts(context);
  } else {
    updateStatusBar(false);
  }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const outputCh = vscode.window.createOutputChannel("Eloquent");
    outputCh.appendLine(`ACTIVATION ERROR: ${msg}`);
    outputCh.show();
    vscode.window.showErrorMessage(`Eloquent failed to activate: ${msg}`);
  }
}

/** Run setup wizard, initialize chosen backend, register speech provider. */
async function setupBackend(context: vscode.ExtensionContext) {
  const backend = await runSetupWizard(context);
  if (!backend) return;

  await initializeAndRegister(context, backend);
}

/** Enable TTS using the configured backend. */
async function enableTts(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("eloquent");
  const backendId = config.get<string>("backend", "") as BackendId | "";

  if (!backendId) {
    await setupBackend(context);
    return;
  }

  const backend = await createBackend(backendId as BackendId, context);
  if (!backend) return;

  await config.update("enabled", true, vscode.ConfigurationTarget.Global);
  await initializeAndRegister(context, backend);
}

/** Disable TTS — unregister speech provider, dispose backend. */
function disableTts() {
  provider?.stopActiveSession();

  speechRegistration?.dispose();
  speechRegistration = undefined;

  provider?.getBackend()?.dispose();

  vscode.workspace
    .getConfiguration("eloquent")
    .update("enabled", false, vscode.ConfigurationTarget.Global);

  updateStatusBar(false);
  outputChannel?.appendLine("TTS disabled.");
}

/** Toggle TTS on/off. */
async function toggleTts(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("eloquent");
  const enabled = config.get<boolean>("enabled", true);

  if (enabled && speechRegistration) {
    disableTts();
  } else {
    await enableTts(context);
  }
}

/** Toggle pause/resume on the active TTS session. */
function togglePause() {
  if (!provider) return;
  provider.togglePause();
}

/** Initialize backend, register as VS Code speech provider, update UI. */
async function initializeAndRegister(
  context: vscode.ExtensionContext,
  backend: TtsBackend
) {
  updateStatusBar(false, true); // loading

  try {
    outputChannel.appendLine(`Initializing ${backend.name} backend…`);
    outputChannel.appendLine("This includes downloading the model on first run (~80 MB for Kokoro q8).");
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Eloquent",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: `Loading ${backend.name} model…` });
        await backend.initialize();
      }
    );
    outputChannel.appendLine(`${backend.name} backend ready.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Backend init failed: ${msg}`);
    vscode.window.showErrorMessage(
      `Eloquent: Failed to initialize ${backend.name}. Check output for details.`
    );
    updateStatusBar(false);
    return;
  }

  provider.setBackend(backend);

  // Re-register speech provider
  speechRegistration?.dispose();
  speechRegistration = vscode.speech.registerSpeechProvider(
    "eloquent",
    provider
  );
  context.subscriptions.push(speechRegistration);

  updateStatusBar(true);

  const tryIt = await vscode.window.showInformationMessage(
    `Eloquent: ${backend.name} is ready! Voice output is now active for Copilot Chat.`,
    "Test Voice",
    "OK"
  );
  if (tryIt === "Test Voice") {
    await testVoice(backend);
  }
}

/** Read the current editor selection (or full document) aloud. */
async function readSelectionAloud() {
  const backend = provider.getBackend();
  if (!backend) {
    vscode.window.showWarningMessage(
      "Eloquent: TTS not active. Run setup first."
    );
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor.");
    return;
  }

  const selection = editor.selection;
  const text = selection.isEmpty
    ? editor.document.getText()
    : editor.document.getText(selection);

  if (!text.trim()) {
    vscode.window.showWarningMessage("No text to read.");
    return;
  }

  const player = new AudioPlayer();
  const abort = new AbortController();

  try {
    const spoken = preprocessForSpeech(text);
    for await (const chunk of backend.synthesize(spoken, abort.signal)) {
      await player.play(chunk);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Eloquent: ${msg}`);
  }
}

/** Quick test: synthesize a short sentence so the user hears their voice. */
async function testVoice(backend: TtsBackend) {
  const player = new AudioPlayer();
  const abort = new AbortController();
  const testText = "Hello! Eloquent is working. This is your selected voice.";

  try {
    statusBar.text = "$(loading~spin) EQ";
    for await (const chunk of backend.synthesize(testText, abort.signal)) {
      await player.play(chunk);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`Voice test failed: ${msg}`);
    vscode.window.showErrorMessage(`Eloquent: Voice test failed — ${msg}`);
  } finally {
    updateStatusBar(true);
  }
}

/** Change voice on the fly — re-creates backend with the new voice. */
async function changeVoice(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("eloquent");
  const backendId = config.get<string>("backend", "");
  if (backendId !== "kokoro") {
    vscode.window.showInformationMessage(
      "Voice selection is only available for the Kokoro backend."
    );
    return;
  }

  const voice = await showVoicePicker();
  if (!voice) return;

  await config.update("voice", voice, vscode.ConfigurationTarget.Global);

  // Re-create and re-initialize backend with the new voice
  const backend = await createBackend("kokoro", context);
  if (!backend) return;

  await initializeAndRegister(context, backend);
}

function updateStatusBar(active: boolean, loading = false) {
  if (loading) {
    statusBar.text = "$(loading~spin) EQ";
    statusBar.tooltip = "Eloquent: Loading TTS backend...";
    pauseBar.hide();
  } else if (active) {
    statusBar.text = "$(unmute) EQ";
    statusBar.tooltip = "Eloquent: TTS active — click to toggle";
    pauseBar.text = "$(debug-pause) Pause";
    pauseBar.tooltip = "Eloquent: Pause playback";
    pauseBar.show();
  } else {
    statusBar.text = "$(mute) EQ";
    statusBar.tooltip = "Eloquent: TTS disabled — click to toggle";
    pauseBar.hide();
  }
  statusBar.show();
}

export function deactivate() {
  speechRegistration?.dispose();
  provider?.getBackend()?.dispose();
}
