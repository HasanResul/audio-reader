# Kokoro local TTS server — runbook

Optional local OpenAI-compatible TTS server for the **Docker server** engine of the
Audio Reader extension. You only need this if you pick the *Docker server* engine in
settings; the in-browser WebGPU/WASM engines need nothing here. Proven on
M4 Pro / 24 GB / macOS 15.7.7.

## Canonical defaults (what the extension expects)
- Endpoint: `http://localhost:8880/v1/audio/speech`
- Voice: `af_heart`
- Model: `kokoro`
- Format: 24 kHz mono; request `wav` or `mp3`, `stream: true` for progressive playback.

## Run method
Docker, CPU/ONNX image ([`ghcr.io/remsky/kokoro-fastapi-cpu`](https://github.com/remsky/Kokoro-FastAPI)).
Apple Silicon Docker has no MPS/GPU passthrough, so this is the ONNX-CPU path by
design — it already meets the latency target, so a native MPS path is intentionally
not used.

## Operate
```bash
# create / start (first run pulls the image)
docker run -d --name kokoro-tts --restart unless-stopped -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-cpu:latest

# status / health
docker ps --filter name=kokoro-tts
curl -s http://localhost:8880/health

# start / stop / restart an existing container
docker start kokoro-tts
docker stop kokoro-tts
docker restart kokoro-tts

# logs
docker logs --tail 50 kokoro-tts

# list voices
# The extension already ships Kokoro's built-in voice catalog, so the picker works
# without this server. This endpoint only adds any *custom* voices the server exposes
# (merged on top of the built-ins when reachable).
curl -s http://localhost:8880/v1/audio/voices | python3 -m json.tool

# recreate from scratch (if the container is lost)
docker rm -f kokoro-tts 2>/dev/null
docker run -d --name kokoro-tts --restart unless-stopped -p 8880:8880 \
  ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

## One-shot synthesis test
```bash
curl -s -X POST http://localhost:8880/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{"model":"kokoro","input":"Hello from Kokoro.","voice":"af_heart","response_format":"wav"}' \
  -o /tmp/k.wav && afplay /tmp/k.wav   # afplay is macOS; use any player elsewhere
```

## Benchmark (reproducible)
```bash
./scripts/benchmark.sh              # latency + RTF (needs curl, ffprobe, jq, bc)
python3 ./scripts/stream_probe.py   # true first-audio + streaming proof (stdlib only)
```
Samples and logs are written under `server/samples/` and `server/logs/` (both
git-ignored).

## Persistence model (on-demand, no autostart)
Docker Desktop autostart is intentionally **off**. The container's
`--restart unless-stopped` policy means:
- Quit Docker Desktop → container stops (daemon down).
- Launch Docker Desktop → daemon restarts → container **auto-resumes** (no `docker start` needed).
- It only stays down if you explicitly `docker stop kokoro-tts` (then `docker start kokoro-tts`).

So: start Docker Desktop when you want narration — the model is already running — and
quit it when you're done.

## Web player (manual quality check)
http://localhost:8880/web/
