#!/usr/bin/env python3
"""Kokoro-82M voice-blend bridge. stdin JSON: {blend:{voice:weight}, speed, lang, out, model, voices, and either text or
segments:[{text, speed?, pauseAfterMs?}]}. Blend = weighted average of Kokoro style vectors (Apache-2.0 voices; no cloning).
Writes one mono WAV; prints JSON {sr, duration, segments:[{start,end,text}]} with measured per-segment times."""
import json, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro
req = json.load(sys.stdin)
k = Kokoro(req["model"], req["voices"])
blend = req["blend"]; tot = sum(blend.values())
style = sum(k.get_voice_style(v) * (w / tot) for v, w in blend.items())
segs = req.get("segments") or [{"text": req["text"]}]
out, info, t, sr = [], [], 0.0, 24000
for s in segs:
    a, sr = k.create(s["text"], voice=style, speed=float(s.get("speed", req.get("speed", 1.0))), lang=req.get("lang", "en-us"))
    info.append({"text": s["text"], "start": t, "end": t + len(a) / sr}); out.append(a); t += len(a) / sr
    p = int(sr * s.get("pauseAfterMs", 0) / 1000)
    if p: out.append(np.zeros(p, dtype=a.dtype)); t += p / sr
samples = np.concatenate(out)
sf.write(req["out"], samples, sr)
print(json.dumps({"sr": sr, "duration": len(samples) / sr, "segments": info}))
