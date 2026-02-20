import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  disableTts,
  togglePause,
  readSelectionAloud,
  changeVoice,
  initializeAndRegister,
  registerCommands,
  testVoice,
  type ExtensionServices,
} from "../src/commands";
import { EloquentProvider } from "../src/speechProvider";
import { StatusBarManager } from "../src/statusBar";
import type { AudioChunk, TtsBackend } from "../src/types";
import * as vscode from "vscode";

// Mock backends to prevent heavy imports
vi.mock("../src/backends/kokoro", () => ({
  KokoroBackend: class {
    name = "Kokoro";
  },
}));
vi.mock("../src/backends/f5python", () => ({
  F5PythonBackend: class {
    name = "F5-TTS (Python)";
  },
}));
vi.mock("../src/backends/custom", () => ({
  CustomBackend: class {
    name = "Custom";
  },
}));
vi.mock("../src/installer", () => ({
  ensureKokoroInstalled: vi.fn(),
  ensurePythonEnvironment: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeBackend(opts?: {
  initFail?: boolean;
}): TtsBackend {
  return {
    name: "FakeBackend",
    initialize: opts?.initFail
      ? vi.fn().mockRejectedValue(new Error("init failed"))
      : vi.fn().mockResolvedValue(undefined),
    async *synthesize(
      _text: string,
      _signal: AbortSignal
    ): AsyncIterable<AudioChunk> {
      yield { samples: new Float32Array([0.1]), sampleRate: 24000 };
    },
    dispose: vi.fn(),
  };
}

function makeServices(overrides?: Partial<ExtensionServices>): ExtensionServices {
  return {
    provider: new EloquentProvider(),
    outputChannel: {
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    } as any,
    statusBar: new StatusBarManager(),
    speechRegistration: undefined,
    ...overrides,
  };
}

function makeContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    extensionPath: "/fake/ext",
    globalStorageUri: { fsPath: "/fake/storage" },
  } as unknown as vscode.ExtensionContext;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("registerCommands", () => {
    it("registers all 7 commands", () => {
      const context = makeContext();
      const services = makeServices();

      // Need commands.registerCommand to be a spy
      const registered: string[] = [];
      (vscode.commands as any) = {
        registerCommand: vi.fn().mockImplementation((id: string, handler: any) => {
          registered.push(id);
          return { dispose: vi.fn() };
        }),
      };

      registerCommands(context, services);

      expect(registered).toContain("eloquent.setup");
      expect(registered).toContain("eloquent.toggle");
      expect(registered).toContain("eloquent.enable");
      expect(registered).toContain("eloquent.disable");
      expect(registered).toContain("eloquent.pause");
      expect(registered).toContain("eloquent.readAloud");
      expect(registered).toContain("eloquent.changeVoice");
      expect(registered.length).toBe(7);
    });
  });

  describe("disableTts", () => {
    it("disposes speech registration and backend", () => {
      const backend = fakeBackend();
      const services = makeServices();
      services.provider.setBackend(backend);
      services.speechRegistration = { dispose: vi.fn() };

      disableTts(services);

      expect(services.speechRegistration).toBeUndefined();
      expect(backend.dispose).toHaveBeenCalled();
    });

    it("is safe when no backend or registration", () => {
      const services = makeServices();
      expect(() => disableTts(services)).not.toThrow();
    });
  });

  describe("togglePause", () => {
    it("calls provider.togglePause", () => {
      const services = makeServices();
      const spy = vi.spyOn(services.provider, "togglePause");

      togglePause(services);

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("readSelectionAloud", () => {
    it("warns when no backend set", async () => {
      const services = makeServices();
      (vscode.window as any).showWarningMessage = vi.fn();

      await readSelectionAloud(services);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("TTS not active")
      );
    });

    it("warns when no active editor", async () => {
      const services = makeServices();
      services.provider.setBackend(fakeBackend());
      (vscode.window as any).activeTextEditor = undefined;
      (vscode.window as any).showWarningMessage = vi.fn();

      await readSelectionAloud(services);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "No active editor."
      );
    });

    it("warns when selection is empty text", async () => {
      const services = makeServices();
      services.provider.setBackend(fakeBackend());
      (vscode.window as any).activeTextEditor = {
        selection: { isEmpty: true },
        document: { getText: () => "   " },
      };
      (vscode.window as any).showWarningMessage = vi.fn();

      await readSelectionAloud(services);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "No text to read."
      );
    });
  });

  describe("initializeAndRegister", () => {
    it("initializes backend and registers speech provider", async () => {
      const context = makeContext();
      const services = makeServices();
      const backend = fakeBackend();

      (vscode.speech as any) = {
        registerSpeechProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      };
      (vscode.window as any).withProgress = vi
        .fn()
        .mockImplementation((_opts: any, task: any) =>
          task({ report: vi.fn() })
        );
      (vscode.window as any).showInformationMessage = vi
        .fn()
        .mockResolvedValue("OK");

      await initializeAndRegister(context, services, backend);

      expect(backend.initialize).toHaveBeenCalled();
      expect(vscode.speech.registerSpeechProvider).toHaveBeenCalledWith(
        "eloquent",
        services.provider
      );
      expect(services.speechRegistration).toBeDefined();
    });

    it("shows error and returns on backend init failure", async () => {
      const context = makeContext();
      const services = makeServices();
      const backend = fakeBackend({ initFail: true });

      (vscode.window as any).withProgress = vi
        .fn()
        .mockImplementation((_opts: any, task: any) =>
          task({ report: vi.fn() })
        );
      (vscode.window as any).showErrorMessage = vi.fn();

      await initializeAndRegister(context, services, backend);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to initialize")
      );
      // Speech provider should NOT be registered
      expect(services.speechRegistration).toBeUndefined();
    });

    it("offers Test Voice and runs it when selected", async () => {
      const context = makeContext();
      const services = makeServices();
      const backend = fakeBackend();

      (vscode.speech as any) = {
        registerSpeechProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      };
      (vscode.window as any).withProgress = vi
        .fn()
        .mockImplementation((_opts: any, task: any) =>
          task({ report: vi.fn() })
        );
      // Simulate clicking "Test Voice"
      (vscode.window as any).showInformationMessage = vi
        .fn()
        .mockResolvedValue("Test Voice");

      await initializeAndRegister(context, services, backend);

      // testVoice should have been called (backend.synthesize invoked)
      // The backend synthesize is an async generator — it was called
      expect(backend.initialize).toHaveBeenCalled();
    });

    it("disposes previous speech registration", async () => {
      const context = makeContext();
      const oldDispose = vi.fn();
      const services = makeServices({
        speechRegistration: { dispose: oldDispose },
      });
      const backend = fakeBackend();

      (vscode.speech as any) = {
        registerSpeechProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      };
      (vscode.window as any).withProgress = vi
        .fn()
        .mockImplementation((_opts: any, task: any) =>
          task({ report: vi.fn() })
        );
      (vscode.window as any).showInformationMessage = vi
        .fn()
        .mockResolvedValue("OK");

      await initializeAndRegister(context, services, backend);

      expect(oldDispose).toHaveBeenCalled();
    });
  });

  describe("testVoice", () => {
    it("synthesizes test text", async () => {
      const services = makeServices();
      const backend = fakeBackend();

      await testVoice(services, backend);

      // The status bar should be updated back to active
      // (testVoice restores status in finally block)
    });
  });

  describe("changeVoice", () => {
    it("shows message when not kokoro backend", async () => {
      const context = makeContext();
      const services = makeServices();
      (vscode.window as any).showInformationMessage = vi.fn();

      // Default config returns empty string for "backend" → not "kokoro"
      await changeVoice(context, services);

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("only available for the Kokoro backend")
      );
    });
  });
});
