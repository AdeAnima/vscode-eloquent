import * as vscode from "vscode";
import { EloquentProvider } from "./speechProvider";
import { StatusBarManager } from "./statusBar";
import {
  registerCommands,
  enableTts,
  disableTts,
  initializeAndRegister,
  type ExtensionServices,
} from "./commands";
import { createBackend } from "./setup";
import type { BackendId } from "./types";

let services: ExtensionServices;

export async function activate(context: vscode.ExtensionContext) {
  try {
    const outputChannel = vscode.window.createOutputChannel("Eloquent", { log: true });
    outputChannel.info("Eloquent extension activating...");
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

    // --- React to settings changes at runtime ---
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (!e.affectsConfiguration("eloquent")) return;

        if (e.affectsConfiguration("eloquent.enabled")) {
          const nowEnabled = vscode.workspace
            .getConfiguration("eloquent")
            .get<boolean>("enabled", true);
          if (nowEnabled && !services.speechRegistration) {
            await enableTts(context, services);
          } else if (!nowEnabled && services.speechRegistration) {
            disableTts(services);
          }
          return;
        }

        // Settings that require backend re-creation
        const backendSettings = [
          "eloquent.backend",
          "eloquent.voice",
          "eloquent.kokoroDtype",
          "eloquent.serverPort",
          "eloquent.refAudioPath",
          "eloquent.refText",
          "eloquent.quantization",
          "eloquent.customEndpoint",
        ];
        const needsReinit = backendSettings.some((s) =>
          e.affectsConfiguration(s)
        );
        if (needsReinit && services.speechRegistration) {
          const cfg = vscode.workspace.getConfiguration("eloquent");
          const bid = cfg.get<string>("backend", "") as BackendId | "";
          if (!bid) return;
          outputChannel.info(`Settings changed — re-initializing ${bid} backend…`);
          const backend = await createBackend(bid as BackendId, context);
          if (backend) {
            await initializeAndRegister(context, services, backend);
          }
        }
      })
    );

    // --- First-run / restore ---
    const config = vscode.workspace.getConfiguration("eloquent");
    const backendId = config.get<string>("backend", "") as BackendId | "";
    const enabled = config.get<boolean>("enabled", true);

    if (!backendId) {
      statusBar.showSetup();
      outputChannel.info("No backend configured — opening walkthrough.");
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
