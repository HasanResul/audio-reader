// Audio Reader — shared offscreen player. Engine-agnostic.
//
// Owns the HTMLAudioElement, state reporting, and transport controls. Engines
// hand it a ReadableStream of MP3 chunks via playMpegStream(); a MediaSource
// pumps them so playback starts before synthesis finishes. Both engines feed
// this one path — the server streams MP3 off the network, the browser engine
// MP3-encodes its generated PCM on the fly — so the seekable timeline, controls,
// and state shape are identical regardless of which engine produced the audio.

export function createPlayer() {
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

  // Bumped on every new source (playMpegStream / playBlob / stop). A streaming
  // read loop captures its value and bails the moment a newer session starts, so
  // a stale, still-draining stream can never feed the next session's buffer. The
  // server engine also aborts its fetch; this guards the browser engine, whose
  // generation stream isn't abortable the same way.
  let playSession = 0;

  // Extra fields merged into every state message (e.g. the live engine label).
  let stateExtra = {};

  // --- State reporting ----------------------------------------------------

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
        ...stateExtra,
        ...extra
      }
    }).catch(() => {});
  }

  ["timeupdate", "play", "pause", "ended", "durationchange", "seeked",
   "ratechange", "waiting", "playing", "canplay"].forEach((ev) => {
    audio.addEventListener(ev, () => postState());
  });
  audio.addEventListener("error", () => postState({ error: "Audio playback failed." }));

  // --- MediaSource plumbing (streaming MP3 path) --------------------------

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

  function readLoop(reader, session) {
    if (session !== playSession) {
      try { reader.cancel(); } catch (e) {}
      return;
    }
    reader.read().then(({ done, value }) => {
      if (session !== playSession) {
        try { reader.cancel(); } catch (e) {}
        return;
      }
      if (done) {
        streamDone = true;
        pump();
        return;
      }
      queue.push(value);
      pump();
      readLoop(reader, session);
    }).catch(() => {
      if (session !== playSession) return;
      streamDone = true;
      pump();  // close out MediaSource so buffered audio finishes instead of hanging in "buffering"
      postState({ error: "Audio stream interrupted." });
    });
  }

  // --- Public feed API ----------------------------------------------------

  function setStateExtra(extra) {
    stateExtra = extra || {};
  }

  // Report a status update (with optional error) without changing playback.
  function report(extra) {
    postState(extra);
  }

  // Stream a chunked MP3 body. `stream` is a ReadableStream (resp.body for the
  // server engine, or an in-browser-generated MP3 stream for the browser engine).
  async function playMpegStream(stream, { speed } = {}) {
    const session = ++playSession;
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

    readLoop(stream.getReader(), session);
  }

  // --- Transport ----------------------------------------------------------

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
    ++playSession;  // invalidate any streaming read loop still draining
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

  return { playMpegStream, control, stop, report, setStateExtra };
}
