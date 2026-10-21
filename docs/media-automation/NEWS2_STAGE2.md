# News 2.0 — Stage 2 (pipeline wiring, cues, video fixes, demos)

## Pipeline (`bin/news2.js` → `src/anchor/pipeline.js`)
Each stage persists `<demoDir>/NN-<stage>.json` and resumes on rerun.
| Stage | Wired to |
|---|---|
| news | `NewsEngine.run()` (RSS: NASA, ESA, BBC Sci/Tech, Guardian Sci/Tech) |
| fact_verification | NewsEngine verification: only `confirmed` / `primary_only` + `auto_approved`; Breaking requires `confirmed` |
| script_editor | `NewsEditor` (Ollama if reachable, else deterministic source-text editor), `pickFact` from source text only |
| humor_safety | `humorSafetyCheck` on candidate tags; tag appended after the facts, never edits them |
| voice_emotion | `selectEmotion` + master voice export |
| video | `MediaLibrary` (strict plan) / branded panel fallback → `rights.json` → `NewsVideoFactory` 16:9 + 9:16 (word-timed captions, `*.cues.json`) |
| qa | ffprobe/black/freeze/A-V sync QA + ebur128 −16 ±0.2 LUFS + cue schema check |
| approval | `ApprovalCenter.submit` → status **pending** (state `/workspace/ma-out/news2/state/approval.json`) |

## Word timestamps & cues
`KokoroBlendTTS` renders sentence by sentence in one process and returns **measured** sentence boundaries. Words inside a sentence are spread by length weight (`wordTimestamps`). `buildCues` → `checkCues` (schema `config/animation-cues.schema.json` + semantic checks); invalid cues abort the render.

## Video fixes
- Image relevance: two capitalised broad words (e.g. "Solar Orbiter") must match as a phrase; ≥ 2 terms **and** ≥ 60% of terms must hit; `strictMediaPlan` adds story-specific required terms (place after a preposition in the headline; multi-word names from the source summary that are also in the headline) and bigram queries ("Mars Helicopter").
- Branded panel no longer prints the headline (it is on the lower-third).
- Title-safe 5% margins; larger lower-third type (5.4% / 5.8% of short side).
- Stereo AAC 48 kHz in every output.
- Emotion-aware ASS caption styles (Serious / Curious / Bright) built from word timestamps.
- Intro shows format + date; outro unchanged (logo + subscribe card), credits card lists sources, image licenses, music, voice.
- Loudness: two-pass linear loudnorm → iterative gain trim + `alimiter` until |I − (−16)| ≤ 0.1 LU and TP ≤ −1 dBFS (`exactLoudness`).

## Limitations
- Word timing inside a sentence is estimated (±~100–150 ms); sentence edges are measured. No forced aligner yet.
- Image relevance is still keyword-based metadata matching: it can pick an **archive** image of the right subject rather than the event itself (demo A: an older NASA image of cyclones near Iceland; demo C: Solar Orbiter during pre-launch processing, not the switchback science). No visual/CLIP check.
- Ollama was not installed/running on this box during the run, so scripts came from the deterministic source-text editor (first source sentences), not the LLM.
- Kokoro emotion is pacing/pitch only (see EMOTION_ENGINE.md).
