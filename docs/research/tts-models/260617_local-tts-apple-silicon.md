---
status: complete
date: 260617
updated: 260617
query: Self-hostable open-source TTS models for article narration on Apple Silicon Mac (2025-2026), with streaming, HTTP API, quality vs ElevenLabs
---

# Local Open-Source TTS for Apple Silicon (2025-2026)

## Evaluation Frame

Target use-case: narrating long-form articles / blog posts / CLI output on an Apple Silicon Mac (M-series). Key axes: naturalness, Apple Silicon speed (RTF > 1.0 = faster than real-time), streaming support, OpenAI-compatible `/v1/audio/speech` server, ease of setup.

RTF convention used below: RTF > 1 means faster-than-real-time (1 second of CPU generates more than 1 second of audio).

---

## Model Profiles

### Kokoro-82M
- **Maker**: HexGrad (independent researcher)
- **License**: Apache 2.0 — fully commercial and self-hostable
- **Params**: 82 M (weights ~326 MB fp16; ONNX runtime ~80 MB INT8)
- **Languages**: v1.0 (Jan 2025): 8 languages, 54 voices including American/British English, French, Korean, Japanese, Mandarin, Spanish, Hindi, Portuguese; v0.19 was English-only
- **Quality**: Hit #1 on TTS Arena leaderboard (Jan 2025), beating XTTS-v2 (467M) and MetaVoice (1.2B). Described as "approaching ElevenLabs" on English
- **Apple Silicon RTF**:
  - CoreML / Neural Engine: 12–79× real-time depending on chip; M2 Ultra generates 30 s audio in 379 ms (79×RT); M1 Mac Mini 16 GB under 2 s for 30 s audio (15×RT)
  - MLX (gabrimatic/kokoro-mlx): ~45 ms inference per forward pass; 1.5 s first-request latency (lazy-load 600 MB model)
  - PyTorch MPS via Kokoro-FastAPI: functional with `start-gpu_mac.sh`; known issues in issue #270 (Mar 2025) were partly addressed
  - CPU ONNX (no GPU): 2.0–2.1× real-time on commodity CPU; ~1.8 s for a 59-char sentence on EPYC 7763 4-core (no GPU)
- **Streaming**: Yes — Kokoro-FastAPI streams with configurable chunk size; sentence-boundary splitting; overlapping generation+format conversion pipeline; first-audio <1 s on M3 Pro CPU at chunk_size=200
- **HTTP server**: Kokoro-FastAPI (remsky/Kokoro-FastAPI) — OpenAI-compatible `/v1/audio/speech`; Docker or bare uv; multiformat (mp3, wav, opus, flac, m4a, pcm); word-level timestamps
- **RAM**: Model <1 GB; inference 1–2 GB on CPU ONNX; 2–3 GB GPU including CUDA buffers
- **Caveats**: MPS path in Kokoro-FastAPI had setup friction on macOS (issue #270 reported Mar 2025, start-gpu_mac.sh added); CoreML path (kokoro-coreml) is a separate project

---

### Piper (rhasspy/piper → OHF-Voice/piper1-gpl)
- **Maker**: rhasspy (Michael Hansen); now maintained by Open Home Foundation Voice
- **License**: Original MIT archived Oct 6 2025; maintained fork OHF-Voice/piper1-gpl under GPL-3.0
- **Params**: VITS-based per-voice models; typically 28–130 MB per voice model
- **Languages**: 30+ languages, 900+ voices (community-contributed)
- **Quality**: Good for utility TTS; robotic by modern standards — noticeably below Kokoro or Chatterbox on naturalness. Designed for Raspberry Pi, not for ElevenLabs parity
- **Apple Silicon**: Runs on macOS ARM natively; available as pre-built binary; no GPU acceleration (CPU only), but VITS is fast — faster-than-real-time on Apple Silicon even on CPU
- **Streaming**: Built-in streaming output via stdout pipe; no native HTTP server but wraps easily
- **HTTP server**: No official HTTP server; community Docker wrappers exist; LlamaEdge tts-api-server provides OpenAI-compatible endpoint wrapping Piper
- **RAM**: <200 MB per voice, tiny footprint
- **Caveats**: Repository archived Oct 2025; GPL fork is the live project. License change from MIT to GPL is a significant shift for embedding use. Quality is dated vs 2025 neural models.

---

### Coqui TTS / XTTS-v2
- **Maker**: Coqui AI (company shut down Dec 2024; community fork coqui-tts maintained)
- **License**: XTTS-v2 weights: Coqui Public Model License (non-commercial only for the weights; code is AGPL/Apache). Community coqui-tts package: MPL-2.0 on code, weights license unchanged
- **Params**: ~467 M
- **Languages**: 17 languages including English, Spanish, French, German, Italian, Polish, Portuguese, Turkish, Russian, Dutch, Czech, Arabic, Chinese, Japanese, Hungarian, Korean, Hindi
- **Quality**: Previously the best open-source option (2023-2024). Now beaten by Kokoro, Chatterbox, F5-TTS. Still good for multi-speaker zero-shot cloning with 6 s of reference audio
- **Apple Silicon**: MPS support broken in official package — hangs when device=mps (GitHub issue #3649); CPU works but slow (XTTS is autoregressive, not fast on CPU). No official fix as of 2025 (company gone)
- **Streaming**: Yes, sentence-level streaming supported in streaming mode
- **HTTP server**: Community wrappers; no official server
- **RAM**: ~3–4 GB loaded
- **Caveats**: Company closed Dec 2024. Weights license restricts commercial use. MPS broken. Not recommended as primary choice for new setups.

---

### Chatterbox (Resemble AI)
- **Maker**: Resemble AI
- **License**: MIT — commercial, self-hostable with no restrictions
- **Params**: ~0.5 B base; Chatterbox-Turbo uses a distilled 350 M one-step decoder
- **Languages**: Primarily English; multilingual variant announced (Chatterbox Multilingual) adding 17 languages per Resemble AI
- **Quality**: Blind preference tests showed 63.75% evaluators preferred Chatterbox over ElevenLabs in head-to-head. Frequently cited as best open-source English quality as of mid-2025
- **Apple Silicon**: MPS acceleration supported; community-optimized Apple Silicon fork at Jimmi42/chatterbox-tts-apple-silicon-code with full MPS GPU support; 2–3× faster than CPU on MPS. Turbo variant cuts diffusion steps from 10 to 1 (major speed gain)
- **Streaming**: Real-time streaming API promised Q3 2025 (<100 ms latency per Resemble AI roadmap); community server (devnen/Chatterbox-TTS-Server) provides OpenAI-compatible endpoint
- **HTTP server**: devnen/Chatterbox-TTS-Server and BrunBrand/Chatterbox-TTS-Server-mt — OpenAI-compatible, Web UI, voice cloning, large-text chunking. Supports CUDA/ROCm/CPU; MPS supported by community patch
- **RAM**: ~2–3 GB for base model; Turbo lighter
- **Caveats**: Specific RTF numbers on Apple Silicon not widely published; Resemble AI roadmap dates (Q2/Q3/Q4 2025) are vendor claims. Voice cloning from 5 s reference audio is a headline feature.

---

### F5-TTS
- **Maker**: SWivid (academic, Shanghai/CUHK)
- **License**: MIT — fully commercial
- **Params**: ~335 M (E2-TTS variant ~310 M). Quantized builds: ~400 MB VRAM at 4-bit
- **Languages**: English and Chinese primary; zero-shot cloning extends to other languages via reference audio
- **Quality**: Flow-matching-based; non-autoregressive. Zero-shot voice cloning from ~3 s reference. Quality comparable to Chatterbox on English; some prefer it for expressive cloning
- **Apple Silicon**: MLX implementation (f5-tts-mlx by lucasnewman) runs natively on Apple Silicon. ~4 s to generate a short sample on M3 Max MacBook Pro; claimed ~15× real-time on M5 Pro CPU with ARM NEON. Non-autoregressive means all tokens generated in parallel — generally fast
- **Streaming**: Not a natural fit (flow-matching generates full mel at once); some community streaming wrappers exist
- **HTTP server**: Official package has CLI and Python API; community FastAPI wrappers exist; no widely-deployed OpenAI-compatible server as of Jun 2026
- **RAM**: ~1–2 GB fp16; quantized ~400 MB VRAM
- **Caveats**: "15× real-time on M5 Pro CPU" is a single-source claim from one benchmark page. Streaming is harder with flow-matching architectures vs autoregressive. Library updated actively on PyPI.

---

### Orpheus TTS (Canopy AI)
- **Maker**: Canopy AI
- **License**: Apache 2.0 (model weights and code)
- **Params**: 3 B (based on Llama 3.2-3B) + SNAC tokenizer
- **Languages**: English only (original); multilingual research preview April 2025
- **Quality**: Described as "human-sounding" — strong expressivity with emotion tags (<laugh>, <sigh>, <cough> etc.). Widely praised for naturalness in interactive/conversational contexts
- **Apple Silicon**: Official Python package requires CUDA (vLLM dependency) — no native support. Working path on M-series: GGUF via LM Studio (Metal backend) + orpheus-tts-local Python client for SNAC decoding. Available on Ollama (legraphista/Orpheus:3b-ft-q4_k_m). Speed is usable single-user but not batch-scale
- **Streaming**: ~200 ms streaming latency; async streaming in Python API; freddyaboulton/orpheus-cpp wraps with WebRTC for FastRTC streaming
- **HTTP server**: No official HTTP server; llama.cpp server with appropriate params; community wrappers
- **RAM**: 3 B model; q4_k_m GGUF ~2 GB; full fp16 ~6 GB
- **Caveats**: Requires workaround for Apple Silicon (LM Studio Metal or llama.cpp Metal). At 3 B params is 37× larger than Kokoro for marginal quality gain on narration. Excels at dialogue/emotion, less critical for article reading.

---

### Dia (Nari Labs)
- **Maker**: Nari Labs
- **License**: Apache 2.0
- **Params**: 1.6 B (transformer-based)
- **Languages**: English primary; Dia2 (released mid-2025) expanding support
- **Quality**: Designed for "ultra-realistic dialogue in one pass"; supports non-verbal audio (laughs, pauses); strong zero-shot voice cloning
- **Apple Silicon**: Possible but limited — no native CUDA, runs on CPU with significantly reduced speed. Community reports of successful use on M-series but slow
- **Streaming**: Not well-documented for streaming use
- **HTTP server**: DigitalOcean tutorial shows standard Python deployment; no widely-used OpenAI-compatible server
- **RAM**: ~3–4 GB
- **Caveats**: Apple Silicon performance not well-benchmarked; primarily designed for GPU (CUDA). Single-source quality claims from vendor site.

---

### Parler-TTS (Hugging Face)
- **Maker**: Hugging Face
- **License**: Apache 2.0
- **Params**: Mini: 880 M; Large: 2.3 B
- **Languages**: English (trained on 45k hours of audiobook data); multilingual-v1.1 variant exists
- **Quality**: Unique prompt-controlled generation — specify gender, noise level, speaking rate, pitch, reverberation in natural language. Quality good but behind Chatterbox/Kokoro on blind tests
- **Apple Silicon**: No specific MPS optimization reported; runs on CPU; Mini variant feasible
- **Streaming**: Not streaming-optimized; full generation then output
- **HTTP server**: No official server; Python library; SDPA and Flash Attention 2 for faster inference
- **RAM**: Mini ~2 GB; Large ~5–6 GB
- **Caveats**: Requires a descriptive prompt to control output style — unusual workflow for article narration. Large is 10–15× more compute than Mini.

---

### StyleTTS2
- **Maker**: Y. Li et al. (academic, Columbia University area)
- **License**: MIT
- **Params**: ~300–400 M (architecture with style diffusion + adversarial training)
- **Languages**: English
- **Quality**: When released (late 2023) matched ElevenLabs quality in informal tests. Still competitive for English narration. Non-autoregressive style transfer
- **Apple Silicon**: Community reports of running on Mac but no dedicated MPS path; GPU 12 GB recommended for comfortable use (tested on RTX 3060 12 GB); CPU mode available but slow
- **Streaming**: Simple TTS server (lxe/tts-server) exists; streaming support not native
- **HTTP server**: lxe/tts-server provides basic HTTP; not OpenAI-compatible
- **RAM**: ~3–4 GB GPU for comfortable use
- **Caveats**: Largely eclipsed by Kokoro and Chatterbox for new projects. Limited Apple Silicon benchmarks.

---

### MeloTTS (MyShell / MIT)
- **Maker**: MyShell.ai and MIT
- **License**: MIT
- **Params**: ~100–200 M (lightweight VITS-based)
- **Languages**: English (American, British, Indian, Australian, default), Spanish, French, Chinese, Japanese, Korean
- **Quality**: Good for its size; below Kokoro and Chatterbox. Better than Piper. Designed for mobile/edge
- **Apple Silicon**: CPU-friendly; runs without GPU. No dedicated MPS path documented
- **Streaming**: Docker image available (sensejworld/melotts) with WebUI and API
- **HTTP server**: Community Docker with HTTP API
- **RAM**: <1 GB
- **Caveats**: Quality compromise vs Kokoro at similar size. Actively maintained as of 2025.

---

### Sesame CSM-1B
- **Maker**: Sesame AI Labs
- **License**: Apache 2.0 (1B variant; released Mar 2025)
- **Params**: 1 B (Llama backbone + Mimi audio decoder)
- **Languages**: English (conversation-optimized)
- **Quality**: Designed for conversational speech, not narration — excels at short utterances with natural turn-taking prosody. Less optimal for long-form article reading
- **Apple Silicon**: MLX support via community project (akashjss/sesame-csm); also runs on CPU. Gradio UI with MLX and CPU paths documented
- **Streaming**: Not optimized for streaming long-form; better for short conversational turns
- **HTTP server**: OpenAI-compatible API in akashjss/sesame-csm; Gradio UI
- **RAM**: ~2–3 GB
- **Caveats**: Optimized for conversational context (Maya assistant), not article narration. "Struggles with lengthy paragraphs" per multiple sources. Not ideal for this use-case.

---

### Higgs Audio (Boson AI)
- **Maker**: Boson AI
- **License**: V2: Apache 2.0 (commercial OK); V3: non-commercial research license (commercial requires separate agreement)
- **Params**: V2: ~5.8 GB fp16 (large foundation model); V3 TTS: 4B param variant (bosonai/higgs-audio-v3-tts-4b)
- **Languages**: V3: 100+ languages
- **Quality**: V2 described as "rivals paid services on naturalness, emotion, voice cloning"; V3 adds fine-grained inline style/emotion/prosody control. Designed as a foundation model, not a lean TTS
- **Apple Silicon**: Mentioned in benchmarking context; no specific Apple Silicon RTF data found
- **Streaming**: SGLang server integration (sgl-project.github.io)
- **HTTP server**: SGLang-based inference; not a simple pip-install HTTP server
- **RAM**: ~6–10 GB (V2 5.8 GB fp16; V3 4B ~8 GB)
- **Caveats**: Large footprint. V3 license restricts commercial use. Complex setup (SGLang). Overkill for personal article narration; more suited to production multi-language pipelines.

---

### Apple `say` / AVSpeechSynthesizer
- **Maker**: Apple
- **License**: Part of macOS/iOS — free to use, not open-source
- **Params**: N/A (built-in neural voices)
- **Languages**: 40+ languages; the newer "premium" voices (downloaded in System Settings > Accessibility > Spoken Content) are neural and significantly better than legacy
- **Quality**: Premium voices (e.g., Ava, Zoe, Nathan) are genuinely good — better than older Piper models, arguably comparable to early ElevenLabs basic tier. Below Kokoro or Chatterbox on blind tests. The gap vs open-source is real but not enormous for neutral narration
- **Apple Silicon**: Zero overhead — runs on Neural Engine with the system. Instant startup, zero RAM overhead beyond OS
- **Streaming**: Instant — streaming playback by default, no buffering
- **HTTP server**: None. Scriptable via `say` CLI; AVSpeechSynthesizer for app embedding only. No OpenAI-compatible endpoint. Would require custom wrapping
- **RAM**: Effectively 0 (OS component)
- **Caveats**: Closed source; no voice cloning; limited voice selection; no OpenAI API compatibility without custom server wrapper. But for pure simplicity and zero-setup personal use, it's the fastest path.

---

## Quality Ranking (English, naturalness, 2025-2026)

Approximate ranking based on blind evaluations and community benchmarks:

1. Chatterbox (63.75% over ElevenLabs in blind test) / Fish Audio S2 Pro (81.88% EmergentTTS-Eval win rate)
2. Kokoro-82M (#1 TTS Arena Jan 2025; better than XTTS-v2 467M, MetaVoice 1.2B)
3. F5-TTS (strong cloning; comparable to Chatterbox for many use-cases)
4. Orpheus 3B (best expressivity/emotion for dialogue; good narration)
5. StyleTTS2 (strong English; less actively maintained)
6. Dia 1.6B / Parler-TTS (quality good; infrastructure less mature)
7. XTTS-v2 (previously top; now eclipsed + license issues + MPS broken)
8. MeloTTS (good for size; below neural leaders)
9. Apple `say` premium voices (good utility; not open/customizable)
10. Piper (utility/speed; quality dated)

---

## Apple Silicon Speed Summary (RTF, higher = faster than real-time)

| Model | Params | Apple Silicon RTF | Notes |
|---|---|---|---|
| Kokoro-82M (CoreML) | 82M | 12–79× | Neural Engine; M2 Ultra = 79× |
| Kokoro-82M (MLX) | 82M | ~15× est. | ~45ms inference |
| Kokoro-82M (CPU ONNX) | 82M | ~2× | No GPU needed |
| Piper | 28–130M/voice | >10× | CPU-only, very lightweight |
| MeloTTS | ~150M | >1× (est.) | CPU-friendly VITS |
| Apple `say` | OS | instant | Neural Engine native |
| F5-TTS (MLX) | 335M | ~15× | M5 Pro claim; M3 Max ~4s/short |
| Chatterbox Turbo | 350M | 2–3× CPU→MPS est. | MPS 2-3× over CPU; no published RTF |
| StyleTTS2 | ~400M | <1× on CPU (slow) | Needs GPU |
| Orpheus 3B (GGUF Metal) | 3B | <1× real-time likely | Single-user usable; no RTF published |
| Sesame CSM-1B | 1B | ~1× est. | MLX path available |
| Dia 1.6B | 1.6B | <1× on CPU | GPU recommended |
| XTTS-v2 | 467M | MPS broken | CPU slow; avoid on Apple Silicon |
| Parler-TTS Mini | 880M | <1× on CPU | GPU preferred |
| Higgs Audio V3 | 4B | unknown | No published Apple Silicon data |

---

## Streaming and HTTP API Comparison

| Model | Streaming | OpenAI-compat `/v1/audio/speech` | Notes |
|---|---|---|---|
| Kokoro-FastAPI | Yes (chunked, configurable) | Yes | Sentence-boundary splitting; start-gpu_mac.sh for MPS |
| Chatterbox-TTS-Server | Planned Q3 2025 | Yes | devnen/Chatterbox-TTS-Server; MPS via community patch |
| Piper + LlamaEdge | Yes (stdout pipe) | Yes (via wrapper) | No native server; LlamaEdge tts-api-server wraps it |
| Orpheus (llama.cpp) | Yes (~200ms latency) | Via llama.cpp server | GGUF Metal path |
| F5-TTS | Partial | Community only | Flow-matching generates full mel; chunking workaround |
| Sesame CSM | Limited | Yes (akashjss fork) | Short-form only; not for long articles |
| Apple `say` | Yes (native) | No | Would need custom wrapper |
| Parler-TTS | No | No | Batch only |
| StyleTTS2 | Partial | Basic (lxe/tts-server) | Not OpenAI-compat |
| Higgs Audio | Yes (SGLang) | Via SGLang | Heavy setup |
| XTTS-v2 | Yes | Community only | MPS broken |

---

## Top 3 Recommendations for "Fast, Natural Article Narration on Apple Silicon + HTTP Streaming"

### Rank 1 — Kokoro-82M via Kokoro-FastAPI

Best overall fit. Reasons:
- Fastest Apple Silicon RTF of any neural TTS: 12–79× real-time via CoreML/Neural Engine; ~2× on CPU ONNX with no GPU required
- OpenAI-compatible `/v1/audio/speech` out of the box (Kokoro-FastAPI)
- Chunked streaming with sentence-boundary splitting — articles start playing in <1 s
- Apache 2.0 license — no restrictions
- Tiny footprint: 82M params, ~326 MB fp16 weights, model loads in ~1.5 s, stays resident
- #1 TTS Arena quality despite tiny size
- Simple install: `pip install kokoro-onnx` for pure-Python CPU path; Docker/uv for server

Setup path for macOS: `pip install kokoro-onnx` for direct use, or clone remsky/Kokoro-FastAPI and run `./start-gpu_mac.sh` for the MPS-accelerated OpenAI-API server. ONNX CPU path needs no GPU at all and still runs 2×RT.

Limitation: MPS path in Kokoro-FastAPI had known setup friction on macOS (issue #270); verify against current CHANGELOG before committing to that path. ONNX CPU fallback works fine.

---

### Rank 2 — Chatterbox (MIT) via Chatterbox-TTS-Server

Best quality for natural-sounding narration (empirically preferred over ElevenLabs in blind tests). Reasons:
- MIT license — permissive
- MPS acceleration on Apple Silicon (2–3× faster than CPU)
- OpenAI-compatible endpoint via devnen/Chatterbox-TTS-Server
- Turbo variant (one-step decoder) dramatically reduces latency vs base
- Voice cloning from 5 s audio useful if a specific voice is desired for narration
- Active development (Resemble AI backing)

Limitation: no confirmed RTF numbers published for Apple Silicon; streaming endpoint was roadmap Q3 2025 — verify current state. Larger footprint than Kokoro (~500 M params, ~2 GB RAM vs ~80 MB). Slower than Kokoro on CPU-only.

---

### Rank 3 — Apple `say` with Premium Neural Voice (for zero-setup fallback)

Not open-source, but uniquely practical for this use-case:
- Zero install, zero model download, zero RAM overhead
- Instant streaming — no buffering latency
- Neural Engine — fastest possible synthesis on Apple Silicon
- Premium voices (Ava, Zoe) are genuinely good for neutral article narration — not ElevenLabs-tier but better than most people expect
- `say -v Ava "$(cat article.txt)"` is a one-liner

Use this as the fallback/zero-dependency path, or while testing other models. The main weakness is: no OpenAI API compatibility and no voice customization.

If an OpenAI-compatible wrapper around `say` is needed, a trivial FastAPI shim can expose it.

---

## What to Avoid

- **XTTS-v2**: MPS broken; company gone; non-commercial weight license
- **Parler-TTS**: Prompt-driven style control is awkward for automation; batch-only; slow
- **Higgs Audio V3**: Non-commercial license; large; complex infrastructure; overkill for personal use
- **Dia 1.6B**: Heavy for Apple Silicon without CUDA; streaming infrastructure immature
- **Sesame CSM**: Explicitly struggles with long paragraphs; conversational model

## Caveats

- Chatterbox streaming RTF claim (Q3 2025 roadmap) is vendor projection — single source (Resemble AI blog)
- F5-TTS "15× real-time on M5 Pro CPU" is a single-source claim from one benchmark page
- Kokoro MPS path in FastAPI: issue #270 was partly addressed but verify current status in CHANGELOG before depending on it; ONNX CPU path is safer
- Piper's license changed from MIT to GPL in the OHF-Voice fork — material if embedding in a project
- All quality comparisons vs ElevenLabs are community blind tests, not peer-reviewed benchmarks
- Higgs Audio V2 (Apache 2.0) vs V3 (non-commercial) — confirm version before use

## Sources

- https://github.com/gabrimatic/kokoro-mlx — MLX implementation, inference timings
- https://github.com/mattmireles/kokoro-coreml — CoreML/Neural Engine RTF data (12–79× real-time)
- https://github.com/remsky/Kokoro-FastAPI — FastAPI server, MPS support, streaming docs
- https://github.com/remsky/Kokoro-FastAPI/issues/270 — Apple Silicon issue (Mar 2025)
- https://deepwiki.com/remsky/Kokoro-FastAPI/7.2-streaming-and-performance-optimization — streaming architecture detail
- https://soniqo.audio/guides/kokoro — Kokoro voice list, CoreML benchmarks
- https://github.com/canopyai/Orpheus-TTS — Orpheus 3B, streaming latency (~200ms), Apache 2.0
- https://github.com/freddyaboulton/orpheus-cpp — orpheus streaming via WebRTC
- https://codersera.com/blog/install-and-run-orpheus-3b-tts-on-macos-a-complete-guide/ — Orpheus on macOS (LM Studio Metal path)
- https://huggingface.co/Jimmi42/chatterbox-tts-apple-silicon-code — Chatterbox MPS fork
- https://github.com/devnen/Chatterbox-TTS-Server — Chatterbox OpenAI-compat server
- https://github.com/resemble-ai/chatterbox — Chatterbox main repo, MIT license, voice cloning
- https://github.com/SWivid/F5-TTS — F5-TTS, MIT license, flow-matching
- https://github.com/lucasnewman/f5-tts-mlx — F5-TTS MLX, Apple Silicon
- https://github.com/nari-labs/dia — Dia 1.6B, Apache 2.0
- https://github.com/rhasspy/piper — Piper archived Oct 2025
- https://github.com/huggingface/parler-tts — Parler-TTS, 880M/2.3B, Apache 2.0
- https://github.com/yl4579/StyleTTS2 — StyleTTS2, MIT
- https://github.com/SesameAILabs/csm — Sesame CSM-1B, Apache 2.0
- https://github.com/akashjss/sesame-csm — CSM MLX + OpenAI API
- https://github.com/boson-ai/higgs-audio — Higgs Audio V2/V3 by Boson AI
- https://huggingface.co/bosonai/higgs-audio-v3-tts-4b — Higgs V3 4B, non-commercial license
- https://github.com/coqui-ai/TTS/issues/3649 — XTTS-v2 MPS bug (still open)
- https://openrouter.ai/hexgrad/kokoro-82m — Kokoro RTF 0.03 on A100 (GPU reference)
- https://gigagpu.com/tts-latency-benchmarks/ — TTS latency benchmarks, GPU cloud
- https://heyneo.com/blog/kokoro-tts-vs-supertonic-3-tts — Kokoro CPU benchmark (2×RT on EPYC 7763)
- https://www.inferless.com/learn/comparing-different-text-to-speech---tts--models-part-2 — 12-model TTS comparison 2025
- https://ocdevel.com/blog/20250720-tts — open-source TTS quality comparison vs ElevenLabs (Jul 2025)
- https://www.resemble.ai/learn/models/chatterbox — Chatterbox description, blind test results
- https://texttolab.com/blog/kokoro-tts-review — Kokoro #1 TTS Arena detail
- https://www.marktechpost.com/2025/04/22/open-source-tts-reaches-new-heights-nari-labs-releases-dia-a-1-6b-parameter-model — Dia release

## Update Log
(None yet.)
