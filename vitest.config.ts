import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    isolate: true,
    alias: {
      vscode: path.resolve(__dirname, "test/__mocks__/vscode.ts"),
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/kokoro-js.d.ts"],
      all: true,
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
