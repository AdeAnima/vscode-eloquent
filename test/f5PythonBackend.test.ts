import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

/** Create a mock ChildProcess with EventEmitter-based stdout/stderr */
function createMockProcess() {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    stdout,
    stderr,
    kill: vi.fn(),
    pid: 12345,
  });
  return proc;
}

let currentMockProcess = createMockProcess();

// Mock installer
vi.mock("../src/installer", () => ({
  ensurePythonEnvironment: vi.fn().mockResolvedValue("/fake/python3"),
}));

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn().mockImplementation(() => currentMockProcess),
}));

import { F5PythonBackend } from "../src/backends/f5python";
import { spawn } from "child_process";

/** Default F5 config for tests */
const defaultConfig = {
  storageDir: "/tmp/store",
  serverScript: "/tmp/server.py",
  port: 18230,
  refAudioPath: "",
  refText: "",
  quantization: "none",
};

describe("F5PythonBackend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentMockProcess = createMockProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has correct name", () => {
    const backend = new F5PythonBackend(defaultConfig);
    expect(backend.name).toBe("F5-TTS (Python)");
  });

  it("synthesize throws when not initialized", async () => {
    const backend = new F5PythonBackend(defaultConfig);
    const abort = new AbortController();

    await expect(async () => {
      for await (const _chunk of backend.synthesize("Hello.", abort.signal)) {
        // noop
      }
    }).rejects.toThrow("F5-TTS server not ready");
  });

  it("dispose kills the process", () => {
    const backend = new F5PythonBackend(defaultConfig);
    (backend as any).process = currentMockProcess;
    (backend as any).ready = true;

    backend.dispose();

    expect(currentMockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    expect((backend as any).process).toBeNull();
    expect((backend as any).ready).toBe(false);
  });

  it("dispose is safe when no process is running", () => {
    const backend = new F5PythonBackend(defaultConfig);
    backend.dispose();
    expect((backend as any).process).toBeNull();
    expect((backend as any).ready).toBe(false);
  });

  it("synthesize respects abort signal when pre-aborted", async () => {
    const backend = new F5PythonBackend(defaultConfig);
    (backend as any).ready = true;

    const abort = new AbortController();
    abort.abort();

    const chunks = [];
    for await (const chunk of backend.synthesize("Hello.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(0);
  });

  // ─── startServer / initialize tests ──────────────────────────────────────

  /** Wait for ensurePython() microtask to resolve, then emit on stdout */
  function emitReady() {
    // ensurePythonEnvironment mock resolves async; wait for spawn to be called
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        currentMockProcess.stdout.emit("data", Buffer.from("READY\n"));
        resolve();
      }, 0);
    });
  }

  it("initialize resolves when stdout emits READY", async () => {
    const backend = new F5PythonBackend(defaultConfig);

    const initPromise = backend.initialize();
    await emitReady();
    await initPromise;

    expect((backend as any).ready).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      "/fake/python3",
      expect.arrayContaining(["/tmp/server.py", "--port", "18230"]),
      expect.any(Object)
    );
  });

  it("initialize rejects after 60s timeout", async () => {
    vi.useFakeTimers();
    const backend = new F5PythonBackend(defaultConfig);

    const initPromise = backend.initialize();
    // Catch immediately to prevent unhandled rejection
    const rejection = expect(initPromise).rejects.toThrow("failed to start within 60s");
    // Flush the ensurePython microtask so startServer runs, then advance timer
    await vi.advanceTimersByTimeAsync(60_000);

    await rejection;
  });

  it("initialize rejects on process error", async () => {
    const backend = new F5PythonBackend(defaultConfig);

    const initPromise = backend.initialize();
    // Wait for spawn to be called, then emit error
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        currentMockProcess.emit("error", new Error("spawn ENOENT"));
        resolve();
      }, 0);
    });

    await expect(initPromise).rejects.toThrow("spawn ENOENT");
  });

  it("sets ready=false on process exit", async () => {
    const backend = new F5PythonBackend(defaultConfig);

    const initPromise = backend.initialize();
    await emitReady();
    await initPromise;

    expect((backend as any).ready).toBe(true);

    currentMockProcess.emit("exit");

    expect((backend as any).ready).toBe(false);
    expect((backend as any).process).toBeNull();
  });

  it("passes refAudioPath, refText, and quantization as CLI args", async () => {
    const backend = new F5PythonBackend({
      ...defaultConfig,
      refAudioPath: "/path/to/ref.wav",
      refText: "Hello world",
      quantization: "8bit",
    });

    const initPromise = backend.initialize();
    await emitReady();
    await initPromise;

    expect(spawn).toHaveBeenCalledWith(
      "/fake/python3",
      expect.arrayContaining([
        "--ref-audio", "/path/to/ref.wav",
        "--ref-text", "Hello world",
        "--quantize", "8bit",
      ]),
      expect.any(Object)
    );
  });

  it("does not pass optional args when empty/none", async () => {
    const backend = new F5PythonBackend(defaultConfig);

    const initPromise = backend.initialize();
    await emitReady();
    await initPromise;

    const spawnArgs = vi.mocked(spawn).mock.calls[0][1] as string[];
    expect(spawnArgs).not.toContain("--ref-audio");
    expect(spawnArgs).not.toContain("--ref-text");
    expect(spawnArgs).not.toContain("--quantize");
  });
});
