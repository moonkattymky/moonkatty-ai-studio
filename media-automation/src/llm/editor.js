'use strict';
const { checkAgainstSources } = require('./factcheck');
const { LocalExtractiveProvider } = require('../news/providers');

const SYSTEM = 'You are a careful news editor. Use ONLY facts present in the SOURCE text. Do not add names, numbers, dates, places or claims that are not in the SOURCE. If unsure, omit. Output plain English text only, no preamble.';
const srcBlock = texts => texts.map((t, i) => `SOURCE ${i + 1}:\n${t}`).join('\n\n');
const clean = s => String(s).replace(/^["'“\s]+|["'”\s]+$/g, '').replace(/^(headline|summary|title)\s*:\s*/i, '').trim();

/**
 * AI news editor. llm: LLMProvider (e.g. OllamaProvider) or null. Every LLM output is fact-checked against sources;
 * rejected/failed outputs fall back to deterministic local text. Each result reports { text, provider, rejected? }.
 */
class NewsEditor {
  constructor({ llm = null, allowNames = ['MOONKATTY'] } = {}) { this.llm = llm; this.allow = allowNames; this.local = new LocalExtractiveProvider(); this.log = []; }
  async _llm(kind, prompt, sources, fallback, { checkNames = true, maxTokens = 300 } = {}) {
    if (!this.llm) return { text: await fallback(), provider: 'local-deterministic' };
    try {
      const { text } = await this.llm.generate({ system: SYSTEM, prompt, maxTokens });
      const out = clean(text); if (!out) throw new Error('empty LLM output');
      const chk = checkAgainstSources(out, sources, { allow: this.allow, checkNames });
      if (!chk.ok) { this.log.push({ kind, rejected: out, unsupported: chk.unsupported }); return { text: await fallback(), provider: 'local-deterministic', rejected: { output: out, unsupported: chk.unsupported } }; }
      return { text: out, provider: this.llm.name };
    } catch (e) { this.log.push({ kind, error: e.message }); return { text: await fallback(), provider: 'local-deterministic', error: e.message }; }
  }
  async headline({ title, texts }) {
    const src = [title, ...texts];
    return this._llm('headline', `${srcBlock(src)}\n\nWrite ONE news headline, max 12 words, using only facts from the sources.`, src,
      async () => (await this.local.summarize({ title, texts })).headline, { maxTokens: 40 });
  }
  async summary({ title, texts }) {
    const src = [title, ...texts];
    return this._llm('summary', `${srcBlock(src)}\n\nWrite a neutral 2-sentence summary using only facts from the sources.`, src,
      async () => (await this.local.summarize({ title, texts })).summary, { maxTokens: 120 });
  }
  /** Video script: returns { scenes:[{heading,text}], provider } for a list of stories. */
  async videoScript({ issueTitle, stories }) {
    const scenes = [{ heading: issueTitle, text: `Welcome to ${issueTitle}. Here are today's top stories.` }];
    const providers = new Set();
    for (const s of stories) {
      const src = [s.headline || s.title, ...(s.texts || [s.summary])];
      const r = await this._llm('script', `${srcBlock(src)}\n\nWrite a 2-3 sentence spoken news script for this story for a short video. Use only facts from the sources.`, src,
        async () => (await this.local.summarize({ title: src[0], texts: src.slice(1) })).summary, { maxTokens: 160 });
      providers.add(r.provider); scenes.push({ heading: s.category ? s.category.toUpperCase() : '', text: r.text, storyId: s.id, provider: r.provider });
    }
    scenes.push({ heading: issueTitle, text: 'That is all for now. Thanks for watching.' });
    return { title: issueTitle, scenes, providers: [...providers] };
  }
  /** Translation: numbers must be preserved; names may be transliterated so only numbers are checked. Fallback = untranslated + flag. */
  async translate(text, to) {
    if (!this.llm) return { text, provider: 'none', translated: false };
    const r = await this._llm('translate', `Translate to ${to}. Keep all numbers exactly. Output only the translation.\n\nTEXT:\n${text}`, [text], async () => text, { checkNames: false, maxTokens: 300 });
    return { ...r, translated: r.provider !== 'local-deterministic' };
  }
}
/** Adapter so NewsEngine can use the editor as its SummaryProvider. */
class EditorSummaryProvider {
  constructor(editor) { this.editor = editor; this.name = editor.llm ? editor.llm.name : 'local'; }
  async summarize({ title, texts }) {
    const h = await this.editor.headline({ title, texts }); const s = await this.editor.summary({ title, texts });
    if (h.provider === 'local-deterministic' && s.provider === 'local-deterministic') throw new Error(h.rejected || s.rejected ? 'LLM output rejected by fact-check' : (h.error || s.error || 'LLM unavailable'));
    return { headline: h.text, summary: s.text };
  }
}
module.exports = { NewsEditor, EditorSummaryProvider, SYSTEM };
