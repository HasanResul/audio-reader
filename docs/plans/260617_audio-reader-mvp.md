---
status: active
created: 260617
updated: 260617_phase2
---

# Audio Reader MVP — Local TTS Read-Aloud for Brave

## Goal
Let the user hear web articles/blogs (and incidentally any selected text, including LLM chat output) read aloud by a self-hosted TTS engine, following the audio while skimming the page. Success = in Brave, the user can (a) select text and trigger a keyboard shortcut, or (b) hit "read this article", and hear natural narration within ~1s for short selections, with player controls (play/pause, speed, seek). All inference runs locally; nothing is sent to a cloud service. Engine is swappable via config (fast Kokoro default; Chatterbox for a higher-quality long-form mode) without code changes.

## Approach
Three phases, each independently demoable. Stop and reassess after Phase 1 before investing in the extension UI.

**Phase 0 — Local server, proven.** Stand up a local OpenAI-compatible TTS server for Kokoro and confirm it runs acceptably on this Mac: measure first-audio latency and real-time factor, confirm streaming works, settle on a run method that survives reboots/sessions. Decide the safe path if hardware-accelerated inference proves troublesome. Capture the resulting endpoint + a known-good voice as the canonical defaults. This phase de-risks everything; voices were only validated on hosted demos so far, so local quality/latency is still unverified.

**Phase 1 — Speak-selection MVP.** A Brave extension that, on a keyboard shortcut, takes the current text selection, sends it to the configured local endpoint, streams back audio, and plays it through a minimal in-UI player with play/pause, playback-speed, and seek. Endpoint URL and voice are user-configurable. Handle the long-text case (chunking at sentence boundaries so playback can start before the whole text is synthesized). This is the core loop and the thing to get right.

**Phase 2 — Read whole article.** Add a "read this article" action that extracts just the main article content from the current page (drop nav/ads/comments) and feeds it to the same play pipeline. Use a local, in-extension extraction approach; no LLM call. Accept that a minority of pages extract poorly — surface a graceful fallback (e.g. fall back to full-page text or let the user select manually) rather than trying to be perfect.

**Quality-mode hook (carried, not built).** Because Phase 1 makes endpoint+voice configurable, pointing at a Chatterbox server for long-form "quality mode" is a settings change. Wire the config surface to allow it; do not build or bundle a second engine in this plan.

## Non-goals
- No karaoke / word- or sentence-level highlight sync. Explicitly cut.
- No system-wide "select text in any app" — browser only. No macOS accessibility (AXUIElement) helper.
- No always-on-top / floating overlay window. Player lives inside the extension surface.
- No dedicated Claude Code / CLI-pipe narration integration. (LLM chat output is covered for free by selecting the rendered text in the browser.)
- No bundling, hosting, or auto-installing the TTS model/server inside the extension. The server is a separate local process the user runs.
- No LLM-based article extraction. No Haiku call. Library extraction only, with a dumb fallback.
- No Safari/Firefox packaging in this plan. Target Chromium/Brave; keep code portable but don't do the extra native packaging now.
- No Chatterbox setup, no second-engine code, no voice-cloning. Config hook only.
- No cloud TTS fallback. Local-only by design.

## References
- `docs/notes/260617_audio-reader-design.md` — design decisions, scope cuts, architecture diagram. Read first.
- `docs/research/tts-models/260617_local-tts-apple-silicon.md` — engine choice rationale; Kokoro-FastAPI on macOS (MPS issue #270; ONNX CPU ~2× real-time as safe fallback); Chatterbox as quality leader.
- `docs/research/tts-tooling/260617_read-aloud-local-tts-landscape.md` — existing extensions to validate against (local_tts_reader / Custom TTS Reader); Readability.js as extraction engine; macOS Kokoro run methods (Docker / apple-container / LaunchAgent auto-start).
- Machine: Apple M4 Pro, 24 GB RAM, macOS (Darwin 24.6). Strong enough for any candidate engine.

## Validation
- Local TTS server responds to an OpenAI-style speech request and returns playable audio; first-audio latency for a short sentence measured and recorded as acceptable (target ~1s for Kokoro).
- In Brave: select a paragraph on a real article, press the shortcut, and hear it narrated; player can pause/resume, change speed, and seek.
- A long selection (multi-paragraph) starts playing before the whole thing is synthesized (no multi-second dead wait scaling with length).
- "Read this article" on 3–5 representative real pages (a news article, a blog post, an X/Twitter thread or long post) extracts the main text without reading nav/ads/boilerplate; a page that extracts poorly degrades gracefully rather than crashing or reading garbage.
- Changing the endpoint/voice in settings takes effect without reinstalling — pointing at a different OpenAI-compatible server works.
- Nothing leaves the machine: traffic goes only to the configured localhost endpoint.

## Open Questions
- Server run method on macOS: Docker vs `apple/container` vs bare `uv`/Python, and auto-start (LaunchAgent) vs manual. Decide in Phase 0 from what installs cleanly; record the choice.
- If Kokoro-FastAPI's MPS path hits the known macOS friction (#270), is ONNX-CPU (~2× real-time) fast enough for the user's comfort, or does that push toward a different server build? Resolve empirically in Phase 0.
- Player placement: extension popup vs an injected in-page control bar. In-page bar persists while scrolling/reading; popup is simpler. Decide at Phase 1.
- Chunk size / boundary strategy for streaming long text — tune for the latency-vs-prosody tradeoff during Phase 1.
- Keyboard-shortcut conflicts in Brave (reserved combos) — pick a default that's unlikely to collide; allow rebinding.

## Implementation Log
Append-only. Filled by implementer.

### Phase 0 — Local server, proven (260617) — COMPLETE ✓

**Outcome:** Kokoro TTS local server stands up and meets the latency target on this Mac. Local quality/latency is no longer unproven. Go for Phase 1.

**Run method chosen: Docker (`ghcr.io/remsky/kokoro-fastapi-cpu:latest`), ONNX-CPU path.**
- Rationale: Docker on Apple Silicon runs in a Linux VM with **no Metal/MPS passthrough** — so Kokoro-FastAPI's MPS-accelerated path (`start-gpu_mac.sh`) exists *only* in a bare-uv native install. Inside Docker, only the ONNX-CPU path runs. The research flagged ONNX-CPU as the safe path and MPS (#270) as the friction-prone one, so Docker-CPU gives us the safe path with the cleanest persistence/reproducibility.
- **MPS-vs-CPU verdict: CPU wins; MPS not pursued.** CPU-ONNX already beats the ~1s first-audio target (see numbers), so there was no reason to fight issue #270 / a bare-uv native install. MPS remains a future optimization lever if long-form first-audio (~3s, below) ever needs cutting — but it is not needed for the MVP loop. (Env check confirmed `apple/container` 0.9.0 + `uv` 0.10.7 are available if we ever revisit MPS natively.)
- Container started with `--restart unless-stopped` for session/crash survival.

**Measured numbers (M4 Pro, 24 GB, macOS 15.7.7, Docker CPU, voice `af_heart`):**
| Metric | Result | Target | Verdict |
|---|---|---|---|
| First-audio latency, short sentence (3 runs) | **0.73–0.86 s** | ~1 s | ✓ meets |
| First-audio latency, long paragraph (~380 chars) | ~3.06 s | — | acceptable; mitigate in Phase 1 by sending first sentence first |
| RTF, short sentence (2.89 s audio) | **4.3× real-time** | >1× | ✓ (research predicted ~2× for CPU; M4 Pro ~2.4× better) |
| RTF, long paragraph (24.85 s audio) | **4.88× real-time** | >1× | ✓ |
| Streaming | **Confirmed progressive** — long-paragraph chunks (98) arrived over 2.18 s, not single-burst | works | ✓ |
| Audio integrity | 24 kHz mono PCM s16le, mean −26 dB / max −9.6 dB (clean speech, not silent/clipping) | playable | ✓ |

Quality-vs-hosted-demo: **user signed off (260617)** — `af_heart` samples judged good quality, not materially worse than hosted demos. Engine decision (Kokoro) holds.

**Canonical defaults (become Phase 1 extension defaults):**
- Endpoint: `http://localhost:8880/v1/audio/speech`
- Voice: `af_heart` (Kokoro's top-rated American-female default; 67 voice packs loaded)
- Model id: `kokoro` (OpenAI aliases `tts-1` / `tts-1-hd` / `gpt-4o-mini-tts` also accepted)
- Native sample rate: 24 kHz mono

**Persistence model (decided with user, 260617): on-demand, no autostart.** Docker Desktop `AutoStart` stays `false` (user does not want it launching at login). The container's `--restart unless-stopped` policy gives exactly the desired behavior: quitting Docker Desktop stops the container; relaunching Docker Desktop restarts the daemon, which auto-resumes the `unless-stopped` container — so the model is already running when the user next opens Docker Desktop. The only case it stays down is an explicit `docker stop kokoro-tts` (then `docker start kokoro-tts`). No reboot-survival login item is wanted; the user starts Docker Desktop when they need narration and quits it otherwise.

**Resolves Open Questions:** server run method = Docker/ONNX-CPU (recorded above); ONNX-CPU is comfortably fast enough — no push toward a different server build.

**`local/` artifacts (gitignored):** `local/kokoro/`
- `scripts/benchmark.sh` — curl+ffprobe latency/RTF benchmark (reproducible; honors `ENDPOINT`/`VOICE`/`MODEL` env).
- `scripts/stream_probe.py` — stdlib streaming probe (true first-audio + progressive-streaming proof).
- `logs/` — timestamped benchmark + probe run logs.
- `samples/short_af_heart.wav`, `samples/long_af_heart.wav` — generated audio (sent to user for quality sign-off).
- `README.md` — operational runbook (start/stop/health, defaults, reboot persistence).

### Phase 1 — Speak-selection MVP (260617) — COMPLETE ✓ (user-verified in Brave)

**Outcome:** Brave/Chromium MV3 extension in `extension/`. Select text → `Cmd+Shift+S` (or right-click → "Read selection aloud") → streamed narration with an in-page control bar. User loaded it unpacked and verified the core loop works (play/pause, seek, speed, voice, reload-cleanup) and the audio quality. The post-test fixes below were applied and re-verified.

**Design decisions locked with user (resolves Open Questions):**
- **Player placement = in-page floating control bar, bottom-center.** Not the toolbar popup. Rationale (user): eyes/scroll are in the top half while reading, the mouse rests near the bottom, and the popup closes on page interaction. Bar lives in a **closed Shadow DOM** so host-page CSS can't break it. Exact position/styling to iterate.
- **Selected text is NOT echoed** in the player — transport controls only (play/pause, seek scrubber, time, speed 0.75–2×, close).
- **Trigger = `Cmd+Shift+S` + context-menu "Read selection aloud"** (recommended option). Shortcut rebindable at `brave://extensions/shortcuts`.

**Architecture (and the load-bearing reason for it):**
- Audio plays from a **hidden offscreen document** (`offscreen.js`), not the page. Decisive reason: many sites set `connect-src`/`media-src` CSP that would block both the localhost fetch and in-page `<audio>`. The offscreen doc runs in the extension's own CSP context, so it works on any site. The in-page bar is just a remote control.
- **Streaming via MediaSource:** the offscreen doc issues ONE `POST /v1/audio/speech` with `stream:true, response_format:mp3` and pipes the `ReadableStream` chunks into a `SourceBuffer('audio/mpeg')`. This leans on the server-side sentence-boundary chunked streaming we *proved* in Phase 0 (98 progressive chunks) — so playback starts ~1s in and the whole selection is one seekable timeline. No client-side chunking needed for Phase 1; the plan's "start before fully synthesized" requirement is met by server streaming + MSE.
- **Speed = client-side `playbackRate`** (pitch preserved), so changing speed is instant with no re-synthesis. The server `speed` param is left at 1.0.
- Message flow: content-bar → service worker → offscreen (controls); offscreen → service worker → content-bar (state). Trigger grabs selection via `chrome.scripting.executeScript` (command path) or `info.selectionText` (context-menu path). Session auto-stops on tab close / navigation.
- Config in `chrome.storage.sync`: `serverUrl` (default `http://localhost:8880`), `voice` (`af_heart`, list loaded live from `/v1/audio/voices`), `speed`. Pointing `serverUrl` elsewhere = the carried Chatterbox/quality-mode hook, no code change.

**Files:** `extension/` — `manifest.json` (MV3), `background.js` (SW), `offscreen.{html,js}` (player), `content.js` (Shadow-DOM bar), `options.{html,js}` (settings), `popup.{html,js}` (status/help), `README.md` (load + manual-test steps). Tracked in git (real project code, not under `local/`).

**Known MVP limitations:** top-frame selections only (iframe selections not captured); no custom toolbar icon (cosmetic); MP3-segment MSE may have minor chunk-boundary artifacts (tune later — plan's open question on chunk-boundary prosody); whole-article extraction is Phase 2.

**Post-test fixes (260617, after first user run in Brave):**
- **Speed dropdown + voice dropdown in the bar.** Replaced the cycle-button speed control with a native `<select>` (opens upward at viewport bottom) and added a voice `<select>`. Voice list is fetched by the service worker (extension context, CSP-safe) and passed to the bar in `SHOW_PLAYER`; selecting a voice persists to storage and applies to the next reading.
- **Fixed speed-not-applied-on-new-audio bug.** Root cause: live speed changes were applied to the offscreen player + bar label but never persisted, so a new reading reloaded the saved default (1×) while the bar still showed the last pick — display and playback disagreed. Fix: persist speed on every change (`storage.sync`); new readings start at the persisted speed; the bar initializes its speed control from that same value and re-syncs from playback state (`state.rate`). Also made the offscreen player re-assert the desired rate on `loadedmetadata`/`play` so a fresh MediaSource source can't silently reset it to 1×.
- Both speed and voice now persist across readings, as requested.
- **Fixed: audio kept playing after page reload** (bar gone, sound continued). Root cause: the stop-on-navigation listener keyed off `changeInfo.url`, which (a) doesn't change on a reload and (b) is only delivered with the `"tabs"` permission, which the extension doesn't hold — so it never fired. Switched to `changeInfo.status === "loading"`, which fires on both reload and navigation and needs no extra permission. Tab-close cleanup (`tabs.onRemoved`) was already correct.

**Validation still owed (user, in Brave):** load unpacked → select paragraph → `Cmd+Shift+S` → hear narration; pause/resume, scrub, speed, close all work; long multi-paragraph selection starts before full synthesis; changing voice/endpoint in Settings takes effect without reinstall.

### Phase 2 — Read whole article (260617) — COMPLETE ✓ (user-verified in Brave)

**Outcome:** Article extraction via Readability.js integrated into the extension. Two new triggers: "Read this article" context menu + keyboard shortcut (`Option+Shift+A` Mac / `Ctrl+Shift+A` Windows; rebindable). Extraction feeds text to the existing Phase 1 play pipeline. Graceful fallback toast when extraction fails. User loaded it unpacked and confirmed selection-reading and article-reading both work and play through the same control bar.

**Design decisions (locked with user):**
- **Triggers:** Both keyboard shortcut (`Option+Shift+A`) + context menu (page-level "Read this article"), matching Phase 1's dual-trigger pattern. `Cmd+Shift+A` was avoided on Mac because it opens Brave's tab search.
- **Fallback on extraction failure:** Toast message prompting the user to use `Cmd+Shift+S` for manual selection (no full-page fallback, no LLM). Chosen by user over full-page-text fallback.
- **Extraction library:** Mozilla Readability.js (same engine as Firefox Reader View). Runs in the content-script (isolated-world) context. No LLM call, no network extraction.

**Implementation:**
- **New files:**
  - `extension/Readability.js` (88.8 KB, Apache-2.0) — vendored from github.com/mozilla/readability. Loaded as a content script at `document_idle` before `content.js`. Defines `Readability` in the isolated world; the Node `module.exports` branch is inert in the browser.
  - `extension/extractor.js` — wrapper `extractArticle()`: clones the DOM (`document.cloneNode(true)`), runs Readability, converts the article HTML to plain text, applies a 100-char minimum threshold, returns `{ success, text, title }` or `{ success: false, reason }`.
- **Modified files:**
  - `extension/manifest.json` — added `Readability.js` + `extractor.js` to `content_scripts`; added the `read-article` command.
  - `extension/background.js` — added "Read this article" context menu (page context); routed both the `read-article` command and menu item through a shared `readArticle(tabId)` helper; `extractArticleFromTab(tabId)` runs `extractArticle()` via `chrome.scripting.executeScript` in the isolated world (sees the content-script-defined function).
  - `extension/offscreen.js` — **bug fix, see below.**

- **Reused from Phase 1:** `startReading()`, offscreen player, in-page Shadow-DOM control bar, all config/persistence/cleanup. Extraction is a pure pre-processor — no parallel pipeline.

**Bug found + fixed during testing (260617):** After reading an article, stopping it, then triggering a new (selection or article) read, the new read **resumed from the old position / kept the old audio** — and a read could bleed across tab switches. Root cause: `offscreen.js` `start()` called `stop()` but never aborted the previous streaming `fetch`, and never reset `audio.currentTime`, so the old MediaSource stream/position could carry into the new session. Fix: added an `AbortController` that aborts the prior fetch on every new `start()` (with an `AbortError` guard so the cancel isn't reported as a server error), and an explicit `audio.currentTime = 0` reset when the new source attaches. User re-verified: selection→article→selection and cross-tab reads now each start fresh.

**Validation results (user-verified in Brave):**
- Selection reading still works after the Readability content scripts were added (no interference). ✓
- "Read this article" extracts and narrates the main content through the same control bar. ✓
- After the offscreen fix: consecutive reads (selection ↔ article) and cross-tab reads each start cleanly from the beginning. ✓
- Graceful fallback path present for poorly-extracting pages (manual-selection toast). ✓
- Per-page extraction-quality sampling across news/blog/X was not exhaustively logged this session; the core loop + fallback are confirmed working. Future sessions can sample more pages if extraction tuning is ever needed.

**Plan status:** All three phases (0/1/2) implemented and user-verified. Engine-swap config hook carried (not built) as planned. Plan kept `active` only pending any further extraction-quality sampling; functionally the MVP is complete.
