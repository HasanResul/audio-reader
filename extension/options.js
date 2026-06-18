// Audio Reader — settings page.

const DEFAULTS = { serverUrl: "http://localhost:8880", voice: "af_heart", speed: 1.0, engine: "auto" };

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind || "";
}

function base() {
  return ($("serverUrl").value || "").trim().replace(/\/+$/, "");
}

async function loadVoices(selected) {
  const sel = $("voice");
  const hint = $("voiceHint");
  sel.innerHTML = "";
  try {
    const resp = await fetch(base() + "/v1/audio/voices");
    const data = await resp.json();
    const raw = data.voices || data;
    const ids = raw.map((v) => (typeof v === "string" ? v : v.id || v.name)).filter(Boolean).sort();
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      sel.appendChild(opt);
    }
    if (selected && ids.includes(selected)) sel.value = selected;
    else if (ids.includes(DEFAULTS.voice)) sel.value = DEFAULTS.voice;
    hint.textContent = ids.length + " voices loaded from the server.";
  } catch (e) {
    // Server unreachable — keep whatever is saved so the user isn't stuck.
    const opt = document.createElement("option");
    opt.value = selected || DEFAULTS.voice;
    opt.textContent = (selected || DEFAULTS.voice) + " (server unreachable)";
    sel.appendChild(opt);
    hint.textContent = "Couldn't reach the server to list voices. Start it, then Reload voices.";
  }
}

// --- Engine picker: live availability gates which engines are selectable ---

function radio(value) {
  return document.querySelector(`input[name="engine"][value="${value}"]`);
}

function setEngineAvailable(value, available, detail, warn) {
  const opt = document.getElementById("opt-" + value);
  const input = radio(value);
  input.disabled = !available;
  opt.classList.toggle("disabled", !available);
  const d = document.getElementById("d-" + value);
  if (d && detail != null) {
    d.textContent = detail;
    d.classList.toggle("warn", !!warn);
  }
}

async function webgpuAvailable() {
  if (!("gpu" in navigator) || !navigator.gpu) return false;
  try { return !!(await navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

async function checkWebGPU() {
  const ok = await webgpuAvailable();
  setEngineAvailable("webgpu", ok,
    ok ? "Fastest. Runs Kokoro on your GPU." : "No WebGPU adapter in this browser.", !ok);
  return ok;
}

async function checkServer() {
  let ok = false;
  try { ok = (await fetch(base() + "/health")).ok; } catch (e) { ok = false; }
  setEngineAvailable("server", ok,
    ok ? "Local Kokoro server is reachable." : "⚠️ Server unreachable — start the container.", !ok);
  // If the server was the selected engine and just went away, fall back to Automatic.
  if (!ok && radio("server").checked) radio("auto").checked = true;
  return ok;
}

async function detectEngines() {
  await Promise.all([checkWebGPU(), checkServer()]);  // WASM is always selectable
}

async function init() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $("serverUrl").value = cfg.serverUrl;
  $("speed").value = String(cfg.speed);

  // Select the saved engine up front; detectEngines() demotes it to Automatic
  // if it turns out to be unavailable right now.
  const saved = radio(cfg.engine) || radio("auto");
  saved.checked = true;
  await detectEngines();
  if (radio(cfg.engine) && radio(cfg.engine).disabled) radio("auto").checked = true;

  await loadVoices(cfg.voice);
}

// Re-check server reachability whenever the URL changes.
$("serverUrl").addEventListener("change", checkServer);

$("reload").addEventListener("click", () => loadVoices($("voice").value));

$("save").addEventListener("click", async () => {
  const engine = (document.querySelector('input[name="engine"]:checked') || {}).value || "auto";
  await chrome.storage.sync.set({
    serverUrl: base() || DEFAULTS.serverUrl,
    voice: $("voice").value || DEFAULTS.voice,
    speed: Number($("speed").value) || 1.0,
    engine
  });
  setStatus("Saved.", "ok");
  setTimeout(() => setStatus(""), 1500);
});

$("test").addEventListener("click", async () => {
  setStatus("Testing…");
  try {
    const resp = await fetch(base() + "/health");
    setStatus(resp.ok ? "Server is up ✓" : "Server responded " + resp.status, resp.ok ? "ok" : "err");
  } catch (e) {
    setStatus("Can't reach server. Is Docker / the container running?", "err");
  }
  checkServer();  // refresh the Docker engine option's availability
});

init();
