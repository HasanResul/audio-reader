---
status: complete
created: 260618
updated: 260618
---

# WebGPU Kokoro in MV3 offscreen document — feasibility + perf gate

## Hypothesis
Kokoro (kokoro-js) runs with WebGPU **inside a Chrome MV3 offscreen document** on this Mac (M4 Pro)
and reaches paragraph-scale real-time factor ≥ the Docker CPU/ONNX baseline (4.3–4.9× RT).

## Decision Unlocked
- **Pass** (WebGPU runs in offscreen AND ≥ Docker RT): build a dual-engine architecture in the real
  extension (`engines/server/` + `engines/browser/`), browser as default per prior decision.
- **Fail** (no WebGPU in offscreen, or only WASM at <Docker RT): browser mode becomes the "portable but
  slow" option, not the headline; revisit browser-default positioning.
- **Marginal:** keep Docker primary, browser as experimental opt-in.

## Setup
- Hardware: M4 Pro / 24 GB / macOS 15.7.7. Chrome (stable), WebGPU → Metal.
- Harness: throwaway unpacked extension formerly at repo-root `webgpu-spike/` (**retired 260618** once the
  real engine shipped into `extension/` — its proven patterns now live in `extension/src/browser-engine-entry.js`).
  - MV3: background SW → offscreen document hosts inference (SW can't use WebGPU / dynamic import).
  - kokoro-js 1.2.1 + @huggingface/transformers v3 + onnxruntime-web, **bundled locally** with esbuild
    (`platform=browser`); MV3 forbids remote script.
  - ORT WebGPU wasm vendored to `webgpu-spike/vendor/ort/` (+ duplicated at root as a resolution hedge);
    `env.backends.onnx.wasm.wasmPaths` redirected to extension URL; `numThreads=1` (no SAB/COOP-COEP).
  - Model `onnx-community/Kokoro-82M-v1.0-ONNX` fetched from HF hub at runtime, browser-cached.
  - Voice `af_heart`. Texts: SHORT (~3.9s audio), LONG (~26.5s audio). RTF = audio_dur / gen_time.
- Baseline: Docker `ghcr.io/remsky/kokoro-fastapi-cpu` measured 4.3–4.9× RT (CPU-only; Apple Silicon
  Docker has no GPU passthrough). See `local/kokoro/logs/benchmark_*.log`.

## Variables
- Held constant: model, voice, texts, hardware, offscreen-document host.
- Varied: device/dtype — `webgpu`+fp32 vs `wasm`+q8 (the recommended dtype per device).

## Rubric
Automated, in-harness:
1. **Gate (binary):** `navigator.gpu` present in offscreen AND a real GPU adapter granted.
2. **Perf:** long-paragraph RTF vs Docker 4.6× midpoint. Pass ≥ 4.6×.
3. **Correctness:** generated clip sounds like intelligible `af_heart` speech (human ear).

## Runs
- `webgpu-fp32` — primary.
- `wasm-q8` — fallback floor for non-WebGPU machines.
Raw numbers in `results/260618_run.md`.

## References
- `docs/research/chrome-ext-webgpu/260618_kokoro-webgpu-mv3-extension.md` — feasibility research.
- `webgpu-spike/` — harness (throwaway).
- `local/kokoro/` — Docker baseline runbook + benchmark logs.
