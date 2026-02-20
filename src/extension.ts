import * as vscode from "vscode";
import { EloquentProvider } from "./speechProvider";
import { StatusBarManager } from "./statusBar";
import {
  registerCommands,
  enableTts,
  type ExtensionServices,
} from "./commands";
import type { BackendId } from "./types";

let services: ExtensionServices;

export async function activate(context: vscode.ExtensionContext) {
  try {
    const outputChannel = vscode.window.createOutputChannel("Eloquent");
    outputChannel.appendLine("Eloquent extension activating...");
    context.subscriptions.push(outputChannel);

    const statusBar = new StatusBarManager();
    context.subscriptions.push(statusBar);

    const provider = new EloquentProvider();
    context.subscriptions.push(
      provider.onDidChangePauseState((paused) =>
        statusBar.updatePauseState(paused)
      )
    );
    context.subscriptions.push(
      provider.onDidEndSession(() => statusBar.hidePause())
    );

    services = {
      provider,
      outputChannel,
      statusBar,
      speechRegistration: undefined,
    };

    registerCommands(context, services);

    // --- First-run / restore ---
    const config = vscode.workspace.getConfiguration("eloquent");
    const backendId = config.get<string>("backend", "") as BackendId | "";
    const enabled = config.get<boolean>("enabled", true);

    if (!backendId) {
      statusBar.showSetup();
      outputChannel.appendLine("No backend configured — opening walkthrough.");
      vscode.commands.executeCommand(
        "workbench.action.openWalkthrough",
        "adeanima.vscode-eloquent#eloquent.welcome",
        true
      );
    } else if (enabled) {
      await enableTts(context, services);
    } else {
      statusBar.update(false);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const outputCh = vscode.window.createOutputChannel("Eloquent");
    outputCh.appendLine(`ACTIVATION ERROR: ${msg}`);
    outputCh.show();
    vscode.window.showErrorMessage(`Eloquent failed to activate: ${msg}`);
  }
}

export function deactivate() {
  services?.speechRegistration?.dispose();
  services?.provider?.getBackend()?.dispose();
}
