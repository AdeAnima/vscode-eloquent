# F5 Speech — VS Code Extension

> High-quality text-to-speech for Copilot Chat using F5-TTS-MLX

## Project Info

| Key | Value |
|-----|-------|
| Version | 0.1.0 |
| Location | `~/Code/vscode-extensions/vscode-f5-speech/` |
| Symlink | `projects/vscode-f5-speech` |
| License | MIT |
| Engine | F5-TTS-MLX (Apple Silicon native) |

## Architecture

```
┌──────────────────────────────────────────┐
│           VS Code Insiders               │
│                                          │
│  ┌─────────────────────────────────────┐ │
│  │  F5 Speech Extension (TypeScript)   │ │
│  │  - Registers as SpeechProvider      │ │
│  │  - Manages Python server lifecycle  │ │
│  │  - Plays audio via afplay           │ │
│  └───────────┬─────────────────────────┘ │
│              │ HTTP POST /synthesize      │
│  ┌───────────▼─────────────────────────┐ │
│  │  tts_server.py (Python)             │ │
│  │  - Wraps f5-tts-mlx                 │ │
│  │  - Keeps model warm in memory       │ │
│  │  - Writes WAV to temp files         │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

## Prerequisites

1. **VS Code Insiders** (proposed API required)
2. **Python 3.11+** with `f5-tts-mlx` installed:
   ```bash
   pip install f5-tts-mlx
   ```
3. **Apple Silicon Mac** (MLX requirement)

## Development

```bash
cd ~/Code/vscode-extensions/vscode-f5-speech

# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run watch
```

## Deploy (local testing)

```bash
# Build production
npm run build

# Install in VS Code Insiders
code-insiders --install-extension vscode-f5-speech-0.1.0.vsix

# Or for dev: use F5 in VS Code to launch Extension Development Host
```

## Enable proposed API

Add to `~/.vscode-insiders/argv.json`:
```json
{
    "enable-proposed-api": ["adeanima.vscode-f5-speech"]
}
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `f5Speech.pythonPath` | `python3` | Python with f5-tts-mlx |
| `f5Speech.serverPort` | `18230` | Local server port |
| `f5Speech.refAudioPath` | `""` | Reference audio for voice cloning |
| `f5Speech.refText` | `""` | Transcript of reference audio |
| `f5Speech.quantization` | `none` | `4` or `8` bit quantization |
| `f5Speech.autoStart` | `true` | Start server on launch |

## Voice Cloning

Record a ~10s mono WAV at 24kHz:
```bash
ffmpeg -i voice_sample.m4a -ac 1 -ar 24000 -sample_fmt s16 -t 10 ref_audio.wav
```

Then set in VS Code settings:
```json
{
    "f5Speech.refAudioPath": "/path/to/ref_audio.wav",
    "f5Speech.refText": "The exact transcript of what you said in the recording."
}
```

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0.1.0 | 2026-02-20 | Initial implementation |
