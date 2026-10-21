#!/usr/bin/env python3
"""Chatterbox English on CPU for voice-lab-v3.

The script text is read unchanged from script.txt. Two renders differ only by
the exaggeration control (0.35 and 0.85). The clone prompt is the Open Speech
Repository male clip. The library generate() hardcodes max_new_tokens=1000,
which is short for this read, so this wrapper calls the same steps with 2500.
"""
import json
import os
import threading
import time
from pathlib import Path

os.environ.setdefault("HF_HOME", "/tmp/hf-voice")
os.environ.setdefault("HF_HUB_CACHE", "/tmp/hf-voice/hub")
os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")

import torch
import torch.nn.functional as F
import soundfile as sf

torch.set_num_threads(4)

from chatterbox.tts import ChatterboxTTS, punc_norm
from chatterbox.models.s3tokenizer import drop_invalid_tokens
from chatterbox.models.t3.modules.cond_enc import T3Cond

ROOT = Path("/workspace/news-launch/voice-lab-v3")
REF = ROOT / "reference" / "osr-us-male-0030-12s.wav"
TEXT = (ROOT / "script.txt").read_text().strip()
RAW = ROOT / "audio" / "raw"
RAW.mkdir(parents=True, exist_ok=True)

peak = {"hwm_kb": 0}
stop_flag = {"stop": False}


def read_mem():
    hwm = rss = None
    with open("/proc/self/status") as fh:
        for line in fh:
            if line.startswith("VmHWM:"):
                hwm = int(line.split()[1])
            elif line.startswith("VmRSS:"):
                rss = int(line.split()[1])
    return hwm, rss


def sampler():
    while not stop_flag["stop"]:
        hwm, _rss = read_mem()
        if hwm and hwm > peak["hwm_kb"]:
            peak["hwm_kb"] = hwm
        time.sleep(0.4)


def generate(model, text, exaggeration, audio_prompt_path, max_new_tokens):
    model.prepare_conditionals(str(audio_prompt_path), exaggeration=exaggeration)
    text = punc_norm(text)
    text_tokens = model.tokenizer.text_to_tokens(text).to(model.device)
    cfg_weight = 0.5
    text_tokens = torch.cat([text_tokens, text_tokens], dim=0)
    sot = model.t3.hp.start_text_token
    eot = model.t3.hp.stop_text_token
    text_tokens = F.pad(text_tokens, (1, 0), value=sot)
    text_tokens = F.pad(text_tokens, (0, 1), value=eot)
    with torch.inference_mode():
        speech_tokens = model.t3.inference(
            t3_cond=model.conds.t3,
            text_tokens=text_tokens,
            max_new_tokens=max_new_tokens,
            temperature=0.8,
            cfg_weight=cfg_weight,
            repetition_penalty=1.2,
            min_p=0.05,
            top_p=1.0,
        )
        speech_tokens = speech_tokens[0]
        n_raw = int(speech_tokens.shape[-1])
        speech_tokens = drop_invalid_tokens(speech_tokens)
        speech_tokens = speech_tokens[speech_tokens < 6561]
        n_kept = int(speech_tokens.shape[-1])
        speech_tokens = speech_tokens.to(model.device)
        wav, _ = model.s3gen.inference(
            speech_tokens=speech_tokens,
            ref_dict=model.conds.gen,
        )
        wav = wav.squeeze(0).detach().cpu().numpy()
        watermarked = model.watermarker.apply_watermark(wav, sample_rate=model.sr)
    return watermarked, n_raw, n_kept


def emit(payload):
    print(json.dumps(payload), flush=True)


def render_one(model, name, text, exaggeration, max_new_tokens):
    t1 = time.perf_counter()
    wav, n_raw, n_kept = generate(model, text, exaggeration, REF, max_new_tokens)
    gen = time.perf_counter() - t1
    dur = len(wav) / model.sr
    out = RAW / f"{name}.wav"
    sf.write(out, wav, model.sr)
    _hwm, rss = read_mem()
    emit({
        "event": "render",
        "id": name,
        "exaggeration": exaggeration,
        "cfgWeight": 0.5,
        "temperature": 0.8,
        "repetitionPenalty": 1.2,
        "maxNewTokens": max_new_tokens,
        "genSec": round(gen, 3),
        "durationSec": round(dur, 3),
        "nRaw": n_raw,
        "nKept": n_kept,
        "hitCap": n_raw >= max_new_tokens,
        "sr": model.sr,
        "vmHwmMb": round(peak["hwm_kb"] / 1024, 1),
        "vmRssMb": round(rss / 1024, 1),
        "rtf": round(gen / max(dur, 0.01), 3),
        "out": str(out),
        "reference": "reference/osr-us-male-0030-12s.wav",
    })


def main():
    threading.Thread(target=sampler, daemon=True).start()
    t0 = time.perf_counter()
    model = ChatterboxTTS.from_pretrained("cpu")
    load_sec = time.perf_counter() - t0
    hwm, rss = read_mem()
    emit({
        "event": "loaded",
        "device": str(model.device),
        "loadSec": round(load_sec, 3),
        "sr": model.sr,
        "vmHwmMb": round((peak["hwm_kb"] or hwm) / 1024, 1),
        "vmRssMb": round(rss / 1024, 1),
        "cuda": torch.cuda.is_available(),
    })
    render_one(model, "chatterbox-smoke", "The doors open at ten.", 0.5, 200)
    render_one(model, "chatterbox-exag035", TEXT, 0.35, 2500)
    render_one(model, "chatterbox-exag085", TEXT, 0.85, 2500)
    stop_flag["stop"] = True


if __name__ == "__main__":
    main()
