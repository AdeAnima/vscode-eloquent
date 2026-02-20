import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AudioChunk, TtsBackend } from "../src/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRunSetupWizard = vi.fn();
const mockCreateBackend = vi.fn();
const mockShowVoicePicker = vi.fn();
vi.mock("../src/setup", () => ({
  runSetupWizard: (...args: any[]) => mockRunSetupWizard(...args),
  createBackend: (...args: any[]) => mockCreateBackend(...args),
  showVoicePicker: (...args: any[]) => mockShowVoicePicker(...args),
}));

const mockPlayerPlay = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/player", () => ({
  AudioPlayer: class {
    play = mockPlayerPlay;
    dispose = vi.fn();
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  disableTts,
  togglePause,
  readSelectionAloud,
  changeVoice,
  initializeAndRegister,
  registerCommands,
  testVoice,
  enableTts,
  toggleTts,
  setupBackend,
  type ExtensionServices,
} from "../src/commands";
import { EloquentProvider } from "../src/speechProvider";
import { StatusBarManager } from "../src/statusBar";
import * as vscode from "vscode";
import { setMockConfig } from "./__mocks__/vscode";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeBackend(opts?: { initFail?: boolean }): TtsBackend {
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

function makeServices(
  overrides?: Partial<ExtensionServices>
): ExtensionServices {
  return {
    provider: new EloquentProvider(),
    outputChannel: {
      appendLine: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
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

/** Patch vscode.window/speech/commands for command tests. */
function patchVscode() {
  // Module exports are read-only, so mutate properties on the existing objects
  vscode.commands.registerCommand = vi.fn().mockImplementation((_id: string) => ({
    dispose: vi.fn(),
  }));
  vscode.speech.registerSpeechProvider = vi.fn().mockReturnValue({ dispose: vi.fn() });
  (vscode.window as any).showWarningMessage = vi.fn();
  (vscode.window as any).showInformationMessage = vi
    .fn()
    .mockResolvedValue("OK");
  (vscode.window as any).showErrorMessage = vi.fn();
  (vscode.window as any).withProgress = vi
    .fn()
    .mockImplementation((_opts: any, task: any) =>
      task({ report: vi.fn() })
    );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchVscode();
  });

  afterEach(() => {
    setMockConfig("eloquent", "backend");
    setMockConfig("eloquent", "enabled");
  });

  // ── registerCommands ──────────────────────────────────────────────────

  describe("registerCommands", () => {
    it("registers all 7 commands", () => {
      const context = makeContext();
      const services = makeServices();

      registerCommands(context, services);

      const ids = (vscode.commands.registerCommand as any).mock.calls.map(
        (c: any[]) => c[0]
      );
      expect(ids).toEqual([
        "eloquent.setup",
        "eloquent.toggle",
        "eloquent.enable",
        "eloquent.disable",
        "eloquent.pause",
        "eloquent.readAloud",
        "eloquent.changeVoice",
      ]);
    });

    it("pushes disposables to context.subscriptions", () => {
      const context = makeContext();
      registerCommands(context, makeServices());
      expect(context.subscriptions.length).toBe(7);
    });
  });

  // ── disableTts ────────────────────────────────────────────────────────

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

    it("updates status bar to inactive", () => {
      const services = makeServices();
      const spy = vi.spyOn(services.statusBar, "update");

      disableTts(services);

      expect(spy).toHaveBeenCalledWith(false);
    });
  });

  // ── togglePause ───────────────────────────────────────────────────────

  describe("togglePause", () => {
    it("delegates to provider.togglePause", () => {
      const services = makeServices();
      const spy = vi.spyOn(services.provider, "togglePause");

      togglePause(services);

      expect(spy).toHaveBeenCalled();
    });
  });

  // ── readSelectionAloud ────────────────────────────────────────────────

  describe("readSelectionAloud", () => {
    it("warns when no backend set", async () => {
      const services = makeServices();
      await readSelectionAloud(services);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining("TTS not active")
      );
    });

    it("warns when no active editor", async () => {
      const services = makeServices();
      services.provider.setBackend(fakeBackend());
      (vscode.window as any).activeTextEditor = undefined;

      await readSelectionAloud(services);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "No active editor."
      );
    });

    it("warns when selection is empty/whitespace", async () => {
      const services = makeServices();
      services.provider.setBackend(fakeBackend());
      (vscode.window as any).activeTextEditor = {
        selection: { isEmpty: true },
        document: { getText: () => "   " },
      };

      await readSelectionAloud(services);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        "No text to read."
      );
    });

    it("synthesizes and plays audio for selected text", async () => {
      const services = makeServices();
      services.provider.setBackend(fakeBackend());
      (vscode.window as any).activeTextEditor = {
        selection: { isEmpty: false },
        document: { getText: () => "Hello world" },
      };

      await readSelectionAloud(services);

      expect(mockPlayerPlay).toHaveBeenCalled();
    });
  });

  // ── initializeAndRegister ─────────────────────────────────────────────

  describe("initializeAndRegister", () => {
    it("initializes backend and registers speech provider", async () => {
      const context = makeContext();
      const services = makeServices();
      const backend = fakeBackend();

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

      await initializeAndRegister(context, services, backend);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to initialize")
      );
      expect(services.speechRegistration).toBeUndefined();
    });

    it("disposes previous speech registration", async () => {
      const context = makeContext();
      const oldDispose = vi.fn();
      const services = makeServices({
        speechRegistration: { dispose: oldDispose },
      });
      const backend = fakeBackend();

      await initializeAndRegister(context, services, backend);

      expect(oldDispose).toHaveBeenCalled();
    });

    it("sets status bar to loading then active", async () => {
      const context = makeContext();
      const services = makeServices();
      const spy = vi.spyOn(services.statusBar, "update");

      await initializeAndRegister(context, services, fakeBackend());

      expect(spy).toHaveBeenCalledWith(false, true); // loading
      expect(spy).toHaveBeenCalledWith(true); // active
    });

    it("runs testVoice when user clicks 'Test Voice'", async () => {
      const context = makeContext();
      const services = makeServices();
      (vscode.window as any).showInformationMessage = vi
        .fn()
        .mockResolvedValue("Test Voice");

      // testVoice plays audio
      await initializeAndRegister(context, services, fakeBackend());

      expect(mockPlayerPlay).toHaveBeenCalled();
    });
  });

  // ── testVoice ─────────────────────────────────────────────────────────

  describe("testVoice", () => {
    it("plays audio and restores status bar", async () => {
      const services = makeServices();
      const spy = vi.spyOn(services.statusBar, "update");

      await testVoice(services, fakeBackend());

      expect(mockPlayerPlay).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith(true); // finally block
    });

    it("shows error on synthesis failure", async () => {
      const services = makeServices();
      const backend: TtsBackend = {
        name: "Bad",
        initialize: vi.fn(),
        async *synthesize() {
          throw new Error("synthesis boom");
        },
        dispose: vi.fn(),
      };

      await testVoice(services, backend);

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("synthesis boom")
      );
    });
  });

  // ── setupBackend ──────────────────────────────────────────────────────

  describe("setupBackend", () => {
    it("returns without registering if wizard cancelled", async () => {
      mockRunSetupWizard.mockResolvedValue(undefined);

      const services = makeServices();
      await setupBackend(makeContext(), services);

      expect(services.speechRegistration).toBeUndefined();
    });

    it("initializes backend from wizard result", async () => {
      const backend = fakeBackend();
      mockRunSetupWizard.mockResolvedValue(backend);

      const services = makeServices();
      await setupBackend(makeContext(), services);

      expect(backend.initialize).toHaveBeenCalled();
      expect(services.speechRegistration).toBeDefined();
    });
  });

  // ── enableTts ─────────────────────────────────────────────────────────

  describe("enableTts", () => {
    it("runs setup wizard when no backend configured", async () => {
      mockRunSetupWizard.mockResolvedValue(undefined);

      await enableTts(makeContext(), makeServices());

      expect(mockRunSetupWizard).toHaveBeenCalled();
    });

    it("creates and initializes configured backend", async () => {
      setMockConfig("eloquent", "backend", "kokoro");
      const backend = fakeBackend();
      mockCreateBackend.mockResolvedValue(backend);

      const services = makeServices();
      await enableTts(makeContext(), services);

      expect(mockCreateBackend).toHaveBeenCalledWith("kokoro", expect.anything());
      expect(backend.initialize).toHaveBeenCalled();
    });
  });

  // ── toggleTts ─────────────────────────────────────────────────────────

  describe("toggleTts", () => {
    it("disables when currently enabled", async () => {
      setMockConfig("eloquent", "enabled", true);
      const services = makeServices();
      services.speechRegistration = { dispose: vi.fn() };
      const spy = vi.spyOn(services.statusBar, "update");

      await toggleTts(makeContext(), services);

      expect(spy).toHaveBeenCalledWith(false);
      expect(services.speechRegistration).toBeUndefined();
    });

    it("enables when currently disabled", async () => {
      setMockConfig("eloquent", "enabled", false);
      mockRunSetupWizard.mockResolvedValue(undefined);

      await toggleTts(makeContext(), makeServices());

      // Falls through to enableTts → setupBackend because no backend configured
      expect(mockRunSetupWizard).toHaveBeenCalled();
    });
  });

  // ── changeVoice ───────────────────────────────────────────────────────

  describe("changeVoice", () => {
    it("shows message when not kokoro backend", async () => {
      setMockConfig("eloquent", "backend", "f5python");

      await changeVoice(makeContext(), makeServices());

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining("only available for the Kokoro backend")
      );
    });

    it("returns without action if voice picker cancelled", async () => {
      setMockConfig("eloquent", "backend", "kokoro");
      mockShowVoicePicker.mockResolvedValue(undefined);

      const services = makeServices();
      await changeVoice(makeContext(), services);

      expect(services.speechRegistration).toBeUndefined();
    });

    it("re-creates and initializes backend with new voice", async () => {
      setMockConfig("eloquent", "backend", "kokoro");
      mockShowVoicePicker.mockResolvedValue("af_sky");
      const backend = fakeBackend();
      mockCreateBackend.mockResolvedValue(backend);

      const services = makeServices();
      await changeVoice(makeContext(), services);

      expect(mockCreateBackend).toHaveBeenCalledWith("kokoro", expect.anything());
      expect(backend.initialize).toHaveBeenCalled();
    });
  });
});
