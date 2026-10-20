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
