# Media Automation — Architecture

Target host: **Mac mini, Apple Silicon, 24 GB unified memory**, single node. All code in `media-automation/` (Node.js ≥20, CommonJS, no new npm deps). Each module is a plain JS class with injected dependencies (fetch, provider, clock, store), so everything is testable offline.

```
Sources ─▶ News Intelligence ─▶ Approval Center ─▶ Video Factory ─▶ Approval ─▶ Social Publisher
              │  (dedup, corroborate)     ▲            │ (TTS, SRT, ffmpeg)            │
              ▼                           │            ▼                               ▼
        Brand/Project Memory  ◀──── Scheduler ───▶ Cost & Resource Control      Analytics
                                                  Character3D adapter (stub)
```

## Status (phase 2)
- **Implemented:** News Intelligence Engine + verification (`src/news`), AI editor (`src/llm`), Video Factory v1 (`src/video`), JobQueuePort + LocalJobQueue (`src/jobs`), Host3D interface (`src/host3d`), Publisher (`src/publish`, dry-run default), Scheduler (`src/schedule`), Approval Center (`src/approval`), Analytics (`src/analytics`), Secrets (`src/secrets.js`).
- **Stub:** StudioJobQueueAdapter, StubHost3D.
- **Interface/docs only:** Brand Memory, Cost Control.
- See INTEGRATION.md for the contracts with the studio, and STAGES.md for per-stage verification status. The sections below describe the phase-1 design; phase-2 details are in the code headers.

## Shared: StateStore (`src/store.js`) — implemented
`new JsonStore(file)`; `get(key)`, `set(key, value)`, `update(key, fn)`. Atomic write (tmp file + `fsync` + `rename`), so a crash never leaves a half-written file. Used for restart-safety.

## 1. News Intelligence Engine (`src/news/`) — implemented
- `Source` interface: `{ id, name, kind:'rss'|'official', trust:0..1, url, categories?, license? , fetch?(ctx) }`. RSS/Atom parsed by built-in minimal parser (`rss.js`). Custom sources may provide their own `fetch`.
- `fetchWithRetry(fetchFn, url, {retries, backoffMs})` — retries on network error / 5xx / 429, no retry on other 4xx.
- `categorize(text)` → one of `politics, economy, tech, science, space, sports, entertainment, other` (keyword scoring).
- Dedup: normalized URL + headline-token Jaccard similarity → clusters (`stories`).
- Corroboration: `confirmed` if ≥ `minSources` (default 2) **distinct** sources, or one `official` source; otherwise `unconfirmed`.
- `SummaryProvider` interface: `async summarize({title, texts, lang}) → {headline, summary}`. `LocalExtractiveProvider` = deterministic fallback; any provider error falls back to it.
- `Translator` hook: `async translate(text, from, to)`; default identity (EN output).
- Each story: `mediaLicense` per item `{ source, license, url, usable:boolean|null }`.
- Editorial review: `reviewStatus` ∈ `auto_approved | pending_approval | approved | rejected`. `breaking` or `controversial` ⇒ `pending_approval` always. `approve(id, by)` / `reject(id, by, reason)`.
- `NewsEngine.run()` persists seen items and stories in StateStore; re-running after restart neither duplicates nor loses review decisions.

## 2. AI Video Factory (`src/video/`) — implemented v0 (no 3D)
- `script.js`: `{title, scenes:[{text, durationHint?, background?}]}`.
- `TTSProvider`: `async synthesize(text, outWav) → {file, durationSec}`. Implementations: `MacSayTTS` (`say -o … --data-format=LEI16@22050`), `PiperTTS` (CLI), `StubTTS` (ffmpeg sine/silence of estimated duration — tests & Linux).
- `subtitles.js`: SRT generation, sentence chunking, timings by speech duration.
- `ffmpeg.js`: per-scene clip (color/background image + drawtext title + burned subtitles), concat, audio mix with optional music track (ducked volume), export.
- Presets (`presets.js`): `youtube` 1920×1080 16:9; `shorts`, `tiktok`, `reels`, `fb_reels` 1080×1920 9:16; H.264 + AAC, yuv420p, faststart.
- Thumbnail: JPEG frame + title overlay.
- Music slot: `{file, title, artist, license, licenseUrl, attributionRequired}`; a track without `license` is rejected.
- `RenderQueue` (`queue.js`): concurrency limit (default 1 on 24 GB Mac), persisted jobs; on restart `running` jobs are reset to `queued` and re-run; per-job retries.

## 3. Character3D adapter (`src/video/character3d.js`) — interface + stub
`Character3DAdapter`: `capabilities()`, `async renderSegment({sceneId, text, audioFile, durationSec, preset, outFile}) → {file, alpha:boolean}`. `StubCharacter3D` returns `null` (pipeline then uses 2D background). Real implementation (Blender / 3D studio from the other developer's branch) plugs in later **without** importing their code here.

## 4. Social Media Publisher — interface only
`Publisher { platform; async validate(asset) ; async publish(asset, meta, {dryRun}) → {remoteId,url} }` for YouTube, TikTok, Instagram Reels, Facebook Reels. Must only publish items with `reviewStatus==='approved'`. Existing Meta OAuth in `meta.js` would be reused via adapter, not modified. Default `dryRun:true`.

## 5. Scheduler — interface only
`schedule({jobType, cron|at, payload})`, persisted in StateStore, idempotency key per run; respects Cost Control quotas and quiet hours.

## 6. Approval Center — partly (engine-level API)
Engine-level `approve/reject` exists in NewsEngine. UI integration with existing panel (`public/`) is out of scope for v0.

## 7. Analytics — interface only
`collect(platform, remoteId) → {views, likes, watchTimeSec, ctr}`; stored per story/video.

## 8. Brand / Project Memory — interface only
`get(projectId)` → `{name, tone, colors, fonts, intro/outro, banned topics, default hashtags}`; Video Factory accepts `brand` options (colors/font) already.

## 9. Cost & Resource Control (Mac mini M-series, 24 GB)
- Render concurrency 1 (ffmpeg `-threads` auto, VideoToolbox `h264_videotoolbox` optional via preset flag), max 1 local LLM loaded at a time (≤ 8B params Q4 ≈ 5–6 GB RAM), local TTS (Piper ≈ 100 MB RAM).
- Budget guard: `{dailyUsd, perCallUsd}` checked before any paid API call (interface; not implemented).
- Disk: renders in `media-automation/out/` (gitignored), retention policy TBD.
