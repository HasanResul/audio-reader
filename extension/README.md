# Audio Reader — Chromium/Brave/Edge extension

Reads selected text — or a whole article — aloud with **Kokoro** TTS. Two ways to
produce audio, picked in settings:

- **In the browser** (WebGPU, or a WASM fallback) — zero install, runs Kokoro
  locally via onnxruntime-web. Downloads the model once (~300 MB WebGPU / ~86 MB
  WASM), then cached by the browser.
- **Local Docker server** — POSTs to a local OpenAI-compatible Kokoro server
  (see `../server/README.md`).

Everything is local; nothing leaves your machine. Chrome/Edge/Brave only (the
in-browser engine needs WebGPU/WASM as shipped by Chromium). Distribution is
load-unpacked / open-source — not an extension-store build.

Plans: `docs/plans/260617_audio-reader-mvp.md`, `docs/plans/260618_browser-tts-engine.md`.

## What it does
- **Read a selection:** select text → `Cmd+Shift+S` (or right-click → **Read selection aloud**).
- **Read the whole article:** `Option+Shift+A` (or right-click → **Read this article**). Extracts the main text (dropping nav/ads/comments) with Mozilla Readability. Poorly-extracting pages get a toast suggesting manual selection — no garbage is read.
- A floating control bar appears bottom-center: play/pause, seek scrubber, time, speed (0.75–2×), voice, a live **engine marker** (🟢 WebGPU / 🟡 WASM / 🔵 Server), and close.
- The toolbar icon shows a **badge** of the engine actually generating audio (`GPU`/`CPU`/`SRV`) while playing.
- Audio **streams**: playback starts on the first sentence while the rest synthesizes. The browser engine MP3-encodes each sentence on the fly into the same streaming pipeline as the server.
- Speed and voice persist to the next reading.

## Build (required for the in-browser engine)
The Docker engine is plain source and needs no build. The browser engine bundles
kokoro-js + onnxruntime-web + an MP3 encoder and vendors the ORT WebGPU wasm
(MV3 forbids remote script), so build it once:

```bash
cd extension
npm install
npm run build      # vendors ORT wasm → vendor/ort/, esbuilds → engines/browser-engine.bundle.js
```

`vendor/` and `engines/browser-engine.bundle.js` are git-ignored (regenerable).
Re-run `npm run build` after changing `src/browser-engine-entry.js`. If you only
ever use the Docker server engine, you can skip the build — the extension loads
without the bundle and just won't offer the browser engines.

## Load it (unpacked)
1. `chrome://extensions` (or `brave://extensions` / `edge://extensions`).
2. Toggle **Developer mode**.
3. **Load unpacked** → select this `extension/` folder.
4. Toolbar icon → **Settings**: pick an **Engine** and a voice/default speed.
5. (Optional) Confirm the shortcut at `chrome://extensions/shortcuts`.

## Engines (settings)
The picker reflects **live availability** when you open settings:

- **Automatic** (default) — uses the fastest available: WebGPU → Docker server → WASM.
- **Browser · WebGPU** 🟢 — selectable only if a GPU adapter is granted; otherwise disabled.
- **Docker server** 🔵 — selectable only if the server's `/health` responds; otherwise disabled with a ⚠️ "start the container" note. Needs the server running (see `../server/README.md`):
  ```bash
  docker start kokoro-tts
  curl -s http://localhost:8880/health
  ```
- **Browser · WASM** 🟡 — always selectable, but **slow** (below real-time): on long articles playback starts immediately and then buffers between sentences as it catches up. It never freezes the page. Best for short selections; use WebGPU or the server for long reads.

A dead engine is never auto-selected, and the tool never silently falls back to
WASM — if your explicitly-chosen engine is unavailable at read time it surfaces
an error rather than swapping.

## Architecture (one extension, one engine boundary)
Everything except "produce audio from text" is shared across engines.

- `background.js` — service worker. Shortcuts/context menus, grabs the selection (or triggers extraction), session lifecycle, message routing, the toolbar engine badge, and idle-warmup of an explicitly-chosen browser engine.
- `offscreen.html` + `offscreen-main.js` — hidden offscreen document; the only context that can reach localhost (page CSP can't block it) and run WebGPU + audio playback. Dispatches to the selected engine and resolves `Automatic`.
- `player.js` — **shared, engine-agnostic** playback: the `<audio>` element, MediaSource streaming pump, transport controls, and state reporting. Both engines feed it MP3 chunks.
- `engines/server-engine.js` — Docker engine: POST `/v1/audio/speech`, stream the MP3 response.
- `src/browser-engine-entry.js` → `engines/browser-engine.bundle.js` (built) — in-browser Kokoro: `tts.stream()` per sentence → resample 24→48 kHz → MP3-encode → same pipeline. WebGPU (fp32) preferred, WASM (q8) fallback. Vendored ORT wasm in `vendor/ort/`; model weights fetch from the HF hub at runtime and are browser-cached.
- `content.js` — in-page control bar (closed Shadow DOM). Pure remote control + the live engine marker; never fetches audio or echoes the text.
- `Readability.js` / `extractor.js` — Mozilla Readability (vendored) + a thin extraction wrapper, run in the content-script context.
- `options.*` / `popup.*` — settings (engine picker + voice/speed) and an engine-aware status popup.

## Known limitations
- Selections inside iframes aren't captured (top frame only).
- First browser-engine run downloads the model; progress shows in the bar (per-file, so the % cycles per file).
- Seek range grows as audio buffers; full duration is known once synthesis finishes.
- On long reads only a window around the playhead is buffered (~5 min back + ~90s ahead, to stay under the MediaSource memory quota); the full audio is kept in memory and assembled into a complete file once synthesis finishes, so seeking anywhere works from then on. While still synthesizing, seeking outside the current window briefly buffers. (Generation is paced to playback — pausing pauses synthesis — so the complete file is ready once you've reached the end.)
- WASM is below real-time — fine for short selections, slow (buffering) for long articles.
- Article extraction quality depends on the page; heavy SPAs / paywalled / oddly-structured layouts fall back to the manual-selection hint.
