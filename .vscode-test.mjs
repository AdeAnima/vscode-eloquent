import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/e2e/**/*.test.js",
  version: "insiders",
  mocha: {
    ui: "tdd",
    timeout: 30000,
  },
  launchArgs: [
    "--disable-extensions",
    "--enable-proposed-api=adeanima.vscode-eloquent",
  ],
});
