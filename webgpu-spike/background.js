// Service worker: opens the test page and hosts the offscreen document where
// inference actually runs (the SW itself can't hold the model or use WebGPU).

async function hasOffscreen() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return ctxs.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS"],
    justification: "Run Kokoro TTS (WebGPU/WASM) inference off the service worker.",
  });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("test.html") });
});

chrome.runtime.onMessage.addListener((msg) => {
  // Forward run requests from the test page into the offscreen document.
  if (msg && msg.type === "SPIKE_RUN" && !msg.target) {
    (async () => {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ ...msg, target: "offscreen" }).catch(() => {});
    })();
  }
});
