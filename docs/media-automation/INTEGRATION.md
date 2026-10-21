# Integration notes

This module lives only in `media-automation/` and `docs/media-automation/`. It never writes to `server/`, `desktop/`, `scripts/`, `server.js`, `meta.js` or `public/`, and it does not import code from the feat/v1.2.0 developer.

## 1. Heavy-job queue (contract from the other developer, DRAFT)
Our port is `media-automation/src/jobs/port.js`:
- `createJob({ type, agent, input, timeoutSec, maxAttempts }) -> { jobId }`
- `getJob(jobId)`, `cancelJob(jobId)`, `listJobs({ status })`
- Statuses: `queued | running | needs_approval | succeeded | failed | cancelled`.

There are two implementations:
- **`LocalJobQueue`** (`src/jobs/local.js`) is used now. It is file-backed (JSON) and has the same statuses plus an `events` log, which is the equivalent of `job_events`. Heavy types (`render_segment`, `llm_generate`, `video_render`, `blender_template`) are **strictly serialized**, one at a time. A `beforeHeavy(type)` hook runs before each heavy job (for example to unload Ollama with `keep_alive:0`). It also supports per-job timeout, attempts, cancel, `needs_approval` with `approveJob`, an idempotency key, and restart recovery (`running` goes back to `queued`).
- **`StudioJobQueueAdapter`** (`src/jobs/studio-adapter.js`) is a **stub**. The studio side injects `client = { createJob, getJob, cancelJob, listJobs }`, backed by its SQLite `jobs`/`job_events`. Until then every call throws `NotConnectedError`. Inline functions cannot cross the boundary: the studio must register a handler for each job `type`.

Rules we follow:
- Ollama calls go through `jobQueue.runExclusive({type:'llm_generate'})` when a queue is configured (`new OllamaProvider({ jobQueue })`). Direct HTTP is used only when no queue is configured.
- `bin/news-video.js` unloads the Ollama model before rendering.

## 2. Host3D (3D characters)
- Interface (`src/host3d/index.js`): `renderSegment({ script, audioPath, durationSec, aspect, outPath }) -> { videoPath } | null`.
- `StubHost3D` always returns null, so the video stays 2D.
- `QueuedHost3D` **only enqueues** a `render_segment` job on the JobQueuePort and waits for `{ videoPath }`. It never calls Blender.
- The studio's `blenderService.runTemplate(...)` will sit behind their `render_segment` handler. They build the adapter to our signature.
- VideoFactory accepts any Host3D as `character3d` and overlays the returned `videoPath` (bottom-centre, 50% width).

## 3. Secrets
- Secrets come from macOS Keychain via `security find-generic-password -s moonkatty-media-automation -a <name> -w` (argv only, no shell). The fallback is the env var `MA_SECRET_<NAME>`, intended for tests.
- To store a secret, run `security add-generic-password -U -s moonkatty-media-automation -a <name> -w`. The command prompts for the value, so it does not end up in argv or shell history.
- Secret names: `youtube_news_token`, `youtube_project_token`, `telegram_bot_token`, `x_news_token`, `tiktok_news_token`, `meta_page_token_news`, `approval_token`.
- Tokens are redacted from errors and history. The existing app's Keychain/Meta tokens (meta.js) are **not** read.
- OAuth flows that obtain these tokens are **not implemented**. Today they must be created by the owner, for example in Google/X/TikTok developer consoles. Reusing the meta.js OAuth (via a read-only adapter on the studio side) is future work.

## 4. Publishing safety
- Every post is DRY-RUN unless all three conditions hold: `account.live === true`, AND an owner flag for that platform (`liveFlags[platform] === true` or env `MA_PUBLISH_LIVE_<PLATFORM>=owner-approved`), AND the content has `reviewStatus === 'approved'`.
- The YouTube NEWS and YouTube PROJECT channels are separate accounts with separate tokens.
- A post interrupted mid-upload becomes `needs_check`. It is never blindly re-published.

## 5. Approval Center remote access (iPhone)
- The router is `createApprovalRouter({ center, token, mediaRoots })`. It can later be mounted into the main app as `app.use('/approval', router)`; that is **not done**, and existing auth is unchanged.
- Today it runs as a standalone server: `node media-automation/bin/approval-server.js <stateDir> 8795 <mediaRoot>`. It binds 127.0.0.1 only.
- Auth is a ≥24-char random token (Keychain `approval_token`), sent as a Bearer header or `?token=`. The page moves the token from the URL into sessionStorage.
- Recommended iPhone access, choose one:
  1. **Tailscale** on the Mac mini and the iPhone, then `tailscale serve https / http://127.0.0.1:8795`. This gives HTTPS on the private tailnet, not public.
  2. **Cloudflare Tunnel** (`cloudflared tunnel --url http://127.0.0.1:8795`) plus a Cloudflare Access policy (email OTP) in front. This is HTTPS and public, so Access must be on.
- Never expose port 8795 directly. Rotate the token if a link leaks.
- Note: on this dev box port 8790 is used by sandbox infrastructure, so 8795 is the default.

## 6. Mac mini notes
- TTS: `MA_TTS=say` with `MA_SAY_VOICE`/`MA_SAY_RATE`, or Piper with `MA_PIPER_MODEL`/`MA_PIPER_BIN`. With no engine, the pipeline fails loudly; there is no tone fallback.
- LLM: `MA_OLLAMA_URL` (default `http://127.0.0.1:11434`), `MA_OLLAMA_MODEL` (default `qwen2.5:1.5b`). 3B–8B Q4 models fit in 24 GB, but they must not run together with Blender (queue rule).

## 7. Studio JOBS_API v1.2.0 alignment (read-only from feat/v1.2.0 @00b63fc docs/JOBS_API.md)
`StudioJobQueueAdapter({client: jobsApi})` passes `resourceClass`, `requiresNode`, `idempotencyKey` (≤128), `safeToRetry`. It normalizes `id`→`jobId` and `publicStatus`, and maps internal statuses (waiting_*→needs_approval, done→succeeded, rejected→cancelled). Artifacts are mapped to `result.videoPath`. `StudioHost3D` enqueues `render_segment` (gpu_heavy, mac-mini). A `failed` result (the current stub) or a missing client returns `null`, and the episode continues without the host. `blenderService` is not called by us.

## 8. Host3D contract v2 (PROPOSAL for Studio)
Request `host3d.render_segment/v2`: `{script, audioPath (48k mono wav), durationSec, aspect, outPath, voice:{voiceProfileId, voiceId, modelSha256}, visemes:[{t,d,viseme,phoneme}], cues:[{t,emotion,gaze,ears,head}], costumeId, character:{id:'moonkatty-master-cat', modelVersion (pinned)}, output:{alpha:true,fps:30,format:'mov-prores4444'}}` → `{videoPath}|null`. Still enqueued as `render_segment`. Viseme set: PP FF TH DD kk CH SS RR I E aa O U sil. Per episode, `lipsync-handoff.json` carries anchorAudio, voiceProfileId, per-segment visemes and cues. We never build our own cat.

## 9. Studio 4 (feat/news-launch-integration, news-launch/CONTRACTS.md), mismatches
1. Imports old commits (4537b7a/66d4b20): Video Factory v0, not factory2/orchestrator/Approval Center.
2. TTS default Piper `ljspeech-high` (female) conflicts with the male-only anchor. They refuse `ryan-high`. Their own `kokoro.js` bypasses MasterVoice (no hash pin, no loud failure).
3. Loudness −14 LUFS (theirs) vs −16 LUFS (ours). Duplicate QC/loudness steps.
4. Publishing via old `social.adapt`/`meta.js` queue with `imageRights:'generated'`, versus our Publisher plus per-asset licenses.
5. Proposed fact-check fields (`primarySourceUrl`, `primaryPublisher`, `primaryPublished`, `editorialStatus`) are not in our engine yet. We are willing to accept them.
6. Job contract without resourceClass/idempotencyKey/safeToRetry. They believe feat/v1.2.0 is not on origin; it is now.

## 10. Proposed Studio job type `video_render` (needs main Studio approval)
`video_render` is not in JOBS_API v1.2.0. Until it is approved, the orchestrator renders on the **local serialized queue** (`LocalJobQueue`, one heavy job at a time, Ollama unloaded first). `StudioJobQueueAdapter.supportedTypes` = design3d, blender_template, opencode_task, render_segment. The orchestrator falls back to `fallbackQueue` when `video_render` is not listed.
Proposal: `type:'video_render'`, `resourceClass:'gpu_heavy'`, `requiresNode:'mac-mini'`, `safeToRetry:true`, `idempotencyKey:'<runId>:<preset>'`, `input:{runId, preset:'youtube'|'shorts', episodeRef}` → `artifacts[{kind:'file', path:<mp4>}, {kind:'file', path:<srt>}, {kind:'png', path:<thumb>}]`. It must hold `withHeavy` so it never overlaps Blender or Ollama.
`render_segment` stays a Studio stub (created as `failed`). `StudioHost3D` maps that to `null`, and the episode renders without the host.

## 11. Editorial verification (aligned with Studio 4)
`confirmed` = primary source (official/originating outlet, `primarySourceUrl`, or `editorialStatus:'confirmed-primary'`) **plus** independent corroboration. A primary source alone is `primary_only`: auto-cleared only for an official, non-breaking, non-controversial self-announcement (`autoPrimaryOnly`, default on); otherwise it goes to owner review. Two media outlets without a primary source are `unconfirmed`. `editorialStatus:'dropped-unconfirmed'` excludes the story. The fields `primarySourceUrl`, `primaryPublisher`, `primaryPublished` and `editorialStatus` are read from source items or `manualFlags`. Licenses now accept UK OGL v3 (`OGL-UK-3.0`, attribution required). Ported from Studio 4: preset `targetLufs` (default −16; a launch can set −14), `resourceClass`/`requiresNode`/`safeToRetry` on LocalJobQueue jobs, and lexicon entries.
