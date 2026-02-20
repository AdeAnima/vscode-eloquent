import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";

/** Run a command and return stdout. Rejects on non-zero exit. */
export function runCommand(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options?.cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: options?.timeout ?? 600_000,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `${command} ${args[0] ?? ""} failed: ${stderr || err.message}`
            )
          );
        } else {
          resolve(stdout);
        }
      }
    );
  });
}

// ─── Kokoro ─────────────────────────────────────────────────────────────────

/**
 * Ensure `kokoro-js` npm package is installed in the extension's node_modules.
 * If missing, runs `npm install --no-save kokoro-js` in the extension directory.
 */
export async function ensureKokoroInstalled(
  extensionPath: string
): Promise<void> {
  const moduleDir = path.join(extensionPath, "node_modules", "kokoro-js");
  if (fs.existsSync(moduleDir)) return;

  try {
    await runCommand("npm", ["--version"]);
  } catch {
    throw new Error(
      "npm is required to install Kokoro TTS but was not found on PATH."
    );
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Eloquent",
      cancellable: false,
    },
    async (progress) => {
      progress.report({
        message: "Installing Kokoro TTS package (this may take a minute)…",
      });
      await runCommand("npm", ["install", "--no-save", "kokoro-js"], {
        cwd: extensionPath,
      });
    }
  );
}

// ─── F5-TTS Python ──────────────────────────────────────────────────────────

const PYTHON_RELEASE = "20260211";
const PYTHON_VERSION = "3.13.12";

function getPythonDownloadUrl(): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "darwin") {
    return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${arch}-apple-darwin-install_only_stripped.tar.gz`;
  }
  if (process.platform === "linux") {
    return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-${arch}-unknown-linux-gnu-install_only_stripped.tar.gz`;
  }
  throw new Error(
    `F5-TTS Python backend is not supported on ${process.platform}/${process.arch}.`
  );
}

/**
 * Ensure a self-contained Python environment with f5-tts-mlx is set up.
 *
 * Layout:
 *   <storageDir>/python-standalone/bin/python3   — standalone CPython
 *   <storageDir>/f5-venv/bin/python3              — venv with f5-tts-mlx
 *
 * Returns the path to the venv python executable.
 */
export async function ensurePythonEnvironment(
  storageDir: string
): Promise<string> {
  const standaloneDir = path.join(storageDir, "python-standalone");
  const standaloneBin = path.join(standaloneDir, "bin", "python3");
  const venvDir = path.join(storageDir, "f5-venv");
  const venvPython = path.join(venvDir, "bin", "python3");

  if (fs.existsSync(venvPython)) return venvPython;

  if (process.platform === "darwin" && process.arch !== "arm64") {
    throw new Error(
      "F5-TTS requires Apple Silicon (arm64). Intel Macs are not supported."
    );
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Eloquent",
      cancellable: false,
    },
    async (progress) => {
      fs.mkdirSync(storageDir, { recursive: true });

      // 1. Download standalone Python if needed
      if (!fs.existsSync(standaloneBin)) {
        progress.report({ message: "Downloading Python runtime (~18 MB)…" });
        const url = getPythonDownloadUrl();
        const archivePath = path.join(storageDir, "python-standalone.tar.gz");

        await runCommand("curl", [
          "-L",
          "-o",
          archivePath,
          "--fail",
          "-s",
          "-S",
          url,
        ]);

        // 2. Extract (tar.gz has python/ at top level, strip it)
        progress.report({ message: "Extracting Python runtime…" });
        fs.mkdirSync(standaloneDir, { recursive: true });
        await runCommand("tar", [
          "xzf",
          archivePath,
          "-C",
          standaloneDir,
          "--strip-components=1",
        ]);

        fs.unlinkSync(archivePath);
      }

      // 3. Create venv
      progress.report({ message: "Creating virtual environment…" });
      await runCommand(standaloneBin, ["-m", "venv", venvDir]);

      // 4. Install f5-tts-mlx (pulls in MLX — can be large)
      progress.report({
        message: "Installing F5-TTS (this may take several minutes)…",
      });
      const pip = path.join(venvDir, "bin", "pip");
      await runCommand(pip, ["install", "f5-tts-mlx"], {
        timeout: 1_800_000,
      });
    }
  );

  return venvPython;
}
