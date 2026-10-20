# Limitations (honest status)

- Only News Engine and Video Factory v0 are implemented; Publisher, Scheduler, Approval UI, Analytics, Brand Memory, Cost Control are **interfaces/docs only**.
- No real publishing and no real paid API calls exist in code. Network is mocked in tests.
- Summaries default to a deterministic **extractive** algorithm (first sentences, trimmed) — not an LLM; quality is basic. LLM provider is a pluggable interface; no concrete LLM adapter shipped.
- Translation is a hook (identity by default). Output language is EN.
- Categorization is keyword-based (EN keywords), will misclassify edge cases. "Controversial" detection is keyword-based plus manual flag.
- Corroboration counts distinct sources; it does not verify facts or detect syndicated copies of the same wire story (e.g. two outlets republishing AP count as two).
- RSS parser is minimal (RSS 2.0 / Atom common fields; no full XML spec, no CDATA edge-cases beyond basics).
- Media license tracking stores what the feed declares; it does not legally verify rights. Images from feeds are **not** downloaded/used by default.
- TTS: on the Linux box `say`/piper are unavailable, so samples were rendered with **StubTTS (tone/silence)**, not real speech. `MacSayTTS` is written but untested on real macOS here.
- Character3D is a stub returning no segment; videos are 2D (color background + text + subtitles).
- Render queue is single-process; no distributed locking.
- State is JSON files (atomic writes), not the app's SQLite DB, to stay isolated from the existing app.
- Not integrated into `server.js` / UI; nothing in the running app changes.
