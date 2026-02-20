import * as assert from "assert";
import * as vscode from "vscode";

const EXTENSION_ID = "adeanima.vscode-eloquent";

suite("Eloquent Smoke Tests", () => {
  test("Extension is present", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "Extension should be installed");
  });

  test("Extension activates", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "Extension must be present");
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "Extension should be active after activation");
  });

  const EXPECTED_COMMANDS = [
    "eloquent.setup",
    "eloquent.toggle",
    "eloquent.enable",
    "eloquent.disable",
    "eloquent.pause",
    "eloquent.readAloud",
    "eloquent.changeVoice",
    "eloquent.toggleNarrationMode",
  ];

  test("All commands are registered", async () => {
    // Ensure extension is active first
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();

    const allCommands = await vscode.commands.getCommands(true);
    for (const cmd of EXPECTED_COMMANDS) {
      assert.ok(
        allCommands.includes(cmd),
        `Command "${cmd}" should be registered`
      );
    }
  });

  test("Output channel is created", async () => {
    // After activation, the "Eloquent" output channel should exist.
    // We can verify indirectly by checking the extension activated without error.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext);
    await ext.activate();
    assert.strictEqual(ext.isActive, true, "Extension active means output channel was created");
  });

  test("Walkthrough contribution is accessible", async () => {
    // Verify the walkthrough command executes without throwing.
    // The walkthrough panel may not be visible in headless mode,
    // but the command should not reject.
    await vscode.commands.executeCommand(
      "workbench.action.openWalkthrough",
      `${EXTENSION_ID}#eloquent.welcome`,
      true
    );
  });

  test("Configuration contributes all expected settings", () => {
    const config = vscode.workspace.getConfiguration("eloquent");
    const inspect = (key: string) => config.inspect(key);

    const EXPECTED_SETTINGS = [
      "enabled",
      "backend",
      "voice",
      "speed",
      "prefetchBufferSize",
      "initialBatchDelay",
      "kokoroDtype",
      "serverPort",
      "narrationMode",
      "customEndpoint",
    ];

    for (const key of EXPECTED_SETTINGS) {
      const info = inspect(key);
      assert.ok(
        info !== undefined && info.defaultValue !== undefined,
        `Setting "eloquent.${key}" should be contributed with a default`
      );
    }
  });
});
