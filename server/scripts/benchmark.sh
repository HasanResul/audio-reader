#!/usr/bin/env bash
# Kokoro-FastAPI Phase 0 benchmark.
# Measures: first-audio latency (streaming TTFB), full-generation time, RTF.
# Requires: curl, ffprobe. Server expected at $ENDPOINT.
set -euo pipefail

ENDPOINT="${ENDPOINT:-http://localhost:8880/v1/audio/speech}"
VOICE="${VOICE:-af_heart}"
MODEL="${MODEL:-kokoro}"
OUTDIR="$(cd "$(dirname "$0")/.." && pwd)"
SAMPLES="$OUTDIR/samples"
LOGS="$OUTDIR/logs"
mkdir -p "$SAMPLES" "$LOGS"

SHORT="The quick brown fox jumps over the lazy dog."
LONG="Artificial intelligence is transforming how we interact with technology. \
From voice assistants that understand natural speech to systems that can summarize \
long articles in seconds, the pace of change is remarkable. Local text-to-speech \
models now run entirely on a personal laptop, keeping data private while delivering \
near-instant narration of any web page you choose to read aloud."

req() { # $1=text $2=format $3=stream(true/false)
  printf '{"model":"%s","input":%s,"voice":"%s","response_format":"%s","stream":%s,"speed":1.0}' \
    "$MODEL" "$(printf '%s' "$1" | jq -Rs .)" "$VOICE" "$2" "$3"
}

echo "=== Kokoro-FastAPI Phase 0 benchmark ==="
echo "endpoint=$ENDPOINT  voice=$VOICE  model=$MODEL"
echo

# --- 1. First-audio latency: streaming, short sentence, repeated ---
echo "--- 1) First-audio latency (streaming, short sentence; TTFB) ---"
for run in 1 2 3; do
  ttfb=$(curl -s -o /dev/null -w '%{time_starttransfer}' \
    -X POST "$ENDPOINT" -H 'Content-Type: application/json' \
    -d "$(req "$SHORT" mp3 true)")
  echo "  run $run: first-audio (TTFB) = ${ttfb}s"
done
echo

# --- 2. Short sentence: full generation + RTF, save sample ---
echo "--- 2) Short sentence: full generation + RTF ---"
t0=$(date +%s.%N)
curl -s -o "$SAMPLES/short_af_heart.wav" \
  -X POST "$ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(req "$SHORT" wav false)"
t1=$(date +%s.%N)
gen=$(echo "$t1 - $t0" | bc)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SAMPLES/short_af_heart.wav")
rtf=$(echo "scale=2; $dur / $gen" | bc)
echo "  audio_dur=${dur}s  gen_time=${gen}s  speedup=${rtf}x real-time  (sample: short_af_heart.wav)"
echo

# --- 3. Long paragraph: full generation + RTF, save sample ---
echo "--- 3) Long paragraph (~380 chars): full generation + RTF ---"
t0=$(date +%s.%N)
curl -s -o "$SAMPLES/long_af_heart.wav" \
  -X POST "$ENDPOINT" -H 'Content-Type: application/json' \
  -d "$(req "$LONG" wav false)"
t1=$(date +%s.%N)
gen=$(echo "$t1 - $t0" | bc)
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SAMPLES/long_af_heart.wav")
rtf=$(echo "scale=2; $dur / $gen" | bc)
echo "  audio_dur=${dur}s  gen_time=${gen}s  speedup=${rtf}x real-time  (sample: long_af_heart.wav)"
echo

echo "=== done. samples in $SAMPLES ==="
