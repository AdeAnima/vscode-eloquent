import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execFile: mockExecFile,
}));

// Mock fs for file existence checks
const mockExistsSync = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockMkdirSync = vi.hoisted(() => vi.fn());
const mockUnlinkSync = vi.hoisted(() => vi.fn());

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    unlinkSync: mockUnlinkSync,
  };
});

import { runCommand, ensureKokoroInstalled, ensurePythonEnvironment } from "../src/installer";
import * as vscode from "vscode";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("installer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
  });

  describe("runCommand", () => {
    it("resolves with stdout on success", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(null, "output text", "");
        }
      );

      const result = await runCommand("echo", ["hello"]);
      expect(result).toBe("output text");
    });

    it("rejects with stderr on failure", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(new Error("fail"), "", "some error");
        }
      );

      await expect(runCommand("bad", ["cmd"])).rejects.toThrow("some error");
    });

    it("rejects with error message when stderr is empty", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(new Error("process killed"), "", "");
        }
      );

      await expect(runCommand("bad", ["cmd"])).rejects.toThrow(
        "process killed"
      );
    });

    it("passes cwd and timeout options", async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], opts: any, cb: Function) => {
          cb(null, JSON.stringify(opts), "");
        }
      );

      const result = await runCommand("test", ["arg"], {
        cwd: "/my/dir",
        timeout: 5000,
      });
      const parsed = JSON.parse(result);
      expect(parsed.cwd).toBe("/my/dir");
      expect(parsed.timeout).toBe(5000);
    });
  });

  describe("ensureKokoroInstalled", () => {
    it("skips install when kokoro-js already exists", async () => {
      mockExistsSync.mockReturnValue(true);

      await ensureKokoroInstalled("/ext");

      // Should not call execFile at all
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("throws if npm is not found", async () => {
      mockExistsSync.mockReturnValue(false);

      // First call: npm --version fails
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(new Error("not found"), "", "npm: command not found");
        }
      );

      await expect(ensureKokoroInstalled("/ext")).rejects.toThrow(
        "npm is required"
      );
    });

    it("runs npm install when kokoro-js is missing", async () => {
      mockExistsSync.mockReturnValue(false);

      let callCount = 0;
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], opts: any, cb: Function) => {
          callCount++;
          if (callCount === 1) {
            // npm --version check
            cb(null, "10.0.0", "");
          } else {
            // npm install
            expect(args).toContain("install");
            expect(args).toContain("kokoro-js");
            cb(null, "", "");
          }
        }
      );

      // vscode.window.withProgress should be called
      await ensureKokoroInstalled("/ext");

      expect(callCount).toBe(2);
    });
  });

  describe("ensurePythonEnvironment", () => {
    const storageDir = "/fake/storage";

    /** Make all execFile calls succeed by default */
    function mockExecSuccess() {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          cb(null, "", "");
        }
      );
    }

    it("returns early if venv python already exists", async () => {
      mockExistsSync.mockImplementation((p: string) =>
        p.endsWith("bin/python3") && p.includes("f5-venv")
      );

      const result = await ensurePythonEnvironment(storageDir);

      expect(result).toContain("f5-venv");
      expect(result).toContain("bin/python3");
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("throws on macOS Intel (non-arm64)", async () => {
      mockExistsSync.mockReturnValue(false);
      const origPlatform = process.platform;
      const origArch = process.arch;
      Object.defineProperty(process, "platform", { value: "darwin" });
      Object.defineProperty(process, "arch", { value: "x64" });

      try {
        await expect(ensurePythonEnvironment(storageDir)).rejects.toThrow(
          "Apple Silicon"
        );
      } finally {
        Object.defineProperty(process, "platform", { value: origPlatform });
        Object.defineProperty(process, "arch", { value: origArch });
      }
    });

    it("downloads Python when standalone missing", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();

      await ensurePythonEnvironment(storageDir);

      // First execFile call should be curl download
      const firstCall = mockExecFile.mock.calls[0];
      expect(firstCall[0]).toBe("curl");
      expect(firstCall[1]).toContain("-L");
      expect(firstCall[1]).toContain("--fail");
      // URL should point to python-build-standalone
      expect(firstCall[1].find((a: string) => a.includes("python-build-standalone"))).toBeTruthy();
    });

    it("extracts tarball and cleans up archive", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();

      await ensurePythonEnvironment(storageDir);

      // Second execFile call should be tar extraction
      const tarCall = mockExecFile.mock.calls[1];
      expect(tarCall[0]).toBe("tar");
      expect(tarCall[1]).toContain("xzf");
      expect(tarCall[1]).toContain("--strip-components=1");

      // Archive should be cleaned up
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining("python-standalone.tar.gz")
      );
    });

    it("skips download if standalone binary already exists", async () => {
      mockExistsSync.mockImplementation((p: string) => {
        // venv doesn't exist, but standalone does
        if (p.includes("f5-venv")) return false;
        if (p.includes("python-standalone")) return true;
        return false;
      });
      mockExecSuccess();

      await ensurePythonEnvironment(storageDir);

      // Should NOT call curl (no download)
      const cmds = mockExecFile.mock.calls.map((c: any[]) => c[0]);
      expect(cmds).not.toContain("curl");
      expect(cmds).not.toContain("tar");
    });

    it("creates venv from standalone Python", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();

      await ensurePythonEnvironment(storageDir);

      // Third call: python3 -m venv
      const venvCall = mockExecFile.mock.calls[2];
      expect(venvCall[0]).toContain("python3");
      expect(venvCall[1]).toEqual(["-m", "venv", expect.stringContaining("f5-venv")]);
    });

    it("installs f5-tts-mlx via pip with 30min timeout", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();

      await ensurePythonEnvironment(storageDir);

      // Fourth call: pip install
      const pipCall = mockExecFile.mock.calls[3];
      expect(pipCall[0]).toContain("pip");
      expect(pipCall[1]).toEqual(["install", "f5-tts-mlx"]);
      expect(pipCall[2]).toMatchObject({ timeout: 1_800_000 });
    });

    it("returns venv python path on success", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();

      const result = await ensurePythonEnvironment(storageDir);

      expect(result).toBe(`${storageDir}/f5-venv/bin/python3`);
    });

    it("propagates curl download errors", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecFile.mockImplementation(
        (cmd: string, _args: string[], _opts: any, cb: Function) => {
          if (cmd === "curl") {
            cb(new Error("download failed"), "", "curl: network error");
          } else {
            cb(null, "", "");
          }
        }
      );

      await expect(ensurePythonEnvironment(storageDir)).rejects.toThrow(
        "curl"
      );
    });

    it("propagates pip install errors", async () => {
      mockExistsSync.mockReturnValue(false);
      let callIdx = 0;
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: Function) => {
          callIdx++;
          if (callIdx === 4) {
            // pip install (4th call) fails
            cb(new Error("pip failed"), "", "Could not install f5-tts-mlx");
          } else {
            cb(null, "", "");
          }
        }
      );

      await expect(ensurePythonEnvironment(storageDir)).rejects.toThrow(
        "pip"
      );
    });

    it("creates storageDir recursively", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();

      await ensurePythonEnvironment(storageDir);

      expect(mockMkdirSync).toHaveBeenCalledWith(storageDir, { recursive: true });
    });

    it("generates Linux download URL on linux platform", async () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSuccess();
      const origPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      try {
        await ensurePythonEnvironment(storageDir);

        const curlCall = mockExecFile.mock.calls[0];
        const urlArg = curlCall[1].find((a: string) => a.includes("python-build-standalone"));
        expect(urlArg).toContain("linux-gnu");
      } finally {
        Object.defineProperty(process, "platform", { value: origPlatform });
      }
    });

    it("throws on unsupported platform (win32)", async () => {
      mockExistsSync.mockReturnValue(false);
      const origPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      try {
        await expect(ensurePythonEnvironment(storageDir)).rejects.toThrow(
          "not supported on win32"
        );
      } finally {
        Object.defineProperty(process, "platform", { value: origPlatform });
      }
    });
  });
});
