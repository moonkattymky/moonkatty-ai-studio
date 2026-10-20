#!/usr/bin/env python3
"""Offline Kokoro synthesis. Model files stay in news-launch/models and are not committed."""
import json
import sys
import soundfile as sf
from kokoro_onnx import Kokoro

def main():
    job = json.load(sys.stdin)
    kokoro = Kokoro(job["model"], job["voices"])
    results = []
    for item in job["items"]:
        audio, rate = kokoro.create(item["text"], voice=item["voice"], speed=float(item.get("speed", 1.0)), lang="en-us")
        sf.write(item["out"], audio, rate)
        results.append({"out": item["out"], "durationSec": round(len(audio) / rate, 3), "sampleRate": rate, "voice": item["voice"]})
    names = kokoro.get_voices()
    json.dump({"voices": names, "results": results}, sys.stdout)

if __name__ == "__main__":
    main()
