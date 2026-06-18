---
status: complete
date: 260618
query: WebGPU in MV3 offscreen documents, kokoro-js API, CSP/manifest requirements, and onnxruntime-web offscreen gotchas for Kokoro TTS Chrome extension
---

# Kokoro TTS + WebGPU in Chrome MV3 Extension

## WebGPU IS Available in Offscreen Documents — Confirmed

`navigator.gpu` is functional inside a Chrome MV3 **offscreen document**. Multiple independent sources confirm the pattern: background service worker creates `offscreen.html`, which loads `offscreen.js` where WebGPU is accessible; the two sides exchange messages. This is the canonical pattern for ML inference in MV3 extensions.

Service workers do NOT expose `navigator.gpu` (or didn't until Chrome 124, and even after 124 the dynamic `import()` restriction in service workers breaks onnxruntime-web's module loading). The offscreen document avoids both problems — it is a full DOM document.

**Popup and options pages** (normal extension pages) also have `navigator.gpu`. They are valid fallback hosts for WebGPU. The offscreen document is preferred for background/daemon-style inference because it has no UI lifecycle and can be kept alive.

**Required permission:** `"offscreen"` in `manifest.json`. Required reason in `chrome.offscreen.createDocument()`: typically `"AUDIO_PLAYBACK"` or `"BLOBS"` (pick whichever fits).

Sources confirming this pattern (2024–2025): the Transformers.js official Chrome extension blog post, Wei Lu's Medium article on Transformers.js + ONNX Runtime WebGPU in Chrome extension, and the transformers.js-chrome GitHub repo.

### Known Chromium bug on adapter acquisition

On some hardware/driver combinations, `navigator.gpu.requestAdapter()` returns null even when `chrome://gpu` reports WebGPU as hardware-accelerated. This is a general WebGPU hardware issue unrelated to extensions. Always guard with a WASM fallback.

### Android WebGPU + Kokoro corrupted audio

Kokoro with `device: "webgpu"` on Android Chrome produces corrupted audio (issue #1320, transformers.js repo). Workaround: fall back to `device: "wasm"` + `dtype: "q8"`. This is mobile-only; desktop Chrome is unaffected. The issue was closed with PR #1382 (fix merged, but confirm version).

## kokoro-js Minimal API

**Install:** `npm install kokoro-js`

**Model repo:** `onnx-community/Kokoro-82M-v1.0-ONNX` (HuggingFace). Fetched from HuggingFace CDN at runtime by default. The v1.0 repo is the current target; the older `onnx-community/Kokoro-82M-ONNX` (no version suffix) is the v0.19 variant.

### dtype options and sizes

| dtype | Notes |
|-------|-------|
| `"fp32"` | Full precision. ~326 MB. **Recommended for WebGPU** per official docs. |
| `"fp16"` | Half precision. ~163 MB. Fewer GPU ops support it — may degrade quality. |
| `"q8"` | 8-bit quantization. ~86 MB. Recommended for WASM path. Quality indistinguishable from fp32 in listening tests. |
| `"q4"` | 4-bit quantization. Smallest but lowest quality. |
| `"q4f16"` | 4-bit weights, fp16 activations. A middle ground. |

The `q8` variant at ~86 MB is described as "no noticeable difference in audio quality" vs fp32.

### Load + generate (minimal)

```js
import { KokoroTTS } from "kokoro-js";

// Load with WebGPU; fall back to WASM+q8 if WebGPU unavailable
const device = (await navigator.gpu?.requestAdapter()) ? "webgpu" : "wasm";
const dtype  = device === "webgpu" ? "fp32" : "q8";

const tts = await KokoroTTS.from_pretrained(
  "onnx-community/Kokoro-82M-v1.0-ONNX",
  { dtype, device }
);

// List voices: tts.list_voices()  — 28+ en-US, 8+ en-GB
const audio = await tts.generate("Hello, world.", { voice: "af_heart" });

// WAV file (Node/worker with fs access):
audio.save("output.wav");

// Raw Float32Array + sample rate (for Web Audio API):
const { audio: f32, sampling_rate } = audio;  // 24 kHz output
// Pass to AudioContext.createBuffer(1, f32.length, sampling_rate)

// WAV ArrayBuffer (for postMessage to service worker):
const wav = audio.toWav();  // returns ArrayBuffer
postMessage({ type: "AUDIO_DONE", wav }, [wav]);
```

### Streaming (lower latency)

```js
import { KokoroTTS, TextSplitterStream } from "kokoro-js";

const splitter = new TextSplitterStream();
const stream   = tts.stream(splitter);

splitter.push("Hello, world.");
splitter.close();

for await (const { text, phonemes, audio } of stream) {
  // audio is a chunk — same object, has .toWav() and .audio Float32Array
}
```

## CSP and Manifest Requirements

### content_security_policy

MV3 enforces a minimum CSP equivalent to `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"`. You must declare `wasm-unsafe-eval` explicitly if you want WASM; it is not on by default but is the only permitted dynamic-eval keyword in MV3 extension CSP (no `unsafe-eval`, no CDN script-src).

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
}
```

`worker-src` is needed if onnxruntime-web spawns internal web workers from the offscreen document (it does for the multi-threaded WASM backend).

### Permissions

```json
"permissions": ["offscreen", "storage"],
"host_permissions": ["https://huggingface.co/*", "https://cdn-lfs.huggingface.co/*", "https://cdn-lfs-us-1.huggingface.co/*"]
```

`host_permissions` are needed for the model weight fetch at runtime. HuggingFace LFS files are served from `cdn-lfs.huggingface.co` and regional variants (`cdn-lfs-us-1`, etc.). If you want to bundle models locally (avoids network dependency, required for Chrome Web Store if you can't accept remote fetch), omit `host_permissions` and set `env.backends.onnx.wasm.wasmPaths` + `env.remoteHost` to point at `chrome.runtime.getURL('models/')`.

### web_accessible_resources

Required if you bundle WASM helper files locally (onnxruntime-web `.wasm` binaries, `.jsep.mjs` shims):

```json
"web_accessible_resources": [{
  "resources": ["*.wasm", "*.mjs", "models/*"],
  "matches": ["<all_urls>"]
}]
```

### Critical CSP gotcha: @huggingface/transformers tries to dynamically import WASM shims from CDN

`@huggingface/transformers` v3.x (which kokoro-js depends on) attempts to dynamically load `ort-wasm-simd-threaded.jsep.mjs` from a CDN URL at runtime. This breaks under MV3 CSP. Fix: copy the onnxruntime-web WASM/mjs files into your bundle during build and point the runtime at them:

```js
import { env } from "@huggingface/transformers";
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/");
```

Then add all files from `node_modules/onnxruntime-web/dist/` into your bundle under `ort/` and list them in `web_accessible_resources`.

## Offscreen Document Gotchas: SharedArrayBuffer and WASM Threads

### The core issue

Multithreaded WASM (used by onnxruntime-web's WASM backend for parallelism) requires `SharedArrayBuffer`, which requires cross-origin isolation (`crossOriginIsolated === true`).

An offscreen document is a chrome-extension:// page. Chrome allows extensions to opt into cross-origin isolation via two manifest keys (introduced in Chrome 93):

```json
"cross_origin_embedder_policy": { "value": "require-corp" },
"cross_origin_opener_policy": { "value": "same-origin" }
```

With these keys, extension pages (including offscreen documents) can use `SharedArrayBuffer`. However, there is a known hard constraint: **service workers cannot become cross-origin-isolated**, even with these manifest keys. This means you cannot `postMessage` a `SharedArrayBuffer` from the offscreen document to the background service worker (the `postMessage` will fail or the SAB will be neutered).

### Practical consequence

If you use WebGPU path in the offscreen document, you do not need `SharedArrayBuffer` at all — WebGPU handles parallelism on GPU. This sidesteps the entire threading problem.

If you fall back to WASM with multithreading, you need cross-origin isolation AND you must keep the SAB inside the offscreen document (not transfer it to the service worker). Instead, transfer the final WAV `ArrayBuffer` via `postMessage` — regular `ArrayBuffer` is transferable without COI.

### Recommended: disable WASM threads, rely on WebGPU

Due to a known bug in onnxruntime-web where multithreading can cause hangs, and to avoid the COI/SAB complexity in extensions, the established community practice is:

```js
import { env } from "@huggingface/transformers";
env.backends.onnx.wasm.numThreads = 1;  // single-threaded WASM, no SAB needed
```

This eliminates the `SharedArrayBuffer` requirement entirely for the WASM fallback path. The WASM fallback will be slower but correct.

### Does WebGPU path need SAB?

No. `device: "webgpu"` inference in onnxruntime-web does not use `SharedArrayBuffer`. WebGPU manages memory in GPU address space. You do NOT need `cross_origin_embedder_policy` or `cross_origin_opener_policy` when running WebGPU-only.

## Full Manifest Skeleton

```json
{
  "manifest_version": 3,
  "name": "Kokoro TTS Reader",
  "version": "1.0",
  "background": { "service_worker": "background.js", "type": "module" },
  "permissions": ["offscreen", "storage", "activeTab"],
  "host_permissions": [
    "https://huggingface.co/*",
    "https://cdn-lfs.huggingface.co/*",
    "https://cdn-lfs-us-1.huggingface.co/*"
  ],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  },
  "web_accessible_resources": [{
    "resources": ["offscreen.html", "*.wasm", "*.mjs"],
    "matches": ["<all_urls>"]
  }]
}
```

If using cross-origin isolation for multithreaded WASM (optional; skip if WebGPU-only):
```json
"cross_origin_embedder_policy": { "value": "require-corp" },
"cross_origin_opener_policy": { "value": "same-origin" }
```

## Chrome Web Store Rejection Risk

Extensions that fetch remote model weights (HuggingFace CDN) may be flagged as "remotely hosted code" by the Web Store review. Issue #839 on the transformers.js repo documents this. Mitigation: bundle model files locally and set `env.remoteModelsPath` to a local path, but at ~86–326 MB this exceeds normal extension size limits. Likely requires self-hosting the extension or using the Chrome Enterprise channel. The Web Store has a 10 MB extension package limit; models must either be downloaded on first run (with appropriate user consent UI) or served from a same-origin hosted endpoint.

## Caveats

- The Android + WebGPU corrupted audio issue (#1320) is mobile-only; fix was merged in PR #1382 — confirm it's in the kokoro-js version you pin.
- The `cross_origin_embedder_policy` fix for SharedArrayBuffer applies to offscreen docs but NOT service workers — single-source from Chrome developer docs; Firefox behavior differs.
- `ort-wasm-simd-threaded.jsep.mjs` CDN fetch failure (issue #1248) is specific to `@huggingface/transformers` v3.x; the older `@xenova/transformers` v2.x does not have this problem, but is not updated.
- HuggingFace CDN subdomains (`cdn-lfs-us-1`, `cdn-lfs-eu-1`, etc.) may vary; listing `https://*.huggingface.co/*` broadly may be needed but wider host_permissions increases Web Store scrutiny.
- The beaufortfrancois WebGPU extension gist demonstrates WebGPU in a **service worker** with an offscreen canvas (not an offscreen document), which is a different code path — don't conflate.

## Sources

- https://medium.com/@GenerationAI/transformers-js-onnx-runtime-webgpu-in-chrome-extension-13b563933ca9 — confirmed WebGPU works in offscreen doc, architecture pattern (service worker + offscreen.html/js), ONNX WebGPU import pattern
- https://developer.chrome.com/docs/extensions/reference/api/offscreen — official offscreen API; confirms offscreen docs are real DOM documents
- https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3 — introduction of the API, use cases
- https://developer.chrome.com/docs/extensions/develop/concepts/cross-origin-isolation — COOP/COEP manifest keys for SharedArrayBuffer in extension pages
- https://github.com/huggingface/transformers.js/issues/1248 — CDN dynamic import failure in MV3 CSP; `@huggingface/transformers` v3.x breakage and wasmPaths fix
- https://github.com/huggingface/transformers.js/issues/1320 — Kokoro WebGPU corrupted audio on Android; WASM+q8 workaround
- https://github.com/microsoft/onnxruntime/discussions/23063 — WASM init challenges in MV3; `numThreads=1` workaround
- https://github.com/xenova/transformers.js/issues/787 — service worker + WebGPU/WASM backend failures; offscreen doc as solution
- https://github.com/hexgrad/kokoro/tree/main/kokoro.js — kokoro-js source; KokoroTTS API, dtype/device options, streaming
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX — model repo; fp32 file 326 MB, q8 ~86 MB
- https://www.npmjs.com/package/kokoro-js — npm readme; basic usage and from_pretrained API
- https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy — MV3 CSP rules; wasm-unsafe-eval is only eval-style keyword allowed
- https://github.com/xenova/transformers.js/issues/839 — Chrome Web Store rejection for remotely-hosted code
- https://dev.to/emojiiii/running-kokoro-82m-onnx-tts-model-in-the-browser-eeh — audio output format: Float32Array at 24 kHz, AudioContext playback pattern
- https://groups.google.com/a/chromium.org/g/chromium-extensions/c/RiZrVY1-Y5o — "Failed to send SharedArrayBuffer to Offscreen Document"; service worker COI limitation

## Update Log
(none)
