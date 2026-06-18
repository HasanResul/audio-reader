---
status: complete
created: 260618
updated: 260618
---

# Analysis — WebGPU Kokoro in MV3 offscreen

## Verdict: PASS (with a fallback caveat)

WebGPU runs inside the MV3 offscreen document (real `apple metal-3` adapter) and beats the Docker
baseline at paragraph scale: **9.52× RT vs ~4.6× (≈2.07× faster)**. The browser engine is viable and,
on WebGPU-capable hardware, the *better* engine — faster than Docker with zero install. Greenlights the
dual-engine build (`engines/server/` + `engines/browser/`).

## The caveat that shapes positioning
The WASM fallback (no WebGPU) is **0.71× RT — slower than real-time**, so it cannot keep up with
continuous playback (audio would stall), and it blocks the offscreen thread (Chrome "unresponsive"
dialog). Implication: **"browser default" is correct only when WebGPU is present.** On non-WebGPU
machines, silently falling back to WASM gives a bad first impression. Engine selection must be
**WebGPU-gated**: browser when `requestAdapter()` succeeds, otherwise steer to Docker (or warn loudly),
not silent WASM. This is a refinement of the prior "browser default, Docker opt-in" decision, driven by
the 0.71× floor — needs user sign-off (open question below).

## Secondary findings (design inputs, not blockers)
- **Cold load 26.2s** (fp32 ~326MB download + shader compile), one-time then browser-cached. Real impl
  needs a first-run progress UI + consent (also required for Web Store "remote code" concerns).
- **Warmup ~2.7s** baked into the first `generate()` call. For short selections this dominates (1.45×).
  Mitigate by warming the model on idle so the first real request is fast.
- **fp32 vs fp16/q8 on WebGPU** not tested. fp32 is the documented WebGPU recommendation; fp16 (~163MB)
  could cut load time but research flags possible quality degradation. Defer unless load time bites.

## Web Store blocker (from research, re-flagged here so it isn't lost)
Extensions fetching model weights at runtime have been rejected as "remotely hosted code," and the
package cap can't hold 82MB. Publishing path needs download-on-first-run with consent UI, or
distribution outside the Web Store. Decide before banking on "just publish it."

## Decision unlocked
Build dual-engine into `extension/` with WebGPU-gated selection. Architecture step pending user
confirmation (it mutates the working extension).
