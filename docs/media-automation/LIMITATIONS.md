# Limitations (honest status, phase 2)

**Verified live on the Linux dev box:** espeak-ng and Piper TTS; Ollama with a local qwen2.5:1.5b model (one real run); live public RSS fetch (NASA, ESA, BBC); full ffmpeg pipeline with QA; the standalone Approval Center over HTTP on localhost.

**Mocked only (never called live):** YouTube Data API and YouTube Analytics, Telegram Bot API, X API v2, TikTok Content Posting and Display API, Meta Graph (IG/FB publish and insights), macOS `say`, macOS Keychain (`security`), the studio SQLite job queue.

### Specific limits
- **Not run on the Mac mini.** `say`, Keychain and VideoToolbox paths are untested on real macOS.
- **LLM:**
  - The 1.5B model is weak, and the fact-check often rejects its output. A rejection falls back to extractive text: safe, but bland.
  - The fact-check is lexical. Numbers, capitalised names and month names must literally appear in the sources. A paraphrase that changes meaning without new names or numbers would pass.
  - Translation checks only numbers.
- **Verification:**
  - Contradiction detection compares number+unit pairs and denial words. It does not understand semantics.
  - Ownership groups are manual config.
  - Syndication detection by text similarity needs summaries longer than 40 characters.
- **Publisher:**
  - Endpoint shapes follow the public docs as I know them; they are not validated against live APIs.
  - YouTube uploads the whole file in one PUT (no chunk resume).
  - X media upload uses the v2 simple upload, images only. X video is not implemented.
  - IG/FB require a public HTTPS `videoUrl` (hosting is not provided).
  - TikTok unaudited apps can post only SELF_ONLY.
  - No OAuth flows; tokens must be provided.
- **Telegram analytics:** the Bot API exposes no per-post views. Only the member count is returned.
- **Scheduler:**
  - Handlers are not yet wired to real jobs; there is no orchestrator.
  - A slot that falls inside the catch-up window while paused runs on resume. Older slots are marked missed.
  - Ambiguous local times at a DST change are not specially handled.
- **Approval Center:** it is a standalone page, not in the main UI. A single shared token, no per-user accounts. No HTTPS by itself (use a tunnel, see INTEGRATION.md).
- **Video:**
  - 2D only (Host3D stub).
  - Backgrounds are solid colours unless an image is supplied. No stock media fetching.
  - Subtitle chunk merging can, in rare cases, produce an over-long line. Validation then fails the render loudly.
- **State:** state is JSON files with atomic writes, single process. Concurrent processes writing the same state file are not supported.
- **Unchanged since phase 1:** Brand Memory and Cost Control are still documentation and interfaces only.
