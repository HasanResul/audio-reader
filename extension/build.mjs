// Build the in-browser Kokoro engine bundle.
//
// MV3 forbids remote script, so kokoro-js + @huggingface/transformers +
// onnxruntime-web + the MP3 encoder are bundled into a single local ESM file,
// and ONNX Runtime's WebGPU wasm is vendored next to it. Only the model weights
// fetch at runtime (from the HF hub). Run: `npm install && npm run build`.

import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

// 1. Vendor the ORT WebGPU wasm + loader locally (so ort.env.wasm.wasmPaths can
//    point at chrome.runtime.getURL("vendor/ort/") instead of a CDN).
const ORT_SRC = "node_modules/@huggingface/transformers/dist";
const ORT_FILES = [
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs"
];
mkdirSync("vendor/ort", { recursive: true });
for (const f of ORT_FILES) copyFileSync(`${ORT_SRC}/${f}`, `vendor/ort/${f}`);
console.log("vendored ORT wasm →", "vendor/ort/");

// 2. Bundle the browser engine into one local ESM module, dynamically imported
//    by the offscreen document only when a browser engine is selected.
mkdirSync("engines", { recursive: true });
await build({
  entryPoints: ["src/browser-engine-entry.js"],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "engines/browser-engine.bundle.js",
  minify: true,
  legalComments: "none"
});
console.log("built →", "engines/browser-engine.bundle.js");
