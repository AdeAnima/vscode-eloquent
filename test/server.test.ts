import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProcess = vi.hoisted(() => ({
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  on: vi.fn(),
  kill: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn().mockReturnValue(mockProcess),
  execFile: vi.fn(),
}));

import { TtsServerManager } from "../src/server";
import * as vscode from "vscode";

function createManager(
  pythonPath = "/usr/bin/python3",
  port = 18230
): TtsServerManager {
  const context = {
    subscriptions: [],
  } as unknown as vscode.ExtensionContext;
  return new TtsServerManager(context, pythonPath, port);
}

describe("TtsServerManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProcess.stdout.on.mockReset();
    mockProcess.stderr.on.mockReset();
    mockProcess.on.mockReset();
    mockProcess.kill.mockReset();
  });

  it("creates with status bar and output channel", () => {
    const context = {
      subscriptions: [] as any[],
    } as unknown as vscode.ExtensionContext;

    const manager = new TtsServerManager(context, "/usr/bin/python3", 18230);
    // Output channel + status bar pushed to subscriptions
    expect(context.subscriptions.length).toBe(2);
    expect(manager).toBeDefined();
  });

  it("stop kills the process and resets state", () => {
    const manager = createManager();
    (manager as any).process = mockProcess;
    (manager as any).ready = true;

    manager.stop();

    expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    expect((manager as any).process).toBeNull();
    expect((manager as any).ready).toBe(false);
    expect((manager as any).starting).toBe(false);
  });

  it("stop is safe when no process is running", () => {
    const manager = createManager();
    manager.stop();
    expect((manager as any).process).toBeNull();
    expect((manager as any).ready).toBe(false);
  });

  it("stopPlayback kills the playback process", () => {
    const manager = createManager();
    const mockPlayback = { kill: vi.fn() };
    (manager as any).playbackProcess = mockPlayback;

    manager.stopPlayback();

    expect(mockPlayback.kill).toHaveBeenCalledWith("SIGTERM");
    expect((manager as any).playbackProcess).toBeNull();
  });

  it("stopPlayback is safe when no playback", () => {
    const manager = createManager();
    manager.stopPlayback();
    expect((manager as any).playbackProcess).toBeNull();
  });

  it("updateConfig triggers restart when config changes and server is ready", () => {
    const manager = createManager("/usr/bin/python3", 18230);
    (manager as any).ready = true;

    // Spy on stop/start
    const stopSpy = vi.spyOn(manager, "stop");
    const startSpy = vi
      .spyOn(manager, "start")
      .mockResolvedValue(undefined);

    manager.updateConfig("/new/python", 9999);

    expect(stopSpy).toHaveBeenCalled();
    expect(startSpy).toHaveBeenCalled();
    expect((manager as any).pythonPath).toBe("/new/python");
    expect((manager as any).port).toBe(9999);
  });

  it("updateConfig does not restart when config unchanged", () => {
    const manager = createManager("/usr/bin/python3", 18230);
    (manager as any).ready = true;

    const stopSpy = vi.spyOn(manager, "stop");

    manager.updateConfig("/usr/bin/python3", 18230);

    expect(stopSpy).not.toHaveBeenCalled();
  });

  it("synthesizeAndPlay throws when server is not running", async () => {
    const manager = createManager();
    // start() won't actually make it ready since it's mocked spawn
    // Set starting to prevent the long `start()` wait
    (manager as any).starting = true;

    // Manually mark as not ready
    await expect(manager.synthesizeAndPlay("Hello")).rejects.toThrow(
      "TTS server is not running"
    );
  });
});
