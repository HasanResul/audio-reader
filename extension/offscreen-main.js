// Audio Reader — offscreen entry point.
//
// Hosts the shared player and dispatches synthesis to the selected engine. The
// offscreen document is the only context that can both reach localhost (page CSP
// can't block it) and run audio playback + WebGPU, so all engines live here
// behind a single boundary.
//
// The Docker server engine is small and always loaded. The browser engine is a
// ~5MB bundle (kokoro-js + onnxruntime-web + MP3 encoder), so it's dynamically
// imported only when a browser engine is actually selected.

import { createPlayer } from "./player.js";
import { serverEngine } from "./engines/server-engine.js";

const player = createPlayer();

let browserEnginePromise = null;
function getBrowserEngine() {
  if (!browserEnginePromise) {
    browserEnginePromise = import(chrome.runtime.getURL("engines/browser-engine.bundle.js"))
      .then((m) => m.browserEngine);
  }
  return browserEnginePromise;
}

let webgpuCached = null;
async function hasWebGPUAdapter() {
  if (webgpuCached !== null) return webgpuCached;
  if (!("gpu" in navigator) || !navigator.gpu) return (webgpuCached = false);
  try { webgpuCached = !!(await navigator.gpu.requestAdapter()); }
  catch (e) { webgpuCached = false; }
  return webgpuCached;
}

async function serverHealthy(serverUrl) {
  const base = (serverUrl || "").replace(/\/+$/, "");
  try { const r = await fetch(base + "/health"); return r.ok; } catch (e) { return false; }
}

// Resolve "auto" to a concrete engine using live capability, preferring the
// fastest available: WebGPU → Docker server → WASM floor. Explicit picks pass
// through unchanged (their availability is enforced by the picker, and a dead
// explicit engine surfaces an error at synthesis rather than silently switching).
async function resolveEngine(msg) {
  const id = msg.engine || "auto";
  if (id !== "auto") return id;
  if (await hasWebGPUAdapter()) return "webgpu";
  if (await serverHealthy(msg.serverUrl)) return "server";
  return "wasm";
}

async function start(msg) {
  player.stop();
  const id = await resolveEngine(msg);
  if (id === "server") {
    player.setStateExtra({ engine: "server" });
    await serverEngine.synthesize(msg, player);
  } else {
    const engine = await getBrowserEngine();
    await engine.synthesize({ ...msg, engine: id }, player);
  }
}

async function warmup(msg) {
  const id = await resolveEngine(msg);
  if (id === "server") return;  // nothing to warm for the server path
  const engine = await getBrowserEngine();
  await engine.warmup({ engine: id });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "OFFSCREEN_START") start(msg);
  else if (msg.type === "OFFSCREEN_CONTROL") player.control(msg.action, msg.value);
  else if (msg.type === "OFFSCREEN_WARMUP") warmup(msg);
});
