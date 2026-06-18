---
status: completed
created: 260618
updated: 260618
---

# Browser TTS engine + multi-engine selection

## Goal
Today the extension produces audio one way: POST to the local Docker Kokoro server. Add a second
engine that runs Kokoro **in the browser** (WebGPU, WASM fallback) so the tool works with **zero
install** on capable machines, and let the user pick the engine. Proven viable by the WebGPU spike
(9.52× RT, ~2× Docker; WASM 0.71× floor — see `docs/experiments/webgpu-browser-engine/`). Success: one
extension, one shared codebase, engine selectable in settings, selection gated by live availability, and
a visible indicator of which engine is actually running. Open-source / load-unpacked distribution — no
extension-store publishing.

## Approach
1. **Extract a single engine boundary.** Everything that isn't "produce audio from text" stays shared
   (extraction, player, controls, settings, commands, offscreen playback). Refactor the existing
   server path to sit behind that boundary with no behavior change first — verify parity before adding
   the second engine.
2. **Add the browser engine** behind the same boundary: in-browser Kokoro inference (WebGPU preferred,
   WASM fallback), hosted in the offscreen document. Productionize the spike: warm the model on idle so
   the first request avoids the ~2.7s cold-shader penalty; stream/segment long text so playback starts
   early and the WASM path doesn't freeze the thread for the whole job; first-run model-download
   progress UI (~300 MB fp32, browser-cached after).
3. **Live capability detection drives selectability.** Detect WebGPU (adapter request) and Docker server
   reachability (health check) at startup and on settings open. The engine picker:
   - Browser (WebGPU): selectable only if an adapter is granted; else disabled.
   - Docker server: selectable only if the server responds; else **disabled** with a ⚠️ tooltip telling
     the user to start the container.
   - Browser (WASM): always selectable — the floor — with a ⚠️ "slow, may stall on long text" tooltip.
   - Default = Browser (WebGPU) if available, else fall back per the user's pick; never auto-select a
     dead engine.
4. **Engine status indicator.** Toolbar badge + a marker in the player bar showing the live engine:
   🟢 GPU / 🟡 CPU(WASM) / 🔵 Server, with a tooltip carrying detail (adapter name or server URL) and,
   for WASM, the slowness warning.
5. **Keep the library bundled locally** (MV3 forbids remote script): vendored ORT wasm + esbuild bundle,
   as validated in the spike. Only model weights fetch at runtime (from HF).
6. **Docs:** README explains the three engines, how to load unpacked, and the WASM caveat. Retire
   `webgpu-spike/` once the real browser engine works.

## Non-goals
- **No second extension and no build-time dist variants.** One extension, one engine boundary — ~7/8
  files (extraction, player, controls, settings, offscreen playback) are shared, so splitting would
  duplicate that surface; the only upside (smaller payload) is moot without store publishing. The wasm
  payload sitting dormant on disk is acceptable (load-unpacked, no store size limit).
- **No extension-store publishing**, so no store-compliance work (consent gating for "remote code", etc.).
- **No new player/extraction/UI rework** beyond what the engine boundary and the indicator require.
- **No fp16/q4 dtype tuning** unless cold-load time proves a real problem — fp32 for WebGPU, q8 for WASM,
  as the spike used.
- **No auto-switching mid-playback** between engines. Selection is explicit (with sane default); a dead
  engine is disabled, not silently swapped.
- **No Safari/Firefox support.** Chrome/Edge only (prior decision).

## References
- `docs/experiments/webgpu-browser-engine/` — the gate: feasibility, numbers, the WASM-floor caveat.
- `docs/research/chrome-ext-webgpu/260618_kokoro-webgpu-mv3-extension.md` — MV3/offscreen/CSP/ORT details.
- `webgpu-spike/` — working reference implementation of the offscreen WebGPU engine (throwaway harness).
- `extension/` — current single-engine (Docker) extension; the shared surface to refactor behind a boundary.
- `local/kokoro/` — Docker engine runbook + baseline benchmarks.
- `docs/plans/260617_audio-reader-mvp.md` — the MVP this extends.

## Validation
- With Docker running and WebGPU present: all three engine states reflected correctly in the picker;
  selecting each produces correct `af_heart` audio for both a short selection and a whole article.
- With Docker stopped: its option is disabled with the ⚠️ tooltip; cannot be selected; other engines work.
- On a no-WebGPU context (or forced): WebGPU option disabled; WASM selectable with its warning; long text
  still plays (segmented) without a hard "page unresponsive" freeze.
- Status indicator always matches the engine actually generating audio; tooltip shows correct detail.
- First browser-engine run shows download progress; subsequent runs start without re-downloading.
- Existing Docker-path behavior (selection reading, whole-article, controls) unchanged when that engine
  is selected — no regression vs current `extension/`.

## Open Questions
- Where the engine indicator lives in the player bar vs. only the toolbar badge — settle during UI work.
- WASM long-text strategy: segment-and-queue is required to avoid the thread freeze; confirm it yields
  acceptable (if slow) playback rather than just moving the stall. May conclude WASM is "short selections
  only" in practice — record in the impl log if so.
- Whether idle warmup for the browser engine should be eager (on extension load) or lazy (on first hover/
  selection) — trade memory/GPU residency vs first-request latency.

## Implementation Log
- **260618 — Phase 1: engine boundary extracted (zero behavior change).** Split the monolithic
  `offscreen.js` into three ESM modules behind a single boundary:
  - `player.js` (`createPlayer()`) — shared, engine-agnostic: owns the `<audio>` element, MediaSource
    streaming pump, state reporting (`OFFSCREEN_STATE`), and transport controls. Moved verbatim from the
    old `offscreen.js`. Added (unused in P1, for P2) `playBlob()` for fully-assembled audio and
    `setStateExtra()` to merge a live-engine label into every state message.
  - `engines/server-engine.js` (`serverEngine`) — the *only* engine-specific code: POST
    `/v1/audio/speech`, abort-previous-fetch, engine-specific error strings → hands `resp.body` to
    `player.playMpegStream()`.
  - `offscreen-main.js` — message router; `ENGINES[msg.engine] || serverEngine` (defaults to server when
    `engine` is absent, so the existing background→offscreen contract is unchanged).
  - `offscreen.html` now loads `<script type="module" src="offscreen-main.js">`; `offscreen.js` deleted.
    Static ESM imports of own extension resources need no `web_accessible_resources`.
  - **Divergence from original (user-invisible):** the server engine now issues `fetch` *before* the
    player sets up the MediaSource (original set up MediaSource first, then fetched). End state identical
    by the time `readLoop` runs; on fetch failure the new order avoids a dangling MediaSource. All error
    strings byte-identical.
  - **No background/content/manifest changes in P1** — `OFFSCREEN_START`/`OFFSCREEN_CONTROL`/
    `OFFSCREEN_STATE` contract preserved.
  - **Doc gap found:** `extension/README.md:43` still describes `offscreen.js` (now `offscreen-main.js` +
    `player.js` + `engines/`). Deferred to the Phase 3 README rewrite (three-engine architecture).
  - **STOP-AND-REVIEW:** awaiting user parity check (selection read + whole-article + controls with Docker
    running) before starting Phase 2. Static parity analysis done; empirical load-unpacked test is the gate.
  - **260618 — Phase 1 parity CONFIRMED by user** (Docker engine works after refactor). Proceeding.
- **260618 — Phase 2: in-browser Kokoro engine (WebGPU + WASM) behind the same boundary.**
  - **Build:** added `extension/package.json` + `build.mjs` (`npm install && npm run build`): vendors ORT
    WebGPU wasm to `vendor/ort/` and esbuilds `src/browser-engine-entry.js` → `engines/browser-engine.bundle.js`
    (ESM, minified, 2.3MB). Deps: `kokoro-js@1.2.1`, `@breezystack/lamejs@1.2.7`, `esbuild`. Generated
    artifacts gitignored (`extension/.gitignore`); regenerable per spike pattern.
  - **`src/browser-engine-entry.js`** — kokoro-js inference in the offscreen doc. ORT env: vendored
    `wasmPaths`, `numThreads=1`, `allowLocalModels=false`, `useBrowserCache=true` (proven spike config).
    `webgpu`→fp32, `wasm`→q8. Keep-resident model cache (2nd+ reads skip load + shader compile).
  - **Progressive playback decision (resolves the WASM open question + corrects my first instinct):** the
    Docker path is already *streaming* (MediaSource, growing duration). User confirmed assemble-then-play
    would regress the feel even on WebGPU. So the browser engine is **also progressive**: `tts.stream()`
    generates sentence-by-sentence; each PCM segment is resampled 24k→48k (lossless for speech; dodges the
    24kHz-MP3-in-MediaSource risk) and MP3-encoded on the fly (single `Mp3Encoder` instance → one
    continuous stream) and pushed into the SAME `player.playMpegStream()` pipeline as Docker. **One
    transport path, identical streaming feel.** Trade-off: a lossy MP3 re-encode — but Docker already
    serves MP3, so no quality regression. **WASM long text** = progressive with buffering between
    sentences (generation < real-time), NOT a hard freeze (stream() yields per sentence; offscreen doc is
    invisible so no "page unresponsive"). Conclusion: WASM is usable-but-slow, not "short selections only".
  - **`player.js` robustness add:** `playSession` guard — a stale, still-draining stream can never feed a
    new session's buffer (the browser generation stream isn't fetch-abortable). Behavior-preserving for the
    server path (which still aborts its fetch).
  - **`offscreen-main.js`:** lazy dynamic-import of the browser bundle (only when a browser engine is
    picked); resolves `engine: "auto"` live → WebGPU → Docker → WASM. `OFFSCREEN_WARMUP` handler.
  - **`background.js`:** `engine: "auto"` added to DEFAULTS; passed through `OFFSCREEN_START`.
  - **`content.js`:** bar now surfaces `state.status` (model download %, "Synthesizing…").
  - **`manifest.json`:** CSP `extension_pages` (`wasm-unsafe-eval`, `worker-src`, `connect-src` HF +
    localhost); HF `host_permissions`; `web_accessible_resources` for `vendor/ort/*` + the bundle.
  - **Warmup decision (eager-vs-lazy open question):** lazy load + keep-resident; idle-warm
    (`OFFSCREEN_WARMUP`) triggered in Phase 3 when the user explicitly selects a browser engine in the
    picker (clean opt-in moment — avoids a surprise ~300MB download for `auto` users).
  - **Note:** download progress is per-file (kokoro fetches several files); the % cycles per file rather
    than showing one aggregate bar. Acceptable for now; aggregate later if it reads poorly.
  - **All files syntax-checked; bundle parses + exports `browserEngine`; no live CDN ORT path (override
    confirmed).** Empirical browser test pending (needs Chrome + first-run model download).
- **260618 — Phase 3: availability-gated picker + live indicator.**
  - **Picker (`options.*`):** radio group — Automatic (default/recommended), Browser·WebGPU 🟢,
    Docker server 🔵, Browser·WASM 🟡. Live-gated on settings open: WebGPU via `requestAdapter()`
    (options page has `navigator.gpu`); Docker via `/health`; WASM always on with a ⚠️ "slow" detail. A
    disabled/unreachable engine can't be picked; if the saved engine is unavailable on open (or the
    server URL changes / Test connection fails), selection demotes to Automatic. Save persists `engine`.
  - **Indicator placement (open question → decided: BOTH, per Approach).** (1) Player-bar marker in
    `content.js` (🟢/🟡/🔵 with tooltip), cleared on each new session, set from `state.engine`. (2) Toolbar
    badge in `background.js` (`GPU`/`CPU`/`SRV`, colored) set on each `OFFSCREEN_STATE` while playing,
    cleared on `ended`/stop. Both reflect the engine *actually* generating (resolved value, incl. what
    `auto` chose).
  - **Idle warmup wired:** `background.js` sends `OFFSCREEN_WARMUP` on `chrome.runtime.onStartup` and on
    `storage.onChanged` for `engine` — but only for an *explicit* `webgpu`/`wasm` pick (not `auto`), so
    no surprise ~300MB download.
  - **Popup (`popup.*`) made engine-aware:** shows the selected engine + live status (mirrors the
    auto-resolution: WebGPU→server→WASM), with a yellow dot for the works-but-slow WASM cases — instead
    of always reporting server health (which misled browser-engine users).
  - **README rewritten** for the three engines, the `npm run build` step, load-unpacked, and the WASM
    caveat (fixes the stale `offscreen.js` doc gap from Phase 1).
  - **Behavior change to flag:** DEFAULTS `engine` is now `"auto"`, which resolves to **WebGPU when an
    adapter is present** — so on a WebGPU-capable machine the default first read now uses the browser
    engine (one-time ~300MB model download) instead of the Docker server. Intended per Goal; users wanting
    the server pick "Docker server" in settings.
  - **`webgpu-spike/` NOT yet retired** — per DoD, retire only once the real browser engine is verified in
    Chrome. Deferred to post-validation.
  - **Implementation complete across all 3 phases; awaiting the user's empirical Validation pass** (all
    three engine states, Docker-stopped disables its option, no-WebGPU disables that option, long WASM
    text plays without freeze, indicator matches live engine, first-run download progress, server-path
    no-regression).
- **260618 — Phase 2/3 bugfix round 1 (browser engine unstable on repeat reads).** User reported: model
  download progress reappearing on later reads; intermittent stuck-in-"buffering"; multi-sentence
  *selections* playing only the first sentence (whole-article fine). Two root causes:
  1. **Shared-counter cancellation race (primary).** The browser engine used a module-level `activeToken`
     to supersede generations, and a stream's `cancel()` *incremented* it. When a new read started, the
     previous reading's stream cancelled asynchronously and its `cancel()` could bump the counter *after*
     the new generation captured its token — invalidating the new run, so its 2nd `pull()` saw a token
     mismatch and closed early (→ first-sentence-only, intermittent, fine on the very first read). **Fix:**
     per-run `{cancelled}` object (`beginRun()`); cancelling an old run only flips that run's own flag,
     never a newer one.
  2. **`auto` flipping engines via flaky `requestAdapter()`.** `auto` re-probed WebGPU every read;
     `requestAdapter()` can intermittently return null on capable hardware (documented Chromium quirk in
     the research doc), so `auto` silently switched engine read-to-read, loading a *different* model
     (reappearing progress) and changing behavior. **Fix:** cache the adapter probe per session
     (`webgpuCached`) in both `offscreen-main.js` and the engine → stable engine choice.
  - **Also:** dedup concurrent model loads (`loading` promise) so warmup + read don't double-load;
    `player.js` `readLoop` `.catch` now `pump()`s so an abnormal stream end closes out MediaSource
    (`endOfStream`) instead of hanging in "buffering"; status copy "Downloading…" → "Loading voice
    model…" (accurate for cache loads too). Bundle rebuilt. **Awaiting user retest.**
- **260618 — Phase 2 bugfix round 2 (ACTUAL root cause of "only one sentence").** Round-1's race fix did
  NOT help (user: still one sentence; offscreen console clean — no error, just benign ORT EP warnings).
  Read kokoro-js source: **`tts.stream(string)` wraps the text in a `TextSplitterStream` it pushes but
  never `.close()`s.** The splitter only emits sentences terminated by punctuation *followed by more
  text*, so the **final sentence is never flushed** and the async iterator then `await`s forever for more
  input. A 2-sentence selection emits only sentence 1 then hangs (→ "one sentence" + "stuck buffering");
  a long article "works" only because its missing last sentence + tail-hang go unnoticed. **Fix:** import
  `TextSplitterStream`, construct it, `tts.stream(splitter, {voice})`, then `splitter.push(text);
  splitter.close()` — the final sentence flushes and the generator terminates cleanly (`done` →
  `endOfStream`). Generation stays per-sentence/progressive. Warmup switched to one-shot `tts.generate()`
  (same unclosed-splitter trap otherwise). The round-1 per-run cancel + adapter-cache + pump-on-error
  changes are kept (correct hygiene, just not the cause). Bundle rebuilt. **Awaiting user retest.**
  - **Doc gap for future sessions:** kokoro-js `stream(string)` is a footgun — never terminates. Always
    drive a `TextSplitterStream` and `close()` it. (Recorded here; the spike used `generate()` so never hit it.)
- **260618 — VALIDATED + DONE.** User confirmed the browser engine reads multi-sentence selections fully,
  ends cleanly (no perpetual buffering), and the whole-article path works. Per the DoD, retired the spike:
  `webgpu-spike/` deleted (~466MB incl. its node_modules); its proven patterns live in
  `extension/src/browser-engine-entry.js`. Experiment `plan.md` annotated with the retirement so its
  pointer doesn't dangle. Plan status → completed.
