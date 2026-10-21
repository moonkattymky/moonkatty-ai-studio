# Verifying media-automation on the Mac mini (branch feat/media-automation)

Read-only for every other branch. Nothing here publishes; live publishing needs `MA_PUBLISH_LIVE_<PLATFORM>=owner-approved` **and** an approved item.

## 1. Prerequisites
```bash
brew install ffmpeg espeak-ng librsvg node@20 ollama
git fetch origin && git checkout feat/media-automation && npm ci
ollama pull qwen2.5:1.5b            # or any local model; set MA_OLLAMA_MODEL
python3 -m venv ~/ma/kokoro && ~/ma/kokoro/bin/pip install kokoro-onnx soundfile
# download kokoro-v1.0.onnx + voices-v1.0.bin (github.com/thewh1teagle/kokoro-onnx releases) into ~/ma/
export MA_KOKORO_PYTHON=~/ma/kokoro/bin/python MA_KOKORO_MODEL=~/ma/kokoro-v1.0.onnx MA_KOKORO_VOICES=~/ma/voices-v1.0.bin
```
## 2. Tests (expected on Linux box 2026-10-21: 0 fail, 2 skipped env-gated; see §8 for count)
`cd media-automation && node --test test/`
## 3. Master voice (FINAL: stock Kokoro am_fenrir, speed 1.0, no pitch — locked)
`node bin/master-voice.js check` — fails loudly if the model hash differs (must match config/master-voice.json).
Already locked (approved by Igor 2026-10-21). Do NOT re-lock. Export for Studio 5: `docs/media-automation/exports/master-voice.studio5.json` (schemaVersion 1.0.0, provisional; schema `media-automation/schemas/voice-profile.v1.schema.json`).
macOS premium voices: `say -v '?' | grep en_US` — evaluate e.g. "Evan (Premium)" by setting a candidate with engine `say`.
## 4. Full episode (real sources, local LLM, real voice, real licensed images)
`node bin/orchestrate.js issue ep-$(date +%Y%m%d)-mac ~/ma-out/episode1`
Check `runs/<id>/` : youtube + shorts mp4 (1920x1080 / 1080x1920, 30fps, H.264/AAC, 45–60 s), rights.json, lipsync-handoff.json, *.anchor.wav (48 kHz mono).
`ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate <mp4>`
## 5. Approval Center (iPhone via Tailscale)
`MA_APPROVAL_TOKEN=$(openssl rand -hex 24) node bin/approval-server.js` → port 8795; open `http://<tailscale-ip>:8795/?token=…` on iPhone. Approve → `node bin/orchestrate.js publish <runId> …` runs Publisher in **dry-run**.
## 6. Secrets (Keychain only)
`node bin/youtube-auth.js youtube-news` / `youtube-project` (needs `youtube_oauth_client` JSON in Keychain, Desktop-app OAuth client; loopback + PKCE).
`node bin/telegram-setup.js @channel` (token via stdin; runs getMe). Verify: `security find-generic-password -s moonkatty-media-automation -a telegram_bot_token` (do not print with -w in shared terminals).
## 7. Studio integration
Inject Studio `jobsApi` (feat/v1.2.0 docs/JOBS_API.md) into `StudioJobQueueAdapter({client})`; `StudioHost3D` returns null while `render_segment` is a stub.

## 8. v1.3.0-test additions — step by step (all DRY-RUN, no accounts connected by these steps)
1. Update the branch: `git checkout feat/media-automation && git pull --rebase`. Never merge, and never touch main or v1.2.4-test.
2. Run the new suites. They use mocks only and make no network calls.
   ```bash
   cd media-automation
   node --test test/platforms.test.js test/integration-jobs.test.js test/compat.test.js
   node --test test/   # full suite, expect 0 fail
   ```
3. **Meta (FB/IG) platforms:**
   - Read `docs/media-automation/META_CAPABILITIES.md`. The docs were checked on 2026-10-21. Note that the IG quota is 100 according to the guide and 50 according to the older reference.
   - Run `node -e "const a=require('./src/platforms/read-api');console.log(a.getPlatforms())"`. It should list 8 platforms, all `dataMode: mock`.
   - The Meta OAuth stays in the repo-root `meta.js`, which is unchanged. Connect FB/IG only through the existing Studio Social UI (`/api/meta/oauth/start`). That is the owner's step, and it is not done here.
   - The bridge `src/platforms/meta-oauth-bridge.js` reads `GET /api/workspaces` (the connection status, pageId and igUserId) and never decrypts tokens. Check it with the Studio running: `curl -s -b "mk_session=…" http://127.0.0.1:<port>/api/workspaces | jq '.[]|{platform,connection:{status:.connection.status,pageId:.connection.pageId,igUserId:.connection.igUserId}}'`.
   - The publishing token comes from Keychain (`meta_page_token_news`) unless the meta.js owner exports a `getPageToken`.
   - Live publishing needs `MA_PUBLISH_LIVE_INSTAGRAM|FACEBOOK=owner-approved` **and** an approved `live_mode:<platform>` item in the Approval Center. Leave both OFF.
4. **Read API:**
   - Regenerate the sample with `node bin/build-platform-snapshot.js`.
   - The schema is at `schemas/platforms/read-api.schema.json`.
   - Validate with `node --test test/platforms.test.js`.
5. **jobsApi queue (flag, default OFF):**
   - By default `LocalJobQueue` is used, and it is not changed.
   - To try the Studio queue, set `MA_JOBS_BACKEND=jobsapi` and inject the Studio `jobsApi` into `selectJobQueue({ local, jobsApi, videoRender })`.
   - Job types and resource classes are **provisional**. Override them with `MA_JOBS_TYPE_MAP='{"tts":"…"}'` and `MA_JOBS_RESOURCE_CLASS='{…}'`.
   - tts and video_render must stay `gpu_heavy`, which is the shared heavy lock.
   - Idempotency: video_render uses a server key (`runId:preset`); other types use a client key of 1–128 printable ASCII characters.
   - `publish_dry_run` always forces `dryRun: true`.
6. **video_render executor:**
   - Review `docs/media-automation/integration/video-render.setExecutor.snippet.js`. It is not applied. Studio decides whether to apply it, and media-automation is not in v1.2.4-test.
   - On the Mac with a Studio checkout that has `services.videoRender`, a manual test would be: set `MA_VIDEO_RENDER=on`, paste the snippet into a **local, uncommitted** copy of the Studio server, run `POST /api/jobs {type:'video_render', input:{runId, preset:'shorts', episodeRef}}`, then check that the artifacts mp4, srt and jpg are directly in `<dataDir>/media/` (`<runId>-<preset>.*`).
   - Until that is done, the integration is verified only against `test/fixtures/studio-jobs-mock.js`.
7. **Animation cues:** the schema is PROVISIONAL (`version: "1"`). Studio reviews it at stage D, so do not treat it as final.
