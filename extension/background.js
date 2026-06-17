// Audio Reader — service worker.
// Orchestrates: trigger (shortcut / context menu) -> grab selection -> start an
// offscreen audio session -> relay control/state messages between the in-page
// control bar (content script) and the offscreen player.

const DEFAULTS = { serverUrl: "http://localhost:8880", voice: "af_heart", speed: 1.0 };

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
    serverUrl: cfg.serverUrl,
    voice: cfg.voice,
    speed: cfg.speed
  });
}

function stopSession({ hideBar = true } = {}) {
  toOffscreen({ type: "OFFSCREEN_CONTROL", action: "stop" });
  if (session && hideBar) toTab(session.tabId, { type: "HIDE_PLAYER" });
  session = null;
}

// --- Triggers -------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "read-selection",
      title: "Read selection aloud",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "read-selection" && tab) {
    startReading(tab.id, info.selectionText);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "read-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const text = await getSelectionFromTab(tab.id);
  startReading(tab.id, text);
});

// --- Message routing ------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  // State updates coming back from the offscreen player.
  if (msg.type === "OFFSCREEN_STATE") {
    if (session) toTab(session.tabId, { type: "STATE", state: msg.state });
    return;
  }

  if (!sender.tab) return;

  // Control commands coming from the in-page bar (content script).
  if (msg.type === "CONTROL") {
    if (msg.action === "stop") {
      stopSession();
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
