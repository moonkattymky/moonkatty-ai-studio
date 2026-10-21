# Voice comparison renders (2026-10-21) — LLM scripts × 3 stock Kokoro voices

**Outcome: Igor chose `am_fenrir` → now the final MOONKATTY_NEWS_MASTER_VOICE (see MASTER_VOICE_EXPORT.md).** The renders below stay comparison-only. `MOONKATTY_NEWS_MASTER_VOICE` (casting B) config is unchanged; these renders use an explicit `voiceOverride` (`comparisonRender: true`, pure stock voice `{voice: 1.0}`, speed 1.0, no pitch shift — emotion modes change only speed/pauses/gain).

- Runner: `bin/news2-voices.js` (reuses the verified stories + licensed images of the master-voice demos; same script for every voice). Reel: `bin/voice-reel.js`.
- Scripts: `docs/media-automation/scripts/demo-{A,B,C}.script.json` (also `/workspace/ma-out/news2-voices/scripts/`). Written by local **Ollama qwen2.5:7b** (Qwen2.5-7B-Instruct Q4_K_M GGUF from Hugging Face, Apache-2.0) via `AnchorScriptWriter`.
- Outputs: `/workspace/ma-out/news2-voices/demo-<A|B|C>/<voice>/demo-<X>-<voice>-{youtube,shorts}.{mp4,cues.json,srt,jpg,json}` + `rights.json` + 8 persisted stage files. Approval Center items `news2-voicecmp-*` (pending).

## Fact-preservation gate (`src/llm/factcheck.js#strictFactCheck` + `src/anchor/scriptwriter.js`)
Rejects: digits, spelled numbers/ordinals, month names, relative time ("yesterday", "recently", "is now", "just whipped", "stay tuned/updates"), capitalised names not in SOURCE (sentence-initial ordinary words exempt via /usr/share/dict/words, but dictionary proper nouns like *Smith*, *Paris* still checked), the anchor naming itself, research credited to "we", duplicate sentences, body sentences with < 40% source vocabulary, and claims flagged by a second LLM verifier pass (paraphrase filter). Retries use feedback + a new seed; after 6 failures → deterministic source text. Humor: only via `humorSafetyCheck` (A: none).

## Script / render improvements
Hook → body → (B: safe tag after a punchline pause) → sign-off; per-line emotion (e.g. B hook EXCITED, body NEUTRAL, tag WITTY), per-line speed and pauses; karaoke word highlight captions (`\kf`) from word timestamps; vertical headline up to 4 lines (no "…" truncation).

## Limitations
- qwen2.5:7b on CPU: 20–60 s per attempt; quality is OK but still generic in places; the verifier is an LLM and can miss subtle embellishment (B: "more extensive science missions" stretches "conducting science"; A: "quite powerful" restates "powerful").
- RSS summaries are 1–2 sentences, so scripts can't get much richer without fetching full articles.
- Pure voices have no pitch emotion; am_adam is the lowest-quality Kokoro US male voice (grade lower in Kokoro's VOICES list).
