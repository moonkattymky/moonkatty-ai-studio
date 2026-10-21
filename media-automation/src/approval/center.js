'use strict';
const crypto = require('crypto');
const { JsonStore } = require('../store');
/**
 * Approval Center queue. Item: { id, kind:'video'|'text'|'story', title, headline, text, videoPath?, thumbPath?, platformTargets?, sources?, meta?,
 *   status: pending|approved|rejected|changes_requested, history:[{at, by, action, from?, to?, note?}] }
 * Any edit puts the item back to 'pending' (approval is for the exact content). onApproved(item) hook (e.g. enqueue to Publisher).
 */
const STATUSES = ['pending', 'approved', 'rejected', 'changes_requested'];
class ApprovalCenter {
  constructor({ statePath, onApproved = null, now = () => new Date().toISOString() }) { this.store = new JsonStore(statePath); Object.assign(this, { onApproved, now }); }
  _all() { return this.store.get('items', {}); }
  _save(it) { this.store.update('items', x => ({ ...x, [it.id]: it }), {}); return it; }
  _h(it, by, action, extra = {}) { it.history.push({ at: this.now(), by, action, ...extra }); it.updatedAt = this.now(); }
  submit(item, by = 'system') {
    if (!item.title && !item.headline) throw new Error('title or headline required');
    const id = item.id || crypto.randomUUID(); const ex = this._all()[id]; if (ex) return ex;
    const it = { kind: 'video', ...item, id, status: 'pending', createdAt: this.now(), history: [] }; this._h(it, by, 'submitted'); return this._save(it);
  }
  list({ status } = {}) { return Object.values(this._all()).filter(i => !status || i.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { return this._all()[id] || null; }
  _need(id) { const it = this.get(id); if (!it) { const e = new Error('not found'); e.status = 404; throw e; } return it; }
  _by(by) { if (!by || typeof by !== 'string') { const e = new Error('reviewer (by) required'); e.status = 400; throw e; } }
  edit(id, { headline, text, title, description }, by) {
    this._by(by); const it = this._need(id); const changes = {};
    if (title != null) { const t = String(title).trim(); if (!t || t.length > 100) { const e = new Error('title 1..100 chars'); e.status = 400; throw e; } changes.title = { from: it.title, to: t }; it.title = t; }
    if (description != null) { const d = String(description); if (d.length > 5000) { const e = new Error('description > 5000 chars'); e.status = 400; throw e; } changes.description = { from: (it.description || '').slice(0, 200), to: d.slice(0, 200) }; it.description = d; }
    if (headline != null) { const h = String(headline).trim(); if (!h || h.length > 150) { const e = new Error('headline 1..150 chars'); e.status = 400; throw e; } changes.headline = { from: it.headline, to: h }; it.headline = h; }
    if (text != null) { changes.text = { from: it.text, to: String(text) }; it.text = String(text); }
    const prev = it.status; if (prev !== 'pending') it.status = 'pending';
    this._h(it, by, 'edited', { changes, statusFrom: prev }); return this._save(it);
  }
  async approve(id, by, note) { this._by(by); const it = this._need(id); if (it.status === 'approved') return it; if (it.status === 'rejected') { const e = new Error('rejected items must be resubmitted'); e.status = 409; throw e; }
    const from = it.status; it.status = 'approved'; this._h(it, by, 'approved', { from, note: note || null }); this._save(it);
    if (this.onApproved) { try { await this.onApproved(it); } catch (e) { this._h(it, 'system', 'on_approved_error', { note: e.message }); this._save(it); } } return it; }
  setPublishStatus(id, publish) { const it = this._need(id); it.publish = { ...(it.publish || {}), ...publish, updatedAt: this.now() }; this._h(it, 'system', 'publish_status', { note: publish.status }); return this._save(it); }
  reject(id, by, reason) { this._by(by); const it = this._need(id); const from = it.status; it.status = 'rejected'; this._h(it, by, 'rejected', { from, note: reason || null }); return this._save(it); }
  sendBack(id, by, note) { this._by(by); if (!note) { const e = new Error('note required when sending back'); e.status = 400; throw e; } const it = this._need(id); const from = it.status;
    it.status = 'changes_requested'; this._h(it, by, 'sent_back', { from, note }); return this._save(it); }
}
module.exports = { ApprovalCenter, STATUSES };
