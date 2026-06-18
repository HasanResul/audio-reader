// Audio Reader — toolbar popup. Shows the selected engine + its live status,
// and a link to settings.

const DEFAULTS = { serverUrl: "http://localhost:8880", engine: "auto" };

const NAMES = {
  auto: "Automatic",
  webgpu: "Browser · WebGPU",
  server: "Docker server",
  wasm: "Browser · WASM"
};

document.getElementById("open").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

async function webgpuAvailable() {
  if (!("gpu" in navigator) || !navigator.gpu) return false;
  try { return !!(await navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

async function serverHealthy(base) {
  try { return (await fetch(base + "/health")).ok; } catch (e) { return false; }
}

(async () => {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  const base = cfg.serverUrl.replace(/\/+$/, "");
  const dot = document.getElementById("dot");
  const text = document.getElementById("statusText");
  const name = NAMES[cfg.engine] || NAMES.auto;

  const set = (cls, msg) => { dot.classList.add(cls); text.textContent = msg; };

  if (cfg.engine === "webgpu") {
    return (await webgpuAvailable())
      ? set("up", name + " — ready")
      : set("down", name + " — no WebGPU adapter");
  }
  if (cfg.engine === "wasm") {
    return set("warn", name + " — ready (slow)");
  }
  if (cfg.engine === "server") {
    return (await serverHealthy(base))
      ? set("up", name + " — running")
      : set("down", name + " — not reachable");
  }

  // Automatic: report whichever engine would actually run (WebGPU → server → WASM).
  if (await webgpuAvailable()) return set("up", "Automatic — WebGPU ready");
  if (await serverHealthy(base)) return set("up", "Automatic — server ready");
  set("warn", "Automatic — WASM only (slow)");
})();
