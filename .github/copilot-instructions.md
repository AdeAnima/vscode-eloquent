# Project Guidelines — Eloquent (vscode-eloquent)

## Overview

VS Code extension that replaces the built-in TTS with high-quality speech synthesis. Registers as a VS Code `SpeechProvider` via the proposed `speech` API. Multi-backend architecture: users choose between Kokoro (Node.js), F5-TTS (Python), or a custom HTTP endpoint.

## Architecture

### Backend Abstraction (`src/types.ts`)
All TTS engines implement the `TtsBackend` interface: `initialize()`, `synthesize(text, signal)` (async iterable of `AudioChunk`), `dispose()`. **Chunking is owned by callers** — the `ChunkedSynthesizer` in `src/chunker.ts` handles sentence-level text splitting and buffered streaming; backends receive pre-chunked text segments.

### Backends
- **Kokoro** (`src/backends/kokoro.ts`): Default. 82M-param ONNX model via `kokoro-js` npm. Runs in-process on Node.js. No Python. 50+ preset voices.
- **F5-TTS** (`src/backends/f5python.ts`): Apple Silicon MLX model via python-build-standalone. Supports voice cloning. Auto-downloads Python runtime on first use.
- **Custom** (`src/backends/custom.ts`): Bring-your-own HTTP TTS server (`POST /synthesize`).

### Setup Flow (`src/setup.ts`)
First install shows walkthrough, then quick-pick to choose backend + voice. Re-triggerable via `Eloquent: Choose TTS Backend` command. Backend choice persisted in `eloquent.backend` setting.

### Streaming Design
Text from `synthesize()` calls accumulates in a `ChunkedSynthesizer`. Text is split at sentence boundaries (`.!?;:\n`), first chunk capped at 60 chars for low latency, subsequent chunks up to 135 chars. Producer-consumer pattern with configurable prefetch buffer (default 2 chunks ahead). Audio plays as soon as each chunk is ready. `AbortSignal` cancels both generation and playback mid-stream.

### Text Preprocessing (`src/textPreprocessor.ts`)
`preprocessForSpeech()` converts Markdown to speech-friendly plain text: code blocks, links, headings, formatting, tables, HTML entities, and bare URLs are all transformed to natural language.

### Auto-Installation (`src/installer.ts`)
- Kokoro: `npm install --no-save kokoro-js` if not present
- F5-Python: Downloads python-build-standalone, creates venv, pip-installs `f5-tts-mlx`

Key files: [BRIEFING.md](../BRIEFING.md) has full architecture details.

## Build and Test

```bash
npm install          # Node dependencies
npm run build        # esbuild bundle → out/extension.js
npm test             # vitest (~160 tests)
npm run typecheck    # tsc --noEmit
npm run watch        # rebuild on save
npm run fetch-types  # update proposed API types (npx @vscode/dts dev)
```

Debug: F5 in VS Code Insiders launches Extension Development Host.

## Conventions

- **Naming**: Extension is "Eloquent", settings prefix is `eloquent.*`, commands are `eloquent.*`
- **Bundler**: esbuild — `kokoro-js` and `onnxruntime-node` are marked external (native modules)
- **Proposed API**: Extension uses `vscode.proposed.speech.d.ts` — requires Insiders and `enabledApiProposals: ["speech"]`
- **No Python dependency for end users**: Kokoro backend is pure Node.js. F5-Python backend auto-downloads standalone Python.
- **Zero runtime deps in package.json**: `kokoro-js` and `onnxruntime-node` are installed at runtime by `installer.ts`, not listed as dependencies
- **TTS output instructions**: See `.github/instructions/tts-voice-output.instructions.md` for rules that make Copilot output sound natural when spoken aloud
- **Platform playback**: `afplay` (macOS), `aplay` (Linux), PowerShell (Windows) — see `src/player.ts`
- **Commit discipline**: Small, focused commits; always update tests in the same commit. See CLAUDE.md for the test-then-commit cycle.

## Key Constraints

- VS Code Insiders only (proposed speech API) — cannot be published to Marketplace
- Distribute as `.vsix` file (build with `npm run package`)
- Model weights downloaded on first activation (~80 MB for Kokoro q8, ~400 MB for F5-TTS 8-bit)
- Voice cloning only available with F5-TTS backend (preset voices for Kokoro)

## Known Issues

- No known issues at this time.
