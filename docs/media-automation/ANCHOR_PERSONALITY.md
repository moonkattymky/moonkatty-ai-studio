# News 2.0 — Anchor personality, humor, formats, pipeline

Config: `media-automation/config/anchor-personality.json` (supersedes tone notes in `anchor-profile.json`; voice pinned to MOONKATTY_NEWS_MASTER_VOICE = stock am_fenrir (final, approved by Igor 2026-10-21; supersedes casting B)).
Code: `media-automation/src/anchor/` (`humor.js`, `emotion.js`, `formats.js`, `pipeline.js`). Tests: `media-automation/test/anchor.test.js`.

## Character
Fictional cat anchor of MOONKATTY NEWS. Male US English voice that sounds 25–35, warm mid/mid-low, confident, friendly, energetic; never sensational. Original synthetic voice (blend of stock Kokoro-82M voices) — no cloning, no imitation of any real person.

## Humor Engine
- `classifyTopic(text)` → `{denied, allowed, humorAllowed}`. Deny-list always wins: deaths, war, terror, epidemics, disasters with victims, crimes against people. Humor only if a topic also hits the allow-list (science, space, tech, animals, culture, food, mild weather). Unknown topics → no humor.
- `humorSafetyCheck(story, joke, ctx)` is a **separate gate**: rejects breaking format, deny topics, jokes > 22 words, unsafe language, numbers or proper names not present in the story (a joke may never add or alter facts), budget (max 2 per briefing) and spacing (≥ 2 stories between jokes).
- `applyHumor()` never edits `story.text`; an approved joke goes into `story.humorTag` (a short tag after the fact).
- Limits: regex classifier — conservative, English only; false negatives possible for euphemisms. Human approval in Approval Center remains mandatory.

## Show formats (`formats.js`)
| Format | Length | Humor | Notes |
|---|---|---|---|
| Daily Briefing | 3–6 min, 5–8 stories | ≤2 jokes | 16:9 |
| Shorts | 30–58 s, 1 story | ≤1 | 9:16, PLAYFUL when humor |
| Space & Tech | 2–5 min, 3–6 stories | ≤2 | 16:9 |
| Breaking | 30–120 s, 1 story | **none** | confirmed-only, SERIOUS; pipeline throws if any story isn't `verification: confirmed` |

## Pipeline
`News → Fact Verification → Script Editor → Humor Safety → Voice&Emotion → Video → QA → Approval`.
`runPipeline({dir, format, handlers, input})` writes each stage to `<dir>/NN-<stage>.json` and resumes from persisted outputs. Wiring the existing modules (news, verify, editorial, video, approval) as handlers is Stage 2.
