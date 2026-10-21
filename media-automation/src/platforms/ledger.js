'use strict';
/**
 * Monetization ledger. RULES: views/impressions are NEVER revenue. Entries are 'estimated' (e.g. Meta
 * monetization_approximate_earnings) or 'confirmed' (requires a payoutId from an actual payout statement).
 * Totals keep confirmed and estimated strictly separate.
 */
const { JsonStore } = require('../store');
const crypto = require('crypto');
const STATUSES = ['estimated', 'confirmed'];
const FORBIDDEN_SOURCES = /views|impressions|reach|plays|cpm_projection/i;
class RevenueLedger {
  constructor({ statePath, now = () => new Date().toISOString() }) { this.store = new JsonStore(statePath); this.now = now; }
  all(platform) { return Object.values(this.store.get('entries', {})).filter(e => !platform || e.platform === platform); }
  add({ platform, amount, currency, status, source, payoutId = null, period = null, note = null }) {
    if (!platform) throw new Error('platform required'); if (!STATUSES.includes(status)) throw new Error('status must be estimated|confirmed');
    if (!Number.isFinite(amount) || amount < 0) throw new Error('amount must be >= 0'); if (!/^[A-Z]{3}$/.test(currency || '')) throw new Error('ISO currency required');
    if (!source) throw new Error('source required'); if (FORBIDDEN_SOURCES.test(source)) throw new Error('views/impressions are never revenue');
    if (status === 'confirmed' && !payoutId) throw new Error('confirmed revenue requires payoutId');
    const id = crypto.createHash('sha256').update([platform, status, source, payoutId || '', period || '', amount, currency].join('|')).digest('hex').slice(0, 16);
    const ex = this.store.get('entries', {})[id]; if (ex) return ex;
    const e = { id, platform, amount, currency, status, source, payoutId, period, note, recordedAt: this.now() };
    this.store.update('entries', x => ({ ...x, [id]: e }), {}); return e;
  }
  /** Mark an estimate as paid: creates a confirmed entry (estimate kept for audit, flagged superseded). */
  confirm(estimateId, { payoutId, amount, currency }) { const all = this.store.get('entries', {}); const est = all[estimateId]; if (!est || est.status !== 'estimated') throw new Error('estimate not found');
    const c = this.add({ platform: est.platform, amount: amount ?? est.amount, currency: currency || est.currency, status: 'confirmed', source: est.source, payoutId, period: est.period });
    this.store.update('entries', x => ({ ...x, [estimateId]: { ...x[estimateId], supersededBy: c.id } }), {}); return c; }
  totals(platform) { const t = { confirmed: {}, estimated: {} }; for (const e of this.all(platform)) { if (e.supersededBy) continue; t[e.status][e.currency] = +((t[e.status][e.currency] || 0) + e.amount).toFixed(2); } return t; }
}
module.exports = { RevenueLedger, STATUSES };
