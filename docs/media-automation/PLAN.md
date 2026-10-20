# Plan — 6 stages (each with verifiable deliverables)

1. **Audit & architecture** — AUDIT.md, ARCHITECTURE.md, APIS_AND_COSTS.md, LIMITATIONS.md, PLAN.md on `feat/media-automation`. ✅ Done.
2. **News Intelligence Engine v0** — `media-automation/src/news/*`; tests: parsing, categories, dedup, corroboration, review status, API error + retry, restart recovery. ✅ Done (`npm`-free: `node --test media-automation/test`).
3. **Video Factory v0 (no 3D)** — script→TTS→SRT→ffmpeg→MP4 16:9 and 9:16, thumbnail, music license slot, render queue with concurrency + restart recovery; Character3D stub. Deliverable: sample MP4s + JPG produced by `node media-automation/bin/sample-render.js`. ✅ Done (stub TTS on Linux; `say` on macOS).
4. **Approval Center + Scheduler** — persisted schedules, approval UI in existing panel (new section only), notifications. Verify: e2e test "story pending → approved → render queued"; screenshot. ⏳ Not started.
5. **Social Publisher (dry-run first)** — YouTube/TikTok/Meta adapters with `dryRun` default, only `approved` items; mocked API tests; one real upload to a private/unlisted test channel after explicit owner approval. ⏳ Not started.
6. **Analytics, Brand Memory, Cost Control, 3D integration** — metrics ingestion, brand profiles, budget guard, real Character3D adapter wired to the 3D studio (coordinated with the feat/v1.2.0 developer). Verify: dashboard numbers from mocked APIs, budget-exceeded test, a render with 3D segment. ⏳ Not started.
