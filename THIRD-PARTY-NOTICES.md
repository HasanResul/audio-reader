# Third-party notices

Audio Reader is MIT-licensed (see [`LICENSE`](LICENSE)), but it vendors and bundles
third-party components under their own licenses. This file collects those notices.

## Vendored in source

| Component | Where | License | Source |
|-----------|-------|---------|--------|
| Mozilla Readability | `extension/Readability.js` | Apache-2.0 | https://github.com/mozilla/readability |

`extension/Readability.js` retains its original Apache-2.0 header
(© 2010 Arc90 Inc; maintained by Mozilla).

## Bundled at build time

`npm run build` in `extension/` produces `engines/browser-engine.bundle.js`, which
bundles the following npm packages (see `extension/package.json`):

| Package | License | Source |
|---------|---------|--------|
| `kokoro-js` | Apache-2.0 | https://github.com/hexgrad/kokoro |
| `onnxruntime-web` | MIT | https://github.com/microsoft/onnxruntime |
| `@breezystack/lamejs` | LGPL-3.0 | https://github.com/zhuker/lamejs |

The build also copies the onnxruntime-web WebGPU/WASM binaries into
`extension/vendor/ort/` (MIT, Microsoft). These bundled/vendored artifacts are
git-ignored and regenerated from a clean checkout via `npm install && npm run build`.

> **LGPL note:** `@breezystack/lamejs` (the MP3 encoder) is LGPL-3.0. It is used
> unmodified and is replaceable — to comply with the LGPL you can substitute another
> build of lamejs by editing `extension/src/browser-engine-entry.js` and rebuilding.

## Model weights (downloaded at runtime)

The in-browser engine fetches Kokoro model weights from the Hugging Face Hub at
runtime (`onnx-community/Kokoro-82M-*-ONNX`); they are browser-cached, not shipped
in this repo. The Kokoro-82M model is Apache-2.0
(https://huggingface.co/hexgrad/Kokoro-82M).

The optional Docker server engine uses the third-party image
`ghcr.io/remsky/kokoro-fastapi-cpu` (https://github.com/remsky/Kokoro-FastAPI),
which carries its own license.
