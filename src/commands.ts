import * as vscode from "vscode";
import { EloquentProvider } from "./speechProvider";
import { StatusBarManager } from "./statusBar";
import { runSetupWizard, createBackend, showVoicePicker } from "./setup";
import { AudioPlayer } from "./player";
import { chunkText } from "./chunker";
import { preprocessForSpeech } from "./textPreprocessor";
import type { BackendId, TtsBackend } from "./types";

/**
 * Shared mutable state passed to all command handlers.
 * Created once in `activate()` and threaded through.
 */
export interface ExtensionServices {
  provider: EloquentProvider;
  outputChannel: vscode.LogOutputChannel;
  statusBar: StatusBarManager;
  speechRegistration: vscode.Disposable | undefined;
}

/** Register all Eloquent commands and push them into the extension context. */
export function registerCommands(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("eloquent.setup", () =>
      setupBackend(context, services)
    ),
    vscode.commands.registerCommand("eloquent.toggle", () =>
      toggleTts(context, services)
    ),
    vscode.commands.registerCommand("eloquent.enable", () =>
      enableTts(context, services)
    ),
    vscode.commands.registerCommand("eloquent.disable", () =>
      disableTts(services)
    ),
    vscode.commands.registerCommand("eloquent.pause", () =>
      togglePause(services)
    ),
    vscode.commands.registerCommand("eloquent.readAloud", () =>
      readSelectionAloud(services)
    ),
    vscode.commands.registerCommand("eloquent.changeVoice", () =>
      changeVoice(context, services)
    )
  );
}

/** Run setup wizard, initialize chosen backend, register speech provider. */
export async function setupBackend(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): Promise<void> {
  const backend = await runSetupWizard(context);
  if (!backend) return;

  await initializeAndRegister(context, services, backend);
}

/** Enable TTS using the configured backend. */
export async function enableTts(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): Promise<void> {
  const config = vscode.workspace.getConfiguration("eloquent");
  const backendId = config.get<string>("backend", "") as BackendId | "";

  if (!backendId) {
    await setupBackend(context, services);
    return;
  }

  const backend = await createBackend(backendId as BackendId, context);
  if (!backend) return;

  await config.update("enabled", true, vscode.ConfigurationTarget.Global);
  await initializeAndRegister(context, services, backend);
}

/** Disable TTS — unregister speech provider, dispose backend. */
export function disableTts(services: ExtensionServices): void {
  services.provider.stopActiveSession();

  services.speechRegistration?.dispose();
  services.speechRegistration = undefined;

  services.provider.getBackend()?.dispose();

  vscode.workspace
    .getConfiguration("eloquent")
    .update("enabled", false, vscode.ConfigurationTarget.Global);

  services.statusBar.update(false);
  services.outputChannel.info("TTS disabled.");
}

/** Toggle TTS on/off. */
export async function toggleTts(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): Promise<void> {
  const config = vscode.workspace.getConfiguration("eloquent");
  const enabled = config.get<boolean>("enabled", true);

  if (enabled && services.speechRegistration) {
    disableTts(services);
  } else {
    await enableTts(context, services);
  }
}

/** Toggle pause/resume on the active TTS session. */
export function togglePause(services: ExtensionServices): void {
  services.provider.togglePause();
}

/** Initialize backend, register as VS Code speech provider, update UI. */
export async function initializeAndRegister(
  context: vscode.ExtensionContext,
  services: ExtensionServices,
  backend: TtsBackend
): Promise<void> {
  services.statusBar.update(false, true); // loading

  try {
    services.outputChannel.info(`Initializing ${backend.name} backend…`);
    services.outputChannel.info(
      "This includes downloading the model on first run (~80 MB for Kokoro q8)."
    );
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
    services.outputChannel.info(`${backend.name} backend ready.`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    services.outputChannel.error(`Backend init failed: ${msg}`);
    vscode.window.showErrorMessage(
      `Eloquent: Failed to initialize ${backend.name}. Check output for details.`
    );
    services.statusBar.update(false);
    return;
  }

  services.provider.setBackend(backend);

  // Re-register speech provider
  services.speechRegistration?.dispose();
  services.speechRegistration = vscode.speech.registerSpeechProvider(
    "eloquent",
    services.provider
  );
  context.subscriptions.push(services.speechRegistration);

  services.statusBar.update(true);

  const tryIt = await vscode.window.showInformationMessage(
    `Eloquent: ${backend.name} is ready! Voice output is now active for Copilot Chat.`,
    "Test Voice",
    "OK"
  );
  if (tryIt === "Test Voice") {
    await testVoice(services, backend);
  }
}

/** Read the current editor selection (or full document) aloud. */
export async function readSelectionAloud(
  services: ExtensionServices
): Promise<void> {
  const backend = services.provider.getBackend();
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
    const textChunks = chunkText(spoken);
    for (const textChunk of textChunks) {
      if (abort.signal.aborted) break;
      for await (const audio of backend.synthesize(textChunk, abort.signal)) {
        await player.play(audio);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Eloquent: ${msg}`);
  }
}

/** Quick test: synthesize a short sentence so the user hears their voice. */
export async function testVoice(
  services: ExtensionServices,
  backend: TtsBackend
): Promise<void> {
  const player = new AudioPlayer();
  const abort = new AbortController();
  const testText = "Hello! Eloquent is working. This is your selected voice.";

  try {
    services.statusBar.main.text = "$(loading~spin) EQ";
    const textChunks = chunkText(testText);
    for (const textChunk of textChunks) {
      if (abort.signal.aborted) break;
      for await (const audio of backend.synthesize(textChunk, abort.signal)) {
        await player.play(audio);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    services.outputChannel.error(`Voice test failed: ${msg}`);
    vscode.window.showErrorMessage(`Eloquent: Voice test failed — ${msg}`);
  } finally {
    services.statusBar.update(true);
  }
}

/** Change voice on the fly — re-creates backend with the new voice. */
export async function changeVoice(
  context: vscode.ExtensionContext,
  services: ExtensionServices
): Promise<void> {
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

  await initializeAndRegister(context, services, backend);
}
