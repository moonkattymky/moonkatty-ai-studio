# Contracts with Studio 2

Studio 2 owns the News Intelligence Engine, Video Factory, and Social Publisher on `feat/media-automation`. This branch re-imports that tree at `882cd398d191eea9dbaeef046562282ccd9a9d8c` and calls it. It does not open a pull request against their branch, and it does not merge.

`server/jobs` and `server/blender` are not created and are not written. `news-launch/src/studio-boundary.js` throws `studio_owned_path` if an output path resolves under either tree.

## Import

`git checkout 882cd39 -- media-automation docs/media-automation` on this branch only. The previous copy (`4537b7a` / `66d4b20`) is replaced.

Local deltas on the imported files, not pushed to `feat/media-automation`:

- `media-automation/src/video/presets.js` — `targetLufs: -16` on the shared preset base. `getPreset(name, { targetLufs })` can override it.
- `media-automation/src/video/factory2.js` — program loudness, the anchor WAV, and `qaVideo` use `preset.targetLufs`, falling back to the factory default `-16`.
- `media-automation/assets/lexicon.json` — episode pronunciations (Muhammad Ali Pate, Wes Streeting, Houthis, Typhoon, Alberta, Abuja, and the rest of the bulletin list). `SpeechComposer` applies them.
- `media-automation/src/jobs/local.js` — `createJob` keeps `resourceClass`, `requiresNode`, and `safeToRetry`, and rejects an `idempotencyKey` longer than 128 characters.
- `media-automation/src/orchestrator/orchestrator.js` — the `video_render` spec now includes `resourceClass: 'gpu_heavy'` and `safeToRetry: true` beside the existing `idempotencyKey`.

## News Engine

`NewsEngine` in `media-automation/src/news/engine.js` is used as imported.

The RSS path still fact-checks with `news-launch/src/factcheck.js`. Two publishers confirm a cluster for the RSS adapter only. That row is marked:

- `primarySourceUrl`, `primaryPublisher`, `primaryPublished`: `null`
- `editorialStatus`: `confirmed-publishers`

A cluster that fails the two-publisher rule is `dropped-unconfirmed`. The corrected episode does not come from RSS. Its rows are `editorialStatus: confirmed-primary` with the primary URL, publisher, and date filled. See `news-launch/artifacts/corrected-episode/sources.json` and `news-launch/artifacts/test-episode/FACTCHECK.md`.

Those four fields are accepted for this launch. `882cd39` does not read or store them (`verify.js` has no `primarySourceUrl`). Emitting them here does not fork their engine.

## Voice

`MasterVoice` (`media-automation/config/master-voice.json`) builds `KokoroTTS`. This launch wraps it in `SpeechComposer` and does not call `lock()`.

- status: `candidate`
- voice: `am_michael` (en-US, male)
- rate: `0.95`
- loudness pin in the voice file: `-16` LUFS
- model sha256: `7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5`

`am_michael` is not owner-approved. The launch refuses a different voice id rather than substituting one. `news-launch/src/kokoro.js`, `news-launch/src/lexicon.js`, and `news-launch/bin/kokoro_synth.py` are removed. The bridge is `media-automation/tools/kokoro_tts.py`.

Piper `en_US-ljspeech-high` remains comparison-only (`--tts piper` / `ensure-tts.js`). Ryan, Joe, and Lessac stay refused in `news-launch/src/voices.js`.

## Video

`NewsVideoFactory` (`media-automation/src/video/factory2.js`) renders both presets. Music is null. The host is `StubHost3D` (`name: host3d-stub`), which returns null. No substitute cat is drawn.

Each story needs a still that `layoutFor` accepts for both 1920×1080 and 1080×1920. The corrected edition uses Commons files that `classify()` accepted. The RSS episode path throws `only N stories with licensed media` when a story has no such still. It does not fall back to a generated color card.

Loudness target is the preset value, default `-16` LUFS. QC is `qaVideo` in `media-automation/src/video/qa.js` (tolerance 1.5 LU, true peak ≤ −0.5 dBFS, blackdetect, freezedetect). `news-launch/src/loudness.js` and `news-launch/src/qc.js` are removed. A thin record in `06-qc.json` copies `ok`, integrated LUFS, true peak, and the failed check names so the HTTP response can stay small.

Their preset caps replace the old 30–60 second gate. Shorts max is 180 seconds. YouTube has no max in `presets.js`. Factory2 also adds a silent intro (3.6s), credits (5s), and outro (3s). Story text is what is spoken. The title card carries “MOONKATTY NEWS”. The credits card lists sources and the line that the edition is not published.

## Jobs

Read-only against `feat/v1.2.0`. The contract consumed is `docs/JOBS_API.md` at `00b63fc` (ancestor of `origin/feat/v1.2.0`, tip `42d3fd5`). This branch does not copy `server/jobs` or `lib/services.js`.

`StudioJobQueueAdapter.createJob` forwards:

```text
createJob({ type, agent, input, timeoutSec, maxAttempts, resourceClass, requiresNode, idempotencyKey, safeToRetry }) → { jobId }
```

With no injected client the adapter throws `NOT_CONNECTED`. The probe result is `TEMPORARY_ADAPTER:studio-job-queue-not-connected`. The error text names `00b63fc` and states that this launch does not open their database.

The VM render uses `LocalJobQueue` with `statePath` under the episode directory (`jobs-local.json`). Each `video_render` job is created with `resourceClass: 'gpu_heavy'`, an `idempotencyKey` of `{episodeId}:{preset}`, and `safeToRetry: true`. `beforeHeavy` is not set, so Ollama is not unloaded.

## Approval and publishing

`social.adapt` and `public/meta.js` are not called. `imageRights: 'generated'` is not written.

`ApprovalCenter.submit` stores the edition at status `pending`. The item carries one license record per still (`title`, `author`, `license`, `licenseUrl`, `pageUrl`, `attribution`). Nothing in this launch calls `approve`.

`Publisher` is constructed with `DEFAULT_ACCOUNTS` (`live: false`) and empty live flags. `enqueue` plus `processDue` for `youtube-news` (horizontal file) and `tiktok-news` (vertical file) ends at `dry_run`. `reviewStatus` on the content is `pending`, so a live account would still be blocked.

The studio episode row keeps `approvalStatus: 'pending_approval'` so the existing dashboard badge (“Ждёт утверждения”) still renders. That string is the studio UI field. The Approval Center status is `pending`. The social queue is not given a row, so “Единая очередь” does not list this edition.

## Explicit non-goals

- No merge into `main`, `feat/media-automation`, or `feat/v1.2.0`.
- No write to `server/jobs` or `server/blender`.
- No publish, and no `MasterVoice.lock()`.
- No Stage C `/api/projects3d` calls. Those exist only on the `42d3fd5` tip of `feat/v1.2.0`.
