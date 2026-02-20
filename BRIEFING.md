# Project Briefing: vscode-f5-speech

> Comprehensive context for continuing development of this VS Code extension.
> Covers goals, research findings, architecture decisions, current implementation status, and planned next steps.

---

## 1. Problem Statement

VS Code has a built-in TTS (text-to-speech) capability for Copilot Chat via the `ms-vscode.vscode-speech` extension. The voice quality is extremely poor — robotic and unnatural. There is **no setting** to change the TTS voice or model in the default extension.

**Goal**: Build a custom VS Code extension that replaces the default TTS with high-quality, locally-running, privacy-preserving text-to-speech, including voice cloning capability.

---

## 2. Research: TTS Model Selection

### Models Evaluated (2026-02)

| Model | Origin | Stars | Key Feature | Issue for Us |
|-------|--------|-------|-------------|--------------|
| **FishAudio S1-mini** | Chinese (FishAudio) | 24.9k | #1 on TTS-Arena2, near-human | Cloud API only, no local MLX |
| **F5-TTS** | Chinese (SWivid) | 14.1k | Has MLX port, Apple Silicon native | MLX port lacks streaming |
| **Spark-TTS** | Chinese (Mobvoi) | 10.9k | 0.5B params, small | PyTorch only, no MLX |
| **CosyVoice 2** | Alibaba | — | Good quality | PyTorch only |
| **Dia** | Nari Labs | — | Dialogue/emotion | Too specialized |

### Decision: F5-TTS via MLX

**F5-TTS-MLX** (`lucasnewman/f5-tts-mlx`) was chosen because:
- Native **Apple Silicon** support via MLX framework (no CUDA needed)
- **Voice cloning** with just a 10s reference audio sample
- Good quality (based on the well-regarded F5-TTS architecture)
- Simple Python API: `pip install f5-tts-mlx`
- Active maintenance

### Model Sizes (from HuggingFace `lucasnewman/f5-tts-mlx`)

| File | Size |
|------|------|
| `model_v1.safetensors` (full) | 1.35 GB |
| `model_v1_8b.safetensors` (8-bit quantized) | 398 MB |
| `model_v1_4b.safetensors` (4-bit quantized) | 232 MB |
| `duration_v2.safetensors` | 86 MB |
| Total repo | ~4.04 GB (all variants) |

### Performance Characteristics
- **Cold start**: ~10-20s (model loading + first inference)
- **Warm inference**: Near real-time for short text (~1-3s for a sentence)
- **Output format**: 24kHz WAV audio
- **Inference steps**: 32 NFE (number of function evaluations)
- **Max per-chunk**: ~30s of audio (upstream limit)

---

## 3. VS Code Speech Provider API

### Proposed API (not yet stable)

The extension uses VS Code's **proposed** `speech` API, which means:
- Requires **VS Code Insiders** (not stable VS Code)
- Must declare `"enabledApiProposals": ["speech"]` in `package.json`
- Must add to `~/.vscode-insiders/argv.json`: `{ "enable-proposed-api": ["adeanima.vscode-f5-speech"] }`
- Types come from `vscode.proposed.speech.d.ts` (fetched via `npx @vscode/dts dev`)

### Key API Types

```typescript
// Register as a speech provider
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

interface TextToSpeechEvent {
    readonly status: TextToSpeechStatus;
    readonly text?: string;
}

enum TextToSpeechStatus {
    Started = 1,
    Stopped = 2,
    Error = 3
}
```

**Important**: `synthesize(text)` is called **multiple times** by Copilot Chat as the response streams in. Each call provides a chunk of text. The extension should queue and process them sequentially.

---

## 4. Current Architecture (v0.1.0)

```
┌─────────────────────────────────────────┐
│           VS Code Insiders              │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │  F5 Speech Extension (TypeScript)  │ │
│  │  - Registers as SpeechProvider     │ │
│  │  - Manages Python server lifecycle │ │
│  │  - Plays audio via afplay          │ │
│  └──────────┬─────────────────────────┘ │
│             │ HTTP POST /synthesize      │
│  ┌──────────▼─────────────────────────┐ │
│  │  tts_server.py (Python)            │ │
│  │  - Wraps f5-tts-mlx                │ │
│  │  - Keeps model warm in memory      │ │
│  │  - Writes WAV to temp files        │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### How It Works Now
1. Extension activates on startup, spawns `tts_server.py` as child process
2. Python server loads F5-TTS model, warms up, prints `READY` to stdout
3. Extension watches stdout for `READY` signal
4. When Copilot Chat generates text, VS Code calls `synthesize(text)` on our TTS session
5. Session queues text, sends HTTP POST to `http://127.0.0.1:18230/synthesize`
6. Python server generates full WAV file, writes to temp dir
7. Extension plays WAV via `afplay` (macOS) / `aplay` (Linux) / `powershell` (Windows)
8. Cancellation: killing the `afplay` process stops playback

### File Structure
```
vscode-f5-speech/
├── package.json              # Extension manifest, proposed API declaration
├── tsconfig.json             # TypeScript config
├── esbuild.config.mjs        # Bundler config (esbuild, not webpack)
├── vscode.proposed.speech.d.ts  # Proposed API types
├── src/
│   ├── extension.ts          # Entry point, activation, command registration
│   ├── speechProvider.ts     # SpeechProvider + TextToSpeechSession implementation
│   └── server.ts             # TtsServerManager: process lifecycle, HTTP, playback
├── server/
│   └── tts_server.py         # Python HTTP server wrapping f5-tts-mlx
├── out/                      # Build output (esbuild bundle)
├── .vscode/
│   ├── launch.json           # Extension Host debug config
│   └── tasks.json            # Build/watch tasks
├── PROJECT.md                # User-facing project documentation
└── BRIEFING.md               # This file
```

---

## 5. Limitations of Current Implementation

### 5.1 No Streaming
The current architecture is **synchronize-then-play**: the entire text is sent to the server, the server generates the complete audio file, and only then does playback begin. For long Copilot responses this means significant delay before the user hears anything.

### 5.2 No Push-to-Talk
There's no keybinding to toggle TTS on/off. The user can only use the built-in VS Code voice controls or the "Read Selection Aloud" command.

### 5.3 MLX Port Has No Streaming
The upstream PyTorch F5-TTS has streaming support (`infer_batch_process(..., streaming=True)`), but the MLX port (`f5-tts-mlx`) does **not** implement streaming. The `generate()` function is all-or-nothing.

### 5.4 Not Yet Tested End-to-End
- `f5-tts-mlx` has not been installed yet in the Python environment
- Extension has not been launched in VS Code Insiders yet
- The proposed `speech` API types file was reformatted after download and may need verification

---

## 6. Planned Next Steps (Priority Order)

### 6.1 Streaming Architecture (Highest Priority)

**Problem**: User wants incremental audio output as text arrives, not wait for full synthesis.

**Proposed solution**: Replace HTTP with WebSocket for server communication.

**Design**:
```
Extension                          Python Server
   │                                    │
   │──── WS connect ──────────────────►│
   │                                    │
   │──── { text: "chunk 1" } ────────►│
   │                                    │ (splits into sentences)
   │◄─── { audio: <wav_bytes> } ──────│ (sentence 1 audio)
   │◄─── { audio: <wav_bytes> } ──────│ (sentence 2 audio)
   │                                    │
   │──── { text: "chunk 2" } ────────►│
   │◄─── { audio: <wav_bytes> } ──────│
   │                                    │
   │──── { cancel: true } ───────────►│ (stop mid-generation)
   │◄─── { status: "cancelled" } ─────│
   │                                    │
```

**Key insight from upstream F5-TTS**:
- `chunk_text(text, max_chars=135)` splits text into synthesis-friendly chunks
- `TTSStreamingProcessor` in `socket_server.py` shows a reference implementation
- First chunk uses fewer characters (`few_chars`, `min_chars`) for lower latency
- Audio chunks are cross-faded for seamless transitions

**Implementation approach**:
1. Python server: Add WebSocket endpoint (e.g., using `websockets` library)
2. Sentence-level chunking: Split incoming text at sentence boundaries, generate each sentence's audio separately
3. Extension client: Connect via WebSocket on session start, send text chunks, receive and play audio chunks in sequence
4. Cancellation: Close the WebSocket to signal stop; server aborts current generation

**Python library option**: `websockets` (pip install websockets) — minimal, async, well-maintained.

**Important**: Since `f5-tts-mlx` `generate()` doesn't support streaming internally, the "streaming" here is at the **sentence/chunk level** — split text into sentences, generate each one fully, and play each one as it completes. This gives incremental audio without needing internal model streaming.

### 6.2 Push-to-Talk
- Add a keyboard shortcut (e.g., `Ctrl+Alt+T`) to toggle TTS
- Should work as: hold key → speech is active, release → stop
- Or toggle mode: press once to start, press again to stop
- This is a UX feature on top of the streaming architecture

### 6.3 End-to-End Testing
1. Install `f5-tts-mlx`: `pip install f5-tts-mlx`
2. Run the extension in VS Code Insiders debug mode (F5)
3. Open Copilot Chat, enable voice output
4. Verify: server starts, model loads, audio plays when Copilot responds
5. Test cancellation (stop mid-response)
6. Test voice cloning with a reference audio file

### 6.4 Audio Playback Improvements
- Consider using VS Code's built-in audio capabilities instead of spawning `afplay`
- Or use Node.js audio libraries for more control (e.g., `speaker` npm package)
- Current `afplay` approach works but is macOS-only for natural playback

---

## 7. Key Technical References

### F5-TTS Upstream (PyTorch)
- **Repo**: https://github.com/SWivid/F5-TTS
- **Socket streaming server**: `src/f5_tts/infer/socket_server.py` — reference for `TTSStreamingProcessor`
- **Chunk text utility**: `src/f5_tts/infer/utils_infer.py` → `chunk_text(text, max_chars=135)`
- **Batch inference**: `infer_batch_process()` supports `streaming=True`, `chunk_size=2048` (audio samples)
- **Audio**: 24kHz sample rate, cross-fade between chunks

### F5-TTS-MLX (Apple Silicon)
- **Repo**: https://github.com/lucasnewman/f5-tts-mlx
- **HuggingFace weights**: https://huggingface.co/lucasnewman/f5-tts-mlx
- **API**: `from f5_tts_mlx.generate import generate; generate(text=..., output_path=...)`
- **Voice cloning**: Pass `ref_audio_path` and `ref_text` to `generate()`
- **Limitation**: No streaming support — generates full audio in one call

### VS Code Proposed Speech API
- **Source**: https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.speech.d.ts
- **Fetch types**: `npx @vscode/dts dev` (downloads to project root)
- **Activation**: Requires Insiders + `enabledApiProposals` + `argv.json` entry

---

## 8. Development Commands

```bash
# Navigate to project
cd ~/Code/vscode-extensions/vscode-f5-speech

# Install Node dependencies
npm install

# Build extension
npm run build

# Watch mode (rebuild on save)
npm run watch

# Fetch latest proposed API types
npm run fetch-types

# Install Python TTS engine
pip install f5-tts-mlx

# Debug: launch Extension Development Host from VS Code (F5)
# Requires .vscode/launch.json (already configured)
```

---

## 9. Configuration Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `f5Speech.pythonPath` | string | `python3` | Python interpreter with f5-tts-mlx |
| `f5Speech.serverPort` | number | `18230` | Local server port |
| `f5Speech.refAudioPath` | string | `""` | Reference audio for voice cloning (mono 24kHz WAV, 5-10s) |
| `f5Speech.refText` | string | `""` | Transcript of the reference audio |
| `f5Speech.quantization` | enum | `none` | `none`, `4`, or `8` bit quantization |
| `f5Speech.autoStart` | boolean | `true` | Start TTS server on VS Code launch |

---

## 10. Voice Cloning Setup

1. Record or provide a clear 5-10 second audio sample of the target voice
2. Convert to the required format:
   ```bash
   ffmpeg -i voice_sample.m4a -ac 1 -ar 24000 -sample_fmt s16 -t 10 ref_audio.wav
   ```
3. Set in VS Code settings:
   - `f5Speech.refAudioPath`: absolute path to the WAV file
   - `f5Speech.refText`: exact transcript of what's said in the recording
4. Restart the TTS server (it will reload with the new reference)

---

## 11. Version History

| Version | Date | Commit | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-02-20 | `ae7f856` | Initial implementation: HTTP-based architecture, full synthesis per request |

---

## 12. Open Questions / Decisions Needed

1. **Python env management**: Should the extension create a venv automatically, or expect the user to have `f5-tts-mlx` pre-installed?
2. **Quantization default**: Should we default to 8-bit quantization (398MB, faster load) instead of full model (1.35GB)?
3. **WebSocket library**: Use `websockets` (Python) or something else for the streaming server?
4. **Audio playback**: Keep `afplay` or switch to a cross-platform Node.js solution?
5. **Push-to-talk UX**: Hold-to-speak or toggle mode?
