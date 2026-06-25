// Built-in Kokoro voice catalog.
//
// These are the voices baked into the in-browser engine (kokoro-js ^1.2.1, the
// Kokoro-82M model). They're a fixed set, so the voice picker can offer them
// without a server: the WebGPU/WASM engines never talk to the Docker server, and
// the server runs the same model, so this is the correct list for every engine.
// Server-reported voices (e.g. custom additions) are merged on top when reachable.
//
// To refresh after a kokoro-js bump:
//   node -e 'const fs=require("fs");const s=fs.readFileSync("node_modules/kokoro-js/dist/kokoro.js","utf8");console.log(JSON.stringify([...new Set([...s.matchAll(/([a-z]{2}_[a-z]+):\{name:"/g)].map(m=>m[1]))]))'
const KOKORO_VOICES = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
  "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael",
  "am_onyx", "am_puck", "am_santa",
  "bf_emma", "bf_isabella", "bf_alice", "bf_lily",
  "bm_george", "bm_lewis", "bm_daniel", "bm_fable"
];

// Merge the built-in catalog with any server-reported voices, de-duped and sorted.
// Always returns a non-empty list so the picker never collapses to one voice.
function mergeVoices(serverVoices) {
  const set = new Set(KOKORO_VOICES);
  for (const v of serverVoices || []) if (v) set.add(v);
  return [...set].sort();
}

// Usable from the service worker (importScripts) and options page (script tag).
if (typeof globalThis !== "undefined") {
  globalThis.KOKORO_VOICES = KOKORO_VOICES;
  globalThis.mergeVoices = mergeVoices;
}
