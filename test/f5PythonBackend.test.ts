import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProcess = vi.hoisted(() => ({
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
}));

// Mock installer
vi.mock("../src/installer", () => ({
  ensurePythonEnvironment: vi.fn().mockResolvedValue("/fake/python3"),
}));

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn().mockReturnValue(mockProcess),
}));

import { F5PythonBackend } from "../src/backends/f5python";

describe("F5PythonBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock process handlers
    mockProcess.stdout.on.mockReset();
    mockProcess.on.mockReset();
    mockProcess.kill.mockReset();
  });

  it("has correct name", () => {
    const backend = new F5PythonBackend({ storageDir: "/tmp/store", serverScript: "/tmp/server.py", port: 18230, refAudioPath: "", refText: "", quantization: "none" });
    expect(backend.name).toBe("F5-TTS (Python)");
  });

  it("synthesize throws when not initialized", async () => {
    const backend = new F5PythonBackend({ storageDir: "/tmp/store", serverScript: "/tmp/server.py", port: 18230, refAudioPath: "", refText: "", quantization: "none" });
    const abort = new AbortController();

    await expect(async () => {
      for await (const _chunk of backend.synthesize("Hello.", abort.signal)) {
        // noop
      }
    }).rejects.toThrow("F5-TTS server not ready");
  });

  it("dispose kills the process", () => {
    const backend = new F5PythonBackend({ storageDir: "/tmp/store", serverScript: "/tmp/server.py", port: 18230, refAudioPath: "", refText: "", quantization: "none" });
    // Simulate a running process
    (backend as any).process = mockProcess;
    (backend as any).ready = true;

    backend.dispose();

    expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    expect((backend as any).process).toBeNull();
    expect((backend as any).ready).toBe(false);
  });

  it("dispose is safe when no process is running", () => {
    const backend = new F5PythonBackend({ storageDir: "/tmp/store", serverScript: "/tmp/server.py", port: 18230, refAudioPath: "", refText: "", quantization: "none" });
    // Should not throw
    backend.dispose();
    expect((backend as any).process).toBeNull();
    expect((backend as any).ready).toBe(false);
  });

  it("synthesize respects abort signal when pre-aborted", async () => {
    const backend = new F5PythonBackend({ storageDir: "/tmp/store", serverScript: "/tmp/server.py", port: 18230, refAudioPath: "", refText: "", quantization: "none" });
    (backend as any).ready = true;

    const abort = new AbortController();
    abort.abort();

    const chunks = [];
    for await (const chunk of backend.synthesize("Hello.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(0);
  });
});
