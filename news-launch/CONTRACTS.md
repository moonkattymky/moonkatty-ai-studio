# Contracts with Studio 2

Studio 2 owns the News Intelligence Engine, Video Factory, and Social Publisher on `feat/media-automation`. This branch imports those modules and calls them. It does not rewrite them, and it does not open a pull request against their branch.

Nothing here is a request to merge. Proposed fields are for Studio 2 to accept or reject.

Imported commits, read-only after copy:

- News Engine and Video Factory v0 from `4537b7a` on `origin/feat/media-automation`.
- `media-automation/src/jobs/port.js`, `media-automation/src/jobs/studio-adapter.js`, and `media-automation/src/host3d/index.js` from `66d4b20`.
- `jobs/local.js` was not imported. This branch cannot point a file queue at `server/jobs`.

`server/jobs` and `server/blender` are not created and are not written. `news-launch/src/studio-boundary.js` throws `studio_owned_path` if an output path resolves under either tree.

## News Engine — used as-is

`NewsEngine` in `media-automation/src/news/engine.js`.

This launch constructs it with:

- `sources[]`: `{ id, name, url, kind: 'rss', trust }` from `news-launch/src/sources.js`
- `outputLang: 'en'`
- `statePath` under the episode output directory
- `fetchFn` only in tests

`engine.stories()` returns the stored story objects. The launch reads `id`, titles, summaries, source ids, and links through `candidatesFromEngine`. It does not call `publishable()` and does not set `reviewStatus` to approved.

The engine's own rule (two source ids, or one official source) is **not** the editorial rule. The owner follow-up requires a primary statement. Two media RSS items are not enough. The corrected episode does not use the RSS cluster as its source of truth. See `news-launch/artifacts/test-episode/FACTCHECK.md`.

### Proposed for Studio 2 — not implemented on their branch

Optional fields on a story or fact-check row, for a later engine:

- `primarySourceUrl` (string)
- `primaryPublisher` (string)
- `primaryPublished` (ISO date)
- `editorialStatus`: `confirmed-primary` | `dropped-unconfirmed`

The launch fact-check schema today is `news-launch/schemas/fact-check-result.json`. Those four fields are not in that schema yet. Adding them on this branch without Studio 2 would fork the engine. Left as a proposal.

## Fact-check result — launch schema

`news-launch/schemas/fact-check-result.json`, produced by `news-launch/src/factcheck.js` for the RSS path only.

The corrected episode stores primary rows in `news-launch/artifacts/corrected-episode/sources.json` with `role: "primary"`. That file is an editorial record. It is not a change to the News Engine store.

## Script — launch schema

`news-launch/schemas/script.json`.

`llm.mode` is `ollama`, `temporary-adapter`, or `editor`.

- `ollama`: loopback only, preferred model `qwen3:8b` (`news-launch/src/ollama.js`). The request body does not set `keep_alive`, so this client does not unload the daemon.
- `temporary-adapter`: `TEMPORARY_ADAPTER:extractive-headlines`. Headlines copied from the RSS cluster. Used when Ollama is down or the draft fails the grounding check. The first episode used this mode.
- `editor`: a person, or this editor pass, wrote the lines from primary statements. `adapter` is null. The corrected episode uses this mode. It is not sent back through RSS grounding, because primary wording is not required to appear in an RSS title.

Video Factory still receives `{ title, scenes: [{ text, heading?, background? }] }`. Phonetic hints are applied inside `KokoroTTS.synthesize` and are not written into `scene.text` or the SRT.

## Voice — TTS provider interface

`async synthesize(text, outWav) -> { file, durationSec }`, as in `media-automation/src/video/tts.js`.

- RSS path default remains Piper `en_US-ljspeech-high` when `--tts` is omitted.
- `--tts kokoro` selects `KokoroTTS` (`news-launch/src/kokoro.js`). Provisional voice `am_michael`. `locked: false`. Candidates: `am_michael`, `am_adam`, `am_fenrir`.
- Piper `en_US-ryan-high` and `en_US-joe-medium` are refused. See `news-launch/src/voices.js`.

No change to the Piper or Stub classes in the factory.

## Video Factory v0 — used as-is

`VideoFactory.render(script, { preset, outDir, basename, music: null })`.

Presets via `getPreset(name, { crf: 23 })`: `youtube` (1920×1080) and `shorts` (1080×1920). H.264, AAC, SRT beside the MP4. `RenderQueue` concurrency 1.

`StubCharacter3D` (`name === 'stub-3d'`) returns null. The episode profile refuses any other character. No substitute host is rendered. The 3D plug-in shape is documented in `news-launch/HOST_3D_INTERFACE.md` and is not built here.

`music: null`. The factory's music helper is not given a file.

Loudness is a launch step after the factory returns (`news-launch/src/loudness.js`): EBU R128 target about −14 LUFS, true-peak headroom, video stream copied. QC is `news-launch/src/qc.js` (ffprobe, ebur128, blackdetect). That QC is not a second video factory.

## Jobs

`StudioJobQueueAdapter` expects an injected client:

```text
createJob({ type, agent, input, timeoutSec, maxAttempts }) -> { jobId }
getJob(jobId) -> Job | null
cancelJob(jobId) -> Job
listJobs({ status }) -> Job[]
```

Statuses: `queued`, `running`, `needs_approval`, `succeeded`, `failed`, `cancelled`.

`runExclusive(spec, fn)` rejects an inline function. Heavy types named by the port include `render_segment`, `llm_generate`, `video_render`, `blender_template`. This launch does not enqueue those types, because no client is injected. The manifest records `TEMPORARY_ADAPTER:studio-job-queue-not-connected`.

`feat/v1.2.0` is not on origin. When that branch supplies a client, pass it as `studioJobClient`. Do not add `server/jobs` in this repo to unblock that.

## Social Publisher and approval — used as-is

`saveToStudio` calls `social.adapt(src, channelId)` for `fb-news` and `yt-news`.

Queue item fields this launch writes:

- `status: 'pending_approval'`
- `factCheck: 'passed'`
- `scheduledAt: null`
- `mediaUrl: ''`
- `imageRights: 'generated'`
- `demo: false`
- `publish: false`

`public/meta.js` tick publishes only when a row is approved, autopublish is on, and `scheduledAt` is set. This launch does not call `meta.js` publish. Workspaces stay at their existing `autopublish: false` and `manualApproval: true`.

Approval record: `news-launch/schemas/approval-request.json`. `status` is `pending_approval`. `publish` is false.

Episode stages written for EN: search, factcheck, script, translate, voice, visuals, edit = `done`; review = `progress`; publish = `todo`. RU and UK are left untouched.

## Explicit non-goals

- No second news engine, video factory, or publisher.
- No Blender invocation and no substitute 3D cat.
- No write to `server/jobs` or `server/blender`.
- No edit to `feat/media-automation`, `main`, or the macOS app branch.
- No publish.
