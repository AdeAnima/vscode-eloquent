import * as vscode from "vscode";
import { TtsServerManager } from "./server";
import { F5SpeechProvider } from "./speechProvider";

let serverManager: TtsServerManager;

export async function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("f5Speech");
  const port = config.get<number>("serverPort", 18230);
  const pythonPath = config.get<string>("pythonPath", "python3");

  serverManager = new TtsServerManager(context, pythonPath, port);

  // Register as VS Code speech provider
  const provider = new F5SpeechProvider(serverManager);
  context.subscriptions.push(
    vscode.speech.registerSpeechProvider("f5-speech", provider)
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("f5Speech.startServer", () =>
      serverManager.start()
    ),
    vscode.commands.registerCommand("f5Speech.stopServer", () =>
      serverManager.stop()
    ),
    vscode.commands.registerCommand("f5Speech.readAloud", () =>
      readSelectionAloud(serverManager)
    )
  );

  // Auto-start
  if (config.get<boolean>("autoStart", true)) {
    serverManager.start();
  }

  // React to config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("f5Speech")) {
        const updated = vscode.workspace.getConfiguration("f5Speech");
        serverManager.updateConfig(
          updated.get<string>("pythonPath", "python3"),
          updated.get<number>("serverPort", 18230)
        );
      }
    })
  );
}

async function readSelectionAloud(server: TtsServerManager) {
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

  try {
    await server.synthesizeAndPlay(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`F5 Speech: ${msg}`);
  }
}

export function deactivate() {
  serverManager?.stop();
}
