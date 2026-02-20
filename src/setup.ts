import * as vscode from "vscode";
import * as path from "path";
import { BACKENDS, type BackendId, type TtsBackend } from "./types";
import { KokoroBackend } from "./backends/kokoro";
import { F5PythonBackend } from "./backends/f5python";
import { CustomBackend } from "./backends/custom";

/**
 * Show the backend selection quick-pick.
 * Shown on first install (no backend configured) or via command.
 * Returns the chosen BackendId, or undefined if cancelled.
 */
export async function showBackendPicker(): Promise<BackendId | undefined> {
  const items = BACKENDS.map((b) => ({
    label: b.label,
    description: b.id === "kokoro" ? "$(star-full) recommended" : b.id,
    detail: b.description,
    backendId: b.id,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    title: "Eloquent — Step 1/2: Choose TTS Backend",
    placeHolder: "Which text-to-speech engine would you like to use?",
    ignoreFocusOut: true,
  });

  return pick?.backendId;
}

/**
 * If the user picks Kokoro, let them choose a voice.
 */
export async function showVoicePicker(): Promise<string | undefined> {
  const voices = [
    // American Female
    { label: "af_heart", description: "American Female — Heart (default)", detail: "❤️ Top rated" },
    { label: "af_alloy", description: "American Female — Alloy" },
    { label: "af_aoede", description: "American Female — Aoede" },
    { label: "af_bella", description: "American Female — Bella", detail: "🔥 Popular" },
    { label: "af_jessica", description: "American Female — Jessica" },
    { label: "af_kore", description: "American Female — Kore" },
    { label: "af_nicole", description: "American Female — Nicole", detail: "🎧 Warm" },
    { label: "af_nova", description: "American Female — Nova" },
    { label: "af_river", description: "American Female — River" },
    { label: "af_sarah", description: "American Female — Sarah" },
    { label: "af_sky", description: "American Female — Sky" },
    // American Male
    { label: "am_adam", description: "American Male — Adam" },
    { label: "am_echo", description: "American Male — Echo" },
    { label: "am_eric", description: "American Male — Eric" },
    { label: "am_fenrir", description: "American Male — Fenrir" },
    { label: "am_liam", description: "American Male — Liam" },
    { label: "am_michael", description: "American Male — Michael" },
    { label: "am_onyx", description: "American Male — Onyx" },
    { label: "am_puck", description: "American Male — Puck" },
    { label: "am_santa", description: "American Male — Santa" },
    // British Female
    { label: "bf_alice", description: "British Female — Alice" },
    { label: "bf_emma", description: "British Female — Emma" },
    { label: "bf_isabella", description: "British Female — Isabella" },
    { label: "bf_lily", description: "British Female — Lily" },
    // British Male
    { label: "bm_daniel", description: "British Male — Daniel" },
    { label: "bm_fable", description: "British Male — Fable" },
    { label: "bm_george", description: "British Male — George" },
    { label: "bm_lewis", description: "British Male — Lewis" },
  ];

  const config = vscode.workspace.getConfiguration("eloquent");
  const currentVoice = config.get<string>("voice", "af_heart");

  const pick = await vscode.window.showQuickPick(
    voices.map((v) => ({
      ...v,
      description: v.label === currentVoice
        ? `$(check) ${v.description}`
        : v.description,
    })),
    {
      title: "Eloquent — Choose Voice",
      placeHolder: `Current: ${currentVoice} — pick a new voice`,
      ignoreFocusOut: true,
    }
  );

  return pick?.label;
}

/**
 * If the user picks Custom, prompt for the endpoint URL.
 */
async function promptCustomEndpoint(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: "Eloquent — Custom TTS Endpoint",
    prompt:
      "Enter the base URL of your TTS server (e.g. http://localhost:8080)",
    placeHolder: "http://localhost:8080",
    ignoreFocusOut: true,
    validateInput: (value) => {
      try {
        new URL(value);
        return undefined;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });
}

/**
 * Run the full setup flow: pick backend → configure → save to settings.
 * Returns the constructed TtsBackend, or undefined if the user cancelled.
 */
export async function runSetupWizard(
  context: vscode.ExtensionContext
): Promise<TtsBackend | undefined> {
  const backendId = await showBackendPicker();
  if (!backendId) return undefined;

  const config = vscode.workspace.getConfiguration("eloquent");
  await config.update("backend", backendId, vscode.ConfigurationTarget.Global);

  return createBackend(backendId, context);
}

/**
 * Create a TtsBackend instance from the saved configuration.
 */
export async function createBackend(
  backendId: BackendId,
  context: vscode.ExtensionContext
): Promise<TtsBackend | undefined> {
  const config = vscode.workspace.getConfiguration("eloquent");

  switch (backendId) {
    case "kokoro": {
      let voice = config.get<string>("voice", "");
      if (!voice) {
        voice = (await showVoicePicker()) ?? "af_heart";
        await config.update(
          "voice",
          voice,
          vscode.ConfigurationTarget.Global
        );
      }
      const dtype = config.get<string>("kokoroDtype", "q8");
      return new KokoroBackend(dtype, voice, context.extensionPath);
    }

    case "f5-python": {
      const storageDir = context.globalStorageUri.fsPath;
      const serverScript = path.join(
        context.extensionPath,
        "server",
        "tts_server.py"
      );
      const port = config.get<number>("serverPort", 18230);
      const refAudio = config.get<string>("refAudioPath", "");
      const refText = config.get<string>("refText", "");
      const quantization = config.get<string>("quantization", "none");
      return new F5PythonBackend(
        storageDir,
        serverScript,
        port,
        refAudio,
        refText,
        quantization
      );
    }

    case "custom": {
      let endpoint = config.get<string>("customEndpoint", "");
      if (!endpoint) {
        endpoint = (await promptCustomEndpoint()) ?? "";
        if (!endpoint) return undefined;
        await config.update(
          "customEndpoint",
          endpoint,
          vscode.ConfigurationTarget.Global
        );
      }
      return new CustomBackend(endpoint);
    }
  }
}
