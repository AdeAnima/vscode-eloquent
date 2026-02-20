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
5. **Backend synthesis**: Each pre-chunked segment sent to `TtsBackend.synthesize()`, which returns `AsyncIterable<AudioChunk>` (Float32Array PCM @ 24 kHz mono). Backends do **not** chunk internally — chunking is owned by the caller (`ChunkedSynthesizer` for streaming, `chunkText()` for read-aloud).
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
| **Kokoro** | In-process Node.js | Dynamic `import("kokoro-js")` → `KokoroTTS.from_pretrained()` | `tts.generate(text)` per pre-chunked segment | `kokoro-js` + `onnxruntime-node` (installed at runtime by `installer.ts`) |
| **F5-Python** | Subprocess | `ensurePythonEnvironment()` downloads python-build-standalone + pip installs `f5-tts-mlx` → spawns `tts_server.py` | HTTP POST `/synthesize` per pre-chunked segment → parse WAV response | python-build-standalone (auto-downloaded) |
| **Custom** | External server | Health check GET `/health` | HTTP POST `/synthesize` with JSON `{ text }` per pre-chunked segment → parse WAV response | User-provided HTTP server |

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
│   ├── extension.ts          # Entry point: activation, config change handler, first-run flow (thin wiring layer)
│   ├── speechProvider.ts     # EloquentProvider + StreamingTextToSpeechSession
│   ├── chunker.ts            # chunkText() + ChunkedSynthesizer (prefetch buffer)
│   ├── commands.ts           # All command handlers (7 commands) + ExtensionServices interface
│   ├── statusBar.ts          # StatusBarManager: main toggle bar + pause bar
│   ├── textPreprocessor.ts   # Markdown → speech-friendly plain text
│   ├── player.ts             # AudioPlayer: WAV encoding, platform playback, pause/resume
│   ├── setup.ts              # Backend picker, voice picker, createBackend() factory
│   ├── installer.ts          # Auto-install kokoro-js (npm) or python-build-standalone + f5-tts-mlx (pip)
│   ├── types.ts              # TtsBackend, AudioChunk, BackendId, BACKENDS
│   ├── wavParser.ts          # Shared WAV parsing utility
│   ├── kokoro-js.d.ts        # Type declarations for kokoro-js npm package
│   └── backends/
│       ├── kokoro.ts         # KokoroBackend: in-process ONNX inference
│       ├── f5python.ts       # F5PythonBackend: subprocess + HTTP to tts_server.py
│       └── custom.ts         # CustomBackend: external HTTP TTS server
├── server/
│   ├── tts_server.py         # Python HTTP server wrapping f5-tts-mlx
│   └── requirements.txt      # f5-tts-mlx>=0.2.6
├── test/
│   ├── textPreprocessor.test.ts   # 34 tests: all markdown transformations
│   ├── chunker.test.ts            # 12 tests: sentence splitting, chunk sizing
│   ├── chunkedSynthesizer.test.ts # 6 tests: streaming, abort, prefetch
│   ├── speechProvider.test.ts     # 15 tests: provider lifecycle, sessions
│   ├── sessionIntegration.test.ts # 8 tests: full session lifecycle integration
│   ├── player.test.ts             # 16 tests: WAV encoding, playback, speed args
│   ├── kokoroBackend.test.ts      # 8 tests: Kokoro backend
│   ├── customBackend.test.ts      # 7 tests: Custom HTTP backend
│   ├── wavParser.test.ts          # 8 tests: WAV parsing
│   ├── f5PythonBackend.test.ts    # 5 tests: F5-Python backend
│   ├── f5PythonIntegration.test.ts # 6 tests: F5-Python HTTP integration
│   ├── installer.test.ts          # 7 tests: npm install, Python setup
│   ├── extensionIntegration.test.ts # 10 tests: activate(), commands
│   ├── statusBar.test.ts          # 9 tests: status bar state transitions
│   ├── setup.test.ts              # 9 tests: setup flow
│   └── __mocks__/vscode.ts        # VS Code mock with EventEmitter, CancellationToken
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
| `eloquent.initialBatchDelay` | number | `150` | Milliseconds to wait before starting synthesis (0–1000). Lower = faster start |
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

210 test cases across 16 test files, using vitest with a VS Code mock (`test/__mocks__/vscode.ts`). Overall coverage: **91.65% stmts, 80.95% branches, 89.2% funcs, 93.17% lines**. Coverage thresholds enforced in `vitest.config.ts` (78/68/76/78).

| File | Cases | What's Tested |
|------|-------|---------------|
| `test/textPreprocessor.test.ts` | 34 | All markdown-to-speech transformations |
| `test/chunker.test.ts` | 12 | `chunkText()`: sentence splitting, chunk sizing, delimiters |
| `test/chunkedSynthesizer.test.ts` | 6 | Streaming, abort, prefetch buffer, error propagation |
| `test/speechProvider.test.ts` | 15 | Provider lifecycle, pause/resume, session creation |
| `test/sessionIntegration.test.ts` | 8 | Full session lifecycle: synthesize → events, cancellation, errors |
| `test/player.test.ts` | 16 | WAV encoding, playback state machine, speed arguments |
| `test/kokoroBackend.test.ts` | 8 | Kokoro backend initialization, synthesis, model loading |
| `test/customBackend.test.ts` | 7 | Custom HTTP backend, WAV parsing, error handling |
| `test/wavParser.test.ts` | 8 | WAV header parsing, validation, edge cases |
| `test/f5PythonBackend.test.ts` | 11 | F5-Python backend: subprocess lifecycle, READY signal, 60s timeout, process error/exit, CLI args |
| `test/f5PythonIntegration.test.ts` | 6 | F5-Python HTTP integration with test server |
| `test/installer.test.ts` | 18 | `runCommand`, `ensureKokoroInstalled`, full `ensurePythonEnvironment` flow (download, extract, venv, pip) |
| `test/extensionIntegration.test.ts` | 17 | Full `activate()`, commands, config change, error handling |
| `test/statusBar.test.ts` | 9 | Status bar updates, visibility, state transitions |
| `test/setup.test.ts` | 9 | Backend picker, voice picker, setup flow |
| `test/commands.test.ts` | 26 | All command handlers, testVoice, setupBackend, toggleTts |

```bash
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
```

---

## 13. Known Issues & Tech Debt

- **Flaky test**: `f5PythonIntegration.test.ts` "synthesize writes and cleans up temp file" occasionally fails with ENOENT due to a timing race between the HTTP response and `fs.readFileSync`. Needs a small retry or `waitForFile` helper.
- **`backends/index.ts` removed**: The barrel export file was removed; backends are imported directly. Coverage report no longer lists it.
- **`sessionIntegration.test.ts` slow**: Tests take ~3.7s due to real 900ms timer delays in session lifecycle tests. Could be faster with fake timers but works reliably.

### Resolved Design Decisions

- **Kokoro TextSplitterStream**: `kokoro-js` provides a built-in `TextSplitterStream` for incremental streaming. After evaluation, the extension keeps its own `chunkText()` + `ChunkedSynthesizer` because: (1) it works with all backends (Kokoro, F5-Python, Custom), not just Kokoro; (2) it provides prefetch buffering with configurable depth; (3) it supports `AbortSignal` cancellation; (4) it gives full control over chunk sizing. The `TextSplitterStream` is Kokoro-specific (`tts.stream(splitter)`) and would only benefit one backend while losing generality.

---

## 14. Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0-beta.1 | 2026-02-20 | Renamed from "F5 Speech" to "Eloquent". All prefixes `f5Speech.*` → `eloquent.*`. Added README, CHANGELOG, LICENSE. |
| 0.1.0-beta.2 | 2026-02-20 | Coverage thresholds, extracted backend config interfaces to types.ts, removed dead backends/index.ts, fixed .vscodeignore. |
| 0.1.0 | 2026-02-20 | Initial implementation: multi-backend TTS (Kokoro, F5-Python, Custom), sentence-level streaming, Markdown preprocessor, cross-platform playback, setup wizard, walkthrough, keybindings. |

---

## 15. Vision & Roadmap

Eloquent starts as a TTS replacement, but the long-term goal is a **voice-first multi-agent workspace**:

- **Multi-session dashboard** — Run multiple agent sessions in parallel with an overview panel
- **Voice-addressed agents** — Say an agent's name to focus their panel and converse
- **Raise-hand protocol** — Agents needing input surface to attention; acknowledged by name
- **Distinct agent voices** — Each agent gets a unique voice preset for auditory identification
- **Conversational control flow** — Natural phrases to delegate, prioritize, pause, or reassign work

### Architecture Improvements Plan

Planned code-health and scalability improvements, mapped to roadmap phases.

#### Phase 1 — Stabilize (current)

| ID | Improvement | Status | Rationale |
|----|------------|--------|----------|
| A1 | **Extract `extension.ts` modules** — Move command handlers to `src/commands.ts`, status bar to `src/statusBar.ts`. Keep extension.ts as thin wiring layer. | ✅ Done | extension.ts reduced from ~330 lines to ~113 lines. Commands in `commands.ts` (272 lines, 92% covered). Status bar in `statusBar.ts` (71 lines, 100% covered). |
| A2 | **Add `onDidChangeConfiguration` handler** — React to setting changes at runtime without requiring reload. | ✅ Done | Handler reacts to `eloquent.enabled` toggle and backend settings (voice, kokoroDtype, serverPort, etc.) that require re-initialization. |
| A3 | **Structured logging via `LogOutputChannel`** — Use `createOutputChannel(name, { log: true })` with `.info()`, `.warn()`, `.error()`. | ✅ Done | All `appendLine()` calls replaced with appropriate log levels. `ExtensionServices.outputChannel` typed as `LogOutputChannel`. |
| A4 | **`installer.ts` test coverage** — Cover `ensurePythonEnvironment()` (34% → target >80%). | ✅ Done | 11 new tests covering full flow: download, extract, venv, pip install, early-return, error propagation, platform gate. 18 total installer tests. 93.61% stmts. |
| A5 | **`f5python.ts` test coverage** — Cover subprocess lifecycle and error paths (57% → target >80%). | ✅ Done | 6 new tests covering startServer lifecycle: READY signal, 60s timeout, process error, exit handler, CLI args with/without optional params. 11 total f5python tests. 95.16% stmts. |

---

##### Remaining Coverage Gaps (by priority)

Coverage report from `npx vitest run --coverage` (2026-02-20, v0.1.0-beta.3+). 255 tests, 16 files. Thresholds: 90% stmts / 85% branches / 90% funcs / 92% lines.

| File | Stmts | Branches | Uncovered Lines | What's Missing |
|------|-------|----------|-----------------|----------------|
| `commands.ts` | 94.49% | 86.11% | 28–34 | `registerCommands()` lambda bodies — thin wrappers that delegate to tested functions. Low value. |
| `extension.ts` | 94.23% | 80.76% | 28, 32 | Minor wiring: output channel creation (28), walkthrough timer scheduling (32). Low value. |
| `chunker.ts` | 91.48% | 85% | 87–88, 121–122, 153 | `waitForChange` immediate return (87–88), prefetch buffer full + abort race (121–122), consumer waiting (153). Require carefully timed async tests. |
| `textPreprocessor.ts` | 100% | 88.88% | 153, 260 | Abbreviation expansion edge cases (table body with no data rows, regex alternation). |
| `setup.ts` | 90.69% | 94.73% | 100–104 | `promptCustomEndpoint()` URL validation branch. |
| `player.ts` | 97.5% | 95.45% | 80–81 | `playFile()` stopped guard — extremely narrow race window, low value. |
| `speechProvider.ts` | 98.73% | 90.9% | 174, 184 | Error handling in `runPlaybackLoop` edge cases. |

**Files now at 100% statements**: `installer.ts`, `statusBar.ts`, `types.ts`, `wavParser.ts`.
**Files now at 100% branches**: `statusBar.ts`, `types.ts`, `wavParser.ts`.

**Recommended next targets** (best ROI):
1. **`extension.ts`** (80.8% branches): Test walkthrough timer and output channel creation.
2. **`chunker.ts`** (85% branches): Carefully timed async tests for consumer waiting and buffer backpressure.
3. **`textPreprocessor.ts`** (88.9% branches): Edge cases in table processing and abbreviation regex.

#### Phase 2 — Multi-Voice & Agent Identity

| ID | Improvement | Rationale |
|----|------------|----------|
| B1 | **Backend config objects** — Replace raw constructor primitives with typed config interfaces (`KokoroConfig`, `F5Config`, `CustomConfig`). | ✅ Done | `KokoroConfig`, `F5Config`, `CustomConfig` in types.ts. All backends and `createBackend()` use config objects. |
| B2 | **Dependency injection for extension state** — Replace module-level `let` variables with a context/service object passed through the call chain. | ✅ Done | `ExtensionServices` interface owns all mutable state. Single module-level `let services` in extension.ts required by VS Code `deactivate()` lifecycle. |

#### Phase 3 — Audio Pipeline & Scaling

| ID | Improvement | Rationale |
|----|------------|----------|
| C1 | **Audio playback modernization** — Replace temp-file + platform-command approach with a Node.js audio library or VS Code audio API (if available). | ⏳ Researched, deferred | Investigated `speaker` (mpg123, 8K DL/wk), `naudiodon` (PortAudio, 4yr stale), `node-wav-player`/`sound-play` (same platform-command approach). Best candidate: `speaker` — direct PCM streaming, no temp files, cross-platform. However: native C++ addon requiring node-gyp compilation + platform-specific prebuilds. Current approach is adequate for single-voice TTS. Recommend deferring to when multi-agent voice support is needed. |
| C2 | **Investigate kokoro-js `TextSplitterStream`** — Evaluate for sub-sentence streaming to reduce time-to-first-audio. | ✅ Done | Investigated. Full TextSplitterStream integration blocked by `preprocessForSpeech()` needing accumulated Markdown context (can't push incremental deltas). Instead: replaced 80ms polling loop in `ChunkedSynthesizer` with event-driven `push()`/`flush()` notifications. Updated `kokoro-js.d.ts` with full `stream()`, `RawAudio`, `TextSplitterStream` types for future use. |

---

## 16. Open Questions / Decisions Needed

1. **True token-level streaming**: Investigated in C2. Full TextSplitterStream integration blocked by Markdown preprocessing needing accumulated context. Event-driven producer notification implemented instead (eliminates 80ms polling). Future option: add a "raw text" mode (no Markdown preprocessing) that pushes tokens directly into TextSplitterStream.
2. **Audio playback modernization**: Researched in C1. `speaker` npm (mpg123 backend) is the best option for direct PCM streaming when multi-agent voices are needed. Deferred due to native addon complexity.
3. **F5-TTS backend maturity**: python-build-standalone download + venv setup is complex and untested on all platforms. Needs end-to-end validation.
4. **Custom backend protocol**: Should we document a formal API spec for the custom backend so third parties can implement compatible servers?
5. **Speed control on Linux**: `aplay` doesn't support playback speed adjustment. Need a different player or audio resampling.

---

## 17. Handover: State & Next Steps (2026-02-20)

### What Was Done

Multi-session testing initiative taking the project from 15.2% to **96.43% statement coverage** (255 tests, 16 files, all green). Key deliverables:

| Deliverable | Commit | Impact |
|-------------|--------|--------|
| Extract extension.ts → commands.ts + statusBar.ts | `37020e3` | extension.ts ~330→113 lines; commands.ts 94% covered, statusBar.ts 100% |
| onDidChangeConfiguration handler | `c621bad` | Runtime setting changes without reload |
| Structured logging (LogOutputChannel) | `c621bad` | `.info()`, `.warn()`, `.error()` with log levels |
| installer.ts test coverage 34%→100% | `1bd0109`+`866e9ec` | 20 tests: full ensurePythonEnvironment flow, Linux/win32 platform branches |
| f5python.ts test coverage 57%→98.38% | `1bd0109` | 11 tests: startServer lifecycle, CLI args, abort |
| Backend config interfaces (KokoroConfig, F5Config, CustomConfig) | `3add491` | Typed config objects in types.ts |
| ExtensionServices dependency injection | Part of A1 | Testable state management, no hidden globals |
| Coverage thresholds in vitest.config.ts | `8da271c` | CI enforces 90/85/90/92 minimums |
| Shared test helpers (fakeBackend, makeContext, collectEvents) | `546fa7f` | DRY test infrastructure, -39 net lines |
| Player.ts branch coverage 63.6%→95.5% | `ad0ad30` | Windows, error handling, process signal tests |
| Session integration test isolation + speedup | `ad0ad30` | MockAudioPlayer, 3.6s→48ms |
| Chunker branch coverage 82.5%→85% | `8da271c` | Backpressure, abort, non-Error throw tests |
| Emoji/special char stripping + abbreviation expansion | `4485ccf` | Cleaner TTS output for markdown symbols |
| CI coverage gate enforcement | `866e9ec` | `npm run test:coverage` in CI — regressions fail PRs |
| Commands.ts assertion hardening + branch gaps | `866e9ec`+ | 12→0 bare assertions, +5 branch tests (86.1% branches) |
| Injectable healthCheckTimeout in CustomBackend | `866e9ec` | Test suite 5.2s→0.4s for custom backend |
| StatusBar.ts assertion hardening | current | 10→0 bare assertions, constructor mock hygiene |
| Preprocessor integration tests | current | 3 end-to-end tests: markdown→speech pipeline |

### What's Working

- **All 255 tests pass** — `npm test` green, `npm run build` clean, `npm run typecheck` clean
- **CI pipeline**: GitHub Actions runs tests **with coverage enforcement** on Node 20+22, typecheck on Node 22
- **Release pipeline**: `v*` tags trigger test → build → vsce package → GitHub Release
- **All Phase 1 (A1–A5) and Phase 2 (B1–B2) improvements complete**
- **Coverage well above thresholds**: 96.43% stmts (90%), 89.47% branches (85%), 93.79% funcs (90%), 97.75% lines (92%)
- **6 files at 100% statements**: installer.ts, statusBar.ts, types.ts, wavParser.ts, textPreprocessor.ts, custom.ts
- **Zero bare `.toHaveBeenCalled()` assertions** in commands.test.ts and statusBar.test.ts (down from 22 total)
- **Suite runtime**: ~640ms (from ~5.5s before injectable timeouts)

### Test Suite Review Status

The `test-suite-review-v2-2026-02-20-k9m4t1.md` document identified 7 gaps. Current status:

| # | Gap | Priority | Status |
|---|-----|----------|--------|
| 1 | CI coverage gate | P0 | **Done** — `npm run test:coverage` in ci.yml |
| 2 | Assertion hardening | P0 | **Done** — commands (12→0) + statusBar (10→0) bare assertions |
| 3 | Timeout test speedup | P1 | **Done** — injectable healthCheckTimeout, suite 5.2s→0.4s |
| 4 | Branch gap closure | P1 | **Done** — commands 77.8→86.1%, installer 79.2→91.7%, all files ≥80% branches |
| 5 | Mock fidelity | P1 | Open — lower priority, no user-facing impact |
| 6 | E2E smoke tests | P2 | Open — `@vscode/test-electron` introduction |
| 7 | Mutation testing | P2 | Open — Stryker pilot on critical modules |

### Recommended Next Steps (priority order)

#### 1. E2E Smoke Tests with @vscode/test-electron

All unit/integration testing is done to a high standard. The next quality frontier is real Extension Host validation:
- Activation in VS Code Insiders
- Command registration and execution
- Status bar visibility
- Walkthrough open behavior

This requires `@vscode/test-electron` pointed at Insiders and is the main gap between current tests and production confidence.

#### 2. Mutation Testing Pilot

With 89.5% branch coverage, mutation testing (Stryker) would reveal assertions that pass despite behavior changes. Recommended scope: `chunker.ts`, `commands.ts`, `speechProvider.ts` — the three modules where permissive assertions are most likely to mask regressions.

#### 3. Feature Work: Multi-Agent Voice

The roadmap vision (Section 15) describes voice-addressed agents with distinct voices. Prerequisites:
- **Audio queue manager**: Multiple TTS sessions playing concurrently or sequentially
- **Voice assignment**: Map agent names to voice presets
- **Session multiplexing**: Multiple `StreamingTextToSpeechSession` instances with independent state
