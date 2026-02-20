import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock backends to avoid heavy imports — use class so `new` works
vi.mock("../src/backends/kokoro", () => ({
  KokoroBackend: class {
    name = "Kokoro";
    constructor(..._args: any[]) {}
  },
}));
vi.mock("../src/backends/f5python", () => ({
  F5PythonBackend: class {
    name = "F5-TTS (Python)";
    constructor(..._args: any[]) {}
  },
}));
vi.mock("../src/backends/custom", () => ({
  CustomBackend: class {
    name = "Custom";
    constructor(..._args: any[]) {}
  },
}));
vi.mock("../src/installer", () => ({
  ensureKokoroInstalled: vi.fn(),
  ensurePythonEnvironment: vi.fn(),
}));

import * as vscode from "vscode";
import {
  showBackendPicker,
  showVoicePicker,
  createBackend,
  runSetupWizard,
} from "../src/setup";
import type { BackendId } from "../src/types";

function makeContext(
  extensionPath = "/ext",
  storagePath = "/storage"
): vscode.ExtensionContext {
  return {
    extensionPath,
    globalStorageUri: { fsPath: storagePath },
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
}

describe("setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("showBackendPicker", () => {
    it("returns backendId when user selects", async () => {
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue({ backendId: "kokoro" });

      const result = await showBackendPicker();
      expect(result).toBe("kokoro");
    });

    it("returns undefined when user cancels", async () => {
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await showBackendPicker();
      expect(result).toBeUndefined();
    });
  });

  describe("showVoicePicker", () => {
    it("returns selected voice label", async () => {
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue({ label: "am_adam" });

      const result = await showVoicePicker();
      expect(result).toBe("am_adam");
    });

    it("returns undefined when cancelled", async () => {
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await showVoicePicker();
      expect(result).toBeUndefined();
    });
  });

  describe("createBackend", () => {
    it("creates KokoroBackend with voice from config", async () => {
      // Mock config returning voice and dtype
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "voice") return "af_bella";
          if (key === "kokoroDtype") return "fp32";
          return def;
        },
        update: vi.fn(),
      });

      const ctx = makeContext("/ext");
      const backend = await createBackend("kokoro", ctx);
      expect(backend).toBeDefined();
      expect(backend!.name).toBe("Kokoro");
    });

    it("creates KokoroBackend and prompts for voice when not configured", async () => {
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "voice") return ""; // No voice configured
          if (key === "kokoroDtype") return "q8";
          return def;
        },
        update: vi.fn(),
      });
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue({ label: "am_michael" });

      const ctx = makeContext();
      const backend = await createBackend("kokoro", ctx);
      expect(backend).toBeDefined();
      expect(vscode.window.showQuickPick).toHaveBeenCalled();
    });

    it("creates F5PythonBackend with config values", async () => {
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "serverPort") return 9999;
          if (key === "refAudioPath") return "/audio/ref.wav";
          if (key === "refText") return "Hello";
          if (key === "quantization") return "8bit";
          return def;
        },
        update: vi.fn(),
      });

      const ctx = makeContext("/ext", "/store");
      const backend = await createBackend("f5-python", ctx);
      expect(backend).toBeDefined();
      expect(backend!.name).toBe("F5-TTS (Python)");
    });

    it("creates CustomBackend with endpoint from config", async () => {
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "customEndpoint") return "http://localhost:5000";
          return def;
        },
        update: vi.fn(),
      });

      const ctx = makeContext();
      const backend = await createBackend("custom", ctx);
      expect(backend).toBeDefined();
      expect(backend!.name).toBe("Custom");
    });

    it("custom returns undefined when no endpoint and user cancels", async () => {
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "customEndpoint") return "";
          return def;
        },
        update: vi.fn(),
      });
      (vscode.window as any).showInputBox = vi
        .fn()
        .mockResolvedValue(undefined);

      const ctx = makeContext();
      const backend = await createBackend("custom", ctx);
      expect(backend).toBeUndefined();
    });

    it("custom prompts for endpoint and saves when user provides one", async () => {
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "customEndpoint") return "";
          return def;
        },
        update: mockUpdate,
      });
      (vscode.window as any).showInputBox = vi
        .fn()
        .mockResolvedValue("http://localhost:9090");

      const ctx = makeContext();
      const backend = await createBackend("custom", ctx);
      expect(backend).toBeDefined();
      expect(backend!.name).toBe("Custom");
      expect(mockUpdate).toHaveBeenCalledWith(
        "customEndpoint",
        "http://localhost:9090",
        1 // ConfigurationTarget.Global
      );
    });
  });

  describe("runSetupWizard", () => {
    it("returns backend when user picks one", async () => {
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue({ backendId: "kokoro" });
      const mockUpdate = vi.fn().mockResolvedValue(undefined);
      (vscode.workspace as any).getConfiguration = () => ({
        get: (key: string, def?: any) => {
          if (key === "voice") return "af_heart";
          if (key === "kokoroDtype") return "q8";
          return def;
        },
        update: mockUpdate,
      });

      const ctx = makeContext("/ext");
      const result = await runSetupWizard(ctx);
      expect(result).toBeDefined();
      expect(result!.name).toBe("Kokoro");
      expect(mockUpdate).toHaveBeenCalledWith("backend", "kokoro", 1);
    });

    it("returns undefined when user cancels picker", async () => {
      (vscode.window as any).showQuickPick = vi
        .fn()
        .mockResolvedValue(undefined);

      const ctx = makeContext();
      const result = await runSetupWizard(ctx);
      expect(result).toBeUndefined();
    });
  });
});
