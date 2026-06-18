#!/usr/bin/env python3
"""Measure true first-audio latency and verify progressive streaming.
Stdlib only (urllib). Times arrival of the first non-empty audio chunk and the
full stream, for a long input where streaming should be observable."""
import json, time, urllib.request, sys

ENDPOINT = "http://localhost:8880/v1/audio/speech"
VOICE = "af_heart"
MODEL = "kokoro"

LONG = ("Artificial intelligence is transforming how we interact with technology. "
        "From voice assistants that understand natural speech to systems that can "
        "summarize long articles in seconds, the pace of change is remarkable. Local "
        "text-to-speech models now run entirely on a personal laptop, keeping data "
        "private while delivering near-instant narration of any web page you choose "
        "to read aloud.")

def probe(text, label):
    body = json.dumps({"model": MODEL, "input": text, "voice": VOICE,
                       "response_format": "mp3", "stream": True, "speed": 1.0}).encode()
    req = urllib.request.Request(ENDPOINT, data=body,
                                 headers={"Content-Type": "application/json"})
    t0 = time.perf_counter()
    first_audio = None
    total_bytes = 0
    chunk_times = []
    with urllib.request.urlopen(req) as resp:
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            now = time.perf_counter() - t0
            if total_bytes == 0:
                first_audio = now
            total_bytes += len(chunk)
            chunk_times.append(now)
    t_end = time.perf_counter() - t0
    print(f"[{label}] first-audio={first_audio*1000:.0f}ms  "
          f"full-stream={t_end:.2f}s  bytes={total_bytes}  chunks={len(chunk_times)}")
    # streaming evidence: spread of chunk arrival times
    if len(chunk_times) >= 2:
        print(f"          chunks arrived over {chunk_times[-1]-chunk_times[0]:.2f}s "
              f"(first chunk @ {chunk_times[0]*1000:.0f}ms, last @ {chunk_times[-1]:.2f}s) "
              f"-> {'PROGRESSIVE (streaming confirmed)' if chunk_times[-1]-chunk_times[0] > 0.3 else 'single-burst'}")
    return first_audio

print("=== first-audio latency (3 runs, short) ===")
SHORT = "The quick brown fox jumps over the lazy dog."
for i in range(1, 4):
    probe(SHORT, f"short run {i}")
print("\n=== streaming behavior (long paragraph) ===")
probe(LONG, "long")
