# Stage notes (phase 2, branch feat/media-automation)

Box: Linux x86_64 dev box (not the target Mac mini). Test command: `node --test media-automation/test`. Test counts below are cumulative for the whole suite after that stage; all passed, 0 skipped (the Piper test needs `MA_PIPER_MODEL`/`MA_PIPER_BIN` set, otherwise it skips).
Sample outputs live under `/workspace/ma-out/` on the box. They are not in git.

| # | Stage | Commit | Tests | Verified live on box | Mocked / not verified |
|---|---|---|---|---|---|
| 1 | Real TTS | `b69d9c8` | 25 | espeak-ng 1.52 (apt) and Piper (pip venv, voice en_US-lessac-medium) produce real speech. Sample render with Piper: `/workspace/ma-out/stage1/sample-{youtube,shorts}.mp4`, plus an espeak run in `/workspace/ma-out/stage1-espeak/` | macOS `say` (AIFF→WAV/M4A, voices, rate) is tested only with mocked `say`. There is no Mac here |
| 2 | AI news editor (Ollama) | `806c347` | 34 | Ollama 0.x installed. The `qwen2.5:1.5b` GGUF came from HuggingFace and was loaded with `ollama create`, because the registry blob download was blocked by the sandbox network. One real run: `/workspace/ma-out/stage2/llm-demo.json`. The headline was accepted. Summary, script and RU translation were **rejected by the fact-check**: the model wrote "2. 9" instead of "2.9" and "29 миллиардов" instead of 2.9, so the deterministic fallback was used | Retry, 404 and hallucination cases are mocked |
| 3 | Verification | `07abdde` | 44 | n/a (pure logic) | Ownership groups must be configured per source (`owner`). Wire detection is a regex |
| 4 | Video Factory v1 | `416feca` | 49 | Real news video from **live public RSS** (NASA, ESA, BBC; 87 items) → Ollama scripts (all 3 accepted by the fact-check) → Piper speech → `/workspace/ma-out/stage4/moonkatty-news-youtube.mp4` (1920×1080) and `moonkatty-news-shorts.mp4` (1080×1920, 48.1 s). QA passed: h264/aac/30 fps/yuv420p, −16.0 LUFS, true peak −2.1 dBFS. Also thumbnails `.jpg`, `.srt`, manifests `.json`, `run.json`, CC0 bed `ambient-bed.wav` | Nothing published |
| – | JobQueuePort + Host3D | `f4ef853` | 55 | Local file-backed queue, tested in-process | Studio SQLite queue adapter is a **stub** (NotConnected until a client is injected) |
| 5 | Social Publisher | `b188403` | 67 | — | **All platform APIs mocked.** No live call was ever made. DRY-RUN is the default |
| 6 | Scheduler | `0138ee8` | 72 | Timezone math against real ICU tz data, including the Israel DST change on 2026-10-25 | Handlers in tests are fakes. Nothing is wired to real renders yet |
| 7 | Approval Center | `3ed76e3` | 74 | Standalone server ran on 127.0.0.1:8795: 401 without token, 206 Range video streaming. iPhone-size screenshot: `/workspace/ma-out/stage7/approval-iphone.png` | Not mounted in `server.js` (by design). No HTTPS/tunnel set up |
| 8 | Analytics | `a141b09` | 77 | — | **All analytics APIs mocked.** Recommendations are rule-based |

## Phase 3 commits
44d11e5 media sourcing · 2d41da4 Kokoro/speech/master voice · bb0bcbd factory v2 + QA · 8af27ea orchestrator · 8400fab OAuth/Telegram/visemes/editorial/approval v2 · cb85e5a JOBS_API alignment · 882cd39 MAC_VERIFY · 78e7bd6 relevance + panel fallback. Tests: 95/95.
