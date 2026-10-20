# media-automation (isolated module, feat/media-automation)

Node ≥20, CommonJS, no extra npm dependencies. Not wired into `server.js`.

- `src/news/` — News Intelligence Engine (see docs/media-automation/ARCHITECTURE.md)
- `src/video/` — Video Factory v0, RenderQueue, TTS providers, Character3D stub
- Tests: `node --test media-automation/test` (network mocked; the ffmpeg render test is skipped if ffmpeg is missing)
- Sample: `node media-automation/bin/sample-render.js [outDir] [--say]` (`--say` = macOS speech; default = tone stub, not speech)
