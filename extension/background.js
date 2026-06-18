// Audio Reader — service worker.
// Orchestrates: trigger (shortcut / context menu) -> grab selection -> start an
// offscreen audio session -> relay control/state messages between the in-page
// control bar (content script) and the offscreen player.

const DEFAULTS = { serverUrl: "http://localhost:8880", voice: "af_heart", speed: 1.0, engine: "auto" };

// The single active reading session, or null. { tabId }
let session = null;

async function getConfig() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

// Voice list, cached per server URL. Fetched from the extension context so the
// page's CSP can't block it.
let voicesCache = { url: null, list: [] };

async function getVoices(base) {
  if (voicesCache.url === base && voicesCache.list.length) return voicesCache.list;
  try {
    const resp = await fetch(base + "/v1/audio/voices");
    const data = await resp.json();
    const raw = data.voices || data;
    const list = raw
      .map((v) => (typeof v === "string" ? v : v.id || v.name))
      .filter(Boolean)
      .sort();
    voicesCache = { url: base, list };
    return list;
  } catch {
    return [];
  }
}

// --- Offscreen document (the actual audio player) -------------------------

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Stream and play text-to-speech audio from the local TTS server."
  });
}

function toOffscreen(msg) {
  chrome.runtime.sendMessage({ target: "offscreen", ...msg }).catch(() => {});
}

// --- Toolbar badge: which engine is actually generating audio --------------

const BADGE = {
  gpu:    { text: "GPU", color: "#1a8917" },
  cpu:    { text: "CPU", color: "#c77700" },
  server: { text: "SRV", color: "#0a84ff" }
};

function setEngineBadge(engine) {
  const b = BADGE[engine];
  if (!b) return;
  chrome.action.setBadgeText({ text: b.text });
  chrome.action.setBadgeBackgroundColor({ color: b.color });
}

function clearEngineBadge() {
  chrome.action.setBadgeText({ text: "" });
}

// Warm a browser engine ahead of the first request so the user doesn't eat the
// model load + ~2.7s cold-shader penalty. Only for an *explicit* browser pick —
// "auto" stays lazy so we never trigger a ~300MB download the user didn't choose.
async function warmEngineIfBrowser(engine) {
  if (engine !== "webgpu" && engine !== "wasm") return;
  const cfg = await getConfig();
  await ensureOffscreen();
  toOffscreen({ type: "OFFSCREEN_WARMUP", engine, serverUrl: cfg.serverUrl });
}

// --- Tab messaging helpers ------------------------------------------------

function toTab(tabId, msg) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

async function getSelectionFromTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection().toString()
    });
    return result || "";
  } catch {
    return "";
  }
}

async function extractArticleFromTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof extractArticle === "undefined") return null;
        return extractArticle();
      }
    });
    return result;
  } catch {
    return null;
  }
}

// --- Session lifecycle ----------------------------------------------------

async function startReading(tabId, rawText) {
  const text = (rawText || "").trim();
  if (!text) {
    toTab(tabId, { type: "TOAST", message: "Select some text first, then trigger Audio Reader." });
    return;
  }
  const cfg = await getConfig();
  const base = cfg.serverUrl.replace(/\/+$/, "");
  await ensureOffscreen();

  // If a previous session was running in a different tab, hide its bar.
  if (session && session.tabId !== tabId) toTab(session.tabId, { type: "HIDE_PLAYER" });
  session = { tabId };

  const voices = await getVoices(base);
  toTab(tabId, { type: "SHOW_PLAYER", voices, voice: cfg.voice, speed: cfg.speed });
  toOffscreen({
    type: "OFFSCREEN_START",
    text,
    engine: cfg.engine,
    serverUrl: cfg.serverUrl,
    voice: cfg.voice,
    speed: cfg.speed
  });
}

function stopSession({ hideBar = true } = {}) {
  toOffscreen({ type: "OFFSCREEN_CONTROL", action: "stop" });
  if (session && hideBar) toTab(session.tabId, { type: "HIDE_PLAYER" });
  session = null;
  clearEngineBadge();
}

// Extract the page's main article and read it; fall back to a manual-selection
// hint when extraction yields nothing usable. Shared by both article triggers.
async function readArticle(tabId) {
  const result = await extractArticleFromTab(tabId);
  if (result && result.success) {
    startReading(tabId, result.text);
  } else {
    toTab(tabId, {
      type: "TOAST",
      message: "Could not extract article. Use Cmd+Shift+S to read selected text instead."
    });
  }
}

// --- Triggers -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "read-selection",
      title: "Read selection aloud",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "read-article",
      title: "Read this article",
      contexts: ["page"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === "read-selection") {
    startReading(tab.id, info.selectionText);
  } else if (info.menuItemId === "read-article") {
    readArticle(tab.id);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === "read-selection") {
    const text = await getSelectionFromTab(tab.id);
    startReading(tab.id, text);
  } else if (command === "read-article") {
    readArticle(tab.id);
  }
});

// --- Message routing ------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  // State updates coming back from the offscreen player.
  if (msg.type === "OFFSCREEN_STATE") {
    if (session) {
      toTab(session.tabId, { type: "STATE", state: msg.state });
      if (msg.state.ended) clearEngineBadge();
      else if (msg.state.engine) setEngineBadge(msg.state.engine);
    }
    return;
  }

  if (!sender.tab) return;

  // Control commands coming from the in-page bar (content script).
  if (msg.type === "CONTROL") {
    if (msg.action === "stop") {
      stopSession();
      // The bar can be visible without an active session (e.g. it's only showing
      // the "select some text first" toast, which never sets `session`).
      // stopSession() won't hide it in that case, so hide the requesting tab's
      // bar directly — the close button must always work.
      toTab(sender.tab.id, { type: "HIDE_PLAYER" });
    } else {
      toOffscreen({ type: "OFFSCREEN_CONTROL", action: msg.action, value: msg.value });
      // Persist speed so the next reading starts at the last-used speed.
      if (msg.action === "speed") chrome.storage.sync.set({ speed: msg.value });
    }
    return;
  }

  // Voice picked from the bar — persist for the next reading.
  if (msg.type === "SET_VOICE") {
    chrome.storage.sync.set({ voice: msg.voice });
  }
});

// --- Idle warmup: prime an explicitly-selected browser engine -------------

chrome.runtime.onStartup.addListener(async () => {
  const cfg = await getConfig();
  warmEngineIfBrowser(cfg.engine);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.engine) warmEngineIfBrowser(changes.engine.newValue);
});

// --- Cleanup: stop when the originating tab navigates or closes -----------

chrome.tabs.onRemoved.addListener((tabId) => {
  if (session && session.tabId === tabId) stopSession({ hideBar: false });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A reload or navigation in the session tab tears down the page + its bar, so
  // stop the audio too. `status === "loading"` fires for both reload and
  // navigation and (unlike `changeInfo.url`) is delivered without the "tabs"
  // permission. The session only starts on an already-loaded page, so the next
  // "loading" on that tab always means the page is going away.
  if (session && session.tabId === tabId && changeInfo.status === "loading") {
    stopSession({ hideBar: false });
  }
});
