# WebGPU Kokoro spike — how to run (2 min)

**Goal:** prove Kokoro runs with **WebGPU inside an MV3 offscreen document** on this Mac,
and see its real-time factor vs the Docker baseline (~4.3–4.9× CPU/ONNX). This is the
go/no-go gate for building a browser engine. Throwaway — not wired into `extension/`.

## Load it
1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top-right) on.
3. **Load unpacked** → select this folder: `webgpu-spike/`
4. Click the extension's toolbar icon → a **WebGPU Kokoro Spike** tab opens.

## Run it
- Click **Run WebGPU (fp32)**.
  - First run downloads ~82 MB of weights from HuggingFace (cached after; later runs are fast).
  - Watch the black log box. You want to see:
    - `navigator.gpu present: true — adapter: apple …`  ← WebGPU is alive in the offscreen doc
    - `short: …× real-time`, `long: …× real-time`
    - a green **PASS** banner + a short audio clip you can play.
- Then click **Run WASM fallback (q8)** to get the CPU-in-browser number for comparison.

## What to report back
- The **PASS/FAIL** banner text (it includes the long-paragraph RTF vs Docker).
- Whether the adapter line showed an **Apple** GPU (real WebGPU) or said *no adapter / undefined*.
- Whether the audio clip **sounds correct**.
- WASM number, for the floor.

If it stalls or errors: right-click the page → Inspect, and also check the offscreen doc's
console via `chrome://extensions` → the spike → **Inspect views: offscreen.html**. Paste the error.

## Sanity check (optional, before loading)
Confirm the browser itself reports WebGPU enabled: open `chrome://gpu` and search for
"WebGPU" — should say *Hardware accelerated*.

## Build from a clean checkout
`node_modules/`, `vendor/`, and `offscreen-bundle.js` are gitignored (regenerable). From this dir:
```bash
# 1. deps
npm install

# 2. vendor the ORT WebGPU wasm locally (MV3 forbids remote script).
#    Also copy to root as a path-resolution hedge for the esbuild-inlined loader.
mkdir -p vendor/ort
cp node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm \
   node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs vendor/ort/
cp vendor/ort/ort-wasm-simd-threaded.jsep.* ./

# 3. bundle (kokoro-js + transformers + onnxruntime-web → one local ESM)
./node_modules/.bin/esbuild src/offscreen-entry.js --bundle --format=esm \
  --platform=browser --outfile=offscreen-bundle.js
```
Re-run step 3 alone after editing `src/`.
