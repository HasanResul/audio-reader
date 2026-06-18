// Audio Reader — in-browser Kokoro engine (bundled).
//
// Runs Kokoro TTS entirely in the offscreen document via onnxruntime-web
// (WebGPU preferred, WASM fallback). Bundled to engines/browser-engine.bundle.js
// by build.mjs because MV3 forbids remote script; only the model weights fetch at
// runtime from the HF hub.
//
// To keep the same progressive, growing-duration timeline as the Docker engine,
// this engine does NOT assemble the whole article before playing. It generates
// sentence-by-sentence via tts.stream(), MP3-encodes each segment on the fly
// (kokoro emits 24kHz PCM; MediaSource plays MP3), and pushes the chunks into the
// shared player's existing MediaSource pipeline. Playback starts on the first
// sentence; the rest stream in behind it. On the slow WASM path generation falls
// behind real-time, so playback simply buffers between sentences — it never
// freezes the thread for the whole job (stream() yields between sentences) and
// the offscreen document has no visible UI to lock up.

import { KokoroTTS, TextSplitterStream } from "kokoro-js";
import { env } from "@huggingface/transformers";
import { Mp3Encoder } from "@breezystack/lamejs";

// ORT loads its WASM from inside the extension, not a CDN (MV3 blocks remote
// code). Single-threaded so we need no SharedArrayBuffer / COOP-COEP. Weights are
// fetched from HF and cached in the browser for subsequent runs.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
env.backends.onnx.wasm.numThreads = 1;
env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const OUTPUT_RATE = 48000;   // upsample target — MediaSource MP3 is rock-solid here
const MP3_KBPS = 128;
const DEFAULT_VOICE = "af_heart";

// Map an engine id to the kokoro device/dtype and the indicator glyph key.
function profileFor(engineId) {
  return engineId === "wasm"
    ? { device: "wasm", dtype: "q8", indicator: "cpu" }
    : { device: "webgpu", dtype: "fp32", indicator: "gpu" };
}

// --- Run lifecycle -----------------------------------------------------------
//
// Each synthesize()/warmup() call owns a private `run` object. Superseding a run
// flips its own `cancelled` flag; a stream's cancel() flips the same flag. Because
// the flag is per-run (never a shared counter), cancelling an old run can never
// invalidate a newer one — the bug that previously cut playback off after the
// first sentence.
let currentRun = null;

function beginRun() {
  if (currentRun) currentRun.cancelled = true;
  currentRun = { cancelled: false };
  return currentRun;
}

// --- Model cache (keep-resident so 2nd+ reads skip load + shader compile) ----

let loaded = { key: null, tts: null };
let loading = null;  // { key, promise } — dedup concurrent loads (warmup + read)

async function getModel({ device, dtype }, onProgress) {
  const key = device + ":" + dtype;
  if (loaded.key === key && loaded.tts) return loaded.tts;
  if (loading && loading.key === key) return loading.promise;
  const promise = KokoroTTS.from_pretrained(MODEL_ID, { dtype, device, progress_callback: onProgress })
    .then((tts) => { loaded = { key, tts }; loading = null; return tts; })
    .catch((e) => { loading = null; throw e; });
  loading = { key, promise };
  return promise;
}

function modelReady(device, dtype) {
  return loaded.key === device + ":" + dtype && !!loaded.tts;
}

function resolveVoice(tts, voice) {
  try {
    if (voice && tts.voices && voice in tts.voices) return voice;
  } catch (e) {}
  return DEFAULT_VOICE;
}

// Cache the WebGPU probe — availability doesn't change within a session, and
// hammering requestAdapter() on every read is wasteful and can be flaky.
let webgpuCached = null;
async function hasWebGPUAdapter() {
  if (webgpuCached !== null) return webgpuCached;
  if (!("gpu" in navigator) || !navigator.gpu) return (webgpuCached = false);
  try { webgpuCached = !!(await navigator.gpu.requestAdapter()); }
  catch (e) { webgpuCached = false; }
  return webgpuCached;
}

// --- PCM → MP3 helpers -------------------------------------------------------

// Linear-resample mono Float32 from `srIn` to OUTPUT_RATE. Speech has no content
// above ~12kHz, so 24kHz→48kHz is lossless in practice; it just lets us emit
// MPEG-1 MP3, which every Chrome MediaSource decodes cleanly.
function resample(float32, srIn) {
  if (srIn === OUTPUT_RATE) return float32;
  const ratio = OUTPUT_RATE / srIn;
  const outLen = Math.round(float32.length * ratio);
  const out = new Float32Array(outLen);
  const last = float32.length - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = i0 < last ? i0 + 1 : last;
    const frac = pos - i0;
    out[i] = float32[i0] * (1 - frac) + float32[i1] * frac;
  }
  return out;
}

function toInt16(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = float32[i];
    if (s > 1) s = 1; else if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function asUint8(int8OrBuf) {
  // lamejs returns Int8Array; MediaSource.appendBuffer wants a Uint8Array view.
  return new Uint8Array(int8OrBuf.buffer, int8OrBuf.byteOffset, int8OrBuf.byteLength);
}

// Build a ReadableStream of MP3 bytes from kokoro's sentence generator. One
// encoder instance spans all sentences so the output is a single continuous MP3
// stream (not concatenated per-sentence files). Backpressure-driven: each pull
// advances generation by one sentence, so memory stays bounded and a slow WASM
// run doesn't race ahead.
function mp3Stream(generator, run) {
  const enc = new Mp3Encoder(1, OUTPUT_RATE, MP3_KBPS);
  return new ReadableStream({
    async pull(controller) {
      if (run.cancelled) { controller.close(); return; }
      try {
        while (true) {
          const { value, done } = await generator.next();
          if (run.cancelled) { controller.close(); return; }
          if (done) {
            const tail = enc.flush();
            if (tail.length) controller.enqueue(asUint8(tail));
            controller.close();
            return;
          }
          const pcm = resample(value.audio.audio, value.audio.sampling_rate);
          const mp3 = enc.encodeBuffer(toInt16(pcm));
          if (mp3.length) { controller.enqueue(asUint8(mp3)); return; }
          // No full MP3 frame from this sentence yet — pull the next one.
        }
      } catch (e) {
        if (!run.cancelled) controller.error(e);
        else { try { controller.close(); } catch (_) {} }
      }
    },
    cancel() {
      run.cancelled = true;
      try { generator.return?.(); } catch (e) {}
    }
  });
}

// --- Engine API --------------------------------------------------------------

export const browserEngine = {
  id: "browser",

  async synthesize(msg, player) {
    const run = beginRun();
    const text = (msg.text || "").trim();
    const { device, dtype, indicator } = profileFor(msg.engine);

    player.setStateExtra({ engine: indicator });

    if (device === "webgpu" && !(await hasWebGPUAdapter())) {
      player.report({ error: "WebGPU isn't available in this browser. Pick another engine in settings." });
      return;
    }

    let tts;
    try {
      if (!modelReady(device, dtype)) player.report({ status: "Loading the voice model…", engine: indicator });
      tts = await getModel({ device, dtype }, (p) => {
        if (run.cancelled) return;
        if (p && p.status === "progress" && p.total) {
          const pct = Math.max(0, Math.min(100, Math.round((p.loaded / p.total) * 100)));
          player.report({ status: `Loading voice model… ${pct}%`, engine: indicator });
        }
      });
    } catch (e) {
      if (!run.cancelled) player.report({ error: "Couldn't load the in-browser model: " + (e?.message || e) });
      return;
    }
    if (run.cancelled) return;

    player.report({ status: "Synthesizing…", engine: indicator });
    const voice = resolveVoice(tts, msg.voice);

    // kokoro's stream(string) wraps the text in a TextSplitterStream it never
    // closes, so the final sentence is never flushed and the generator hangs
    // after the last *complete* sentence. Drive the splitter ourselves and close
    // it: push the whole text, close → the final sentence flushes and the
    // generator terminates cleanly. Generation stays per-sentence/progressive.
    const splitter = new TextSplitterStream();
    const generator = tts.stream(splitter, { voice });
    splitter.push(text);
    splitter.close();

    await player.playMpegStream(mp3Stream(generator, run), { speed: msg.speed });
  },

  // Load the model (and compile WebGPU shaders) ahead of the first real request
  // so the user doesn't eat the ~2.7s cold-shader penalty. Safe to call repeatedly.
  async warmup(msg) {
    const run = beginRun();
    const { device, dtype } = profileFor(msg.engine);
    if (device === "webgpu" && !(await hasWebGPUAdapter())) return;
    try {
      const tts = await getModel({ device, dtype });
      if (run.cancelled) return;
      // A tiny one-shot generate compiles the WebGPU shaders; discard the audio.
      await tts.generate("Ready.", { voice: DEFAULT_VOICE });
    } catch (e) { /* warmup is best-effort */ }
  }
};
