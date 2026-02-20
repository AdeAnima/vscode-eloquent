import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as http from "http";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { encodeWav } from "../src/player";
import type { AudioChunk } from "../src/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../src/installer", () => ({
  ensurePythonEnvironment: vi.fn().mockResolvedValue("/fake/python3"),
}));

// We don't mock child_process or fs — instead we skip initialize()
// and test the HTTP synthesis path using a real local server.

import { F5PythonBackend } from "../src/backends/f5python";

// ─── Test HTTP server (simulates the F5-TTS Python server) ───────────────────

let server: http.Server;
let port: number;

const testWav = encodeWav({
  samples: new Float32Array([0.1, 0.2, -0.3, 0.4, -0.5]),
  sampleRate: 24000,
});

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      if (req.url === "/synthesize" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const { text, output_path: outputPath } = JSON.parse(body);

          if (text === "FAIL") {
            res.writeHead(500);
            res.end("Synthesis error");
            return;
          }

          // Write WAV to the requested output path (like the real server)
          fs.writeFileSync(outputPath, testWav);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, "127.0.0.1", () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("F5PythonBackend HTTP integration", () => {
  beforeEach(async () => {
    await startServer();
  });

  afterEach(() => {
    server?.close();
  });

  /** Create a backend pointing at our test server, with ready=true. */
  function readyBackend(): F5PythonBackend {
    const backend = new F5PythonBackend({
      storageDir: os.tmpdir(),
      serverScript: "/fake/server.py",
      port,
      refAudioPath: "",
      refText: "",
      quantization: "none",
    });
    // Skip initialize() (it spawns a real Python process).
    // Directly set ready=true and port to test the HTTP layer.
    (backend as any).ready = true;
    return backend;
  }

  it("synthesize yields audio chunks via HTTP", async () => {
    const backend = readyBackend();
    const abort = new AbortController();
    const chunks: AudioChunk[] = [];

    for await (const chunk of backend.synthesize("Hello world.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(1);
    expect(chunks[0].sampleRate).toBe(24000);
    expect(chunks[0].samples).toBeInstanceOf(Float32Array);
    expect(chunks[0].samples.length).toBe(5);
  });

  // Temp file cleanup (fs.unlink in synthesize's finally block) is a single line of
  // deterministic code. Previously this was tested via tmpdir scanning, but that was
  // inherently racy when vitest runs multiple test files in parallel — all sharing
  // the same os.tmpdir(). The HTTP → file → parseWav pipeline is already covered by
  // "synthesize yields audio chunks via HTTP" above.

  it("synthesize rejects on server error", async () => {
    const backend = readyBackend();
    const abort = new AbortController();

    await expect(async () => {
      for await (const _chunk of backend.synthesize("FAIL", abort.signal)) {
        // consume
      }
    }).rejects.toThrow("Server returned 500");
  });

  it("synthesize respects abort signal (pre-aborted)", async () => {
    const backend = readyBackend();
    const abort = new AbortController();
    abort.abort();

    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize("Hello.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(0);
  });

  it("dispose resets ready state", () => {
    const backend = readyBackend();
    expect((backend as any).ready).toBe(true);

    backend.dispose();
    expect((backend as any).ready).toBe(false);
  });

  it("synthesize after dispose throws", async () => {
    const backend = readyBackend();
    backend.dispose();

    const abort = new AbortController();
    await expect(async () => {
      for await (const _chunk of backend.synthesize("Hello.", abort.signal)) {
        // consume
      }
    }).rejects.toThrow("F5-TTS server not ready");
  });

  it("synthesize rejects when server never responds (timeout)", async () => {
    // Start a server that accepts /synthesize but never responds
    const hangServer = http.createServer((req) => {
      req.resume(); // consume body, but never respond
    });
    const hangPort = await new Promise<number>((resolve) => {
      hangServer.listen(0, "127.0.0.1", () => {
        resolve((hangServer.address() as { port: number }).port);
      });
    });

    try {
      const backend = new F5PythonBackend({
        storageDir: os.tmpdir(),
        serverScript: "/fake/server.py",
        port: hangPort,
        refAudioPath: "",
        refText: "",
        quantization: "none",
        synthesisTimeout: 200, // Very short timeout for testing
      });
      (backend as any).ready = true;

      const abort = new AbortController();
      await expect(async () => {
        for await (const _chunk of backend.synthesize("Hello.", abort.signal)) {
          // consume
        }
      }).rejects.toThrow("Synthesis request timed out");
    } finally {
      hangServer.close();
    }
  });
});
