# FINAL AUDIT: media-automation (branch `feat/media-automation`, code @a33a315)

Date: 2026-10-21. Environment: Linux sandbox box (not the Mac mini). No feature changes; docs-only commit.
Evidence files on the box: `/workspace/ma-out/audit/` (`pipeline-evidence.txt`, `av-evidence.txt`, `approval-evidence.txt`, `approval-iphone.png`, `publish-guard.txt`, `publish-guard.js`, `tests.txt`, `episode-run.log`).
Test episode (scenario 2, "короткий выпуск MOONKATTY NEWS на английском"): `/workspace/ma-out/episode1/runs/ep-20261021-audit/`. It was **not published** and is left `pending` in the Approval Center.

## 1. What really works (verified live on the box)
| # | Item | Evidence |
|---|---|---|
| 1 | Real news fetch (RSS: NASA, ESA, BBC Science, BBC Tech) | fetched 87 items, 7 new, 80 duplicates, 0 errors (`pipeline-evidence.txt`) |
| 2 | Verification statuses | in store: 24 confirmed/auto_approved, 2 primary_only/auto_approved, 54 unconfirmed/pending_approval. The 3 selected stories are `primary_only` (official NASA, no corroboration, low-risk). Note: stories stored before 228c2ea keep their older status until they are recomputed. |
| 3 | Script via Ollama `qwen2.5:1.5b` with fact-preserving check | scripts by `ollama:qwen2.5:1.5b`. The grounding check **rejected** 2 LLM headlines with unsupported names ("Astronomers", "Works") and fell back to the deterministic headline. |
| 4 | Male US-English voice | Kokoro `am_michael` (candidate, **not locked, not chosen by Igor**). `tts=kokoro:am_michael` in both manifests. anchor.wav is pcm 48 kHz mono. |
| 5 | 16:9 and 9:16 video + QA | youtube 1920×1080, shorts 1080×1920, H.264 yuv420p 30 fps, AAC 48 kHz, 48.1 s, −16.5/−16.6 LUFS. All 15 QA checks passed (resolution, fps, codecs, duration, A/V sync, no black or frozen frames, loudness, true peak). |
| 6 | Subtitles | SRT next to each MP4 (8 and 11 cues), burned-in ASS in the video |
| 7 | Approval Center 127.0.0.1:8795 | no token → 401; with token → 200; list shows the audit items `pending`; video Range → 206 video/mp4; approve without a reviewer → 400; UI 200; iPhone screenshot `approval-iphone.png` |
| 8 | Publishing blocked without owner permission | `orchestrate publish` on the pending run → `awaiting_approval`, 0 posts created. Publisher with network hard-blocked: default/no flag → `dry_run`; flag only (account not live) → `dry_run`; live+flag but not approved → `failed: not approved by owner`; wrong flag value → `dry_run`; 0 network calls |
| – | Orchestrator end-to-end with resume, JSONL log, licensed media + rights.json, lip-sync handoff (visemes for each story) | `runs/ep-20261021-audit.jsonl`, `rights.json`, `lipsync-handoff.json` |

## 2. Verified only by tests/mocks
YouTube OAuth loopback+PKCE and token refresh; Telegram setup (getMe); Keychain write (`security`, macOS only); live publishing adapters (YouTube/Telegram/X/TikTok/Meta); Studio JobQueue adapter + `video_render` executor contract (a991e93) + `render_segment` stub; CorrectionsDesk ports (Studio 4/5); major-event schedule pause; Analytics collectors.

## 3. Not verified on the Mac mini
Nothing here has been run on macOS yet: `say` premium voices, Keychain, launchd/daemon scheduling, Kokoro/Piper/ffmpeg performance on Apple Silicon, Tailscale access from iPhone, Studio `services.videoRender.setExecutor` wiring inside the real Studio server. Follow `MAC_VERIFY.md`.

## 4. What is in the build
`feat/media-automation` is **NOT in the v1.2.1 build** (tags `v1.2.0-mac-preview` and `v1.2.1-mac-preview` do not contain any media-automation commit). It is a separate branch, not merged, with no PR to main. It runs standalone via `node media-automation/bin/*.js`. The Studio integration point (`video_render` executor) exists on our side only.

## 5. Known bugs / limitations
- **Weak image relevance** (keyword-based). In this audit episode the APOD "Ghosts in Cassiopeia" story shows a **nor'easter satellite image** (wrong); the cyclone story got a different cyclone (Pacific NW) image. Owner must check images in the Approval Center.
- APOD feed summaries are page boilerplate, so the script for such items is vague.
- The branded fallback panel repeats the headline that the lower-third already shows (duplicate headline).
- Viseme timing is approximate (uniform per phoneme, no forced alignment).
- **Voice not chosen**: am_michael is a candidate. The agent cannot listen; Igor must approve and lock it (`bin/master-voice.js lock`).
- Breaking News Engine is roadmap only (detection + pause hook exist).
- Publishing, OAuth and Keychain are mocked or dry-run only; no live publish was ever done. Platform audits are needed (YouTube private-lock, TikTok SELF_ONLY, Meta public URL, X paid tier).
- Final AAC track is mono (QA passes; stereo not required, but note for platforms).
- The small LLM (1.5B) sometimes hedges ("likely remnants…"). The grounding check catches unsupported names/numbers, not wording.
- Old episodes a–g remain `pending` in the Approval Center (test artifacts). Igor should reject them.

## 6. Tests
`node --test media-automation/test/`: **101 tests, 101 pass, 0 fail, 0 skipped** (`/workspace/ma-out/audit/tests.txt`).

## 7. Install (Mac mini)
See `MAC_VERIFY.md`. In short: `brew install ffmpeg espeak-ng librsvg node@20 ollama`; checkout `feat/media-automation` in a **separate worktree** (`git worktree add ~/ma feat/media-automation`) so the v1.2.1 app checkout is untouched; `npm ci`; Kokoro venv + model; `ollama pull qwen2.5:1.5b`; run tests; `node bin/master-voice.js check`; one `orchestrate issue` run; Approval Center on 127.0.0.1:8795 with a Keychain token.

## 8. Rollback
Nothing is merged into main or a release, so rollback means removing the worktree (`git worktree remove ~/ma`) and its state directory (e.g. `~/ma-out`, after a backup if wanted). Keychain entries live under service `moonkatty-media-automation` (remove manually with `security delete-generic-password` if desired). No Studio server code is changed; the `video_render` executor is only active if Studio calls `setExecutor`.

## 9. Readiness
- **Ready for Mac install as a standalone, owner-supervised, dry-run pipeline**: news → verification → LLM script → male voice → 16:9/9:16 video with QA → Approval Center. Nothing publishes.
- **Not ready for live publishing**: the voice is not chosen, image relevance needs human review, OAuth/Keychain have not been verified on the Mac, and platform app audits are pending.
