// Audio Reader — offscreen player.
// Fetches the streaming /v1/audio/speech response and feeds it into a
// MediaSource buffer so playback starts as soon as the first bytes arrive while
// the rest of the article is still being synthesized. Exposes a single seekable
// timeline. Lives in the extension's own context, so page CSP can't block the
// localhost fetch or the audio playback.

const audio = new Audio();
audio.preservesPitch = true;

// The rate we want playing; re-asserted on (re)load in case the element resets
// playbackRate to 1 when a fresh source attaches.
let desiredRate = 1.0;
audio.addEventListener("loadedmetadata", () => { audio.playbackRate = desiredRate; });
audio.addEventListener("play", () => { audio.playbackRate = desiredRate; });

let mediaSource = null;
let sourceBuffer = null;
let queue = [];          // pending Uint8Array chunks awaiting append
let streamDone = false;  // network stream fully read
let objectUrl = null;
let started = false;     // playback kicked off for the current session
let abortController = null; // abort previous fetch if new read starts

// --- State reporting ------------------------------------------------------

function bufferedEnd() {
  if (sourceBuffer && sourceBuffer.buffered.length) {
    return sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
  }
  return 0;
}

function postState(extra = {}) {
  const duration = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : bufferedEnd();
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_STATE",
    state: {
      playing: !audio.paused && !audio.ended,
      paused: audio.paused,
      ended: audio.ended,
      currentTime: audio.currentTime || 0,
      duration,
      rate: audio.playbackRate,
      buffering: audio.readyState < 3 && !audio.ended,
      ...extra
    }
  }).catch(() => {});
}

["timeupdate", "play", "pause", "ended", "durationchange", "seeked",
 "ratechange", "waiting", "playing", "canplay"].forEach((ev) => {
  audio.addEventListener(ev, () => postState());
});
audio.addEventListener("error", () => postState({ error: "Audio playback failed." }));

// --- MediaSource plumbing -------------------------------------------------

function pump() {
  if (!sourceBuffer || sourceBuffer.updating) return;

  if (queue.length) {
    try {
      sourceBuffer.appendBuffer(queue.shift());
    } catch (e) {
      postState({ error: "Buffer append failed: " + e.message });
      return;
    }
    if (!started && audio.readyState >= 2) {
      started = true;
      audio.play().catch(() => {});
    }
    return;
  }

  if (streamDone && mediaSource && mediaSource.readyState === "open") {
    try { mediaSource.endOfStream(); } catch (e) { /* already ended */ }
  }
}

function readLoop(reader) {
  reader.read().then(({ done, value }) => {
    if (done) {
      streamDone = true;
      pump();
      return;
    }
    queue.push(value);
    pump();
    readLoop(reader);
  }).catch(() => {
    streamDone = true;
    postState({ error: "Audio stream interrupted." });
  });
}

async function start({ text, serverUrl, voice, speed }) {
  stop();

  // Abort any previous fetch that might still be in progress
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  const base = (serverUrl || "").replace(/\/+$/, "");
  const speechUrl = base + "/v1/audio/speech";

  if (!window.MediaSource || !MediaSource.isTypeSupported("audio/mpeg")) {
    postState({ error: "This browser can't stream MP3 audio (MediaSource unsupported)." });
    return;
  }

  mediaSource = new MediaSource();
  objectUrl = URL.createObjectURL(mediaSource);
  audio.src = objectUrl;
  audio.currentTime = 0;  // Explicitly reset playback position
  desiredRate = speed || 1.0;
  audio.playbackRate = desiredRate;
  started = false;

  await new Promise((resolve) => {
    mediaSource.addEventListener("sourceopen", resolve, { once: true });
  });

  try {
    sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
  } catch (e) {
    postState({ error: "Could not create audio buffer: " + e.message });
    return;
  }
  sourceBuffer.addEventListener("updateend", pump);

  streamDone = false;
  queue = [];

  abortController = new AbortController();
  let resp;
  try {
    resp = await fetch(speechUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice,
        response_format: "mp3",
        stream: true,
        speed: 1.0
      }),
      signal: abortController.signal
    });
  } catch (e) {
    if (e.name === "AbortError") return;  // Fetch was cancelled, don't report error
    postState({ error: "Can't reach the TTS server at " + base + ". Is it running?" });
    return;
  }

  if (!resp.ok || !resp.body) {
    postState({ error: "TTS server returned an error (HTTP " + resp.status + ")." });
    return;
  }

  readLoop(resp.body.getReader());
}

function control(action, value) {
  switch (action) {
    case "toggle":
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
      break;
    case "pause":
      audio.pause();
      break;
    case "resume":
      audio.play().catch(() => {});
      break;
    case "seek":
      try { audio.currentTime = value; } catch (e) { /* out of range */ }
      break;
    case "speed":
      desiredRate = value;
      audio.playbackRate = value;
      break;
    case "stop":
      stop();
      break;
  }
}

function stop() {
  try { audio.pause(); } catch (e) {}
  try {
    if (mediaSource && mediaSource.readyState === "open") mediaSource.endOfStream();
  } catch (e) {}
  try { audio.removeAttribute("src"); audio.load(); } catch (e) {}
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  mediaSource = null;
  sourceBuffer = null;
  queue = [];
  streamDone = false;
  started = false;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "OFFSCREEN_START") start(msg);
  else if (msg.type === "OFFSCREEN_CONTROL") control(msg.action, msg.value);
});
