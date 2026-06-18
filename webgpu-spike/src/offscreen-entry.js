// WebGPU Kokoro spike — runs INSIDE the MV3 offscreen document.
// This is the whole point of the spike: prove navigator.gpu / WebGPU works in
// an offscreen document and that Kokoro inference produces audio there.
// Bundled to ../offscreen-bundle.js by build.mjs (MV3 forbids remote script).

import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";

// ORT must load its WASM from inside the extension, not jsDelivr (MV3 blocks
// remote code). Point it at the locally-vendored jsep build.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
env.backends.onnx.wasm.numThreads = 1; // single-thread: no SharedArrayBuffer / COOP-COEP needed
env.allowLocalModels = false;          // fetch the model from the HF hub
env.useBrowserCache = true;            // cache the 82MB weights for subsequent runs

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

const SHORT = "Hello from Kokoro, running entirely in your browser.";
const LONG =
  "Kokoro is an open-weight text to speech model with eighty two million parameters. " +
  "Despite its lightweight architecture, it delivers quality comparable to far larger models, " +
  "while running significantly faster. With Apache licensed weights, it can be deployed anywhere, " +
  "from production environments to personal projects, and it can even run one hundred percent " +
  "locally in your browser, powered by WebGPU and Transformers dot js.";

function log(msg) {
  chrome.runtime.sendMessage({ type: "SPIKE_LOG", msg }).catch(() => {});
}

// Probe the offscreen document's own WebGPU support — the gate question.
async function gpuInfo() {
  if (!("gpu" in navigator) || !navigator.gpu) return { available: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { available: true, adapter: null };
    let info = adapter.info || {};
    if (!adapter.info && adapter.requestAdapterInfo) info = await adapter.requestAdapterInfo();
    return {
      available: true,
      adapter: { vendor: info.vendor, architecture: info.architecture, description: info.description },
    };
  } catch (e) {
    return { available: true, error: String(e) };
  }
}

async function blobToDataURL(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return "data:audio/wav;base64," + btoa(binary);
}

let tts = null;

async function run({ device, dtype }) {
  try {
    const gpu = await gpuInfo();
    log(`context = offscreen document`);
    log(
      `navigator.gpu present: ${gpu.available}` +
        (gpu.adapter
          ? ` — adapter: ${[gpu.adapter.vendor, gpu.adapter.architecture, gpu.adapter.description]
              .filter(Boolean)
              .join(" ") || "(no info)"}`
          : gpu.available
            ? " (no adapter granted)"
            : "")
    );
    if (gpu.error) log(`navigator.gpu adapter error: ${gpu.error}`);

    if (device === "webgpu" && !gpu.available) {
      log("⚠️ WebGPU requested but navigator.gpu is undefined in the offscreen document — GATE FAILED.");
      chrome.runtime.sendMessage({ type: "SPIKE_RESULT", ok: false, reason: "no-webgpu-in-offscreen", gpu });
      return;
    }

    log(`loading ${MODEL_ID} (device=${device}, dtype=${dtype}) …`);
    const tLoad = performance.now();
    tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device });
    const loadMs = performance.now() - tLoad;
    log(`model ready in ${(loadMs / 1000).toFixed(1)}s`);

    const results = [];
    for (const [label, text] of [
      ["short", SHORT],
      ["long", LONG],
    ]) {
      const t0 = performance.now();
      const audio = await tts.generate(text, { voice: "af_heart" });
      const genMs = performance.now() - t0;
      const durSec = audio.audio.length / audio.sampling_rate;
      const rtf = durSec / (genMs / 1000);
      log(`${label}: ${durSec.toFixed(2)}s audio in ${(genMs / 1000).toFixed(2)}s → ${rtf.toFixed(2)}× real-time`);
      results.push({
        label,
        durSec,
        genMs,
        rtf,
        dataUrl: label === "short" ? await blobToDataURL(await audio.toBlob()) : null,
      });
    }

    chrome.runtime.sendMessage({ type: "SPIKE_RESULT", ok: true, device, dtype, loadMs, gpu, results });
  } catch (e) {
    log("❌ " + (e && e.stack ? e.stack : String(e)));
    chrome.runtime.sendMessage({ type: "SPIKE_RESULT", ok: false, reason: String(e) });
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.target === "offscreen" && msg.type === "SPIKE_RUN") run(msg);
});

log("offscreen entry ready");
