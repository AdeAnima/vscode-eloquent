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

import { runCommand, ensureKokoroInstalled } from "../src/installer";
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
});
