'use strict';
const crypto = require('crypto');
const { JsonStore } = require('../store');
const { fetchWithRetry } = require('./http');
const { parseFeed } = require('./rss');
const { categorize, isBreaking, isControversial } = require('./classify');
const { normUrl, tokens, jaccard } = require('./dedup');
const { FallbackProvider, LocalExtractiveProvider, identityTranslator } = require('./providers');

const REVIEW = { AUTO: 'auto_approved', PENDING: 'pending_approval', APPROVED: 'approved', REJECTED: 'rejected' };
const id = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

/**
 * Source: { id, name, url, kind:'rss'|'official', trust?, license?, fetch?: async ({fetchWithRetry}) => [{title,link,summary,published,license,mediaUrl}] }
 */
class NewsEngine {
  constructor({ statePath, sources = [], provider, translator = identityTranslator, fetchFn, retries = 2, backoffMs = 200,
    similarity = 0.5, minSources = 2, outputLang = 'en', now = () => new Date().toISOString() } = {}) {
    if (!statePath) throw new Error('statePath required');
    this.store = new JsonStore(statePath);
    this.sources = new Map(); sources.forEach(s => this.addSource(s));
    this.provider = new FallbackProvider(provider || new LocalExtractiveProvider());
    Object.assign(this, { translator, fetchFn, retries, backoffMs, similarity, minSources, outputLang, now });
  }
  addSource(s) { if (!s.id || (!s.url && !s.fetch)) throw new Error('source needs id and url|fetch'); this.sources.set(s.id, { kind: 'rss', trust: 0.5, ...s }); }
  removeSource(sid) { this.sources.delete(sid); }
  stories() { return Object.values(this.store.get('stories', {})); }
  story(sid) { return this.store.get('stories', {})[sid] || null; }

  async fetchSource(src) {
    if (src.fetch) return src.fetch({ fetchWithRetry: (u, o) => fetchWithRetry(u, { fetchFn: this.fetchFn, retries: this.retries, backoffMs: this.backoffMs, ...o }) });
    const xml = await fetchWithRetry(src.url, { fetchFn: this.fetchFn, retries: this.retries, backoffMs: this.backoffMs });
    const { items, channelLicense } = parseFeed(xml);
    return items.map(i => ({ ...i, license: i.license || channelLicense || src.license || null }));
  }

  /** Fetch all sources, ingest new items. Errors per source are recorded, not fatal. */
  async run() {
    const report = { fetched: 0, new: 0, duplicates: 0, errors: [] };
    for (const src of this.sources.values()) {
      let items;
      try { items = await this.fetchSource(src); this._health(src.id, null); }
      catch (e) { report.errors.push({ source: src.id, error: e.message }); this._health(src.id, e.message); continue; }
      for (const it of items) {
        report.fetched++;
        const r = await this.ingest(src, it);
        r === 'new' ? report.new++ : r === 'dup' && report.duplicates++;
      }
    }
    return report;
  }
  _health(sid, err) { this.store.update('sourceHealth', h => ({ ...h, [sid]: { at: this.now(), ok: !err, error: err } }), {}); }

  /** Ingest one item; persisted immediately (restart-safe, idempotent). Returns 'new'|'merged'|'dup'|'skip'. */
  async ingest(src, it) {
    if (!it.title || !it.link) return 'skip';
    const key = normUrl(it.link);
    const seen = this.store.get('seen', {});
    if (seen[key]) return 'dup';
    const stories = this.store.get('stories', {});
    const tk = tokens(it.title);
    let target = null, best = 0;
    for (const s of Object.values(stories)) {
      const sim = jaccard(tk, new Set(s.tokens)); if (sim >= this.similarity && sim > best) { best = sim; target = s; }
    }
    const item = { sourceId: src.id, sourceName: src.name || src.id, kind: src.kind, title: it.title, link: it.link, summary: it.summary || '',
      published: it.published || null, mediaUrl: it.mediaUrl || null, license: it.license || null, fetchedAt: this.now() };
    let result;
    if (target) { if (target.items.some(x => x.sourceId === src.id && x.title === it.title)) { result = 'dup'; } else { target.items.push(item); result = 'merged'; } }
    else { target = { id: id(key), createdAt: this.now(), tokens: [...tk], items: [item], manualFlags: {} }; stories[target.id] = target; result = 'new'; }
    if (result !== 'dup') await this._recompute(target);
    stories[target.id] = target;
    seen[key] = target.id;
    this.store.set('stories', stories); this.store.set('seen', seen);
    return result;
  }

  async _recompute(s) {
    const text = s.items.map(i => `${i.title} ${i.summary}`).join(' ');
    const distinct = new Set(s.items.map(i => i.sourceId));
    s.sourceCount = distinct.size;
    s.officialSource = s.items.some(i => i.kind === 'official');
    s.corroboration = (s.sourceCount >= this.minSources || s.officialSource) ? 'confirmed' : 'unconfirmed';
    s.category = s.manualFlags.category || categorize(text);
    s.breaking = !!(s.manualFlags.breaking ?? s.items.some(i => /^(breaking|just in)/i.test(i.title) || isBreaking(i.title)));
    s.controversial = !!(s.manualFlags.controversial ?? isControversial(text));
    s.mediaLicense = s.items.map(i => ({ source: i.sourceId, url: i.mediaUrl, license: i.license, usable: i.mediaUrl ? (i.license ? null : false) : null }));
    const primary = [...s.items].sort((a, b) => (b.kind === 'official') - (a.kind === 'official'))[0];
    const out = await this.provider.summarize({ title: primary.title, texts: s.items.map(i => i.summary || i.title), lang: this.outputLang });
    s.headline = await this.translator.translate(out.headline, 'auto', this.outputLang);
    s.summary = await this.translator.translate(out.summary, 'auto', this.outputLang);
    s.lang = this.outputLang; s.summaryProvider = out.provider; s.summaryFallbackReason = out.fallbackReason || null;
    // Editorial review: never downgrade a human decision.
    const needs = s.breaking || s.controversial || s.corroboration !== 'confirmed';
    if (s.reviewStatus !== REVIEW.APPROVED && s.reviewStatus !== REVIEW.REJECTED) s.reviewStatus = needs ? REVIEW.PENDING : REVIEW.AUTO;
    if (s.reviewStatus === REVIEW.APPROVED && (s.breaking || s.controversial) && !s.review?.by) s.reviewStatus = REVIEW.PENDING;
    s.reviewReasons = [s.breaking && 'breaking', s.controversial && 'controversial', s.corroboration !== 'confirmed' && 'unconfirmed'].filter(Boolean);
    s.updatedAt = this.now();
  }

  _decide(sid, status, by, reason) {
    if (!by) throw new Error('reviewer required');
    const stories = this.store.get('stories', {}); const s = stories[sid]; if (!s) throw new Error(`no story ${sid}`);
    s.reviewStatus = status; s.review = { by, at: this.now(), reason: reason || null };
    this.store.set('stories', stories); return s;
  }
  approve(sid, by) { return this._decide(sid, REVIEW.APPROVED, by); }
  reject(sid, by, reason) { return this._decide(sid, REVIEW.REJECTED, by, reason); }
  async flag(sid, flags) {
    const stories = this.store.get('stories', {}); const s = stories[sid]; if (!s) throw new Error(`no story ${sid}`);
    s.manualFlags = { ...s.manualFlags, ...flags };
    if ((flags.breaking || flags.controversial) && s.reviewStatus === REVIEW.AUTO) s.reviewStatus = REVIEW.PENDING;
    await this._recompute(s); this.store.set('stories', stories); return s;
  }
  /** Only stories cleared for production. */
  publishable() { return this.stories().filter(s => s.reviewStatus === REVIEW.APPROVED || s.reviewStatus === REVIEW.AUTO); }
}
module.exports = { NewsEngine, REVIEW };
