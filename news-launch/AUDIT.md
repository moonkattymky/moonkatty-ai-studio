# MOONKATTY NEWS launch audit

Checked on 2026-10-20 against this branch, `feat/news-launch-integration`, based on `main` at `e87bd32f904faf676e8316fbf38ef8805727c7fc`. Other branches were fetched and read. None of them were merged or committed to.

`feat/v1.2.0` is not on `origin` (`git fetch` and `git ls-remote` style branch list). `feat/quality-automation` and a Blender automation branch are not on `origin` either. This launch does not create or write `server/jobs*` or `server/blender*`.

## Owner claims

| Claim | What the repository shows |
| --- | --- |
| AI STUDIO v1.1.2 on a Mac mini | `main` `package.json` is `1.0.0`. `origin/feat/macos-app` is `1.1.1` and was not run. `origin/feat/opencode-auth` commit message says Basic Auth 1.1.2. This VM did not inspect the Mac. |
| Ollama `qwen3:8b` | `server.js` `llmPlan` calls `127.0.0.1:11434` `/api/chat` and defaults the model to `qwen3:8b`. The VM has no Ollama daemon. The episode script is the extractive adapter. |
| Secured OpenCode | Present on `origin/feat/opencode-auth` (`3f9bd90`). Not imported and not executed. |
| Blender | No Blender branch and no `server/blender` tree. `StubCharacter3D` returns null. `QueuedHost3D` only enqueues `render_segment` on an injected client. |
| News Intelligence Engine on `feat/media-automation` | Imported from `4537b7a` (files only, not a merge). That engine's own tests pass. Its corroboration is not the launch fact-check: one official source counts as confirmed there, and two copies of a wire can count. |
| NewsVideoFactory | Re-imported from `882cd39`. Both aspect ratios, `music: null`, `host3d-stub`, loudness preset default −16 LUFS, QC from `qaVideo`. |
| Approval Center and Publisher | Their Approval Center (`pending`) and Publisher dry-run. No `social.adapt` row and no `imageRights: 'generated'`. The studio episode badge stays `pending_approval`. |
| Newer media-automation (stages 2–8, job port) | `origin/feat/media-automation` moved to `66d4b20` after the import. That commit was not merged. Only `jobs/port.js`, `jobs/studio-adapter.js`, and `host3d/index.js` were copied. `jobs/local.js` was left there so this branch cannot point a file queue at `server/jobs`. |

## Proven by tests run here

`node --test media-automation/test/*.js news-launch/test/pipeline.test.js` — 22 files/tests, 0 failures (about 12s). Includes the Video Factory ffmpeg render and the launch pipeline (both resolutions, QC, approval hold, anonymous `POST /api/news/prepare` returns 401).

`node --test news-launch/test/factcheck.test.js news-launch/test/script-ollama.test.js news-launch/test/studio-boundary.test.js` — 13 tests, 0 failures. Covers two-org confirmation, same-org rejection, refusal to invent a third story, contradictory URL, conflicting figures, Ollama grounding, refusal of `server/jobs` and `server/blender`, and `QueuedHost3D` enqueue without a Blender process.

## What works

- News Engine RSS ingest, Jaccard dedup, and its own review statuses. Live run: 359 items, 0 source errors, then a second pass that saw 359 duplicates. 321 engine stories.
- Launch fact-check on top of that engine. A story is confirmed only with at least two `org` values, URL/title agreement, and no conflicting figures. Six stories confirmed. Three selected inside 96 hours. See the episode sources.
- Extractive English script. Words of five letters or more and every number in a story scene must appear in the source titles, summaries, or publisher names. Intro and outro are fixed boilerplate.
- Piper `en_US-ljspeech-high` (MIT engine, public-domain LJ Speech). Lessac was rejected.
- Video Factory v0: H.264 + AAC, 1920×1080 and 1080×1920, SRT burned in, no music, no 3D segment. Generated color cards and DejaVu Sans only.
- QC on the episode: both files `ok: true`, about 57.8s, loudness −14.2 LUFS, true peak −2.5 and −2.1 dBTP, no black frames, audio present. Pass window for loudness is −16 to −12 LUFS. Clipping fails above −1.0 dBTP.
- Dashboard and News UI read the saved episode. Social queue holds the posts. Auth on `/api` is unchanged.

## Stubs and temporary adapters

| Piece | Status |
| --- | --- |
| `TEMPORARY_ADAPTER:extractive-headlines` | Used for this episode. Ollama on the VM returned `fetch failed`. |
| `TEMPORARY_ADAPTER:studio-job-queue-not-connected` | `StudioJobQueueAdapter` has no client. Recorded in `artifacts/test-episode/studio-boundary.json`. |
| `StubHost3D` / `host3d-stub` | Episode host. No substitute character is drawn. |
| `QueuedHost3D` | Interface only, until a client and an owner-approved model exist. |
| News Engine "confirmed" | Weaker than this launch. Official-only NASA items stay rejected here. |
| OpenCode, Blender, `feat/v1.2.0` | Not present on this branch and not executed. |
| Social autopublish | Left at the seeded default off. Queue `scheduledAt` is null, so `meta.js` `tick` cannot send these items. |
| Phobos / MMX | Guardian and CBS both reported the launch. Title Jaccard was 0.33, under the 0.42 bar. That bar also keeps apart "Lula and Bolsonaro tied" and "Meta treats both equally" (Jaccard 0.31). The pair was not scripted. |
| Japan Phobos BBC headline | "Mission blasts off for Mars…" does not say Japan or Phobos. It was not attached. |
| Shark attack and the Kenya cult case | Confirmed by two publishers, then not selected. The cult story matches the child/murder filter. The shark story is ranked behind the three world items. |

## Contracts

JSON Schemas live in `news-launch/schemas/` and are checked by `news-launch/src/schemas.js` for required fields and `const` / `enum`:

| Stage | File |
| --- | --- |
| Story candidate | `story-candidate.json` |
| Fact-check result with sources | `fact-check-result.json` (`status` confirmed or rejected, sources carry `url`) |
| Script | `script.json` |
| Voiceover | `voiceover.json` |
| Video render job | `video-render-job.json` (`character3d` const `host3d-stub`, status `succeeded`, `music` null) |
| QC result | `qc-result.json` (their `qaVideo`, default −16 LUFS) |
| Approval request | `approval-request.json` (`status` const `pending`, `publish` const false, at least two source URLs) |

Episode artifacts for the rendered bulletin: `01-story-candidates.json` through `06-qc.json`, `script.txt`, `sources.json`, `image-licenses.json`, `manifest.json`, `horizontal.mp4`, `vertical.mp4`, and both `.srt` files.

## Studio boundary

`news-launch/src/studio-boundary.js` resolves a path and throws `studio_owned_path` when it is under `server/jobs` or `server/blender`. `runLaunch` checks the output directory before creating it. `openStudio` / `saveToStudio` check the database and files directory. The studio queue is `StudioJobQueueAdapter`: list/create/get/cancel go to an injected client, or the call throws `NotConnectedError`. No code path opens a studio SQLite job table.
