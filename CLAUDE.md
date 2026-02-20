# CLAUDE.md — Eloquent (vscode-eloquent)

## Project Overview

VS Code extension replacing built-in TTS with high-quality local speech synthesis. Multi-backend: Kokoro (Node.js ONNX), F5-TTS (Python MLX), or custom HTTP endpoint. Uses the proposed `speech` API — requires VS Code Insiders.

## Build & Run

```bash
npm install          # install dependencies
npm run build        # esbuild → out/extension.js
npm test             # vitest (50+ tests)
npm run typecheck    # tsc --noEmit
npm run watch        # rebuild on save
```

Debug: F5 in VS Code Insiders launches Extension Development Host.

## Development Workflow

### Commit Granularly

Make small, focused commits — one logical change per commit. This makes it easy to bisect regressions and review history.

**Good examples:**
- `fix: handle nested blockquotes in preprocessor`
- `feat: add pause/resume support to player`
- `test: add chunker edge case tests`

**Bad examples:**
- `update files` (too vague)
- `feat: add preprocessor, tests, and CI` (too many things)

### Always Update Tests

When changing code, **update or add tests in the same commit**. Never leave tests for a follow-up.

- **Bug fix?** → Add a regression test that reproduces the bug, then fix it.
- **New feature?** → Add tests covering the happy path and edge cases.
- **Refactor?** → Ensure existing tests still pass; update if interfaces changed.

Run `npm test` before every commit. Run `npm run build && npm run typecheck` before pushing.

### Test-then-commit cycle

```
1. Write/update tests for the change
2. Run `npm test` — confirm new tests fail (for new features/bugs)
3. Implement the change
4. Run `npm test` — confirm all tests pass
5. Run `npm run build && npm run typecheck` — confirm no regressions
6. Commit with a descriptive message
```

## Architecture

- `src/types.ts` — `TtsBackend` interface, `BackendId`, `AudioChunk`, `BACKENDS` const
- `src/chunker.ts` — `chunkText()` sentence splitting + `ChunkedSynthesizer` prefetch buffer
- `src/textPreprocessor.ts` — Markdown → speech-friendly plain text (code blocks, tables, links, etc.)
- `src/player.ts` — Platform-native audio playback with pause/resume (SIGSTOP/SIGCONT)
- `src/speechProvider.ts` — VS Code `SpeechProvider` + `StreamingTextToSpeechSession` (150ms initial batching)
- `src/extension.ts` — Entry point, 7 commands, status bar, walkthrough trigger
- `src/setup.ts` — Backend picker, voice picker (28 Kokoro voices), `createBackend()` factory
- `src/installer.ts` — Auto-install kokoro-js (npm) or python-build-standalone + f5-tts-mlx (pip)
- `src/kokoro-js.d.ts` — Type declarations for kokoro-js npm package
- `src/backends/kokoro.ts` — Kokoro ONNX backend (in-process Node.js)
- `src/backends/f5python.ts` — F5-TTS via auto-installed Python subprocess
- `src/backends/custom.ts` — HTTP endpoint backend

## Test Structure

Tests live in `test/` and use vitest with a vscode mock (`test/__mocks__/vscode.ts`).

- `test/textPreprocessor.test.ts` — Markdown preprocessing (headings, tables, code blocks, URLs, etc.)
- `test/chunker.test.ts` — Sentence splitting and chunk sizing
- `test/chunkedSynthesizer.test.ts` — Streaming, abort, prefetch buffer

## Conventions

- Extension name: "Eloquent", settings prefix: `eloquent.*`, commands: `eloquent.*`
- Bundler: esbuild — `kokoro-js` and `onnxruntime-node` are externals
- Proposed API: `vscode.proposed.speech.d.ts` — Insiders + `enabledApiProposals: ["speech"]`
- Kokoro backend is pure Node.js (no Python). F5-TTS auto-downloads standalone Python.
- Platform playback: `afplay` (macOS), `aplay` (Linux), PowerShell (Windows)

## CI/CD

- `.github/workflows/ci.yml` — Runs on push/PR to main: tests (Node 20+22), build, typecheck
- `.github/workflows/release.yml` — Triggered on `v*` tags: tests, build, vsce package, GitHub Release
