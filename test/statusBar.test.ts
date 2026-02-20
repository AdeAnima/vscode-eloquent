import { describe, it, expect, vi, beforeEach } from "vitest";
import { StatusBarManager } from "../src/statusBar";

describe("StatusBarManager", () => {
  let manager: StatusBarManager;

  beforeEach(() => {
    manager = new StatusBarManager();
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
    expect(manager.main.show).toHaveBeenCalled();
    expect(manager.pause.hide).toHaveBeenCalled();
  });

  it("update(true) shows active state with pause button", () => {
    manager.update(true);

    expect(manager.main.text).toBe("$(unmute) EQ");
    expect(manager.main.tooltip).toContain("active");
    expect(manager.pause.text).toBe("$(debug-pause) Pause");
    expect(manager.pause.show).toHaveBeenCalled();
    expect(manager.main.show).toHaveBeenCalled();
  });

  it("update(false) shows disabled state, hides pause", () => {
    manager.update(false);

    expect(manager.main.text).toBe("$(mute) EQ");
    expect(manager.main.tooltip).toContain("disabled");
    expect(manager.pause.hide).toHaveBeenCalled();
    expect(manager.main.show).toHaveBeenCalled();
  });

  it("update(false, true) shows loading state", () => {
    manager.update(false, true);

    expect(manager.main.text).toBe("$(loading~spin) EQ");
    expect(manager.main.tooltip).toContain("Loading");
    expect(manager.pause.hide).toHaveBeenCalled();
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
    expect(manager.pause.hide).toHaveBeenCalled();
  });

  it("dispose disposes both bars", () => {
    manager.dispose();
    expect(manager.main.dispose).toHaveBeenCalled();
    expect(manager.pause.dispose).toHaveBeenCalled();
  });
});
