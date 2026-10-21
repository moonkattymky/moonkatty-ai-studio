# Required APIs / services and cost estimates

> **All numbers are ESTIMATES** (Oct 2026, list prices as commonly published; verify before purchase). Free/local options are preferred and are the default in code.

| Need | Default (free/local) | Optional paid | Est. monthly cost |
|---|---|---|---|
| News ingestion | Public RSS/Atom feeds, official press-release feeds (gov, agencies, NASA, ESA) | NewsAPI / GDELT (GDELT free) | $0 (paid NewsAPI ~$449/mo business — not needed) |
| Summaries/headlines | Deterministic local extractive (built-in); local LLM via Ollama/LM Studio (Llama 3.x 8B / Qwen 7B Q4) | OpenAI / Anthropic / xAI API | $0 local; ~$5–30/mo API at ~100 stories/day (estimate) |
| Translation | Hook only; local (Argos Translate / NLLB via Ollama) | DeepL API | $0 local; DeepL Free 500k chars/mo |
| TTS | macOS `say` (free), Piper (free, MIT, local) | ElevenLabs / OpenAI TTS | $0 local; ~$5–22/mo paid tiers (estimate) |
| Video render | ffmpeg (LGPL/GPL, local) | — | $0 (electricity) |
| Stock media | Own assets; Pexels/Pixabay (free licenses, attribution rules) | Storyblocks etc. | $0 |
| Music | CC0 / YouTube Audio Library / own tracks (license field enforced) | Epidemic Sound | $0; ~$10–20/mo if paid (estimate) |
| YouTube publish | YouTube Data API v3 (free, quota 10,000 units/day; upload ≈1,600 units → ~6 uploads/day) | quota increase request | $0 |
| TikTok publish | TikTok Content Posting API (requires app audit) | — | $0 |
| Instagram/Facebook Reels | Meta Graph API (already partly integrated in `meta.js`) | — | $0 |
| 3D character | Blender (free, local) — via adapter, other developer | — | $0 |

**Baseline estimate:** $0/month software cost with local-only stack; **~$20–70/month** if paid LLM + premium TTS + music library are enabled (estimate). Hardware: existing Mac mini; power ~10–40 W.
