import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CustomBackend } from "../src/backends/custom";
import { encodeWav } from "../src/player";
import * as http from "http";
import type { AudioChunk } from "../src/types";

// ─── Test HTTP server ─────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

/** WAV response for a known test phrase */
const testWav = encodeWav({
  samples: new Float32Array([0.1, 0.2, 0.3]),
  sampleRate: 24000,
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200);
      res.end("OK");
      return;
    }
    if (req.url === "/synthesize" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { text } = JSON.parse(body);
        if (text === "FAIL") {
          res.writeHead(500);
          res.end("Internal error");
          return;
        }
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(testWav);
      });
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CustomBackend", () => {
  it("has correct name", () => {
    const backend = new CustomBackend(baseUrl);
    expect(backend.name).toBe("Custom Endpoint");
  });

  it("initialize succeeds with healthy endpoint", async () => {
    const backend = new CustomBackend(baseUrl);
    await expect(backend.initialize()).resolves.toBeUndefined();
  });

  it("initialize resolves even when /health returns error (graceful)", async () => {
    // Connect to the server but health returns error — this should still resolve
    // because the code treats connection errors gracefully
    const backend = new CustomBackend("http://127.0.0.1:1"); // unreachable port
    // The code resolves on "error" event, so this should not throw
    await expect(backend.initialize()).resolves.toBeUndefined();
  });

  it("synthesize returns audio chunks for valid text", async () => {
    const backend = new CustomBackend(baseUrl);
    await backend.initialize();

    const abort = new AbortController();
    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize("Hello.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].sampleRate).toBe(24000);
    expect(chunks[0].samples).toBeInstanceOf(Float32Array);
  });

  it("synthesize stops on abort signal", async () => {
    const backend = new CustomBackend(baseUrl);
    await backend.initialize();

    const abort = new AbortController();
    abort.abort(); // Pre-abort

    const chunks: AudioChunk[] = [];
    for await (const chunk of backend.synthesize("Hello. World.", abort.signal)) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBe(0);
  });

  it("synthesize rejects on server error", async () => {
    const backend = new CustomBackend(baseUrl);
    await backend.initialize();

    const abort = new AbortController();
    const chunks: AudioChunk[] = [];

    await expect(async () => {
      for await (const chunk of backend.synthesize("FAIL", abort.signal)) {
        chunks.push(chunk);
      }
    }).rejects.toThrow("Custom TTS returned 500");
  });

  it("dispose is a no-op (does not throw)", () => {
    const backend = new CustomBackend(baseUrl);
    expect(() => backend.dispose()).not.toThrow();
  });
});
