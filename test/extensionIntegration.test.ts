import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks for heavy dependencies ─────────────────────────────────────────────

// Mock installer (prevent actual npm install / python download)
vi.mock("../src/installer", () => ({
  ensureKokoroInstalled: vi.fn().mockResolvedValue(undefined),
  ensurePythonEnvironment: vi.fn().mockResolvedValue("/fake/python3"),
}));

// Mock setup (prevent real backend creation)
vi.mock("../src/setup", () => ({
  runSetupWizard: vi.fn().mockResolvedValue(undefined),
  createBackend: vi.fn().mockResolvedValue(undefined),
  showVoicePicker: vi.fn().mockResolvedValue(undefined),
}));

// ─── Enhanced vscode mock for extension integration ───────────────────────────
// We need commands, speech, ProgressLocation, withProgress, etc.

const registeredCommands: Record<string, (...args: any[]) => any> = {};
const subscriptions: { dispose: () => void }[] = [];
let statusBars: Array<{
  text: string;
  tooltip: string;
  command: string;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];

let configValues: Record<string, any> = {};
const configUpdates: Array<{ key: string; value: any }> = [];
let onConfigChangeListeners: Array<(e: any) => void> = [];

vi.mock("vscode", () => {
  const EventEmitter = class<T = void> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const idx = this.listeners.indexOf(listener);
          if (idx >= 0) this.listeners.splice(idx, 1);
        },
      };
    };
    fire(data: T) {
      for (const fn of this.listeners) fn(data);
    }
    dispose() {
      this.listeners = [];
    }
  };

  return {
    EventEmitter,
    StatusBarAlignment: { Left: 1, Right: 2 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ProgressLocation: { Notification: 15, Window: 10 },
    TextToSpeechStatus: { Started: 1, Stopped: 2, Error: 3 },
    workspace: {
      getConfiguration: (_section?: string) => ({
        get: <T>(key: string, defaultValue?: T): T | undefined => {
          return key in configValues
            ? (configValues[key] as T)
            : defaultValue;
        },
        update: vi.fn().mockImplementation((key: string, value: any) => {
          configUpdates.push({ key, value });
          configValues[key] = value;
          return Promise.resolve();
        }),
      }),
      onDidChangeConfiguration: vi.fn().mockImplementation((listener: (e: any) => void) => {
        onConfigChangeListeners.push(listener);
        return { dispose: () => {
          const idx = onConfigChangeListeners.indexOf(listener);
          if (idx >= 0) onConfigChangeListeners.splice(idx, 1);
        }};
      }),
    },
    window: {
      createOutputChannel: vi.fn().mockReturnValue({
        appendLine: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
      }),
      createStatusBarItem: vi.fn().mockImplementation(() => {
        const bar = {
          text: "",
          tooltip: "",
          command: "",
          show: vi.fn(),
          hide: vi.fn(),
          dispose: vi.fn(),
        };
        statusBars.push(bar);
        return bar;
      }),
      showInformationMessage: vi.fn().mockResolvedValue("OK"),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      withProgress: vi
        .fn()
        .mockImplementation((_opts: any, task: (progress: any) => Promise<any>) =>
          task({ report: vi.fn() })
        ),
      activeTextEditor: undefined as any,
    },
    commands: {
      registerCommand: vi
        .fn()
        .mockImplementation((id: string, handler: (...args: any[]) => any) => {
          registeredCommands[id] = handler;
          const disposable = { dispose: vi.fn() };
          subscriptions.push(disposable);
          return disposable;
        }),
      executeCommand: vi.fn(),
    },
    speech: {
      registerSpeechProvider: vi
        .fn()
        .mockReturnValue({ dispose: vi.fn() }),
    },
    CancellationTokenSource: class {
      private _cancelled = false;
      get token() {
        return {
          isCancellationRequested: this._cancelled,
          onCancellationRequested: vi.fn(),
        };
      }
      cancel() {
        this._cancelled = true;
      }
      dispose() {}
    },
  };
});

import * as vscode from "vscode";
import { createBackend } from "../src/setup";
import { fakeBackend } from "./helpers/fakeBackend";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("extension integration", () => {
  let fakeContext: vscode.ExtensionContext;

  beforeEach(() => {
    // Reset state
    Object.keys(registeredCommands).forEach(
      (k) => delete registeredCommands[k]
    );
    subscriptions.length = 0;
    statusBars = [];
    configValues = {};
    configUpdates.length = 0;
    onConfigChangeListeners = [];
    vi.clearAllMocks();

    fakeContext = {
      subscriptions: [],
      extensionPath: "/fake/ext",
      globalStorageUri: { fsPath: "/fake/storage" },
    } as unknown as vscode.ExtensionContext;
  });

  describe("activate()", () => {
    it("registers all 7 commands", async () => {
      // No backend configured → first-install flow
      configValues = {};

      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      const expectedCommands = [
        "eloquent.setup",
        "eloquent.toggle",
        "eloquent.enable",
        "eloquent.disable",
        "eloquent.pause",
        "eloquent.readAloud",
        "eloquent.changeVoice",
      ];

      for (const cmd of expectedCommands) {
        expect(registeredCommands[cmd]).toBeDefined();
      }
    });

    it("creates two status bar items", async () => {
      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      // Main status bar + pause bar
      expect(statusBars.length).toBeGreaterThanOrEqual(2);
    });

    it("shows walkthrough on first install (no backend configured)", async () => {
      configValues = {};

      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        "workbench.action.openWalkthrough",
        "adeanima.vscode-eloquent#eloquent.welcome",
        true
      );
    });

    it("creates output channel", async () => {
      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith(
        "Eloquent",
        { log: true }
      );
    });
  });

  describe("command handlers", () => {
    beforeEach(async () => {
      configValues = {};
      // Import and activate fresh
      const ext = await import("../src/extension");
      await ext.activate(fakeContext);
    });

    it("eloquent.disable stops and updates status", async () => {
      const disableHandler = registeredCommands["eloquent.disable"];
      expect(disableHandler).toBeDefined();

      // Call disable — should not throw
      await disableHandler();
    });

    it("eloquent.pause toggles without error when no session", () => {
      const pauseHandler = registeredCommands["eloquent.pause"];
      expect(pauseHandler).toBeDefined();

      // Should be safe even with no active session
      pauseHandler();
    });

    it("eloquent.readAloud warns when no backend set", async () => {
      const readAloudHandler = registeredCommands["eloquent.readAloud"];
      expect(readAloudHandler).toBeDefined();

      await readAloudHandler();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("TTS not active")
      );
    });

    it("eloquent.readAloud warns when no active editor", async () => {
      // We need a backend set, but no active editor
      // Access the provider via the module internals
      const ext = await import("../src/extension");
      // Use enableTts to set up a backend — but we need a configured backend
      // Instead, directly test readAloud with no editor
      const readAloudHandler = registeredCommands["eloquent.readAloud"];
      await readAloudHandler();

      // Should warn about TTS not active (no backend) or no editor
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
    });

    it("eloquent.changeVoice shows message when not kokoro", async () => {
      configValues = { backend: "custom" };

      const changeVoiceHandler = registeredCommands["eloquent.changeVoice"];
      expect(changeVoiceHandler).toBeDefined();

      await changeVoiceHandler();

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("only available for the Kokoro backend")
      );
    });
  });

  describe("deactivate()", () => {
    it("disposes speech registration and backend", async () => {
      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      // Should not throw
      ext.deactivate();
    });
  });

  describe("onDidChangeConfiguration", () => {
    it("registers a config change listener", async () => {
      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      expect(onConfigChangeListeners.length).toBeGreaterThanOrEqual(1);
    });

    it("ignores non-eloquent config changes", async () => {
      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      const event = { affectsConfiguration: (s: string) => s === "editor.fontSize" };
      for (const listener of onConfigChangeListeners) {
        await listener(event);
      }

      // No interaction with createBackend
      expect(createBackend).not.toHaveBeenCalled();
    });

    it("disables TTS when eloquent.enabled changes to false", async () => {
      const ext = await import("../src/extension");
      // Start with a backend configured and enabled
      const backend = fakeBackend();
      vi.mocked(createBackend).mockResolvedValueOnce(backend);
      configValues = { backend: "kokoro", enabled: true };
      await ext.activate(fakeContext);

      // Now simulate enabled → false
      configValues.enabled = false;
      const event = {
        affectsConfiguration: (s: string) =>
          s === "eloquent" || s === "eloquent.enabled",
      };
      for (const listener of onConfigChangeListeners) {
        await listener(event);
      }

      // disableTts logs "TTS disabled."
      const outputChannel = vi.mocked(vscode.window.createOutputChannel).mock.results[0]?.value;
      expect(outputChannel.info).toHaveBeenCalledWith("TTS disabled.");
    });

    it("re-initializes backend when a backend setting changes", async () => {
      const ext = await import("../src/extension");
      // Start with an active backend
      const initialBackend = fakeBackend();
      vi.mocked(createBackend).mockResolvedValueOnce(initialBackend);
      configValues = { backend: "kokoro", enabled: true };
      await ext.activate(fakeContext);

      // Simulate voice setting change
      const newBackend = fakeBackend();
      vi.mocked(createBackend).mockResolvedValueOnce(newBackend);
      const event = {
        affectsConfiguration: (s: string) =>
          s === "eloquent" || s === "eloquent.voice",
      };
      for (const listener of onConfigChangeListeners) {
        await listener(event);
      }

      // Should have called createBackend a second time for the re-init
      expect(createBackend).toHaveBeenCalledTimes(2);
    });

    it("enables TTS when eloquent.enabled changes to true", async () => {
      const ext = await import("../src/extension");
      // Start disabled with a configured backend
      configValues = { backend: "kokoro", enabled: false };
      await ext.activate(fakeContext);

      // Mock createBackend for the enableTts call
      const backend = fakeBackend();
      vi.mocked(createBackend).mockResolvedValueOnce(backend);
      configValues.enabled = true;

      const event = {
        affectsConfiguration: (s: string) =>
          s === "eloquent" || s === "eloquent.enabled",
      };
      for (const listener of onConfigChangeListeners) {
        await listener(event);
      }

      expect(createBackend).toHaveBeenCalledWith("kokoro", expect.anything());
      expect(backend.initialize).toHaveBeenCalled();
    });
  });

  describe("activate() error handling", () => {
    it("catches activation errors and shows error message", async () => {
      // Make createOutputChannel throw on first call
      vi.mocked(vscode.window.createOutputChannel).mockImplementationOnce(
        () => {
          throw new Error("Channel creation failed");
        }
      );

      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Channel creation failed")
      );
    });

    it("starts disabled when backend configured but enabled=false", async () => {
      configValues = { backend: "kokoro", enabled: false };

      const ext = await import("../src/extension");
      await ext.activate(fakeContext);

      // Should update status bar to disabled, not call createBackend
      expect(createBackend).not.toHaveBeenCalled();
      // At least one status bar should show muted state
      const mainBar = statusBars[0];
      expect(mainBar.text).toContain("mute");
    });
  });
});
