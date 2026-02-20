# Open-Source TTS Models Research (February 2026)

> Research for vscode-f5-speech extension: which models can run locally in a VS Code extension with zero Python dependency?

---

## TTS Arena Rankings (as of early 2026)

The HuggingFace TTS-Arena and Artificial Analysis Speech Arena provide crowdsourced human preference rankings. Based on available data:

| Rank | Model | Type | Notes |
|------|-------|------|-------|
| #1 | FishAudio S1 | Commercial + open-weight | #1 on TTS-Arena2 (confirmed by their repo) |
| ~2-4 | ElevenLabs, OpenAI, Google | Commercial | Not open-source |
| ~5-7 | Kokoro, Orpheus, Dia | Open-weight | Top open-source contenders |
| ~8-10 | Sesame CSM, Parler-TTS | Open-weight | Good but below top tier |
| ~11+ | Piper, legacy models | Open-source | Functional but dated quality |

*Note: Arena leaderboard is dynamic; exact positions shift. Rankings are approximate based on community consensus and available benchmarks.*

**Sources**: [TTS-AGI/TTS-Arena](https://huggingface.co/spaces/TTS-AGI/TTS-Arena) (credibility: 8/10 — crowdsourced but well-established), [fishaudio/fish-speech README](https://github.com/fishaudio/fish-speech) (credibility: 7/10 — self-reported #1), [Artificial Analysis Speech Arena](https://artificialanalysis.ai/text-to-speech/arena) (credibility: 8/10 — independent benchmark).

---

## Model Comparison Table

| Model | Repo | Params | Quality | Streaming | JS/Node.js | Model Size | License | Voice Cloning | Stars |
|-------|------|--------|---------|-----------|------------|------------|---------|---------------|-------|
| **Kokoro** | [hexgrad/kokoro](https://github.com/hexgrad/kokoro) | 82M | ⭐⭐⭐⭐ | ✅ Chunk-level via TextSplitterStream | ✅ **kokoro-js** npm (ONNX) | ~87MB (q8), ~44MB (q4) | Apache-2.0 | ❌ Preset voices only | 5.7k |
| **Piper** | [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) | ~15-60M (varies) | ⭐⭐⭐ | ⚠️ Sentence-level (fast inference) | ✅ Via **sherpa-onnx-node** | 15-65MB per voice | **GPL-3.0** (new), MIT (archived) | ❌ Train custom voices | 10.6k (orig) |
| **Orpheus** | [canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS) | 3B | ⭐⭐⭐⭐⭐ | ✅ Native streaming (~200ms latency) | ❌ Python only (vllm/llama.cpp) | ~6GB | Apache-2.0 | ✅ Zero-shot | 6k |
| **OuteTTS** | [edwko/OuteTTS](https://github.com/edwko/OuteTTS) | 0.6B / 1B | ⭐⭐⭐⭐ | ⚠️ Chunk-level | ⚠️ npm `outetts` v0.2 only (stale) | ~1.2GB (1B) | Apache-2.0 | ✅ Few-shot | 1.4k |
| **Parler-TTS** | [huggingface/parler-tts](https://github.com/huggingface/parler-tts) | 880M / 2.3B | ⭐⭐⭐⭐ | ⚠️ Via torch.compile + SDPA | ❌ Python only (transformers) | ~1.7GB (mini) | Apache-2.0 | ⚠️ Text-described styles | 5.5k |
| **Sesame CSM** | [SesameAILabs/csm](https://github.com/SesameAILabs/csm) | 1B | ⭐⭐⭐⭐⭐ | ❌ No streaming | ❌ Python only (CUDA required) | ~2GB + Llama-3.2-1B | Apache-2.0 | ⚠️ Context-conditioned | 14.5k |
| **Dia** | [nari-labs/dia](https://github.com/nari-labs/dia) | 1.6B | ⭐⭐⭐⭐⭐ | ❌ (Dia1), ✅ (Dia2) | ❌ Python only (CUDA) | ~4.4GB VRAM | Apache-2.0 | ✅ Audio prompt | 19.1k |
| **Dia2** | [nari-labs/dia2](https://github.com/nari-labs/dia2) | 1B / 2B | ⭐⭐⭐⭐⭐ | ✅ Native streaming (doesn't need full text) | ❌ Python only (CUDA) | ~2-4GB VRAM | Apache-2.0 | ✅ Prefix audio | 1.1k |
| **FishAudio S1-mini** | [fishaudio/fish-speech](https://github.com/fishaudio/fish-speech) | 0.5B | ⭐⭐⭐⭐⭐ | ⚠️ Server-based streaming | ❌ Python only (PyTorch) | ~1GB | Apache-2.0 code, **CC-BY-NC-SA-4.0** weights | ✅ 10-30s reference | 24.9k |
| **Spark-TTS** | [SparkAudio/Spark-TTS](https://github.com/SparkAudio/Spark-TTS) | 0.5B | ⭐⭐⭐⭐ | ⚠️ Triton TRT-LLM server | ❌ Python only (Qwen2.5) | ~1GB | Apache-2.0 | ✅ Zero-shot | 10.9k |
| **Mars5-TTS** | [Camb-ai/MARS5-TTS](https://github.com/Camb-ai/MARS5-TTS) | ~1.2B | ⭐⭐⭐⭐ | ❌ No streaming | ❌ Python only (PyTorch) | ~2.4GB (AR+NAR) | **AGPL-3.0** | ✅ Deep/shallow clone | 2.8k |

---

## Detailed Model Assessments

### 1. Kokoro (hexgrad/kokoro) — ✅ BEST CANDIDATE

**Repo**: https://github.com/hexgrad/kokoro | **npm**: [kokoro-js](https://www.npmjs.com/package/kokoro-js) (23.6k weekly downloads)

- **82M parameters** — tiny but punches way above its weight
- **ONNX model** via [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) on HuggingFace
- **kokoro-js v1.2.1** — maintained by @xenova (Transformers.js author), uses onnxruntime underneath
- **Quantization options**: fp32, fp16, q8 (~87MB), q4 (~44MB), q4f16
- **Streaming**: `TextSplitterStream` + `tts.stream(splitter)` — receives text incrementally, outputs audio chunks
- **Node.js**: `device: "cpu"` for onnxruntime-node, `device: "wasm"` for browser
- **Languages**: English (US/UK), Spanish, French, Hindi, Italian, Japanese, Portuguese, Chinese
- **50+ preset voices** across different styles and genders
- **No voice cloning** — preset voices only
- **Quality**: Top-tier for its size; competitive with models 10-40x larger. TTS Arena contender ranked by @Pendrokar.
- **License**: Apache-2.0 (both code and weights)

**Streaming code example (Node.js)**:
```javascript
import { KokoroTTS, TextSplitterStream } from "kokoro-js";
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8", device: "cpu"
});
const splitter = new TextSplitterStream();
const stream = tts.stream(splitter);
for await (const { text, phonemes, audio } of stream) {
  // each chunk is playable immediately
  audio.save(`chunk.wav`);
}
```

**Source credibility**: npm package page (10/10), GitHub repo (10/10 — first-party)

---

### 2. Piper TTS (via sherpa-onnx) — ✅ SECONDARY OPTION

**Original**: https://github.com/rhasspy/piper (archived Oct 2025) → **New home**: https://github.com/OHF-Voice/piper1-gpl

- **ONNX-based** — VITS architecture, very fast inference
- **sherpa-onnx-node** npm package (2.1k weekly downloads) wraps ONNX runtime with native addon, supports Piper models for TTS
- **Model sizes**: 15-65MB per voice (many pre-trained voices in 30+ languages)
- **Streaming**: Not native, but inference is so fast (~10x realtime) that sentence-level chunking feels instant
- **Quality**: Decent but dated — sounds synthetic compared to 2025-era models. Fine for utilitarian TTS, not competitive for "natural" voice
- **⚠️ License**: Original Piper was MIT, but the new active fork (piper1-gpl) is **GPL-3.0** — **problematic for a VS Code extension**. Older MIT-licensed ONNX model weights may still be usable separately.
- **Voice cloning**: Not supported; must train a new voice model (~1hr of audio + GPU training)

**Source credibility**: GitHub repos (10/10 — first-party), npm package (10/10)

---

### 3. Orpheus TTS (canopyai/Orpheus-TTS) — ❌ NO JS RUNTIME

**Repo**: https://github.com/canopyai/Orpheus-TTS

- **3B params** (Llama-3B backbone → SNAC audio tokens)
- **Best-in-class quality** — "superior to SOTA closed source models" for emotional/natural speech
- **Native streaming**: ~200ms latency (reducible to ~100ms with input streaming)
- **8 English voices** + multilingual models (7 language pairs)
- **Emotion tags**: `<laugh>`, `<sigh>`, `<gasp>`, etc.
- **Voice cloning**: Zero-shot via pretrained model
- **Runtime**: Python only — requires `vllm` or `llama.cpp` (GGUF). The llama.cpp option theoretically supports non-GPU inference but still requires Python wrapper (`orpheus-speech` pip package)
- **No ONNX conversion** available
- **No JS/Node.js runtime**
- **License**: Apache-2.0

**Note**: There are community llama.cpp implementations that run without GPU, but wrapping them for Node.js would require significant effort with no maintained solution.

**Source credibility**: GitHub repo (10/10), blog at canopylabs.ai (8/10)

---

### 4. OuteTTS (edwko/OuteTTS) — ⚠️ PARTIAL JS SUPPORT

**Repo**: https://github.com/edwko/OuteTTS

- **v1.0**: 0.6B and 1B parameter models (LLM-based, uses llama.cpp backend)
- **npm package `outetts`** exists but only supports **v0.2** (old model, 4 downloads/week, no README, stale)
- **JS dir in repo** (`outetts.js/`) exists for v0.2 via Transformers.js
- **v1.0 has no JS support** — Python only with llama.cpp, HuggingFace Transformers, ExLlamaV2, or VLLM backends
- **Voice cloning**: Yes, create speaker profiles from ~10s audio
- **Streaming**: Token-level via LLM generation, but requires DAC vocoder decode
- **Quality**: Good for v1.0, competitive for conversational TTS
- **License**: Apache-2.0

**Source credibility**: GitHub repo (10/10), npm package (10/10)

---

### 5. Parler-TTS (huggingface/parler-tts) — ❌ NO JS RUNTIME

**Repo**: https://github.com/huggingface/parler-tts

- **880M (mini) / 2.3B (large)** parameters
- Unique approach: describe voice in natural language ("A female speaker delivers a slightly expressive speech...")
- **34 named speakers** for consistency
- **No JS port**, no ONNX conversion
- Python only (transformers + PyTorch)
- Last commit: 2 years ago — development appears stalled
- **License**: Apache-2.0

**Source credibility**: GitHub repo (10/10 — Hugging Face official)

---

### 6. Sesame CSM (SesameAILabs/csm) — ❌ NO JS RUNTIME

**Repo**: https://github.com/SesameAILabs/csm

- **1B params** — Llama-3.2-1B backbone + Mimi audio codec
- Extremely natural conversational speech (powering Sesame's viral voice demo)
- Requires **CUDA GPU** (not even CPU-compatible in current release)
- Available in HF Transformers (v4.52.1+)
- **No streaming** — generates full audio at once
- **No JS/ONNX runtime**
- English only
- **License**: Apache-2.0

**Source credibility**: GitHub repo (10/10 — Sesame AI Labs official)

---

### 7. Dia / Dia2 (nari-labs) — ❌ NO JS RUNTIME

**Dia1**: https://github.com/nari-labs/dia (19.1k stars) | **Dia2**: https://github.com/nari-labs/dia2 (1.1k stars)

- **Dia1**: 1.6B params, dialogue TTS (`[S1]`/`[S2]` speaker tags), non-verbal sounds
- **Dia2**: 1B/2B params, **true streaming** — doesn't need full text to start generating
- Both GPU-only (CUDA), Python only
- Dia2 has a Rust-based speech-to-speech engine ("Sori") planned but not released
- **No JS/ONNX runtime**
- **License**: Apache-2.0

**Source credibility**: GitHub repos (10/10)

---

### 8. FishAudio S1 / S1-mini — ❌ NO JS RUNTIME

**Repo**: https://github.com/fishaudio/fish-speech

- **S1**: 4B params (cloud API only) — **#1 on TTS-Arena2**
- **S1-mini**: 0.5B params (open-weight, HuggingFace)
- Emotion control with fine-grained tags, multilingual
- Python only (PyTorch)
- **⚠️ Code**: Apache-2.0, **Weights**: CC-BY-NC-SA-4.0 (non-commercial)
- **No JS/ONNX runtime**

**Source credibility**: GitHub repo (10/10)

---

### 9. Spark-TTS — ❌ NO JS RUNTIME

**Repo**: https://github.com/SparkAudio/Spark-TTS

- **0.5B params** built on Qwen2.5 LLM
- Bilingual (Chinese/English), voice cloning, controllable generation
- Has Triton TRT-LLM deployment for production streaming
- Python only, no ONNX export, no JS runtime
- **License**: Apache-2.0

**Source credibility**: GitHub repo (10/10), ArXiv paper (9/10)

---

### 10. Mars5-TTS — ❌ AGPL LICENSE + NO JS

**Repo**: https://github.com/Camb-ai/MARS5-TTS

- ~1.2B params (750M AR + 450M NAR), good prosody
- Deep/shallow voice cloning
- **AGPL-3.0 license** — incompatible with VS Code extension distribution
- Python only, last major update July 2024
- No streaming, no ONNX, no JS

**Source credibility**: GitHub repo (10/10)

---

## Key Infrastructure: sherpa-onnx

**Repo**: https://github.com/k2-fsa/sherpa-onnx (10.4k stars) | **npm**: [sherpa-onnx-node](https://www.npmjs.com/package/sherpa-onnx-node) v1.12.25

sherpa-onnx is a **cross-platform ONNX inference framework** that supports TTS (among many other speech tasks) via a Node.js native addon. It supports:
- **Piper ONNX voices** (many pre-trained)
- **Kokoro ONNX** models
- **PocketTTS** (recently added, lightweight)
- **KittenTTS** (another small model)

It provides a unified API for running various ONNX TTS models in Node.js without Python. Actively maintained (last release: 1 week ago). Apache-2.0 licensed.

This is relevant as **an alternative to kokoro-js** for running Kokoro or Piper models.

---

## ONNX Models Available for Node.js (Besides Kokoro)

| Model | ONNX Available | Node.js Runtime | Quality |
|-------|---------------|-----------------|---------|
| Kokoro-82M | ✅ Official (onnx-community/) | kokoro-js, sherpa-onnx | ⭐⭐⭐⭐ |
| Piper voices | ✅ Native format | sherpa-onnx-node | ⭐⭐⭐ |
| OuteTTS v0.2 | ✅ Via Transformers.js | outetts npm (stale) | ⭐⭐⭐ |
| PocketTTS | ✅ sherpa-onnx native | sherpa-onnx-node | ⭐⭐⭐ |
| Orpheus | ❌ No ONNX export | — | — |
| Parler-TTS | ❌ No ONNX export | — | — |
| Sesame CSM | ❌ No ONNX export | — | — |
| Dia/Dia2 | ❌ No ONNX export | — | — |
| FishAudio S1-mini | ❌ No ONNX export | — | — |
| Spark-TTS | ❌ No ONNX export | — | — |

---

## Viability Assessment for VS Code Extension (Zero Python Dependency)

### Tier 1: Production-Ready ✅

**Kokoro via kokoro-js** is the clear winner:
- ✅ npm package with 23.6k weekly downloads
- ✅ Maintained by @xenova (HuggingFace/Transformers.js core contributor)
- ✅ Built-in streaming (TextSplitterStream)
- ✅ Small model (~44-87MB quantized)
- ✅ Good quality for 82M params
- ✅ Apache-2.0 license
- ✅ Multiple voices (50+)
- ✅ Works on macOS/Linux/Windows (CPU via onnxruntime-node)
- ❌ No voice cloning

### Tier 2: Possible Alternatives

**Piper via sherpa-onnx-node**:
- ✅ Very fast inference, tiny models
- ✅ Active Node.js bindings
- ⚠️ Quality is noticeably lower than modern models
- ⚠️ GPL-3.0 license on new code (original MIT models may still work)
- ⚠️ Native addon requires platform-specific prebuilds

### Tier 3: Not Viable Without Python

All other models (Orpheus, Dia2, CSM, FishAudio S1, Spark-TTS, Parler, OuteTTS v1.0, Mars5) require Python + heavy ML frameworks. No ONNX exports exist for them as of February 2026.

---

## Recommendation

**For the vscode-f5-speech extension, Kokoro via kokoro-js is the only production-viable option** that meets all criteria:

1. ✅ Open-source/open-weight (Apache-2.0)
2. ✅ Runs locally (no cloud API)
3. ✅ Good voice quality (top-tier for its size)
4. ✅ Streaming via TextSplitterStream
5. ✅ Native npm package for Node.js

The main tradeoff vs. the current F5-TTS-MLX approach:
- **Lost**: Voice cloning capability
- **Gained**: Zero Python dependency, cross-platform, streaming, much smaller model, faster cold start

If voice cloning is absolutely required in the future, the options are:
1. Keep F5-TTS as a Python fallback for voice cloning mode
2. Wait for Orpheus ONNX export (community may create one, given llama.cpp support)
3. Use OuteTTS v1.0 via embedded llama.cpp binary (complex but theoretically possible)

---

*Research conducted 2026-02-20. Sources: GitHub repos (primary), npm registry, HuggingFace model cards, TTS Arena leaderboards.*
