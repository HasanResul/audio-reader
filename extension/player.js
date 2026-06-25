// Audio Reader — shared offscreen player. Engine-agnostic.
//
// Owns the HTMLAudioElement, state reporting, and transport controls. Engines
// hand it a ReadableStream of MP3 chunks via playMpegStream(); a MediaSource
// streams them so playback starts before synthesis finishes. Both engines feed
// this one path — the server streams MP3 off the network, the browser engine
// MP3-encodes its generated PCM on the fly — so the seekable timeline, controls,
// and state shape are identical regardless of which engine produced the audio.
//
// Memory model: a long article is far more audio than the MediaSource buffer's
// quota (a few MB) can hold, so we keep every generated chunk in a heap array
// (cheap — ~1 MB/min of MP3) and feed the MediaSource only a bounded WINDOW
// around the playhead. Once synthesis finishes, the heap chunks are assembled
// into one complete file; seeking back into audio that's left the window swaps
// the element onto that file, so re-listening never needs re-synthesis.

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
  let allChunks = [];      // every generated MP3 chunk, kept in heap for the
                           // full-file assembly + seek-back (cheap: ~1 MB/min)
  let appendCursor = 0;    // index of the next chunk to feed the MediaSource window
  let streamDone = false;  // source stream fully read into allChunks
  let fullBlobUrl = null;  // complete-file object URL, set once synthesis finishes
  let objectUrl = null;    // current audio.src object URL (MediaSource, then full file)
  let started = false;     // playback kicked off for the current session
  let canDownload = false; // the complete MP3 is assembled and downloadable
  let knownDuration = 0;   // true total duration, measured once synthesis finishes

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

  // Diagnostic: a contiguous stream should always be a single buffered range.
  // More than one range means the timeline has a gap (the cause of the
  // crackle-then-skip artifact) — warn so it's visible in the offscreen console.
  // With sourceBuffer.mode = "sequence" this should never fire.
  function warnOnBufferGap() {
    if (!sourceBuffer || sourceBuffer.buffered.length <= 1) return;
    const b = sourceBuffer.buffered;
    const gaps = [];
    for (let i = 1; i < b.length; i++) {
      gaps.push(`${b.end(i - 1).toFixed(3)}s→${b.start(i).toFixed(3)}s`);
    }
    console.warn("[audio-reader] buffered timeline gap(s):", gaps.join(", "));
  }

  function postState(extra = {}) {
    // Prefer the true total once synthesis has finished; otherwise the live
    // streaming buffer end (the scrubber max grows as audio buffers).
    const duration = knownDuration ||
      (isFinite(audio.duration) && audio.duration > 0 ? audio.duration : bufferedEnd());
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
        canDownload,
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

  // Advance the buffer window as the playhead moves (append ahead, evict behind),
  // then — once synthesis is complete — proactively switch to the assembled file.
  // The MediaSource window is only needed while still generating; staying on it
  // afterwards is fragile (under memory pressure Chrome evicts buffered data,
  // hanging playback inside a hidden offscreen document whose timers are throttled
  // so it can't reliably self-recover). A plain blob-backed element re-decodes
  // from its own in-memory source, so it can't dead-end. See maybeSwapToFullFile.
  audio.addEventListener("timeupdate", () => { feedWindow(); maybeSwapToFullFile(); });

  // If the user seeks to audio that's left the window but was already generated,
  // switch to the complete file (assembled at synthesis end) and seek there.
  audio.addEventListener("seeking", () => {
    if (!sourceBuffer) return;        // already on the full file — native seek
    if (playheadInWindow()) return;   // normal in-window MediaSource seek
    if (fullBlobUrl) { swapToFullFile(audio.currentTime || 0); return; }
    feedWindow();  // still generating: let the window refill toward the target
  });

  // As a fast backstop for the brief window between "synthesis done" and the
  // proactive swap, also recover if the element reports a stall there.
  const recoverFromStall = () => { if (sourceBuffer) maybeSwapToFullFile(); };
  audio.addEventListener("waiting", recoverFromStall);
  audio.addEventListener("stalled", recoverFromStall);

  // --- MediaSource plumbing (streaming MP3 path) --------------------------

  // The MediaSource buffer holds only a window around the playhead: at most
  // MAX_AHEAD seconds ahead (so a fast engine can't race the whole article in and
  // blow the quota) and ~KEEP_BEHIND seconds behind (the live seek-back range;
  // older played audio is evicted to reclaim memory). The full audio lives in
  // `allChunks`, so nothing is lost — once synthesis finishes, seeking past the
  // window swaps onto the assembled complete file. The window (~MAX_AHEAD +
  // KEEP_BEHIND ≈ 6.5 min ≈ 6–7 MB) stays well under the SourceBuffer quota.
  const MAX_AHEAD = 90;       // seconds of audio to keep buffered ahead of the playhead
  const KEEP_BEHIND = 300;    // seconds of played audio to retain (≈ seek-back range)
  const KEEP_BEHIND_MIN = 30; // floor retained under quota pressure (forced eviction)
  const EVICT_BATCH = 30;     // only evict once this much has piled up, to avoid churn

  function bufferAhead() {
    return bufferedEnd() - (audio.currentTime || 0);
  }

  // Is the playhead inside the currently-buffered window? (False once the user
  // has seeked to audio the window doesn't hold.)
  function playheadInWindow() {
    if (!sourceBuffer || !sourceBuffer.buffered.length) return false;
    const t = audio.currentTime || 0;
    const b = sourceBuffer.buffered;
    return t >= b.start(0) && t <= b.end(b.length - 1);
  }

  // Drop already-played audio behind the playhead to free SourceBuffer memory.
  // Returns true if a removal was started (it fires updateend → feedWindow()).
  // Batches removals (EVICT_BATCH) so it doesn't churn a tiny remove() per frame;
  // `force` removes whatever it can, for the quota safety-net path.
  function evictBehind(force) {
    if (!sourceBuffer || sourceBuffer.updating || !sourceBuffer.buffered.length) return false;
    const start = sourceBuffer.buffered.start(0);
    // Normally retain KEEP_BEHIND for seek-back; when forced (quota hit on a
    // machine with a smaller buffer) free aggressively down to KEEP_BEHIND_MIN.
    const cutoff = (audio.currentTime || 0) - (force ? KEEP_BEHIND_MIN : KEEP_BEHIND);
    if (cutoff <= start) return false;                        // nothing safe to remove yet
    if (!force && cutoff - start < EVICT_BATCH) return false; // wait for a full batch
    try { sourceBuffer.remove(start, cutoff); return true; }
    catch (e) { return false; }
  }

  // Keep the MediaSource window fed from the heap: evict what's fallen behind,
  // append the next chunk while we're within MAX_AHEAD of the playhead, and close
  // the stream once everything generated has been appended. Driven by updateend
  // (append→append chains) and timeupdate (playback drains → append more).
  function feedWindow() {
    if (!sourceBuffer || sourceBuffer.updating) return;

    if (evictBehind(false)) return;  // removal in flight; updateend re-runs feedWindow

    if (appendCursor < allChunks.length && bufferAhead() < MAX_AHEAD) {
      try {
        sourceBuffer.appendBuffer(allChunks[appendCursor]);
        appendCursor++;
      } catch (e) {
        // Proactive eviction should keep us under quota; this is the safety net.
        // Free space and retry on updateend; only surface if nothing's left.
        if (e.name === "QuotaExceededError" && evictBehind(true)) return;
        postState({ error: "Buffer append failed: " + e.message });
        return;
      }
      if (!started && audio.readyState >= 2) {
        started = true;
        audio.play().catch(() => {});
      }
      return;
    }

    if (streamDone && appendCursor >= allChunks.length &&
        mediaSource && mediaSource.readyState === "open") {
      try { mediaSource.endOfStream(); } catch (e) { /* already ended */ }
      // Everything is buffered and the complete file exists; drop the heap copy
      // (seek-out and stall-recovery use the assembled file, not these chunks).
      if (fullBlobUrl && allChunks.length) { allChunks = []; appendCursor = 0; }
    }
  }

  // Assemble every generated chunk into one complete MP3 file, kept ready for a
  // seek-back to swap onto (see swapToFullFile) and for download. Cheap relative
  // to the model. Also probes the file's true duration so the scrubber can show
  // the real total instead of the streaming estimate.
  function buildFullBlob(session) {
    if (session !== playSession || fullBlobUrl || !allChunks.length) return;
    try {
      fullBlobUrl = URL.createObjectURL(new Blob(allChunks, { type: "audio/mpeg" }));
    } catch (e) {
      return;  // couldn't assemble; windowed playback still works
    }
    canDownload = true;
    const probe = new Audio();
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      if (session === playSession && isFinite(probe.duration) && probe.duration > 0) {
        knownDuration = probe.duration;
      }
      postState();
    }, { once: true });
    probe.src = fullBlobUrl;
    postState();  // surface canDownload immediately (duration follows from the probe)
  }

  // Once synthesis is complete and playback is underway, move off the fragile
  // windowed MediaSource onto the assembled file. Triggered from timeupdate so we
  // know playback has started; `started` guards the pre-playback window where a
  // very short clip finishes synthesizing before the first chunk has played.
  function maybeSwapToFullFile() {
    if (streamDone && started && fullBlobUrl && sourceBuffer && !audio.ended) {
      swapToFullFile(audio.currentTime || 0);
    }
  }

  // Replace the windowed MediaSource with the complete file so playback is robust
  // (a blob-backed element re-decodes from its in-memory source and can't be
  // evicted into a dead-end) and seeking is native. One-way (synthesis finished).
  function swapToFullFile(targetTime) {
    console.info("[audio-reader] switched playback to the complete file");
    const wasPlaying = !audio.paused && !audio.ended;
    const prev = objectUrl;
    objectUrl = fullBlobUrl;  // keep fullBlobUrl pointing here too (download source)
    mediaSource = null;
    sourceBuffer = null;
    allChunks = [];
    appendCursor = 0;
    const onMeta = () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      try { audio.currentTime = targetTime; } catch (e) {}
      if (wasPlaying) audio.play().catch(() => {});
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.src = objectUrl;
    audio.load();
    if (prev && prev !== objectUrl) URL.revokeObjectURL(prev);
  }

  // Save the assembled complete MP3 via a download. `title` is the page title,
  // used (sanitized) as the filename. Available once canDownload is true.
  function download(title) {
    if (!fullBlobUrl) return;
    const base = (title || "audio-reader")
      .replace(/[\\/:*?"<>|\n\r\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "audio-reader";
    const a = document.createElement("a");
    a.href = fullBlobUrl;
    a.download = base + ".mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // Read the whole stream into the heap as fast as it yields (the windowed
  // appender, not this loop, bounds memory), then mark it done + assemble the
  // full file. Bails immediately if a newer session supersedes this one.
  async function readLoop(reader, session) {
    try {
      while (true) {
        if (session !== playSession) { try { reader.cancel(); } catch (e) {} return; }
        const { done, value } = await reader.read();
        if (session !== playSession) { try { reader.cancel(); } catch (e) {} return; }
        if (done) {
          streamDone = true;
          buildFullBlob(session);
          feedWindow();          // finish appending the tail / close the stream
          maybeSwapToFullFile(); // and move onto the solid file if already playing
          return;
        }
        allChunks.push(value);
        feedWindow();
      }
    } catch (e) {
      if (session !== playSession) return;
      streamDone = true;
      buildFullBlob(session);  // partial file — what was generated stays seekable
      feedWindow();  // close out so buffered audio finishes instead of hanging
      postState({ error: "Audio stream interrupted." });
    }
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
    // Lay each appended chunk immediately after the previous one instead of
    // trusting the parsed MP3 frame timestamps. In the default "segments" mode,
    // tiny timestamp discontinuities at append boundaries leave sub-frame gaps in
    // the buffered timeline; Chrome then "gap-jumps" across them during playback —
    // heard as a brief crackle followed by a small forward skip, dropping the
    // audio inside the gap. "sequence" mode guarantees one contiguous range, so
    // there is nothing to jump.
    try { sourceBuffer.mode = "sequence"; } catch (e) { /* mode unsupported */ }
    sourceBuffer.addEventListener("updateend", feedWindow);
    sourceBuffer.addEventListener("updateend", warnOnBufferGap);

    streamDone = false;
    allChunks = [];
    appendCursor = 0;
    canDownload = false;
    knownDuration = 0;
    if (fullBlobUrl) { URL.revokeObjectURL(fullBlobUrl); fullBlobUrl = null; }

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
      case "download":
        download(value);
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
    if (fullBlobUrl) { URL.revokeObjectURL(fullBlobUrl); fullBlobUrl = null; }
    mediaSource = null;
    sourceBuffer = null;
    allChunks = [];
    appendCursor = 0;
    streamDone = false;
    started = false;
    canDownload = false;
    knownDuration = 0;
  }

  return { playMpegStream, control, stop, report, setStateExtra };
}
