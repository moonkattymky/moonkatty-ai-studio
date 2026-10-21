# TTS comparison (male US-English news anchor)

Requirement: adult male, confident US English. Female voices are excluded. Samples are in `/workspace/ma-out/voice-samples/` (about 15 s each) and described in `samples.json`.

**Not yet verified by ear.** The agent cannot listen to audio. The ranking below uses published model grades and technical checks (loudness, clipping, duration).

| Engine / voice | Cost | Runs on | Quality (published grade / notes) | Status |
|---|---|---|---|---|
| Kokoro-82M `am_michael` | free, Apache-2.0 | CPU (onnx), Mac OK | grade C+ (best US male in Kokoro) | **demo candidate (MASTER VOICE, not locked)** |
| Kokoro `am_fenrir` | free | CPU | C+, deeper | alternative |
| Kokoro `am_puck` | free | CPU | C+ | alternative |
| Kokoro `am_adam` | free | CPU | F+ (artifacts) | rejected |
| Piper `en_US-ryan-high` | free, MIT | CPU | clear but robotic prosody; Studio 4 refuses it | sample only |
| Piper `lessac-*` | free | CPU | female | excluded |
| macOS premium (e.g. "Evan (Premium)", "Nathan (Enhanced)") | free on macOS | Mac only | good prosody, not testable in Linux sandbox | evaluate on Mac (MAC_VERIFY §3) |
| espeak-ng | free | any | robotic | fallback/test only |

Pipeline: lexicon respellings (`assets/lexicon.json`), `[pause N]` markup, rate 0.95, two-pass loudnorm −16 LUFS, anchor.wav 48 kHz mono for lip-sync.

## Paid alternatives (NOT enabled; prices as publicly listed, verify before use)
| Service | Approx. price | Notes |
|---|---|---|
| ElevenLabs | Starter $5/mo (~30k credits ≈ 30 min), Creator $22/mo (~100k ≈ 100 min), Pro $99/mo (~500k) | best realism; voice cloning needs consent; commercial use from Starter |
| OpenAI TTS (`tts-1` / `tts-1-hd`, `gpt-4o-mini-tts`) | $15 / $30 per 1M chars; gpt-4o-mini-tts ≈ $0.015/min | voices onyx/echo/ash are male |
| Azure Neural TTS | ~$15 per 1M chars (neural), free tier 0.5M chars/mo | SSML, en-US male e.g. Andrew/Guy/Davis; custom neural voice extra |
| Google Cloud TTS | WaveNet/Neural2 ~$16 per 1M chars, Studio ~$160 per 1M; free tier 1M (WaveNet) / 4M (standard) | en-US Neural2-D/J male, Studio-Q male |
A daily 2×60 s episode is about 2×900 chars, roughly 55k chars per month. That fits inside the Azure and Google free tiers and costs about $1/month on OpenAI. Enabling any of these needs owner approval and a key in Keychain.
