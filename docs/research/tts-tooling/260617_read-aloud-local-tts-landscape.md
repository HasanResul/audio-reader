---
status: complete
date: 260617
updated: 260617
query: existing solutions for "read web articles / selected text aloud" with local/self-hosted TTS, macOS, floating overlay player, highlight sync
---

# Local-TTS Read-Aloud Landscape (2025-2026)

## What Already Exists End-to-End (Closest Matches)

### OpenReader — strongest open-source match
- Repo: https://github.com/richardr1126/openreader  
- MIT license. Latest release v4.3.0, June 2026 (836 commits, active).
- Supports: EPUB, PDF, TXT, MD, DOCX. NOT web URL/article extraction.
- Self-hosted TTS: yes — Kokoro-FastAPI, KittenTTS-FastAPI, Orpheus-FastAPI, OpenAI, Replicate.
- **Word-by-word highlight sync via ONNX Whisper alignment** — the only open-source project found with this.
- Segment-level (sentence) highlighting also supported.
- No floating overlay player; it's a web app you run locally.
- No browser extension or "select text anywhere" shortcut.
- No CLI output narration.

### OpenWebTTS — Speechify-clone, simpler
- Repo: https://github.com/Gyyyn/OpenWebTTS (and fork https://github.com/sgj0/tts)
- MIT license. 43 commits, activity level unclear.
- Supports: PDF, EPUB, URLs (web import).
- Local TTS: yes — Piper, Kokoro, Coqui. Offline-first.
- No highlight sync mentioned.
- No floating player.

### Readest — ebook-focused, has sentence TTS highlight
- Repo: https://github.com/readest/readest  
- AGPL-3.0. Built with Next.js + Tauri v2. Cross-platform (macOS, Windows, Linux, iOS, Android, web). 468+ commits, active.
- Supports: EPUB, PDF. NOT web article extraction.
- TTS: on-device voices OR cloud. **Sentence-level highlight during TTS playback confirmed**.
- Speed 0.5×–3×, lock-screen controls.
- No custom local-server (OpenAI-compatible endpoint) support found.
- No floating overlay.

---

## Browser Extensions for Local TTS (Category 1)

### Custom TTS Reader (Firefox)
- URL: https://addons.mozilla.org/en-US/firefox/addon/custom-tts-reader/  
- Source: https://github.com/BassGaming/customtts  
- Designed for Kokoro-FastAPI. Configurable API URL, key, voice, speed. Context-menu "Read Selected Text". Streaming + download mode.
- **No word/sentence highlight sync.**
- Firefox only (no Chrome extension).

### local_tts_reader (Chrome extension)
- Repo: https://github.com/phildougherty/local_tts_reader  
- Chrome extension. Connects to any `http://localhost:8000/v1/audio/speech` compatible server. Voice select, speed 0.25×–4×, audio save.
- **No highlight sync.** Small repo (10 commits), maintenance unknown.

### XTTS-Read-Aloud (Chrome)
- Repo: https://github.com/psdwizzard/XTTS-Read-Aloud  
- Right-click or Ctrl+Shift+S. Connects to XTTS or AllTalk backend on port 8020. Latest release v0.7 March 2025.
- **No highlight sync.** macOS compatibility not stated.

### kokoro-tts-addon (Firefox)
- Repo: https://github.com/pinguy/kokoro-tts-addon  
- Local Flask server + Kokoro model. Linux/macOS/Windows. V3.0 released June 16, 2025.
- **No highlight sync.**
- macOS-compatible per docs.

### Read Aloud: A Text to Speech Voice Reader (ken107)
- Repo: https://github.com/ken107/read-aloud (Chrome/Firefox/Edge, MIT)
- Supports Google WaveNet, Amazon Polly, IBM Watson, Microsoft Azure, OpenAI — but **no custom local endpoint URL**. Last release 2022; still in Chrome Store.
- Text highlighting: on/off toggle (not word-sync confirmed).

### edge-tts-extension (travisvn)
- Repo: https://github.com/travisvn/edge-tts-extension  
- Uses Microsoft Edge's TTS API (cloud, not local). Free, high-quality voices. Chrome. No custom endpoint.

### openai-edge-tts server (travisvn)
- Repo: https://github.com/travisvn/openai-edge-tts  
- NOT a browser extension — it's a local server that emulates `/v1/audio/speech` using Microsoft Edge TTS (cloud calls). GPL-3.0. v2.0.0 Dec 2024. Good drop-in for extensions that need an OpenAI-compatible endpoint without paying OpenAI.

**Gap:** No browser extension found that combines (a) arbitrary local endpoint + (b) word/sentence highlight sync. These two features do not coexist in any single extension as of June 2026.

---

## Article Content Extraction (Category 2)

### Benchmark results (cross-verified, 2024 independent evaluation)
| Library | F1 | Precision | Recall | Maintenance |
|---|---|---|---|---|
| trafilatura | 0.945 | 0.925 | 0.966 | Active (2.1.0, 2025) |
| readability-js | 0.887 | 0.853 | 0.924 | Active (Mozilla) |
| newspaper3k | >0.9 all metrics | — | — | No release since 2018 — avoid |

trafilatura has statistically significantly better F1 than readability-js in ScrapingHub/independent benchmarks. No statistically significant difference in recall between the two (p>0.05).

**Is Readability.js good enough to skip LLM extraction?** Yes for most pages. Readability.js is the engine behind Firefox Reader View and Edge Immersive Reader — it handles the overwhelming majority of article pages reliably. LLM extraction (e.g., Haiku) is only needed as a fallback for unusual page structures (SPAs with client-side render, paywalled previews, heavy JS pages). A tiered approach is practical: trafilatura (Python) or Readability.js (JS) first; fall back to LLM only on empty/garbage output.

trafilatura is the better default if the backend is Python. Readability.js is the better default for a browser extension (runs in JS context). newspaper3k should be avoided — unmaintained.

---

## macOS Native "Speak Selection" (Category 3)

Built-in: System Settings → Accessibility → Spoken Content → "Speak selection" ON. Default shortcut: Option+Esc (configurable). Highlights text as spoken (configurable on/off). Shows an onscreen controller with play/pause, speed, skip controls.

**Limitations:**
- Only speaks Apple-provided or Apple-downloaded system voices.
- The `say` CLI command also only uses Apple voices (some third-party voices install as macOS speech synthesizer plugins — e.g., CereProc InfoVox iVox — but this path is obscure and not supported by modern APIs).
- No way to intercept Speak Selection and route to a custom TTS engine without replacing the system voice. There is no hook, no plugin API.
- There is no "select text anywhere → send to localhost:8880" mechanism in the native stack. You'd need a separate accessibility tool (e.g., a macOS app using AXUIElement to read selected text) or a keyboard shortcut app (e.g., BetterTouchTool, Hammerspoon, Karabiner) triggering a script.

**Practical path for CLI output narration:** Pipe stdout to a script that calls a local TTS API and plays audio. E.g., `claude code ... | tee /dev/tty | mytts-speak`. No existing off-the-shelf tool for this was found.

---

## Commercial Apps with Highlight Sync — Local Support Assessment (Category 4)

| App | Highlight sync | Local/offline TTS | Platform | Cost |
|---|---|---|---|---|
| Microsoft Edge Read Aloud | Word-level (built-in browser) | No (Edge cloud voices) | macOS/Win/Linux | Free |
| Speechify | Yes (word-level) | Offline download only (pre-rendered audio) | macOS, iOS, Android, Chrome ext | Paid |
| NaturalReader | Yes | No offline mode on any plan | Web, desktop, mobile | Paid |
| ElevenReader | Yes | No (ElevenLabs cloud) | Web, Chrome ext (no desktop app) | Free tier + paid |
| Readwise Reader | Sentence-level (word-by-word TTS scroll fixed 2024) | No (cloud TTS) | Web, iOS, Android | $9.99/mo |
| Pocket | TTS was a feature; **Pocket shut down July 8, 2025** | N/A | N/A | N/A |
| Readest | Sentence-level highlight during TTS | On-device voices (Apple/OS voices) | macOS, Win, Linux, iOS, Android | Free, AGPL |

None of the commercial apps accept a custom local TTS endpoint. Speechify's "offline" mode pre-renders cloud audio — not truly local inference.

Edge Read Aloud has the best built-in highlight sync (word-level, free) but is locked to Edge cloud voices and cannot be redirected to a local engine.

---

## Always-on-Top Floating Overlay on macOS (Category 5)

macOS has no built-in "always on top" API for arbitrary windows. Options:

**Existing tools (general window pinning):**
- Floaty (https://www.floatytool.com) — dedicated always-on-top pinning for any window. Uses Accessibility + Screen Recording APIs. No TTS integration.
- BetterTouchTool, Rectangle Pro — window management tools with some floating support.
- Afloat (legacy SIMBL injection) — broken on modern macOS, requires SIP disabled, Apple Silicon issues.

**Building a custom overlay — what to use:**
- **SwiftUI/AppKit**: Set `NSWindow.level = .floating` (or `.screenSaver` for above-everything). `NSWindow(contentRect:styleMask:.borderless ...)` with `.isMovableByWindowBackground = true` gives a draggable overlay. Well-documented approach. Native, no Electron bloat.
- **Tauri v2**: `set_always_on_top(true)`, `set_decorations(false)`. Community-confirmed working on macOS. MiniFy (Spotify mini player) uses this pattern. Cross-platform bonus.
- **Electron**: Same approach as Tauri but heavier. Not recommended unless already committed to Electron.

Real-world examples:
- Tuneful (macOS native floating music player) — demonstrates the SwiftUI pattern.
- MiniFy (Tauri + React floating Spotify player) — demonstrates the Tauri pattern.

No existing open-source floating TTS player found. This is genuinely custom territory.

---

## Kokoro-FastAPI on macOS — Setup Reality (Category 6)

- macOS 15.5+: Use Apple's Container Framework (WWDC 2025, `apple/container` on GitHub). Run Kokoro-FastAPI container at `http://localhost:8880`. No pip/Python needed.
- Older macOS: Docker Desktop or Orbstack; same container image.
- Voice Mode tool (https://voice-mode.readthedocs.io) includes an install script that sets up a LaunchAgent for auto-start on port 8880.
- OpenAI-compatible endpoint at `POST http://localhost:8880/v1/audio/speech`.
- docker-kokoro (hwdsl2): 50+ voices, 9 languages, streaming, NVIDIA GPU support, amd64+arm64.

---

## What Already Exists vs. What Must Be Built

### Can use/fork with minimal work:
- **OpenReader** (MIT): word-level highlight sync + local Kokoro TTS is already solved here. Gap: no web URL extraction, no browser extension, no floating player. Fork this for the document-reading use case.
- **Custom TTS Reader (Firefox)** or **local_tts_reader (Chrome)**: for "select text → local TTS" in browser, these exist but without highlight sync.
- **Readest**: sentence-level TTS highlight in an ebook reader. AGPL, cross-platform.
- **trafilatura**: article extraction, drop it in as a library.

### Must build:
1. **Browser extension with local endpoint + word/sentence highlight sync** — no existing extension combines both. Either extend local_tts_reader (no highlight) or Custom TTS Reader (Firefox only, no highlight) with a highlight sync layer. Word-level sync requires either: (a) Whisper-based forced alignment (OpenReader's approach) or (b) streaming token timestamps from the TTS server if it provides them.
2. **macOS system-wide "select text anywhere → local TTS" shortcut** — no off-the-shelf tool. Need a small macOS helper (Swift/Objective-C) that reads selected text via AXUIElement API, or a Hammerspoon/BetterTouchTool script calling a local endpoint.
3. **Floating always-on-top draggable overlay player** — no existing open-source TTS-specific one. Build with Tauri v2 or SwiftUI (30–100 lines of native code for the basic window).
4. **Claude Code CLI output narration** — no tool found. Implement as a shell wrapper that pipes stdout to a local TTS API call.

---

## Caveats

- Word-level highlight sync in OpenReader uses ONNX Whisper alignment (post-hoc, not real-time) — adds latency. Real-time word sync via streaming timestamps requires TTS server support (Kokoro-FastAPI does not appear to emit word timestamps as of June 2026; single source).
- Newspaper3k: widely cited in older benchmarks but should be treated as abandoned.
- Pocket: confirmed shut down July 8, 2025 — any docs referencing Pocket TTS are stale.
- ken107/Read Aloud: popular extension but last release 2022, OpenAI support listed but custom local endpoint URL not confirmed from docs (single source from search snippet only).
- Floaty and similar tools are for window management only — no TTS integration to leverage.
- ElevenReader desktop app: ElevenLabs has not published a timeline as of 2026 review.

---

## Sources
- https://github.com/richardr1126/openreader — OpenReader: features, TTS backends, word-highlight via Whisper
- https://github.com/Gyyyn/OpenWebTTS — OpenWebTTS: Speechify alt, Piper/Kokoro/Coqui, URL import
- https://github.com/readest/readest — Readest: Tauri ebook reader, sentence TTS highlight, AGPL
- https://github.com/pinguy/kokoro-tts-addon — Firefox + Kokoro local server, V3.0 June 2025, macOS supported
- https://github.com/phildougherty/local_tts_reader — Chrome ext, OpenAI-compat local server, no highlight
- https://github.com/psdwizzard/XTTS-Read-Aloud — Chrome ext, XTTS backend, v0.7 March 2025
- https://github.com/BassGaming/customtts — Custom TTS Reader (Firefox), Kokoro-FastAPI, streaming
- https://github.com/ken107/read-aloud — Read Aloud extension, MIT, last release 2022
- https://github.com/travisvn/openai-edge-tts — Local OpenAI-compat TTS server using Edge TTS, GPL-3.0
- https://github.com/scrapinghub/article-extraction-benchmark — Benchmark data: trafilatura vs readability-js F1 scores
- https://trafilatura.readthedocs.io/en/latest/evaluation.html — Trafilatura self-reported benchmark results
- https://mybyways.com/blog/running-kokoro-tts-via-macos-containerisation-framework — Kokoro on macOS via Apple Container Framework
- https://voice-mode.readthedocs.io/en/stable/kokoro/ — Voice Mode Kokoro install tool + LaunchAgent
- https://blog.rampatra.com/how-to-change-the-window-level-to-floating-popupmenu-etc-in-swiftui — SwiftUI floating window level
- https://github.com/tauri-apps/tauri/discussions/4452 — Tauri always-on-top floating window
- https://support.apple.com/guide/mac-help/have-your-mac-speak-text-thats-on-the-screen-mh27448/mac — macOS Spoken Content / Speak Selection docs
- https://www.speedreadinglounge.com/elevenreader-review — ElevenReader review 2026: no desktop app
- https://speechcentral.net/2025/05/22/pocket-shutdown-try-this-powerful-text-to-speech-alternative-with-instapaper/ — Pocket shut down July 8, 2025
- https://chuniversiteit.nl/papers/comparison-of-web-content-extraction-algorithms — Independent extraction algorithm comparison
- https://github.com/hwdsl2/docker-kokoro — Docker Kokoro TTS server, 50+ voices, OpenAI-compat
