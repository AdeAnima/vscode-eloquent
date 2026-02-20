import { describe, it, expect, vi, beforeEach } from "vitest";
import { EloquentProvider } from "../src/speechProvider";
import { CancellationTokenSource, TextToSpeechStatus } from "./__mocks__/vscode";
import type { AudioChunk, TtsBackend } from "../src/types";

/** Minimal fake backend for provider tests. */
function fakeBackend(delay = 0): TtsBackend & { calls: string[]; disposed: boolean } {
  const calls: string[] = [];
  let disposed = false;
  return {
    name: "test",
    calls,
    get disposed() { return disposed; },
    async initialize() {},
    async *synthesize(text: string, _signal: AbortSignal): AsyncIterable<AudioChunk> {
      calls.push(text);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      yield { samples: new Float32Array([0.1]), sampleRate: 24000 };
    },
    dispose() { disposed = true; },
  };
}

describe("EloquentProvider", () => {
  let provider: EloquentProvider;

  beforeEach(() => {
    provider = new EloquentProvider();
  });

  // ─── Backend lifecycle ──────────────────────────────────────────────

  describe("backend lifecycle", () => {
    it("starts with no backend", () => {
      expect(provider.getBackend()).toBeUndefined();
    });

    it("setBackend stores the backend", () => {
      const backend = fakeBackend();
      provider.setBackend(backend);
      expect(provider.getBackend()).toBe(backend);
    });

    it("setBackend disposes the previous backend", () => {
      const old = fakeBackend();
      const next = fakeBackend();
      provider.setBackend(old);
      provider.setBackend(next);
      expect(old.disposed).toBe(true);
      expect(next.disposed).toBe(false);
    });
  });

  // ─── Session creation ───────────────────────────────────────────────

  describe("provideTextToSpeechSession", () => {
    it("returns undefined when no backend is set", () => {
      const cts = new CancellationTokenSource();
      const session = provider.provideTextToSpeechSession(cts.token as any);
      expect(session).toBeUndefined();
      cts.dispose();
    });

    it("returns a session when backend is set", () => {
      provider.setBackend(fakeBackend());
      const cts = new CancellationTokenSource();
      const session = provider.provideTextToSpeechSession(cts.token as any);
      expect(session).toBeDefined();
      expect(session).toHaveProperty("synthesize");
      expect(session).toHaveProperty("onDidChange");
      cts.dispose();
    });

    it("resets paused state when creating new session", () => {
      provider.setBackend(fakeBackend());
      // Simulate previous pause state by creating a session and pausing
      const cts1 = new CancellationTokenSource();
      provider.provideTextToSpeechSession(cts1.token as any);
      provider.togglePause(); // pause
      expect(provider.paused).toBe(true);

      // New session should reset pause
      const cts2 = new CancellationTokenSource();
      provider.provideTextToSpeechSession(cts2.token as any);
      expect(provider.paused).toBe(false);
      cts1.dispose();
      cts2.dispose();
    });
  });

  // ─── Pause/resume ──────────────────────────────────────────────────

  describe("togglePause", () => {
    it("returns false when no active session", () => {
      expect(provider.togglePause()).toBe(false);
    });

    it("toggles paused state with active session", () => {
      provider.setBackend(fakeBackend());
      const cts = new CancellationTokenSource();
      provider.provideTextToSpeechSession(cts.token as any);

      expect(provider.paused).toBe(false);
      expect(provider.togglePause()).toBe(true);
      expect(provider.paused).toBe(true);
      expect(provider.togglePause()).toBe(false);
      expect(provider.paused).toBe(false);
      cts.dispose();
    });

    it("fires onDidChangePauseState events", () => {
      provider.setBackend(fakeBackend());
      const cts = new CancellationTokenSource();
      provider.provideTextToSpeechSession(cts.token as any);

      const states: boolean[] = [];
      provider.onDidChangePauseState((paused) => states.push(paused));

      provider.togglePause(); // → true
      provider.togglePause(); // → false

      expect(states).toEqual([true, false]);
      cts.dispose();
    });
  });

  // ─── Stop active session ───────────────────────────────────────────

  describe("stopActiveSession", () => {
    it("does nothing when no session active", () => {
      // Should not throw
      provider.stopActiveSession();
    });

    it("clears paused state and fires events", () => {
      provider.setBackend(fakeBackend());
      const cts = new CancellationTokenSource();
      provider.provideTextToSpeechSession(cts.token as any);
      provider.togglePause(); // → paused

      let endCount = 0;
      provider.onDidEndSession(() => { endCount++; });

      provider.stopActiveSession();

      expect(provider.paused).toBe(false);
      expect(endCount).toBe(1);
      cts.dispose();
    });
  });

  // ─── Other provider methods ────────────────────────────────────────

  describe("other speech methods", () => {
    it("provideSpeechToTextSession returns undefined", () => {
      const cts = new CancellationTokenSource();
      expect(provider.provideSpeechToTextSession(cts.token as any)).toBeUndefined();
      cts.dispose();
    });

    it("provideKeywordRecognitionSession returns undefined", () => {
      const cts = new CancellationTokenSource();
      expect(provider.provideKeywordRecognitionSession(cts.token as any)).toBeUndefined();
      cts.dispose();
    });
  });

  // ─── Session behavior ─────────────────────────────────────────────

  describe("TextToSpeechSession", () => {
    it("fires Started status on first synthesize call", async () => {
      provider.setBackend(fakeBackend());
      const cts = new CancellationTokenSource();
      const session = provider.provideTextToSpeechSession(cts.token as any)!;

      const events: number[] = [];
      session.onDidChange((e: any) => events.push(e.status));

      session.synthesize("Hello.");

      // Started fires synchronously on first synthesize
      expect(events).toContain(TextToSpeechStatus.Started);
      cts.cancel();
      cts.dispose();
    });

    it("cancellation token stops session and fires Stopped", async () => {
      provider.setBackend(fakeBackend(100));
      const cts = new CancellationTokenSource();
      const session = provider.provideTextToSpeechSession(cts.token as any)!;

      const events: number[] = [];
      session.onDidChange((e: any) => events.push(e.status));

      session.synthesize("Hello world. This is a long text.");

      // Cancel immediately
      cts.cancel();

      // Stopped should have been fired
      expect(events).toContain(TextToSpeechStatus.Stopped);
      cts.dispose();
    });
  });
});
