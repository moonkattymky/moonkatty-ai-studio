#!/usr/bin/env python3
"""Kokoro-82M (kokoro-onnx) bridge. stdin JSON: {text, voice, speed, lang, out, model, voices}. Writes WAV, prints JSON {sr, duration}."""
import json, sys
import soundfile as sf
from kokoro_onnx import Kokoro
req = json.load(sys.stdin)
k = Kokoro(req["model"], req["voices"])
samples, sr = k.create(req["text"], voice=req.get("voice", "af_heart"), speed=float(req.get("speed", 1.0)), lang=req.get("lang", "en-us"))
sf.write(req["out"], samples, sr)
print(json.dumps({"sr": sr, "duration": len(samples) / sr}))
