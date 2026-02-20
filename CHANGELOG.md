# Changelog

## 0.1.0-beta.1 — 2026-02-20

### Changed
- Renamed extension from "F5 Speech" to **Eloquent**
- All settings prefix changed from `f5Speech.*` to `eloquent.*`
- All command IDs changed from `f5Speech.*` to `eloquent.*`
- Updated description to reflect multi-backend architecture
- Added `preview: true` flag for beta distribution
- Added `repository`, `keywords` fields to package.json

### Added
- README with quick-start guide and settings reference
- CHANGELOG
- LICENSE file
- Improved `.vscodeignore` (excludes tests, docs, dev files from VSIX)

### Fixed
- `.vscodeignore` now excludes `test/`, `.github/`, and development docs from packaged extension

## 0.1.0 — 2026-02-20

Initial implementation:
- Multi-backend TTS: Kokoro (Node.js ONNX), F5-TTS (Python MLX), Custom HTTP
- VS Code `SpeechProvider` registration via proposed `speech` API
- Sentence-level chunking with prefetch buffer streaming
- Markdown-to-speech preprocessor
- Cross-platform audio playback (macOS, Linux, Windows)
- Setup wizard with backend picker and 28-voice Kokoro voice selector
- Keyboard shortcuts: toggle (`Cmd+Alt+T`), pause/resume (`Cmd+Alt+P`)
- Walkthrough onboarding experience
