# Contributing to Audio Reader

Thanks for your interest! This is a small, focused browser extension — contributions
that keep it simple and local-first are very welcome.

## Ground rules

- **Local-first is non-negotiable.** No telemetry, no analytics, no third-party
  network calls beyond the model download (Hugging Face Hub) and the user's own local
  Docker server. A PR that phones home will be declined.
- **One engine boundary.** Everything except *"produce audio from text"* is shared.
  New engines plug in behind the same boundary (`extension/engines/`); don't fork the
  player, control bar, or extraction per engine.
- **Manifest V3 only.** No remote script; bundle/vendor anything the browser engine
  needs (see the build step).

## Development setup

```bash
git clone https://github.com/HasanResul/audio-reader.git
cd audio-reader/extension
npm install
npm run build      # vendors ORT wasm + esbuilds the browser-engine bundle
```

Load the unpacked `extension/` folder via `chrome://extensions` → Developer mode →
Load unpacked. After editing `src/browser-engine-entry.js`, re-run `npm run build` and
reload the extension. For the optional Docker server engine, see
[`server/README.md`](server/README.md).

`vendor/` and `engines/browser-engine.bundle.js` are git-ignored (regenerable) — never
commit build output.

## Making changes

1. Fork and branch from `main` (`feat/...`, `fix/...`, `docs/...`).
2. Keep changes scoped; match the surrounding code style.
3. **Test manually in a real browser** — there's no automated test suite. Verify both a
   short selection and a whole-article read on the engine(s) you touched.
4. Update the relevant docs: `README.md`, `extension/README.md`, or the design docs
   under `docs/` if you change behavior or architecture.
5. Open a PR using the template; describe what you tested and on which engine/browser.

## Project layout

- `extension/` — the extension itself (architecture in `extension/README.md`).
- `server/` — optional local Kokoro Docker server runbook + benchmarks.
- `docs/` — design plans, research, experiments, and notes (see `docs/CLAUDE.md`).

## Reporting bugs / requesting features

Use the GitHub issue templates. Include browser + version, the engine in use, and steps
to reproduce. Security issues: **do not** open a public issue — see
[SECURITY.md](SECURITY.md).
