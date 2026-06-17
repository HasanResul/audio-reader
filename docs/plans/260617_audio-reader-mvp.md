---
status: draft
created: 260617
updated: 260617
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
(Empty — filled by implementer.)
