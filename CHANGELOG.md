# Changelog

## 0.1.0-beta.3 — 2026-02-20

### Added
- Emoji and special character stripping in speech preprocessor (arrows, dashes, checkmarks, warnings)
- Abbreviation expansion for TTS (npm, API, URL, TTS, VS Code — first occurrence only)
- Shared test helpers (`fakeBackend`, `makeContext`, `collectEvents`) for DRY test infrastructure
- Player.ts tests: Windows PowerShell, SIGTERM/error handling, process signals
- Chunker tests: prefetch backpressure, non-Error throws, abort-during-synthesis
- Mock AudioPlayer in session integration tests (75x speedup: 3.6s → 48ms)

### Changed
- Coverage thresholds raised to 90/85/90/92 (stmts/branches/funcs/lines)
- Trimmed redundant formatting rules from TTS voice output instructions
- Overall coverage: 95.6% stmts, 87.1% branches, 93.8% funcs, 97.1% lines

### Fixed
- Session integration test isolation (no longer leaks `child_process` mock from player tests)
- Suppressed expected `console.error` output in session error tests

## 0.1.0-beta.2 — 2026-02-20

### Added
- Event-driven chunker replacing 80ms polling loop
- Full `kokoro-js` streaming type declarations (`TextSplitterStream`, `RawAudio`, `stream()`)

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
