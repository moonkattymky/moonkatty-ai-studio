# media-automation (isolated module, branch feat/media-automation)

Node ≥20, CommonJS. Uses only `express`, which is already a repo dependency, and only for the Approval router. Not wired into `server.js`.

| Dir | What |
|---|---|
| `src/news` | News Intelligence Engine, verification (`verify.js`) |
| `src/llm` | Ollama adapter, fact-check, NewsEditor |
| `src/video` | VideoFactory v1, TTS (say/piper/espeak), SRT build/validate, QA, CC0 ambient bed, RenderQueue |
| `src/jobs` | JobQueuePort, LocalJobQueue, StudioJobQueueAdapter (stub) |
| `src/host3d` | Host3D interface, StubHost3D, QueuedHost3D |
| `src/publish` | Publisher + YouTube/Telegram/X/TikTok/Meta adapters (DRY-RUN default) |
| `src/schedule` | Scheduler (Asia/Jerusalem default) |
| `src/approval` | ApprovalCenter + express router + page |
| `src/analytics` | Analytics adapters + recommendations |
| `src/secrets.js` | Keychain (`security`) + env fallback |

- **Tests:** `node --test media-automation/test`. The network is mocked. Real ffmpeg, espeak and Piper tests run if those tools are installed.
- **Real news video (nothing is published):** `MA_PIPER_MODEL=... MA_PIPER_BIN=... node media-automation/bin/news-video.js /path/out 3`
- **Approval page:** `MA_SECRET_APPROVAL_TOKEN=... node media-automation/bin/approval-server.js <stateDir> 8795 <mediaRoot>`
- **LLM demo:** `node media-automation/bin/llm-demo.js out.json`
