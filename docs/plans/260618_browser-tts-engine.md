---
status: draft
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
- (append-only; filled during build)
