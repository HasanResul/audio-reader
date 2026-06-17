---
status: draft
kind: design
date: 260617
updated: 260617
topic: Architecture for a local-TTS read-aloud tool — Brave extension + local OpenAI-compatible TTS server
---

# Audio Reader — Design

## Goal

Read web articles/blogs (and incidentally LLM chat outputs) aloud via a self-hosted TTS engine, so the user can follow audio while skimming the page. User reads faster with audio. Primary surface: browser. No copy-paste friction — select text + shortcut, or "read whole article".

## Scope Decisions (from requirements convo 260617)

- **Browser-first.** Mostly articles/blogs in Brave. LLM-output narration is a free side effect (select the response text → same shortcut), not a built integration.
- **No highlight-sync.** Karaoke word/sentence highlighting explicitly NOT needed. Kills Whisper forced-alignment + fragile DOM overlay. Just play audio.
- **No system-wide selection / always-on-top overlay.** Native macOS accessibility helper (AXUIElement) and floating window explicitly out of scope. Player lives in the extension.
- **Voice quality matters; latency matters more for short selections.** User can wait for full-article generation; short selections must start fast.

## Architecture

```
Local TTS server (OpenAI-compatible /v1/audio/speech @ localhost) ── resident
        ▲
        │ POST {input, voice, speed, model}  → streamed audio
        │
Brave (Chromium MV3) extension
   • Select text + keyboard shortcut → POST → stream & play
   • "Read this article" → Readability.js extracts main content → POST
   • Mini player (popup/in-page): play/pause, speed, seek
   • Config: endpoint URL + voice (so engine is swappable)
```

### Engine: build against the API, not a model
Both **Kokoro-FastAPI** and **Chatterbox-TTS-Server** expose the same OpenAI `/v1/audio/speech` endpoint. Extension is engine-agnostic — configurable endpoint + voice.
- **Kokoro-82M (default):** Apache-2.0, #1 TTS Arena, streams <1s on M4 Pro, ~1GB RAM. Best for fast short selections. User confirmed "suffices".
- **Chatterbox (quality mode):** MIT, beat ElevenLabs in blind tests, heavier/slower. User confirmed "higher quality". Point the endpoint here for full-article reading where waiting is fine.
- Two-tier maps to the latency tradeoff: fast selections → Kokoro, long-form quality → Chatterbox. MVP ships Kokoro; switching is a config change, not a rebuild.

### Article extraction: Readability.js, no LLM
Mozilla **Readability.js** (engine behind Firefox Reader View) handles the large majority of pages in-extension (JS context). The originally-proposed Haiku/LLM extraction is NOT needed for the common case — keep an LLM only as a rare fallback for SPA/garbage-output pages (likely deferred indefinitely).

## What Exists vs. Must Build (from research 260617)

- Existing extensions (local_tts_reader / Chrome, Custom TTS Reader / Firefox) prove "select → local endpoint" but have no article extraction and no real player. Validation-only; not the deliverable.
- No tool combines local-endpoint + article extraction + player → that integration is the build.
- Research reports: `docs/research/tts-models/260617_local-tts-apple-silicon.md`, `docs/research/tts-tooling/260617_read-aloud-local-tts-landscape.md`.

## Staged Plan

- **Stage 0 — PARTIAL.** Voice validated via *hosted demos only* (Kokoro + Chatterbox websites): both acceptable, Chatterbox higher quality, Kokoro suffices. Local inference (latency, footprint, macOS server setup) still UNPROVEN — must stand up a local server before trusting the loop.
- **Stage 1 — MVP.** Brave MV3 extension: select-text + shortcut → stream from local Kokoro; mini-player with play/pause, speed, seek; configurable endpoint/voice.
- **Stage 2.** "Read whole article" via Readability.js.
- **Stage 3 (optional).** Quality-mode toggle (point at Chatterbox); menu-bar control; CLI-pipe narration for Claude Code output.

## Open Questions
- How will the local TTS server be run/kept resident on macOS (Docker / Apple Container Framework / bare uv / LaunchAgent auto-start)? Decide at Stage 1 setup. Kokoro-FastAPI MPS path had macOS setup friction (issue #270); ONNX CPU path (~2× real-time) is the safe fallback.
- Player placement: popup vs injected in-page bar. Lean in-page bar for persistence while scrolling; TBD at Stage 1.
- Does the chosen Kokoro server emit word timestamps? (Not needed now; only relevant if highlight-sync is ever revived.)
