# Project Briefing: Eloquent (vscode-eloquent)

> Comprehensive context for continuing development of this VS Code extension.
> Covers goals, research findings, architecture decisions, current implementation status, and planned next steps.
> Last updated: 2026-02-20.

---

## 1. Problem Statement

VS Code has a built-in TTS (text-to-speech) capability for Copilot Chat via the `ms-vscode.vscode-speech` extension. The voice quality is extremely poor — robotic and unnatural. There is **no setting** to change the TTS voice or model in the default extension.

**Goal**: Build a custom VS Code extension that replaces the default TTS with high-quality, locally-running, privacy-preserving text-to-speech, with multiple backend options including voice cloning.

---

## 2. Research: TTS Model Selection

Full research is in [RESEARCH-TTS-MODELS-2026.md](RESEARCH-TTS-MODELS-2026.md). Summary:

### Models Evaluated (2026-02)

10 open-source TTS models evaluated for viability in a VS Code extension with zero-Python default:

| Model | Params | JS/Node.js | Quality | Voice Cloning | License |
|-------|--------|-----------|---------|---------------|---------|
| **Kokoro** ⭐ | 82M | ✅ kokoro-js npm | ⭐⭐⭐⭐ | ❌ Preset only | Apache-2.0 |
| **F5-TTS** | 330M | ❌ Python MLX | ⭐⭐⭐⭐ | ✅ 10s sample | Apache-2.0 |
| Piper | ~15-60M | ✅ sherpa-onnx | ⭐⭐⭐ | ❌ | GPL-3.0 ⚠️ |
| Orpheus | 3B | ❌ Python | ⭐⭐⭐⭐⭐ | ✅ | Apache-2.0 |
| Dia2 | 1-2B | ❌ Python/CUDA | ⭐⭐⭐⭐⭐ | ✅ | Apache-2.0 |
| Sesame CSM | 1B | ❌ Python/CUDA | ⭐⭐⭐⭐⭐ | ⚠️ | Apache-2.0 |
| Others | — | ❌ | — | — | — |

### Architecture Decision: Multi-Backend

**Kokoro** (via `kokoro-js` npm) is the default backend — the only production-viable option for zero-Python Node.js:
- 82M-param ONNX model, ~87 MB (q8) or ~44 MB (q4)
- 50+ preset voices, 8 languages
- Runs on CPU via onnxruntime-node, cross-platform
- Maintained by @xenova (Transformers.js author)

**F5-TTS** (via `f5-tts-mlx`) retained as secondary backend for voice cloning on Apple Silicon:
- 330M-param MLX model, ~398 MB (8-bit quantized)
- Voice cloning from a 10-second reference audio sample
- Auto-downloads standalone Python runtime (python-build-standalone)

**Custom HTTP** backend for bring-your-own TTS server.

---

## 3. VS Code Speech Provider API

### Proposed API (not yet stable)

The extension uses VS Code's **proposed** `speech` API:
- Requires **VS Code Insiders** (not stable VS Code)
- Must declare `"enabledApiProposals": ["speech"]` in `package.json`
- Must add to `~/.vscode-insiders/argv.json`: `{ "enable-proposed-api": ["adeanima.vscode-eloquent"] }`
- Types come from `vscode.proposed.speech.d.ts` (fetched via `npx @vscode/dts dev`)

### Key API Types

```typescript
vscode.speech.registerSpeechProvider(id: string, provider: SpeechProvider): Disposable

interface SpeechProvider {
    provideSpeechToTextSession(token, options?): SpeechToTextSession | undefined;
    provideTextToSpeechSession(token, options?): TextToSpeechSession | undefined;
    provideKeywordRecognitionSession(token): KeywordRecognitionSession | undefined;
}

interface TextToSpeechSession {
    readonly onDidChange: Event<TextToSpeechEvent>;
    synthesize(text: string): void;
}

enum TextToSpeechStatus { Started = 1, Stopped = 2, Error = 3 }
```

**Important**: `synthesize(text)` is called **multiple times** by Copilot Chat as the response streams in. Each call provides a text fragment. The extension accumulates these in the `ChunkedSynthesizer` and synthesizes at sentence boundaries.

---

## 4. Architecture (v0.1.0-beta.1)

### High-Level Design

```
┌──────────────────────────────────────────────────────────┐
│  VS Code Insiders                                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Eloquent Extension (TypeScript, esbuild bundle)   │  │
│  │                                                    │  │
│  │  extension.ts ─► EloquentProvider (speechProvider) │  │
│  │                    │                               │  │
│  │                    ▼                               │  │
│  │  StreamingTextToSpeechSession                      │  │
│  │    push text → ChunkedSynthesizer → AudioPlayer    │  │
│  │    (sentence splitting + prefetch buffer)          │  │
│  │                    │                               │  │
│  │          ┌─────────┼─────────┐                     │  │
│  │          ▼         ▼         ▼                     │  │
│  │       Kokoro    F5-Python   Custom                 │  │
│  │       Backend   Backend     Backend                │  │
│  │       (ONNX)    (MLX)      (HTTP)                  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  Kokoro: in-process Node.js (kokoro-js + onnxruntime)    │
│  F5: subprocess tts_server.py ← HTTP POST /synthesize    │
│  Custom: external HTTP server ← POST /synthesize         │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Text arrives**: Copilot Chat calls `synthesize(text)` on our TTS session, multiple times as tokens stream in
2. **Accumulation**: `ChunkedSynthesizer.push(text)` buffers incoming text
3. **Sentence splitting**: `chunkText()` splits at sentence boundaries (`.!?;:\n`), first chunk capped at 60 chars for low latency, subsequent chunks up to 135 chars
4. **Prefetch buffer**: Producer synthesizes chunks ahead (configurable `prefetchBufferSize`, default 2), consumer yields `AudioChunk`s with backpressure
5. **Backend synthesis**: Each chunk sent to the active `TtsBackend.synthesize()`, which returns `AsyncIterable<AudioChunk>` (Float32Array PCM @ 24 kHz mono)
6. **Playback**: `AudioPlayer` writes each chunk to a temp WAV file, plays via platform command (`afplay -r <speed>` on macOS, `aplay -q` on Linux, PowerShell on Windows)
7. **Cancellation**: `AbortSignal` propagates through the entire pipeline — cancels generation and playback mid-stream

### Backend Abstraction

All backends implement `TtsBackend` (defined in `src/types.ts`):

```typescript
interface TtsBackend {
    readonly name: string;
    initialize(): Promise<void>;
    synthesize(text: string, signal: AbortSignal): AsyncIterable<AudioChunk>;
    dispose(): void;
}

interface AudioChunk {
    audio: Float32Array;  // PCM samples, 24 kHz mono
    sampleRate: number;   // 24000
}
```

### Backend Details

| Backend | Runtime | Model Loading | Synthesis | Dependencies |
|---------|---------|--------------|-----------|--------------|
| **Kokoro** | In-process Node.js | Dynamic `import("kokoro-js")` → `KokoroTTS.from_pretrained()` | `chunkText()` → `tts.generate()` per chunk | `kokoro-js` + `onnxruntime-node` (installed at runtime by `installer.ts`) |
| **F5-Python** | Subprocess | `ensurePythonEnvironment()` downloads python-build-standalone + pip installs `f5-tts-mlx` → spawns `tts_server.py` | `chunkText()` → HTTP POST `/synthesize` per chunk → parse WAV response | python-build-standalone (auto-downloaded) |
| **Custom** | External server | Health check GET `/health` | `chunkText()` → HTTP POST `/synthesize` with JSON `{ text }` → parse WAV response | User-provided HTTP server |

### Session Lifecycle

1. VS Code calls `provideTextToSpeechSession()` on `EloquentProvider`
2. `StreamingTextToSpeechSession` created with an `AbortController`
3. First `synthesize(text)` call: waits 150ms to accumulate initial tokens, then flushes and starts playback loop
4. Subsequent `synthesize(text)` calls: push text into the `ChunkedSynthesizer`
5. Playback loop: drains `ChunkedSynthesizer.stream()` → plays each `AudioChunk` via `AudioPlayer`
6. Session ends: `AbortController.abort()` cancels everything; fires `TextToSpeechStatus.Stopped`

### File Structure

```
vscode-eloquent/
├── package.json              # Extension manifest (7 commands, 13 settings, 1 walkthrough)
├── tsconfig.json             # Target ES2022, module commonjs, strict
├── esbuild.config.mjs        # CJS bundle → out/extension.js; externals: vscode, kokoro-js, onnxruntime-node
├── vitest.config.ts          # test/**/*.test.ts, vscode mock alias
├── vscode.proposed.speech.d.ts  # Proposed speech API types
├── src/
│   ├── extension.ts          # Entry point: activation, 7 commands, status bar, walkthrough trigger
│   ├── speechProvider.ts     # EloquentProvider + StreamingTextToSpeechSession
│   ├── chunker.ts            # chunkText() + ChunkedSynthesizer (prefetch buffer)
│   ├── textPreprocessor.ts   # Markdown → speech-friendly plain text
│   ├── player.ts             # AudioPlayer: WAV encoding, platform playback, pause/resume
│   ├── setup.ts              # Backend picker, voice picker, createBackend() factory
│   ├── installer.ts          # Auto-install kokoro-js (npm) or python-build-standalone + f5-tts-mlx (pip)
│   ├── types.ts              # TtsBackend, AudioChunk, BackendId, BACKENDS
│   ├── kokoro-js.d.ts        # Type declarations for kokoro-js npm package
│   └── backends/
│       ├── kokoro.ts         # KokoroBackend: in-process ONNX inference
│       ├── f5python.ts       # F5PythonBackend: subprocess + HTTP to tts_server.py
│       └── custom.ts         # CustomBackend: external HTTP TTS server
├── server/
│   ├── tts_server.py         # Python HTTP server wrapping f5-tts-mlx
│   └── requirements.txt      # f5-tts-mlx>=0.2.6
├── test/
│   ├── textPreprocessor.test.ts   # ~30 test cases: all markdown transformations
│   ├── chunker.test.ts            # ~11 test cases: sentence splitting, chunk sizing
│   ├── chunkedSynthesizer.test.ts # ~6 test cases: streaming, abort, prefetch
│   └── __mocks__/vscode.ts        # Minimal vscode mock for vitest
├── media/
│   └── walkthrough/          # 4 markdown files for onboarding walkthrough
├── .github/
│   ├── copilot-instructions.md    # AI agent project guidelines
│   ├── instructions/
│   │   └── tts-voice-output.instructions.md  # TTS-friendly output rules for Copilot
│   └── workflows/
│       ├── ci.yml            # Push/PR: test (Node 20+22) + typecheck
│       └── release.yml       # v* tags: test, build, vsce package, GitHub Release
├── .vscode/
│   ├── launch.json           # Extension Dev Host with --enable-proposed-api
│   └── tasks.json            # build (default) + watch tasks
├── BRIEFING.md               # This file
├── CLAUDE.md                 # Claude/Cline agent instructions
├── README.md                 # User-facing documentation
├── CHANGELOG.md              # Version history
└── RESEARCH-TTS-MODELS-2026.md  # Full TTS model research
```

---

## 5. Text Preprocessing Pipeline

`preprocessForSpeech(text)` in `src/textPreprocessor.ts` converts Markdown to speech-friendly plain text. Processing order:

1. Fenced code blocks → short: "Code example: ..." / long (>6 lines): "[lang] code block omitted."
2. Inline code backticks → removed
3. Images → "Image: alt." or removed
4. Links (inline, reference, definitions) → text only
5. Horizontal rules → removed
6. Headings → text with trailing period
7. Bold, italic, strikethrough → formatting stripped
8. Blockquotes (including nested) → stripped
9. Lists (unordered, ordered, task) → markers removed
10. Tables → prose conversion ("Row 1: Column is Value.")
11. HTML tags → stripped
12. HTML entities → expanded (`&amp;` → " and ")
13. Bare URLs → "link"
14. Whitespace normalization

---

## 6. Setup & Onboarding

### First-Launch Flow

1. Extension activates via `onStartupFinished`
2. If `eloquent.backend` is empty (first install): opens walkthrough (`eloquent.welcome`)
3. Walkthrough step 1: `Eloquent: Choose TTS Backend` command → quick-pick with 3 backends (Kokoro recommended)
4. Walkthrough step 2: `Eloquent: Change Voice` command → quick-pick with 28 Kokoro voices across 4 categories
5. Backend choice persisted in `eloquent.backend`, voice in `eloquent.voice`

### Installer (`src/installer.ts`)

- **Kokoro**: Checks for `kokoro-js` in `node_modules`. If missing, runs `npm install --no-save kokoro-js` with progress notification.
- **F5-Python**: Downloads `python-build-standalone` (cpython-3.13.12+20260211 for macOS arm64 or Linux x86_64), creates venv, pip-installs `f5-tts-mlx`. All stored under VS Code's `globalStorageUri`.

---

## 7. Audio Playback

`AudioPlayer` in `src/player.ts`:

- Converts `Float32Array` PCM → 16-bit WAV with RIFF header via `encodeWav()`
- Writes to temp file, plays via platform command, cleans up
- **macOS**: `afplay -r <speed>` (supports `-r` rate multiplier)
- **Linux**: `aplay -q` (no speed control)
- **Windows**: `powershell -c (New-Object Media.SoundPlayer 'file').PlaySync()`
- **Pause**: SIGSTOP on the child process
- **Resume**: SIGCONT on the child process
- **Stop**: SIGCONT then SIGTERM (macOS defers SIGTERM on stopped processes)

---

## 8. Commands & Keybindings

| Command | ID | Keybinding | Description |
|---------|-----|------------|-------------|
| Choose TTS Backend | `eloquent.setup` | — | Setup wizard: pick backend + voice |
| Toggle TTS On/Off | `eloquent.toggle` | `Cmd+Alt+T` / `Ctrl+Alt+T` | Enable or disable speech output |
| Enable TTS | `eloquent.enable` | — | Enable speech output |
| Disable TTS | `eloquent.disable` | — | Disable speech output |
| Pause / Resume | `eloquent.pause` | `Cmd+Alt+P` / `Ctrl+Alt+P` | Pause or resume current playback |
| Read Selection Aloud | `eloquent.readAloud` | — | Speak selected text (or full file) |
| Change Voice | `eloquent.changeVoice` | — | Switch Kokoro voice preset |

---

## 9. Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `eloquent.enabled` | boolean | `true` | Enable or disable Eloquent TTS |
| `eloquent.backend` | string | `""` | `kokoro`, `f5-python`, or `custom`. Empty triggers setup wizard |
| `eloquent.voice` | string | `af_heart` | Kokoro voice preset (28 options) |
| `eloquent.speed` | number | `1.0` | Playback speed multiplier (0.5–2.0) |
| `eloquent.prefetchBufferSize` | number | `2` | Chunks to synthesize ahead of playback (1–10) |
| `eloquent.kokoroDtype` | string | `q8` | Kokoro model quantization: `fp32`, `fp16`, `q8`, `q4` |
| `eloquent.serverPort` | number | `18230` | F5-TTS Python server port |
| `eloquent.refAudioPath` | string | `""` | Reference audio for voice cloning (F5-TTS only) |
| `eloquent.refText` | string | `""` | Transcript of reference audio (F5-TTS only) |
| `eloquent.quantization` | string | `"8"` | F5-TTS model quantization: `none`, `4`, `8` |
| `eloquent.customEndpoint` | string | `""` | Base URL for custom TTS server |

---

## 10. Voice Cloning (F5-TTS Backend Only)

1. Record or provide a clear 5–10 second audio sample of the target voice
2. Convert to the required format:
   ```bash
   ffmpeg -i voice_sample.m4a -ac 1 -ar 24000 -sample_fmt s16 -t 10 ref_audio.wav
   ```
3. Set in VS Code settings:
   - `eloquent.refAudioPath`: absolute path to the WAV file
   - `eloquent.refText`: exact transcript of what's said in the recording
4. Restart the extension (re-run `Eloquent: Choose TTS Backend` or reload window)

---

## 11. CI/CD

### CI (`ci.yml`)
- **Trigger**: Push/PR to `main`
- **Test job**: Ubuntu, matrix Node 20 + 22 → `npm ci` → `npm test` → `npm run build`
- **Typecheck job**: Ubuntu, Node 22 → `npm ci` → `tsc --noEmit`

### Release (`release.yml`)
- **Trigger**: Push `v*` tags
- **Steps**: Test → build → `vsce package --no-dependencies` → GitHub Release via `softprops/action-gh-release@v2`

---

## 12. Tests

47 test cases across 3 test files, using vitest with a VS Code mock (`test/__mocks__/vscode.ts`).

| File | Cases | What's Tested |
|------|-------|---------------|
| `test/textPreprocessor.test.ts` | ~30 | All markdown-to-speech transformations |
| `test/chunker.test.ts` | ~11 | `chunkText()`: sentence splitting, chunk sizing, delimiters |
| `test/chunkedSynthesizer.test.ts` | ~6 | Streaming, abort, prefetch buffer, error propagation |

```bash
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
```

---

## 13. Known Issues & Tech Debt

1. **150ms batching**: `StreamingTextToSpeechSession` waits 150ms after the first `synthesize()` call before flushing. This batches initial tokens but introduces a fixed delay. Could be made configurable or adaptive.
2. **Kokoro TextSplitterStream unused**: `kokoro-js` provides a built-in `TextSplitterStream` for incremental streaming, but the extension uses its own `chunkText()` + `ChunkedSynthesizer` instead. The custom implementation gives more control over chunk sizing and prefetch, but the tradeoff should be revisited.
3. **No integration tests**: Only unit tests exist. No tests for the full session lifecycle, backend initialization, or audio playback.

---

## 14. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0-beta.1 | 2026-02-20 | Renamed from "F5 Speech" to "Eloquent". All prefixes `f5Speech.*` → `eloquent.*`. Added README, CHANGELOG, LICENSE. |
| 0.1.0 | 2026-02-20 | Initial implementation: multi-backend TTS (Kokoro, F5-Python, Custom), sentence-level streaming, Markdown preprocessor, cross-platform playback, setup wizard, walkthrough, keybindings. |

---

## 15. Vision & Roadmap

Eloquent starts as a TTS replacement, but the long-term goal is a **voice-first multi-agent workspace**:

- **Multi-session dashboard** — Run multiple agent sessions in parallel with an overview panel
- **Voice-addressed agents** — Say an agent's name to focus their panel and converse
- **Raise-hand protocol** — Agents needing input surface to attention; acknowledged by name
- **Distinct agent voices** — Each agent gets a unique voice preset for auditory identification
- **Conversational control flow** — Natural phrases to delegate, prioritize, pause, or reassign work

---

## 16. Open Questions / Decisions Needed

1. **True token-level streaming**: Current design waits for full sentences before synthesizing. Should we investigate `kokoro-js` `TextSplitterStream` for more granular streaming?
2. **Audio playback modernization**: `afplay`/`aplay` works but lacks features (no volume control, no queue management). Consider Node.js audio libraries or VS Code audio APIs if they emerge.
3. **F5-TTS backend maturity**: python-build-standalone download + venv setup is complex and untested on all platforms. Needs end-to-end validation.
4. **Custom backend protocol**: Should we document a formal API spec for the custom backend so third parties can implement compatible servers?
5. **Speed control on Linux**: `aplay` doesn't support playback speed adjustment. Need a different player or audio resampling.
