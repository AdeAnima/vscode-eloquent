# Eloquent — High-Quality TTS for VS Code

Replaces the built-in text-to-speech with natural-sounding voices powered by local AI models. Works with Copilot Chat, read-aloud, and any VS Code speech consumer.

> **Beta.** Requires [VS Code Insiders](https://code.visualstudio.com/insiders/) — uses the proposed `speech` API.

## Features

- **Natural voices** — Kokoro 82M ONNX model with 28 voice presets
- **Voice cloning** — F5-TTS backend clones any voice from a 10-second sample (Apple Silicon)
- **Streaming playback** — Sentence-level chunking with prefetch buffering for low-latency audio
- **Privacy-first** — All inference runs locally, no cloud APIs
- **Bring your own backend** — Point at any HTTP TTS server

## Backends

| Backend | Best for | Size | Python? |
|---------|----------|------|---------|
| **Kokoro** ⭐ | Fast, high-quality, cross-platform | ~80 MB | No |
| **F5-TTS** | Voice cloning on Apple Silicon | ~1.5 GB | Auto-installed |
| **Custom** | Your own HTTP TTS server | — | — |

## Quick Start

1. Install the `.vsix` in VS Code Insiders
2. Enable the proposed API — add to `~/.vscode-insiders/argv.json`:
   ```json
   { "enable-proposed-api": ["adeanima.vscode-eloquent"] }
   ```
3. Restart VS Code Insiders — the setup wizard will guide you through backend and voice selection

## Commands

| Command | Description |
|---------|-------------|
| `Eloquent: Choose TTS Backend` | Setup wizard — pick backend and voice |
| `Eloquent: Toggle TTS On/Off` | Enable or disable speech output |
| `Eloquent: Pause / Resume` | Pause or resume current playback |
| `Eloquent: Read Selection Aloud` | Speak the selected text (or full file) |
| `Eloquent: Change Voice` | Switch Kokoro voice preset |

## Keyboard Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Toggle TTS | `Cmd+Alt+T` | `Ctrl+Alt+T` |
| Pause/Resume | `Cmd+Alt+P` | `Ctrl+Alt+P` |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `eloquent.backend` | — | `kokoro`, `f5-python`, or `custom` |
| `eloquent.voice` | `af_heart` | Voice preset (Kokoro) |
| `eloquent.speed` | `1.0` | Playback speed (0.5×–2.0×) |
| `eloquent.kokoroDtype` | `q8` | Model quantization: `fp32`, `fp16`, `q8`, `q4` |
| `eloquent.prefetchBufferSize` | `2` | Chunks to synthesize ahead of playback |
| `eloquent.customEndpoint` | — | Base URL for custom TTS server |
| `eloquent.serverPort` | `18230` | F5-TTS Python server port |
| `eloquent.refAudioPath` | — | Reference audio for voice cloning (mono 24 kHz WAV) |
| `eloquent.refText` | — | Transcript of the reference audio |
| `eloquent.quantization` | `8` | F5-TTS model quantization (`none`, `4`, `8`) |

## Requirements

- **VS Code Insiders** (proposed speech API)
- **Node.js 20+** (Kokoro backend)
- **Apple Silicon Mac** (F5-TTS backend only)

## Vision & Roadmap

Eloquent starts as a TTS replacement, but the long-term goal is a **voice-first multi-agent workspace**:

- **Multi-session dashboard** — Run multiple agent sessions in parallel with an overview panel showing who's working on what and their current progress
- **Voice-addressed agents** — Say an agent's name to focus their panel and start a spoken conversation ("Hey, Reviewer — what did you find?")
- **Raise-hand protocol** — Agents that need input surface to attention; you acknowledge by name, the panel enlarges with a spoken summary of what they need, and shrinks back when the consultation ends ("Ok, thanks — carry on")
- **Distinct agent voices** — Each agent gets a unique voice preset so you can identify who's speaking without looking at the screen
- **Conversational control flow** — Natural phrases to delegate, prioritize, pause, or reassign work across agents

> The extension will likely be renamed to reflect this broader scope once the conversational multi-agent features land.

## Development

```bash
npm install
npm run build      # esbuild → out/extension.js
npm run watch      # rebuild on save
npm test           # vitest
npm run typecheck  # tsc --noEmit
```

## License

MIT
