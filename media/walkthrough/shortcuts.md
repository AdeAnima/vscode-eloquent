# Keyboard Shortcuts & Tips

### Shortcuts

| Action | Mac | Windows/Linux |
|--------|-----|---------------|
| Toggle TTS on/off | `Cmd+Alt+T` | `Ctrl+Alt+T` |
| Pause / Resume | `Cmd+Alt+P` | `Ctrl+Alt+P` |

### Narration Mode

By default, Eloquent reads the entire Copilot response aloud. Enable **Narration Mode** to have the LLM produce concise spoken summaries instead — only `<speak>` tagged sections are read aloud, while code and details stay silent in the chat.

[Toggle Narration Mode](command:eloquent.toggleNarrationMode)

### Status Bar

Look for the **EQ** indicator in the bottom-right status bar:

- `$(unmute) EQ` — TTS is active
- `$(mute) EQ` — TTS is disabled
- `$(debug-pause) Pause` — Pause current playback

Click the EQ icon to quickly toggle TTS on or off.

### Speed Control

Adjust playback speed in Settings → `eloquent.speed` (range: 0.5× to 2.0×).
