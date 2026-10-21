# Plan

## Phase 1 (accepted by owner)
1. Audit & architecture ✅  2. News Engine v0 ✅  3. Video Factory v0 ✅

## Phase 2 (this round) — see STAGES.md for SHAs/tests/output files
1. Real TTS (say / Piper / espeak-ng, fail loudly) ✅
2. AI news editor via Ollama with fact post-check + deterministic fallback ✅ (real run on 1.5B model)
3. Stronger verification (independence, wire/syndication, primary source, dates, contradictions → disputed) ✅
4. Video Factory v1 (xfade, intro/outro, credits, CC0 bed, loudnorm −16 LUFS, SRT validation, ffprobe QA) ✅ real video rendered
5. Social Publisher adapters (YouTube, Telegram, X, TikTok, Meta) — DRY-RUN default ✅ (mocked APIs only)
6. Scheduler (tz-aware, 2 daily issues, text posts, PROJECT plan, autoPublish OFF) ✅
7. Approval Center (API + standalone page) ✅
8. Analytics adapters + recommendations ✅ (mocked APIs only)
+ JobQueuePort / Host3D per studio contract ✅ (studio adapter = stub)

## Next (not started)
- Wiring: one orchestrator that connects Scheduler → NewsEngine → Editor → Factory (via JobQueue) → ApprovalCenter → Publisher → Analytics.
- OAuth token acquisition per platform; first LIVE test upload to a private YouTube test channel after explicit owner approval.
- Connect StudioJobQueueAdapter + real Host3D once the other developer's contract is final.
- Run the full suite on the Mac mini (say voices, h264_videotoolbox, memory budget).
- Brand/Project Memory and Cost Control modules (still interface-only).

## Phase 3 (done on branch, see STAGES.md)
Licensed media sourcing with relevance filter and branded-panel fallback, Video Factory v2, Kokoro plus a pinned MASTER VOICE (candidate), real orchestrator with resume, YouTube OAuth PKCE / Telegram setup (mock-tested), Approval Center v2, visemes plus Host3D v2 proposal, editorial (anchor profile, corrections desk, major-event pause), Studio JOBS_API alignment.

## Roadmap (Studio items)
1. voiceProfileId: **added** (field null until Studio 5 provides the id).
2. Anchor behavior/speech profile: **added** (`config/anchor-profile.json`, draft). Next step: enforce it in the editor prompt.
3. Breaking News Engine: **roadmap**. Detection only exists (`editorial.detectMajorEvent`). Needs a fast-poll source loop, a breaking template, an owner push notification and a breaking video preset.
4. Pause the regular schedule on major events: **added** (`applyMajorEventPolicy`). Not yet called from the scheduler daemon automatically.
5. Corrections/retractions: **added** (`CorrectionsDesk` with VerificationPort for Studio 4 and CorrectionLogPort for Studio 5). Correction video segment is roadmap.
6. Owner approval for anything breaking/controversial: **existed** (Approval Center; nothing auto-publishes).
Other roadmap items: forced-alignment visemes (e.g. Montreal/whisper timestamps), host overlay compositing once Studio delivers alpha video, owner master-voice lock, live publishing per platform after audits, image relevance via vision model (local).

## News 2.0 — Stage 2 plan (not started)
1. Wire `runPipeline` handlers to existing news/verify/editorial/video/approval modules; emit animation cues per segment.
2. Word timestamps (per-sentence durations + local forced alignment), cue JSON generator + schema validation test.
3. Video improvements: per-format templates (16:9 / 9:16), emotion-driven lower-thirds, story transitions, captions from word timings.
4. Three demo videos (Daily Briefing, Shorts, Space & Tech) with the owner-picked voice variant; QA + Approval only, no publishing.
