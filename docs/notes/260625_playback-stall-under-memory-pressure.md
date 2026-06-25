---
status: draft
kind: analyze
date: 260625
updated: 260625
topic: in-browser playback stalls partway and won't resume; proactive full-file swap fired but audio still didn't play — rules out MediaSource buffer eviction
---

# Playback stalls partway and won't resume (in-browser engine)

## Symptom
On the in-browser engine (WebGPU; `am_adam`), a generated snippet plays to some
fraction (observed 50–80%, varies) then **stops**. Pause/play does not resume; the
bar can show endless "Buffering…" or just freeze on the playing icon. The offscreen
document stays alive (its console keeps logging the benign ORT
`VerifyEachNodeIsAssignedToAnEp` / `content-length` warnings). User reports it was
**not an issue before the `07cdd92` streaming rewrite** (heap-store + windowed
MediaSource + full-file assembly). Correlated with many tabs open (memory pressure),
but **also reproduced after closing most tabs**.

## Key finding: not MediaSource buffer eviction
The leading hypothesis was that Chrome evicts data from the windowed MediaSource
SourceBuffer under memory pressure, hanging the playhead. The fix attempted was to
proactively switch to a plain blob-backed `<audio>` element once synthesis finishes
(a file-backed element re-decodes from its in-memory source and can't be evicted
into a dead-end).

The swap **fired** — console showed `[audio-reader] switched playback to the
complete file` (player.js:241) — and audio **still did not resume**. A blob-backed
element with the complete file in memory not playing **rules out buffer eviction as
the cause.** The problem is upstream of the buffer.

## Leading hypotheses (next investigation)
- **Offscreen-document audio suspension/throttling.** The offscreen document is
  always hidden. Chrome may suspend or throttle its media playback (not just its
  timers) under some condition, so neither MediaSource nor a blob element plays.
  The earlier watchdog `setInterval` was also confirmed throttled here.
- **`audio.play()` rejected after swap.** `swapToFullFile` calls
  `audio.play().catch(() => {})` on `loadedmetadata`; a rejected promise is
  swallowed. Need to log/inspect the rejection reason (autoplay policy? element
  state?). Likely the most direct next probe.
- **Seek target past the element's reported duration.** If the blob's decoded
  duration < the MediaSource playhead position at swap time (encoder-padding /
  frame-count mismatch — note the scrubber showed 0:40/0:41 with a ~1s gap), the
  post-swap `audio.currentTime = targetTime` may land at/after the end and stick.

## How to isolate (requested by user)
Compare against the pre-rewrite version to confirm regression scope:
- `main` (`da06d7a`) — has the windowing rewrite (`07cdd92`) + SW-session fix but
  **not** this branch's proactive-swap work. User is reloading this to observe.
- To isolate the windowing rewrite itself, also test `2edbe72` (the commit just
  before `07cdd92`), which is the last pre-windowing state.

## Where the experimental code is
This branch (`investigate/playback-stall`) holds the uncommitted stall-mitigation
work on top of `main`: proactive full-file swap (`maybeSwapToFullFile`),
reactive `waiting`/`stalled` backstop, and freeing the heap copy after full append.
`main` deliberately does **not** carry these so the user can A/B against it.

## Open Questions
- Does `audio.play()` reject after the swap, and with what error? (add a
  `.catch(e => console.warn(...))` probe.)
- Does the plain server engine (no WebGPU, no heap rewrite path differences) stall
  the same way on long reads? If not, the regression is specific to the
  browser-engine generation/append path, not the shared player.
- Is the offscreen document's `AudioContext`/media element being suspended? Check
  `audio.readyState`, `audio.error`, and whether a fresh `audio.play()` from the
  offscreen console resumes it.
