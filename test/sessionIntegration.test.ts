import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EloquentProvider } from "../src/speechProvider";
import { CancellationTokenSource, TextToSpeechStatus, setMockConfig } from "./__mocks__/vscode";
import { fakeBackend } from "./helpers/fakeBackend";
import { collectEvents } from "./helpers/collectEvents";

// Mock AudioPlayer so tests don't invoke real system playback commands.
vi.mock("../src/player", () => {
  class MockAudioPlayer {
    paused = false;
    play = vi.fn().mockResolvedValue(undefined);
    pause = vi.fn();
    resume = vi.fn();
    stop = vi.fn();
  }
  return { AudioPlayer: MockAudioPlayer, encodeWav: vi.fn() };
});

/**
 * Integration tests for the full StreamingTextToSpeechSession lifecycle.
 *
 * These test the complete flow: provideTextToSpeechSession → synthesize() calls
 * → ChunkedSynthesizer → backend.synthesize → status events (Started/Stopped/Error).
 *
 * The mock configuration returns initialBatchDelay=0 to avoid real timers in tests.
 */

describe("StreamingTextToSpeechSession integration", () => {
  let provider: EloquentProvider;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setMockConfig("eloquent", "initialBatchDelay", 0);
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    provider = new EloquentProvider();
  });

  afterEach(() => {
    setMockConfig("eloquent", "initialBatchDelay");
    consoleErrorSpy.mockRestore();
  });

  it("full lifecycle: synthesize → Started → Stopped", async () => {
    const backend = fakeBackend();
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;
    expect(session).toBeDefined();

    const eventsPromise = collectEvents(session);

    session.synthesize("Hello world.");

    const events = await eventsPromise;

    expect(events[0].status).toBe(TextToSpeechStatus.Started);
    expect(events[events.length - 1].status).toBe(TextToSpeechStatus.Stopped);
    expect(backend.calls.length).toBeGreaterThanOrEqual(1);
    expect(backend.calls.join(" ")).toContain("Hello");

    cts.dispose();
  });

  it("multiple synthesize calls accumulate text", async () => {
    // Use a small batch delay so all three synchronous synthesize() calls
    // accumulate before the playback loop flushes.
    setMockConfig("eloquent", "initialBatchDelay", 10);
    const backend = fakeBackend();
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;

    const eventsPromise = collectEvents(session);

    // Simulate Copilot streaming tokens
    session.synthesize("First sentence. ");
    session.synthesize("Second sentence. ");
    session.synthesize("Third sentence.");

    const events = await eventsPromise;

    expect(events[0].status).toBe(TextToSpeechStatus.Started);
    expect(events[events.length - 1].status).toBe(TextToSpeechStatus.Stopped);

    const allText = backend.calls.join(" ");
    expect(allText).toContain("First");
    expect(allText).toContain("Third");

    cts.dispose();
  });

  it("cancellation via token fires Stopped and halts synthesis", async () => {
    const backend = fakeBackend({ delay: 50 });
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;

    const eventsPromise = collectEvents(session);

    session.synthesize("Sentence one. Sentence two. Sentence three. Sentence four.");

    // Cancel almost immediately — should not synthesize all chunks
    setTimeout(() => cts.cancel(), 10);

    const events = await eventsPromise;

    expect(events.some((e) => e.status === TextToSpeechStatus.Stopped)).toBe(true);
    // Should have stopped early
    expect(backend.calls.length).toBeLessThan(4);

    cts.dispose();
  });

  it("backend error fires Error status with message", async () => {
    const backend = fakeBackend({ failOnText: "Hello" });
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;

    const eventsPromise = collectEvents(session);

    session.synthesize("Hello world.");

    const events = await eventsPromise;

    const errorEvent = events.find((e) => e.status === TextToSpeechStatus.Error);
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.text).toContain("synthesis failed");

    cts.dispose();
  });

  it("onDidEndSession fires when session completes naturally", async () => {
    const backend = fakeBackend();
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;

    let sessionEnded = false;
    provider.onDidEndSession(() => { sessionEnded = true; });

    const eventsPromise = collectEvents(session);
    session.synthesize("Done.");
    await eventsPromise;

    // Give the finally block time to run
    await new Promise((r) => setTimeout(r, 20));

    expect(sessionEnded).toBe(true);

    cts.dispose();
  });

  it("synthesize after abort is a no-op", async () => {
    const backend = fakeBackend();
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;

    const eventsPromise = collectEvents(session);
    session.synthesize("First.");

    // Cancel and try to synthesize more
    cts.cancel();

    const events = await eventsPromise;
    expect(events.some((e) => e.status === TextToSpeechStatus.Stopped)).toBe(true);

    // This should be silently ignored
    session.synthesize("Should be ignored.");

    // Backend should have been called with at most the first text
    const allText = backend.calls.join(" ");
    expect(allText).not.toContain("ignored");

    cts.dispose();
  });

  it("second session replaces the first", async () => {
    const backend = fakeBackend();
    provider.setBackend(backend);

    // First session
    const cts1 = new CancellationTokenSource();
    const session1 = provider.provideTextToSpeechSession(cts1.token as any)!;

    // Second session immediately replaces
    const cts2 = new CancellationTokenSource();
    const session2 = provider.provideTextToSpeechSession(cts2.token as any)!;

    expect(session2).toBeDefined();
    expect(session2).not.toBe(session1);

    // The second session should work independently
    const events2Promise = collectEvents(session2);
    session2.synthesize("From session two.");
    const events2 = await events2Promise;

    expect(events2[0].status).toBe(TextToSpeechStatus.Started);
    expect(events2[events2.length - 1].status).toBe(TextToSpeechStatus.Stopped);

    cts1.cancel();
    cts1.dispose();
    cts2.dispose();
  });

  it("empty text produces Started then Stopped with no backend calls", async () => {
    const backend = fakeBackend();
    provider.setBackend(backend);

    const cts = new CancellationTokenSource();
    const session = provider.provideTextToSpeechSession(cts.token as any)!;

    const eventsPromise = collectEvents(session);
    session.synthesize("");

    const events = await eventsPromise;

    expect(events[0].status).toBe(TextToSpeechStatus.Started);
    expect(events[events.length - 1].status).toBe(TextToSpeechStatus.Stopped);
    expect(backend.calls.length).toBe(0);

    cts.dispose();
  });
});
