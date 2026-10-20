// Sponsor placements & future AI STUDIO clients. An agreed amount is NOT income: money appears only as a ledger 'actual'
// entry with proof (linked via dealId). Expected amounts may be shown only as forecast (explicitly derived, labelled).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const TYPES = ['sponsor', 'client']; const STATUSES = ['lead', 'negotiating', 'agreed', 'in_progress', 'delivered', 'invoiced', 'paid', 'cancelled'];
const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'x', 'telegram', 'facebook', 'site', 'other'];
function createDeals({ dir, ledger, now = Date.now }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); const file = path.join(dir, 'deals.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }; const save = d => { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(d, null, 1), { mode: 0o600 }); fs.renameSync(t, file); };
  const bad = m => { throw Object.assign(new Error(m), { status: 400 }); };
  function clean(b, prev = {}) { const o = { ...prev };
    if (b.type !== undefined) o.type = TYPES.includes(b.type) ? b.type : bad('type: sponsor | client'); if (b.name !== undefined) o.name = String(b.name).trim().slice(0, 120) || bad('name');
    if (b.status !== undefined) o.status = STATUSES.includes(b.status) ? b.status : bad('status: ' + STATUSES.join(', '));
    if (b.contact !== undefined) { const c = String(b.contact || '').slice(0, 200); if (/pass(word)?|token|secret/i.test(c)) bad('contact: без паролей/токенов'); o.contact = c; }
    if (b.projectId !== undefined) o.projectId = b.projectId ? String(b.projectId).slice(0, 140) : null;
    if (b.agreed !== undefined) o.agreed = b.agreed ? { amount: /^\d+(\.\d{1,2})?$/.test(String(b.agreed.amount)) ? String(b.agreed.amount) : bad('agreed.amount'), currency: /^[A-Z]{3}$/.test(String(b.agreed.currency || '').toUpperCase()) ? String(b.agreed.currency).toUpperCase() : bad('agreed.currency'), note: 'согласовано, не получено' } : null;
    if (b.placements !== undefined) o.placements = (Array.isArray(b.placements) ? b.placements : bad('placements[]')).slice(0, 100).map(p => ({ platform: PLATFORMS.includes(p.platform) ? p.platform : bad('placement.platform'), deliverable: String(p.deliverable || '').slice(0, 200), date: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null, url: p.url && /^https:\/\//.test(p.url) ? String(p.url).slice(0, 300) : null, status: ['planned', 'published', 'cancelled'].includes(p.status) ? p.status : 'planned' }));
    if (b.notes !== undefined) o.notes = String(b.notes || '').slice(0, 1000); return o; }
  function create(b) { if (!b || !b.type || !b.name) bad('type и name обязательны'); const d = load(); const id = 'deal_' + crypto.randomBytes(6).toString('hex');
    d[id] = { id, status: 'lead', placements: [], agreed: null, projectId: null, ...clean(b), createdAt: new Date(now()).toISOString() }; save(d); return view(d[id]); }
  function update(id, b) { const d = load(); if (!d[id]) throw Object.assign(new Error('not found'), { status: 404 }); d[id] = { ...clean(b, d[id]), updatedAt: new Date(now()).toISOString() }; save(d); return view(d[id]); }
  function view(x) { const received = ledger ? ledger.listEntries({ kind: 'actual', direction: 'income' }).filter(e => e.dealId === x.id) : [];
    const byCur = {}; for (const e of received) byCur[e.currency] = ((+(byCur[e.currency] || 0)) + e.amountMinor / 100).toFixed(2); return { ...x, receivedActual: byCur, receivedEntries: received.map(e => e.id), project: ledger ? ledger.resolve(x.projectId) : null }; }
  const list = (f = {}) => Object.values(load()).filter(x => (!f.type || x.type === f.type) && (!f.status || x.status === f.status)).map(view);
  return { create, update, list, get: id => { const x = load()[id]; return x ? view(x) : null; } };
}
module.exports = { createDeals, TYPES, STATUSES, PLATFORMS };
