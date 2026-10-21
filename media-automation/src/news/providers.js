'use strict';
/** Deterministic local extractive summarizer — no network. */
class LocalExtractiveProvider {
  get name() { return 'local-extractive'; }
  async summarize({ title, texts }) {
    const headline = String(title).replace(/^(breaking|just in)\s*[:\-–]\s*/i, '').trim().slice(0, 110);
    const sents = []; const seen = new Set();
    for (const t of texts) for (const s of String(t).split(/(?<=[.!?])\s+/)) {
      const k = s.toLowerCase().trim(); if (k.length > 20 && !seen.has(k)) { seen.add(k); sents.push(s.trim()); }
    }
    let summary = sents.slice(0, 2).join(' ');
    if (summary.length > 400) summary = summary.slice(0, 397).replace(/\s+\S*$/, '') + '...';
    return { headline, summary: summary || headline };
  }
}
/** Wraps a primary provider; on error/invalid output uses fallback. */
class FallbackProvider {
  constructor(primary, fallback = new LocalExtractiveProvider()) { this.primary = primary; this.fallback = fallback; this.lastError = null; }
  get name() { return `${this.primary.name}|fallback:${this.fallback.name}`; }
  async summarize(input) {
    try { const r = await this.primary.summarize(input); if (r && r.headline && r.summary) return { ...r, provider: this.primary.name }; throw new Error('invalid provider output'); }
    catch (e) { this.lastError = e; return { ...(await this.fallback.summarize(input)), provider: this.fallback.name, fallbackReason: e.message }; }
  }
}
/** Translation hook; identity by default. */
const identityTranslator = { name: 'identity', async translate(text) { return text; } };
module.exports = { LocalExtractiveProvider, FallbackProvider, identityTranslator };
