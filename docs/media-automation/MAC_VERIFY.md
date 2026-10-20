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
## 2. Tests (expected: 93 pass, 0 fail)
`cd media-automation && node --test test/`
## 3. Master voice (male anchor, candidate kokoro:am_michael)
`node bin/master-voice.js check` — fails loudly if the model hash differs (must match config/master-voice.json).
After listening to /workspace samples: `node bin/master-voice.js lock "Igor"` (owner only). Set `voiceProfileId` (Studio 5) before locking.
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
