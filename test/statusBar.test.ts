import { describe, it, expect, vi, beforeEach } from "vitest";
import { StatusBarManager } from "../src/statusBar";

describe("StatusBarManager", () => {
  let manager: StatusBarManager;

  beforeEach(() => {
    manager = new StatusBarManager();
    // Constructor calls pause.hide() — reset counts so tests measure method behavior only
    vi.mocked(manager.main.show).mockClear();
    vi.mocked(manager.main.hide).mockClear();
    vi.mocked(manager.pause.show).mockClear();
    vi.mocked(manager.pause.hide).mockClear();
  });

  it("creates main and pause status bar items", () => {
    expect(manager.main).toBeDefined();
    expect(manager.pause).toBeDefined();
    expect(manager.main.command).toBe("eloquent.toggle");
    expect(manager.pause.command).toBe("eloquent.pause");
  });

  it("showSetup sets megaphone text on main bar", () => {
    manager.showSetup();

    expect(manager.main.text).toBe("$(megaphone) Eloquent Setup");
    expect(manager.main.tooltip).toContain("set up");
    expect(manager.main.show).toHaveBeenCalledTimes(1);
    expect(manager.pause.hide).toHaveBeenCalledTimes(1);
  });

  it("update(true) shows active state with pause button", () => {
    manager.update(true);

    expect(manager.main.text).toBe("$(unmute) EQ");
    expect(manager.main.tooltip).toContain("active");
    expect(manager.pause.text).toBe("$(debug-pause) Pause");
    expect(manager.pause.show).toHaveBeenCalledTimes(1);
    expect(manager.main.show).toHaveBeenCalledTimes(1);
  });

  it("update(false) shows disabled state, hides pause", () => {
    manager.update(false);

    expect(manager.main.text).toBe("$(mute) EQ");
    expect(manager.main.tooltip).toContain("disabled");
    expect(manager.pause.hide).toHaveBeenCalledTimes(1);
    expect(manager.main.show).toHaveBeenCalledTimes(1);
  });

  it("update(false, true) shows loading state", () => {
    manager.update(false, true);

    expect(manager.main.text).toBe("$(loading~spin) EQ");
    expect(manager.main.tooltip).toContain("Loading");
    expect(manager.pause.hide).toHaveBeenCalledTimes(1);
  });

  it("updatePauseState(true) shows resume button", () => {
    manager.updatePauseState(true);

    expect(manager.pause.text).toBe("$(debug-continue) Resume");
    expect(manager.pause.tooltip).toContain("Resume");
  });

  it("updatePauseState(false) shows pause button", () => {
    manager.updatePauseState(false);

    expect(manager.pause.text).toBe("$(debug-pause) Pause");
    expect(manager.pause.tooltip).toContain("Pause");
  });

  it("hidePause hides the pause bar", () => {
    manager.hidePause();
    expect(manager.pause.hide).toHaveBeenCalledTimes(1);
  });

  it("dispose disposes both bars", () => {
    manager.dispose();
    expect(manager.main.dispose).toHaveBeenCalledTimes(1);
    expect(manager.pause.dispose).toHaveBeenCalledTimes(1);
  });
});
