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
│   ├── extension.ts          # Entry point: activation, 7 commands, status bar, walkthrough trigger
│   ├── speechProvider.ts     # EloquentProvider + StreamingTextToSpeechSession
│   ├── chunker.ts            # chunkText() + ChunkedSynthesizer (prefetch buffer)
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

193 test cases across 16 test files, using vitest with a VS Code mock (`test/__mocks__/vscode.ts`).

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
| `test/f5PythonBackend.test.ts` | 5 | F5-Python backend, subprocess management |
| `test/f5PythonIntegration.test.ts` | 6 | F5-Python HTTP integration with test server |
| `test/installer.test.ts` | 7 | `runCommand`, `ensureKokoroInstalled`, npm detection |
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

### Resolved Design Decisions

- **Kokoro TextSplitterStream**: `kokoro-js` provides a built-in `TextSplitterStream` for incremental streaming. After evaluation, the extension keeps its own `chunkText()` + `ChunkedSynthesizer` because: (1) it works with all backends (Kokoro, F5-Python, Custom), not just Kokoro; (2) it provides prefetch buffering with configurable depth; (3) it supports `AbortSignal` cancellation; (4) it gives full control over chunk sizing. The `TextSplitterStream` is Kokoro-specific (`tts.stream(splitter)`) and would only benefit one backend while losing generality.

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

### Architecture Improvements Plan

Planned code-health and scalability improvements, mapped to roadmap phases.

#### Phase 1 — Stabilize (current)

| ID | Improvement | Status | Rationale |
|----|------------|--------|----------|
| A1 | **Extract `extension.ts` modules** — Move command handlers to `src/commands.ts`, status bar to `src/statusBar.ts`. Keep extension.ts as thin wiring layer. | ✅ Done | extension.ts reduced from ~330 lines to ~113 lines. Commands in `commands.ts` (272 lines, 92% covered). Status bar in `statusBar.ts` (71 lines, 100% covered). |
| A2 | **Add `onDidChangeConfiguration` handler** — React to setting changes at runtime without requiring reload. | ✅ Done | Handler reacts to `eloquent.enabled` toggle and backend settings (voice, kokoroDtype, serverPort, etc.) that require re-initialization. |
| A3 | **Structured logging via `LogOutputChannel`** — Use `createOutputChannel(name, { log: true })` with `.info()`, `.warn()`, `.error()`. | ✅ Done | All `appendLine()` calls replaced with appropriate log levels. `ExtensionServices.outputChannel` typed as `LogOutputChannel`. |
| A4 | **`installer.ts` test coverage** — Cover `ensurePythonEnvironment()` (34% → target >80%). | ✅ Done | 11 new tests covering full flow: download, extract, venv, pip install, early-return, error propagation, platform gate. 18 total installer tests. |
| A5 | **`f5python.ts` test coverage** — Cover subprocess lifecycle and error paths (57% → target >80%). | ✅ Done | 6 new tests covering startServer lifecycle: READY signal, 60s timeout, process error, exit handler, CLI args with/without optional params. 11 total f5python tests. |

---

##### A4: `installer.ts` Test Coverage Plan

**Current state**: 34% statements. `runCommand()` and `ensureKokoroInstalled()` are tested. `ensurePythonEnvironment()` (lines 79–170) is completely untested — it downloads a standalone Python runtime, extracts it, creates a venv, and pip-installs `f5-tts-mlx`.

**Goal**: >80% statement coverage without hitting the network.

**Mocking strategy**:
- `child_process.execFile` — already indirectly mocked via `runCommand()` tests. For `ensurePythonEnvironment`, mock at the `fs` + `child_process` level.
- `fs.existsSync` — controls early-return (venv exists) and download-skip (standalone exists) branches.
- `fs.mkdirSync`, `fs.unlinkSync` — verify directory creation and archive cleanup.
- `vscode.window.withProgress` — already in the shared mock; verify `progress.report()` messages.

**Challenge**: `ensurePythonEnvironment` calls `runCommand()` from the same module. Options:
1. **Mock `child_process.execFile` directly** (preferred) — tests the full flow including `runCommand()` internals. Simulate curl, tar, python -m venv, and pip install responses. ✅
2. **Restructure to inject `runCommand`** — cleaner but requires production code changes.

**Test cases** (~8–10 tests in `test/installer.test.ts`):

| # | Test | Covers |
|---|------|--------|
| 1 | Returns early if `venvPython` already exists | Early-return guard (line 92) |
| 2 | Throws on macOS Intel (non-arm64) | Platform gate (lines 94–97) |
| 3 | Downloads Python when standalone missing | curl call with correct URL, archive path (lines 102–112) |
| 4 | Extracts tarball and cleans up archive | tar call + `fs.unlinkSync` (lines 114–123) |
| 5 | Skips download if standalone already exists | `fs.existsSync(standaloneBin)` true branch (line 101) |
| 6 | Creates venv from standalone Python | `python3 -m venv` call (lines 126–127) |
| 7 | Installs f5-tts-mlx via pip with 30min timeout | pip install call + timeout option (lines 130–133) |
| 8 | Returns venv python path on success | Return value check (line 136) |
| 9 | Propagates curl download errors | curl failure → rejection |
| 10 | Propagates pip install errors | pip failure → rejection |
| 11 | Reports correct progress messages | 4 `progress.report()` calls in sequence |

**Mock setup pattern**:
```typescript
// Mock fs for file existence checks
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, existsSync: vi.fn(), mkdirSync: vi.fn(), unlinkSync: vi.fn() };
});

// Mock execFile to simulate curl/tar/python/pip
vi.mock("child_process", () => ({
  execFile: vi.fn().mockImplementation((cmd, args, opts, cb) => {
    cb(null, "ok", ""); // success by default
  }),
}));
```

**Platform-specific URL testing**: Verify `getPythonDownloadUrl()` returns correct URL for darwin/arm64, darwin/x86_64 (should throw), linux/x86_64, linux/arm64. Note: this is a private function — test via `ensurePythonEnvironment()` triggering the download path.

---

##### A5: `f5python.ts` Test Coverage Plan

**Current state**: 57% statements, 59% branches. HTTP synthesis path tested via `f5PythonIntegration.test.ts`. Untested: `startServer()` subprocess lifecycle (lines 70–113), `requestSynthesis()` timeout path (lines 149–150), ref audio/text/quantization CLI args.

**Goal**: >80% statement coverage.

**Architecture**: `F5PythonBackend` has three layers:
1. `ensurePython()` → delegates to `installer.ts` (already mockable)
2. `startServer(pythonPath)` → spawns subprocess, waits for "READY" on stdout
3. `requestSynthesis(text, outputPath)` → HTTP POST to `127.0.0.1:<port>/synthesize`

Layers 1 and 3 are tested. Layer 2 (`startServer`) is the primary gap.

**Mocking strategy for `startServer()`**:
- `child_process.spawn` — return a mock `ChildProcess` with controllable `stdout`, `on('exit')`, `on('error')` events.
- Use `EventEmitter` to simulate stdout data arriving ("READY" signal).
- Use fake timers (`vi.useFakeTimers()`) to test the 60s startup timeout without waiting.

**Test cases** (~8–10 tests, split across `test/f5PythonBackend.test.ts`):

| # | Test | Covers |
|---|------|--------|
| 1 | `initialize()` calls `ensurePython()` then `startServer()` | Full init flow (lines 23–25) |
| 2 | `startServer` resolves when stdout emits "READY" | Happy path (lines 82–86) |
| 3 | `startServer` rejects after 60s timeout | Timeout branch (lines 77–79) |
| 4 | `startServer` rejects on process error | Error event (lines 93–96) |
| 5 | `startServer` sets `ready=false` on process exit | Exit handler (lines 88–91) |
| 6 | `startServer` passes ref audio/text/quantization args | CLI arg construction (lines 71–79) |
| 7 | `requestSynthesis` timeout destroys request | HTTP timeout → `req.destroy()` (lines 149–150) |
| 8 | `synthesize` cleans up temp file on HTTP error | Finally block (line 50) |
| 9 | `dispose` during `startServer` clears timeout | Cleanup during init |

**Mock setup pattern for spawn**:
```typescript
import { EventEmitter } from "events";

function mockChildProcess() {
  const stdout = new EventEmitter();
  const proc = Object.assign(new EventEmitter(), {
    stdout, stderr: new EventEmitter(),
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(), pid: 12345,
  });
  return proc;
}

// In test: emit "READY" to resolve startServer
const proc = mockChildProcess();
vi.mocked(spawn).mockReturnValue(proc as any);
const initPromise = backend.initialize();
proc.stdout.emit("data", Buffer.from("Server listening... READY\n"));
await initPromise; // resolves
```

**Fake timers for timeout test**:
```typescript
vi.useFakeTimers();
const proc = mockChildProcess();
const initPromise = backend.initialize();
vi.advanceTimersByTime(60_000); // trigger timeout
await expect(initPromise).rejects.toThrow("failed to start within 60s");
vi.useRealTimers();
```

**HTTP timeout test**: Use the existing real HTTP server pattern from `f5PythonIntegration.test.ts` but add a server handler that never responds, then verify the 120s timeout fires (with fake timers).

#### Phase 2 — Multi-Voice & Agent Identity

| ID | Improvement | Rationale |
|----|------------|----------|
| B1 | **Backend config objects** — Replace raw constructor primitives with typed config interfaces (`KokoroConfig`, `F5Config`, `CustomConfig`). | Reduces parameter coupling, makes adding new config fields safe and self-documenting. |
| B2 | **Dependency injection for extension state** — Replace module-level `let` variables with a context/service object passed through the call chain. | Enables testability of extension.ts logic, removes hidden global state. Prerequisite for multi-session (each session needs its own state). |

#### Phase 3 — Audio Pipeline & Scaling

| ID | Improvement | Rationale |
|----|------------|----------|
| C1 | **Audio playback modernization** — Replace temp-file + platform-command approach with a Node.js audio library or VS Code audio API (if available). | Current approach won't scale for overlapping multi-agent voices, cannot control volume, and has no queue management. |
| C2 | **Investigate kokoro-js `TextSplitterStream`** — Evaluate for sub-sentence streaming to reduce time-to-first-audio. | Current design waits for full sentences. Sub-sentence streaming could improve perceived latency. |

---

## 16. Open Questions / Decisions Needed

1. **True token-level streaming**: Current design waits for full sentences before synthesizing. Should we investigate `kokoro-js` `TextSplitterStream` for more granular streaming?
2. **Audio playback modernization**: `afplay`/`aplay` works but lacks features (no volume control, no queue management). Consider Node.js audio libraries or VS Code audio APIs if they emerge.
3. **F5-TTS backend maturity**: python-build-standalone download + venv setup is complex and untested on all platforms. Needs end-to-end validation.
4. **Custom backend protocol**: Should we document a formal API spec for the custom backend so third parties can implement compatible servers?
5. **Speed control on Linux**: `aplay` doesn't support playback speed adjustment. Need a different player or audio resampling.
