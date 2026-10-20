# Jobs / Blender service API (v1.2.0), shared with feat/media-automation and feat/studio-operations

## Job record (`GET /api/jobs/:id`, `jobsApi.getJob`)
| field | type | notes |
|---|---|---|
| `jobId` (`id` in HTTP view) | string `job_<hex16>` | |
| `type` | `design3d` \| `blender_template` \| `opencode_task` (stub) \| `render_segment` (stub) | HTTP view: `kind` (`3d` = design3d) |
| `status` (public) | `queued` \| `running` \| `needs_approval` \| `succeeded` \| `failed` \| `cancelled` | HTTP view: `publicStatus`; `internalStatus`/`status` also has `waiting_confirmation`, `waiting_approval`, `blocked`, `done` |
| `stage` | design3d: `preflight → params → agent → validate → build → render → verify` | |
| `attempt`, `maxAttempts`, `retries`, `maxRetries` | int | automatic retry for transient errors, manual retry up to `maxRetries` (3) |
| `resourceClass` | `gpu_heavy` \| `llm` \| `light` \| null | optional; defaults: design3d/blender_template/render_segment = `gpu_heavy`, opencode_task = `llm` |
| `requiresNode` | string \| null | optional; Blender/OpenCode types default to `mac-mini` |
| `idempotencyKey` | string ≤128 \| null | optional, UNIQUE; createJob with an existing key returns `{jobId, existing:true}` |
| `safeToRetry` | bool | optional; default true (design3d/blender_template/render_segment), false (opencode_task). Interrupted non-safe jobs are not re-run after a restart |
| `artifacts[]` | `{name, path, size, sha256, kind}` | `kind`: `blend` \| `png` \| `frame` \| `glb` \| `fbx` \| `file` |
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

## HTTP
`GET /api/jobs?status=&limit=`, `POST /api/jobs` (same body as createJob), `POST /api/jobs/:id/cancel|retry|confirm {approve}`,
`POST /api/studio3d/run {text}`, `GET /api/studio3d/status`, `PUT /api/studio3d/settings {blenderPath, opencodeModel}`,
`GET /api/projects3d/:pid/:ver/file?name=renders/preview.png`, `DELETE /api/projects3d/:pid/:ver {confirm:true}` (two-step).
