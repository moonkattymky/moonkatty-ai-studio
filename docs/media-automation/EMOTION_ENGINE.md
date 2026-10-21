# Emotion Engine & voice casting (News 2.0 Stage 1)

## Modes → prosody (`src/anchor/emotion.js`)
| Mode | speed | sentence pause | pitch (st) | gain dB | smile | gesture |
|---|---|---|---|---|---|---|
| SERIOUS | 0.92 | 480 ms | −0.5 | −1 | 0.0 | none |
| NEUTRAL | 1.00 | 360 | 0 | 0 | 0.2 | rest |
| EXCITED | 1.10 | 240 | +0.8 | +1.5 | 0.8 | paws_open |
| CURIOUS | 0.98 | 420 | +0.4 | 0 | 0.4 | head_tilt |
| PLAYFUL | 1.06 | 300 | +0.6 | +1 | 0.9 | paw_wave |
| WITTY | 1.02 | 520 (+650 before punchline) | +0.2 | +0.5 | 0.6 | ear_flick |
| EMPATHETIC | 0.90 | 520 | −0.3 | −1.5 | 0.1 | paws_together |

`selectEmotion(story)`: breaking → SERIOUS; deny-topic → EMPATHETIC (victims) / SERIOUS; humor tag → WITTY (PLAYFUL in Shorts); launch/record → EXCITED; question/mystery → CURIOUS; else NEUTRAL. An explicit override can never make a tragic/breaking story light. One voice for all modes.

## Honest limits of Kokoro-82M
- No emotion/style token, no SSML, no native pitch control. Only `speed` and the voice style vector are native.
- Pauses are produced by synthesizing sentence-by-sentence and inserting silence; pitch is an ffmpeg post-shift (`asetrate+aresample+atempo`, duration preserved) — kept to ≤ ±1 semitone because larger shifts sound processed.
- Perceived emotion therefore comes mostly from **text wording + pacing**. Differences between modes are audible but subtle; Kokoro intonation is still somewhat even on long sentences (mitigate with short sentences).
- Loudness normalized with `loudnorm I=-16:TP=-1.5:LRA=11` after gain, so gain only shapes dynamics, not final level.

## Casting (`bin/voice-casting.js`, `tools/kokoro_cast.py`)
Blend = weighted mean of Kokoro style vectors (no cloning).
- **A Smart & Charming** — am_michael 0.7 + am_puck 0.3, speed ×1.00, pitch +0.
- **B Energetic & Playful** — am_puck 0.6 + am_michael 0.4, speed ×1.06, pitch +0.4 st.
- **C Professional & Witty** — am_michael 0.75 + am_fenrir 0.25, speed ×0.98, pitch −0.2 st.
Each renders serious (SERIOUS), light (PLAYFUL), joke (WITTY). Output + sha256 in `casting.json`. **Owner approved B on 2026-10-21** → pinned as MOONKATTY_NEWS_MASTER_VOICE (see MASTER_VOICE_EXPORT.md).

## Engine licenses (commercial use)
| Engine | License | Commercial | Status |
|---|---|---|---|
| Kokoro-82M (+voices) | Apache-2.0 | yes | used |
| kokoro-onnx / onnxruntime | MIT | yes | used |
| espeak-ng (phonemizer) | GPL-3.0 | yes, copyleft obligations if distributed | used as phonemizer |
| Piper / en_US-ryan-high | Piper MIT (now GPL-3.0 in piper1-gpl); ryan voice dataset license must be checked per model card | verify | not used for casting |
| StyleTTS2 code | MIT; pretrained LibriTTS weights require disclosing synthetic speech, base speakers' consent terms | conditional | not evaluated (not installed, time) |
| F5-TTS | code MIT, **pretrained weights CC-BY-NC-4.0** | **no** | excluded |
| XTTS-v2 | Coqui Public Model License | **no** (non-commercial) | excluded |
