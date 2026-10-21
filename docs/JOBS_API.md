# Jobs / Blender service API (v1.2.0), shared with feat/media-automation and feat/studio-operations

## Job record (`GET /api/jobs/:id`, `jobsApi.getJob`)
| field | type | notes |
|---|---|---|
| `jobId` (`id` in HTTP view) | string `job_<hex16>` | |
| `type` | `design3d` \| `blender_template` \| `opencode_task` (stub) \| `render_segment` (stub) \| `video_render` (stub executor) | HTTP view: `kind` (`3d` = design3d) |
| `status` (public) | `queued` \| `running` \| `needs_approval` \| `succeeded` \| `failed` \| `cancelled` | HTTP view: `publicStatus`; `internalStatus`/`status` also has `waiting_confirmation`, `waiting_approval`, `blocked`, `done` |
| `stage` | design3d: `preflight → params → agent → validate → build → render → verify` | |
| `attempt`, `maxAttempts`, `retries`, `maxRetries` | int | automatic retry for transient errors, manual retry up to `maxRetries` (3) |
| `resourceClass` | `gpu_heavy` \| `llm` \| `light` \| null | optional; defaults: design3d/blender_template/render_segment = `gpu_heavy`, opencode_task = `llm` |
| `requiresNode` | string \| null | optional; Blender/OpenCode types default to `mac-mini` |
| `idempotencyKey` | string ≤128 \| null | optional, UNIQUE; createJob with an existing key returns `{jobId, existing:true}` |
| `safeToRetry` | bool | optional; default true (design3d/blender_template/render_segment), false (opencode_task). Interrupted non-safe jobs are not re-run after a restart |
| `artifacts[]` | `{name, path, size, sha256, kind}` | `kind`: `blend` \| `png` \| `frame` \| `glb` \| `fbx` \| `file`; video_render: `mp4` \| `srt` \| `jpg` |
| `checkpoint` | object | `projectId`, `version`, `vdir`, `params`, `paramsBy`, `sessionID`, `timeoutSec` … |
| `error`, `pending`, `heartbeat`, `createdAt`, `updatedAt`, `input` | | `pending` = confirmation request |
Events: `GET /api/jobs/:id?after=<seq>` → `events[] {seq, at, level, stage, msg, rule}`.

## In-process (server.js → `app.locals.services`, `require('./lib/services.js')`)
- `jobsApi.createJob({type, agent, input, timeoutSec, maxAttempts, resourceClass, requiresNode, idempotencyKey, safeToRetry}) → {jobId}`
  - design3d: `input {text}`
  - blender_template: `input {template:'scene_basic', params, projectId}`
- `jobsApi.getJob(id)`, `jobsApi.cancelJob(id)`, `jobsApi.listJobs({status})` (public or internal status)
- `blenderService.detectBlender() → {path, version, pythonOk, engines, error}`
- `blenderService.runTemplate({template, params, projectId, signal?, timeoutSec?}) → {versionDir, version, blendPath, pngPath?, glbPath?, log, files}`
- `host3d.renderSegment({script, audioPath, durationSec, aspect, outPath}) → null` (**stub**; job type `render_segment` is reserved and created as `failed` "не реализовано")
- Heavy work is serialized: `lib/heavy-lock.js` `withHeavy(label, fn, signal)`, used for every Blender run and Ollama generation. `status()` returns `{holder, waiting}`.

- video_render: see below.

## Job type `video_render` (unreleased; requested by Studio 2 / feat/media-automation INTEGRATION.md §10)
- Fixed ops fields: `resourceClass:'gpu_heavy'`, `requiresNode:'mac-mini'`, `safeToRetry:true`. Other values → 400.
- `idempotencyKey` is always `<runId>:<preset>` (computed by the server; a different explicit key → 400). Re-creating returns `{jobId, existing:true}`.
- `input {runId, preset, episodeRef}` — strict schema, unknown fields → 400:
  - `runId`: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, no `..`;
  - `preset`: `youtube` \| `shorts`;
  - `episodeRef`: `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, no `..`/`.`/empty segments.
- **Exclusive**: the job waits (`queued`) for the process-wide heavy lock (`lib/heavy-lock.js withHeavy`), the same lock held by every Blender run (design3d, blender_template) and every Ollama generation. So `video_render` runs strictly one at a time and never overlaps Blender or Ollama (FIFO). `heavyStatus()` → `{holder, waiting}`.
- Result (on success, status `done`/`succeeded`): `artifacts` = exactly one each of `kind:'mp4'`, `kind:'srt'`, `kind:'jpg'` (cover), each `{name, path, size, sha256, kind}`. `path` must be absolute and inside `<dataDir>/media` (symlinks resolved), extension must match kind, `size`/`sha256` are re-checked against the file. A result that fails the check makes the job `failed` and no artifacts are stored.
- **Executor: stub.** INTEGRATION.md (228c2ea) defines no Studio-side handler, so by default the job fails after acquiring the lock with `video_render: Не подключено — …` and produces no files. The integration point is `services.videoRender.setExecutor(async ({runId, preset, episodeRef, jobId, outDir, signal}) => ({artifacts}))` (`outDir` = `<dataDir>/media`).
- cancel: `POST /api/jobs/:id/cancel` (also while waiting for the lock); retry: `POST /api/jobs/:id/retry` re-queues it behind the lock. Interrupted jobs are re-run after a restart (safeToRetry).

## HTTP
`GET /api/jobs?status=&limit=`, `POST /api/jobs` (same body as createJob), `POST /api/jobs/:id/cancel|retry|confirm {approve}`,
`POST /api/studio3d/run {text}`, `GET /api/studio3d/status`, `PUT /api/studio3d/settings {blenderPath, opencodeModel}`,
`GET /api/projects3d/:pid/:ver/file?name=renders/preview.png`, `DELETE /api/projects3d/:pid/:ver {confirm:true}` (two-step).

## Stage C endpoints (v1.2.1)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/projects3d` | list / create project `{title}` → `{id}` |
| GET | `/api/projects3d/:pid` | `{id,title,references[],versions[{version,files,params,parent,comment,review,backup,animFrames}],deleted[]}` |
| POST | `/api/projects3d/:pid/references?name=` | raw image body (png/jpeg/webp ≤15 MB) → `{sha256,file,name,size,duplicate}` |
| GET | `/api/projects3d/:pid/references/:sha` | image, `nosniff`, sandbox CSP |
| POST | `/api/jobs/:id/review` | `{action: approve|rework|reject, comment}`; only from `waiting_approval`; rework → `{nextTask}` |
| POST | `/api/projects3d/:pid/:ver/rerender` | `{lighting,camera,animation,render,exports,background}` → new task (agent skipped) |
| GET | `/api/projects3d/:pid/:ver/file?name=&download=1` | whitelisted artifacts only |
| DELETE | `/api/projects3d/:pid/:ver` | body `{confirm:true}` required (else 409 `needsConfirmation`); moved to `_trash` |

Job status `rejected` (task `cancelled`) is new. Approve sets job `done`.
