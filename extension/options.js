// Audio Reader — settings page.

const DEFAULTS = { serverUrl: "http://localhost:8880", voice: "af_heart", speed: 1.0 };

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

async function init() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  $("serverUrl").value = cfg.serverUrl;
  $("speed").value = String(cfg.speed);
  await loadVoices(cfg.voice);
}

$("reload").addEventListener("click", () => loadVoices($("voice").value));

$("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    serverUrl: base() || DEFAULTS.serverUrl,
    voice: $("voice").value || DEFAULTS.voice,
    speed: Number($("speed").value) || 1.0
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
});

init();
