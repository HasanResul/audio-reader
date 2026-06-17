# Audio Reader — Brave/Chromium extension (Phase 1 + 2)

Reads selected text — or a whole article — aloud through the local Kokoro TTS
server stood up in Phase 0. Plan: `docs/plans/260617_audio-reader-mvp.md`.

## What it does
- **Read a selection:** select text on any page → `Cmd+Shift+S` (or right-click → **Read selection aloud**).
- **Read the whole article:** `Option+Shift+A` (or right-click → **Read this article**). Extracts the main article text (dropping nav/ads/comments) with Mozilla Readability and reads it. If a page extracts poorly, a toast suggests selecting text manually instead — no garbage is read.
- A floating control bar appears bottom-center: play/pause, seek scrubber, time, speed dropdown (0.75–2×), voice dropdown, close.
- Speed and voice are dropdowns (open upward at the bottom of the screen) and persist: the next reading uses your last speed and voice. Changing the voice applies to the next reading.
- Audio streams from `localhost:8880` and starts playing in ~1s; the rest synthesizes while you listen.
- Everything is local; nothing leaves the machine.

## Prerequisites
The TTS server must be running (see `local/kokoro/README.md`):
```bash
docker start kokoro-tts        # or: docker ps --filter name=kokoro-tts
curl -s http://localhost:8880/health
```

## Load it (unpacked)
1. Open Brave → `brave://extensions` (or `chrome://extensions`).
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select this `extension/` folder.
4. (Optional) Click the toolbar icon → **Settings** to pick a voice / default speed, or **Test connection**.
5. Confirm/adjust the shortcut at `brave://extensions/shortcuts` (default `Cmd+Shift+S`).

## Try it
1. Open a normal article page (not `brave://` or the extension store — content scripts can't run there).
2. Select a paragraph.
3. Press `Cmd+Shift+S`. The bar appears and narration starts.
4. Test pause/resume, drag the scrubber, cycle speed, then close (✕).
5. Select a long, multi-paragraph block → playback should start before the whole thing is synthesized.
6. To read the whole page, press `Option+Shift+A` (or right-click → **Read this article**). On a page that doesn't extract cleanly, a toast points you back to manual selection.

## Configuration
- **Settings page** (toolbar icon → Settings): server URL, voice (loaded live from the server), default speed.
- Pointing the server URL at a different OpenAI-compatible TTS server (e.g. a future Chatterbox instance) switches engines with no code change.
- Defaults: `http://localhost:8880`, voice `af_heart`, speed `1×`.

## Architecture (why it's split this way)
- `background.js` — service worker. Handles the shortcuts + context menus, grabs the selection (or triggers extraction), manages the session, and routes messages.
- `offscreen.html` / `offscreen.js` — hidden offscreen document that does the localhost fetch and plays the audio via MediaSource (streaming). Runs in the extension's context, so page CSP can't block the fetch or the audio. Aborts the prior fetch and resets the timeline on every new read.
- `content.js` — the in-page control bar (closed Shadow DOM, bottom-center). Pure remote control; sends commands, renders state. Does not fetch audio or echo the selected text.
- `Readability.js` — Mozilla's article-extraction library (vendored, MIT-compatible Apache-2.0). Runs in the content-script context.
- `extractor.js` — thin wrapper: clones the page DOM, runs Readability, returns the plain article text (or a failure reason). Invoked on demand by the service worker for "read this article".
- `options.*` / `popup.*` — settings and a status/help popup.

## Known limitations (MVP)
- Selection must be in the top frame (selections inside iframes aren't captured).
- No custom toolbar icon yet (Chrome shows a default) — cosmetic.
- Seek range grows as audio buffers; full duration is known once synthesis finishes.
- Article extraction quality depends on the page: some pages (heavy SPAs, paywalled or unusually structured layouts) extract poorly and fall back to the manual-selection hint.
