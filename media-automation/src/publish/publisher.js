'use strict';
const crypto = require('crypto');
const { JsonStore } = require('../store');
const { ChainSecrets, redact } = require('../secrets');

/**
 * Social Publisher. DRY-RUN by default. A post goes LIVE only if ALL hold:
 *   account.live === true  AND  owner live flag for that platform (liveFlags[platform] === true or env MA_PUBLISH_LIVE_<PLATFORM>=owner-approved)
 *   AND content.reviewStatus === 'approved' (human approval).
 * Accounts are separate entities, e.g. youtube-news vs youtube-project, each with its own secret name.
 * Post statuses: queued | retry_wait | publishing | published | dry_run | failed | needs_check
 */
const LIVE_ENV_VALUE = 'owner-approved';
class Publisher {
  constructor({ statePath, adapters, accounts, secrets = new ChainSecrets(), liveFlags = {}, env = process.env, now = () => Date.now(), maxAttempts = 4, backoffMs = 2000 }) {
    this.store = new JsonStore(statePath); Object.assign(this, { adapters, secrets, liveFlags, env, now, maxAttempts, backoffMs });
    this.accounts = new Map(accounts.map(a => [a.id, a]));
    // restart: a post interrupted mid-publish may or may not exist remotely -> never auto-retry, require status check
    const posts = this.store.get('posts', {}); for (const p of Object.values(posts)) if (p.status === 'publishing') { p.status = 'needs_check'; this._hist(p, 'interrupted; requires status check before retry'); }
    this.store.set('posts', posts);
  }
  _hist(p, event, data) { (p.history = p.history || []).push({ at: new Date(this.now()).toISOString(), event, data: data ?? null }); }
  _save(p) { this.store.update('posts', ps => ({ ...ps, [p.id]: p }), {}); }
  posts(filter = {}) { return Object.values(this.store.get('posts', {})).filter(p => Object.entries(filter).every(([k, v]) => p[k] === v)); }
  post(id) { return this.store.get('posts', {})[id] || null; }
  isLive(accountId) {
    const a = this.accounts.get(accountId); if (!a || a.live !== true) return false;
    return this.liveFlags[a.platform] === true || this.env[`MA_PUBLISH_LIVE_${a.platform.toUpperCase()}`] === LIVE_ENV_VALUE;
  }
  _adapter(a) { const ad = this.adapters[a.adapter || a.platform]; if (!ad) throw new Error(`no adapter for ${a.platform}`); return ad; }
  preview(accountId, payload) { const a = this.accounts.get(accountId); if (!a) throw new Error('unknown account ' + accountId); const ad = this._adapter(a);
    return { account: { id: a.id, label: a.label, platform: a.platform }, mode: this.isLive(accountId) ? 'LIVE' : 'DRY-RUN', errors: ad.validate({ ...a.defaults, ...payload }), preview: ad.preview({ ...a.defaults, ...payload }) }; }
  /** Enqueue; same (account, contentId) -> same post (no duplicates). */
  enqueue({ accountId, contentId, payload, content = {} }) {
    const a = this.accounts.get(accountId); if (!a) throw new Error('unknown account ' + accountId);
    if (!contentId) throw new Error('contentId required (idempotency)');
    const key = crypto.createHash('sha256').update(`${accountId}|${contentId}`).digest('hex').slice(0, 24);
    const existing = this.posts().find(p => p.idempotencyKey === key); if (existing) return { ...existing, deduplicated: true };
    const errors = this._adapter(a).validate({ ...a.defaults, ...payload }); if (errors.length) throw new Error('invalid post: ' + errors.join('; '));
    const p = { id: key, idempotencyKey: key, accountId, platform: a.platform, contentId, payload, content: { reviewStatus: content.reviewStatus || null, storyId: content.storyId || null },
      status: 'queued', attempts: 0, nextAt: 0, remote: null, error: null, createdAt: new Date(this.now()).toISOString(), history: [] };
    this._hist(p, 'enqueued'); this._save(p); return p;
  }
  /** Process due posts once. Returns processed posts. */
  async processDue() {
    const due = this.posts().filter(p => (p.status === 'queued' || p.status === 'retry_wait') && p.nextAt <= this.now());
    const out = []; for (const p of due) out.push(await this._process(p)); return out;
  }
  async _process(p) {
    const a = this.accounts.get(p.accountId); const ad = this._adapter(a); const payload = { ...a.defaults, ...p.payload };
    if (!this.isLive(a.id)) { p.status = 'dry_run'; p.remote = { dryRun: true, preview: ad.preview(payload) }; this._hist(p, 'dry_run'); this._save(p); return p; }
    if (p.content.reviewStatus !== 'approved') { p.status = 'failed'; p.error = 'not approved by owner'; this._hist(p, 'blocked', p.error); this._save(p); return p; }
    let token;
    try { token = await this.secrets.require(a.secret); } catch (e) { p.status = 'failed'; p.error = e.message; this._hist(p, 'failed', e.message); this._save(p); return p; }
    p.status = 'publishing'; p.attempts++; this._hist(p, 'publishing', { attempt: p.attempts }); this._save(p);
    try {
      const r = await ad.publish(payload, { token, account: a }); p.status = 'published'; p.remote = r; p.error = null; this._hist(p, 'published', r);
    } catch (e) {
      const msg = redact(e.message, [token]);
      if (e.transient && p.attempts < this.maxAttempts) { const wait = e.retryAfterSec ? e.retryAfterSec * 1000 : this.backoffMs * 2 ** (p.attempts - 1);
        p.status = 'retry_wait'; p.nextAt = this.now() + wait; p.error = msg; this._hist(p, 'retry_scheduled', { inMs: wait, error: msg }); }
      else { p.status = 'failed'; p.error = msg; this._hist(p, 'failed', msg); }
    }
    this._save(p); return p;
  }
  async checkStatus(id) {
    const p = this.post(id); if (!p) throw new Error('no post'); const a = this.accounts.get(p.accountId);
    if (!p.remote?.remoteId) return { status: p.status, remote: null };
    const token = await this.secrets.require(a.secret); const s = await this._adapter(a).status(p.remote.remoteId, { token });
    this._hist(p, 'status_checked', s); this._save(p); return { status: p.status, remote: s };
  }
  /** Owner decision for a needs_check post after verifying remotely: 'published' (with remote) or 'requeue'. */
  resolve(id, decision, remote) { const p = this.post(id); if (p?.status !== 'needs_check') throw new Error('not in needs_check');
    if (decision === 'requeue') { p.status = 'queued'; p.nextAt = 0; } else { p.status = 'published'; p.remote = remote || p.remote; } this._hist(p, 'resolved', decision); this._save(p); return p; }
  history(id) { return this.post(id)?.history || []; }
}
/** Default account layout: separate YouTube channels for NEWS and PROJECT. All live:false. */
const DEFAULT_ACCOUNTS = [
  { id: 'youtube-news', label: 'YouTube — MOONKATTY NEWS', platform: 'youtube', secret: 'youtube_news_token', live: false, defaults: { privacy: 'private' } },
  { id: 'youtube-project', label: 'YouTube — MOONKATTY PROJECT', platform: 'youtube', secret: 'youtube_project_token', live: false, defaults: { privacy: 'private' } },
  { id: 'telegram-news', label: 'Telegram — news channel', platform: 'telegram', secret: 'telegram_bot_token', live: false, defaults: { chatId: '@moonkatty_news' } },
  { id: 'x-news', label: 'X — news', platform: 'x', secret: 'x_news_token', live: false },
  { id: 'tiktok-news', label: 'TikTok — news', platform: 'tiktok', secret: 'tiktok_news_token', live: false, defaults: { privacy: 'SELF_ONLY' } },
  { id: 'instagram-news', label: 'Instagram — news', platform: 'instagram', secret: 'meta_page_token_news', live: false },
  { id: 'facebook-news', label: 'Facebook — news page', platform: 'facebook', secret: 'meta_page_token_news', live: false },
];
module.exports = { Publisher, DEFAULT_ACCOUNTS, LIVE_ENV_VALUE };
