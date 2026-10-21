# Contracts with Studio 2

Studio 2 owns the News Intelligence Engine, Video Factory, and Social Publisher on `feat/media-automation`. This branch re-imports that tree at `228c2ea44e677e3067e8c0389c824c27549b38e3` and calls it. It does not open a pull request against their branch, and it does not merge.

`server/jobs` and `server/blender` are not created and are not written. `news-launch/src/studio-boundary.js` throws `studio_owned_path` if an output path resolves under either tree.

## Import

`git checkout 228c2ea -- media-automation docs/media-automation` on this branch only. The earlier copy (`882cd39`, and before that `4537b7a` / `66d4b20`) is replaced. `git diff 228c2ea -- media-automation docs/media-automation` is empty: the loudness preset, lexicon, and job fields that this launch had patched locally now come from their tree.

Their `228c2ea` already contains:

- `targetLufs: -16` on the shared preset, overridable through `getPreset(name, { targetLufs })`. `factory2` uses that value for the program, the anchor WAV, and `qaVideo`.
- Episode pronunciations in `media-automation/assets/lexicon.json`, applied by `SpeechComposer`.
- `LocalJobQueue.createJob` fields `resourceClass`, `requiresNode`, `safeToRetry`, and an `idempotencyKey` of at most 128 characters.
- Orchestrator `video_render` specs with `resourceClass: 'gpu_heavy'` and `safeToRetry: true`.
- UK OGL v3 as `OGL-UK-3.0` (attribution required). A numbered OGL that is not v3, including `OGL 2`, stays rejected.

## News Engine

`NewsEngine` and `verifyStory` are used as imported.

`confirmed` requires a primary source and an independent second origin. A primary source is an official item, a source flagged `primary`, a `primarySourceUrl`, or `editorialStatus: 'confirmed-primary'`. A primary source alone is `primary_only`. With `autoPrimaryOnly` (default on), that status auto-clears only when the source is official and the story is neither breaking nor controversial. Every other `primary_only`, plus `unconfirmed`, `disputed`, breaking, controversial, and `editorialStatus: 'dropped-unconfirmed'`, goes to owner review. `dropped-unconfirmed` forces `corroboration` to `unconfirmed`. Two outlets with no primary source are `unconfirmed`.

The RSS path still fact-checks with `news-launch/src/factcheck.js`. Two publishers confirm a cluster for that adapter only. That row is marked:

- `primarySourceUrl`, `primaryPublisher`, `primaryPublished`: `null`
- `editorialStatus`: `confirmed-publishers`

A cluster that fails the two-publisher rule is `dropped-unconfirmed`. The corrected episode does not come from RSS. Its rows stay `editorialStatus: confirmed-primary` with the primary URL, publisher, and date filled. See `news-launch/artifacts/corrected-episode/sources.json` and `news-launch/artifacts/test-episode/FACTCHECK.md`. Those rows are compatible with their engine. They are not ingested as `NewsEngine` stories, so `autoPrimaryOnly` does not clear the edition. Approval Center stays `pending`.

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

`video_render` is absent from `docs/JOBS_API.md`. Their `INTEGRATION.md` §10 keeps it on `LocalJobQueue` until Studio adds the type. `StudioJobQueueAdapter.supportedTypes` is `design3d`, `blender_template`, `opencode_task`, `render_segment`. A failed `render_segment` is no host: `StudioHost3D` returns null, and this launch uses `StubHost3D` (`host3d-stub`).

The VM render uses `LocalJobQueue` with `statePath` under the episode directory (`jobs-local.json`). Each `video_render` job matches the §10 proposal: `resourceClass: 'gpu_heavy'`, `requiresNode: 'mac-mini'`, `idempotencyKey` `{episodeId}:{preset}`, `safeToRetry: true`, timeout 1800, one attempt. Their orchestrator spec omits `requiresNode`. This launch does not set `beforeHeavy`, so it does not unload Ollama. Their `bin/orchestrate.js` does.

## Remaining differences

- RSS `editorialStatus: 'confirmed-publishers'` is this launch's two-publisher label. Their `verifyStory` classifies that cluster as `unconfirmed`.
- Their engine copies story-level `editorialStatus` from `manualFlags` or from the item that also has `primarySourceUrl`. An item-level `dropped-unconfirmed` without a primary URL stays on the item. `flag()` with `editorialStatus: 'dropped-unconfirmed'` does force `corroboration` to `unconfirmed` and owner review. The corrected rows set both `primarySourceUrl` and `confirmed-primary`, which their engine stores.
- The corrected bulletin is held in Approval Center. A lone official `confirmed-primary` item inside `NewsEngine` would be `primary_only` and, when it is not breaking or controversial, `auto_approved`.
- The edition still uses the CC BY 4.0 RAF Typhoon photograph. OGL v3 would be eligible. The Commons “RAF Typhoon inflight” file is OGL 2 and stays out.
- The Abuja still is CC BY-SA 4.0. The edition is not published.
- `am_michael` stays `candidate`. The Pate pronunciation in the lexicon is an unverified editorial hint. Alberta has no winner; official results are 29 October 2026.
- The corrected render calls `NewsVideoFactory` directly. It does not use orchestrator `trimScript` (34 words), `panelFallback`, or `fallbackQueue`. The RSS path still fails closed when a story has no licensed still.
- Stage C routes on `feat/v1.2.0` tip `42d3fd5` are unused. The adapter maps `rejected` to `cancelled`.
- Their `INTEGRATION.md` §9 still describes the pre-alignment launch. That file is theirs at `228c2ea` and is unchanged on this branch.

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
