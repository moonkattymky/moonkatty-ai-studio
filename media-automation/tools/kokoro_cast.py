#!/usr/bin/env python3
"""Kokoro-82M voice-blend bridge. stdin JSON: {text, blend:{voice:weight}, speed, lang, out, model, voices}.
Blend = weighted average of Kokoro style vectors (Apache-2.0 voices; no cloning). Prints JSON {sr, duration}."""
import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
req = json.load(sys.stdin)
k = Kokoro(req["model"], req["voices"])
blend = req["blend"]; tot = sum(blend.values())
style = sum(k.get_voice_style(v) * (w / tot) for v, w in blend.items())
samples, sr = k.create(req["text"], voice=style, speed=float(req.get("speed", 1.0)), lang=req.get("lang", "en-us"))
sf.write(req["out"], samples, sr)
print(json.dumps({"sr": sr, "duration": len(samples) / sr}))
