'use strict';
/**
 * PLATFORM READ API v1.0.0 — read-only view for Studio 4 (CEO / Marketing Director / Revenue Director).
 * Every return value is a frozen deep copy; nothing here can publish, spend, approve or mutate state.
 * Data source: a snapshot object (default: fixtures/platforms-snapshot.sample.json, all mock) or live providers
 * ({ publisher, ledger, approvals, analytics }) which are only READ.
 */
const fs = require('fs'); const path = require('path');
const { PLATFORMS, getPlatform, liveMode } = require('./registry');
const { capabilitiesFor } = require('./capabilities');
const READ_API_VERSION = '1.0.0';
const SAMPLE = path.join(__dirname, '..', '..', 'fixtures', 'platforms-snapshot.sample.json');
const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
const out = o => freeze(JSON.parse(JSON.stringify(o)));
function createReadApi({ snapshot = null, snapshotPath = SAMPLE, publisher = null, ledger = null, approvals = null, analytics = null, liveFlags = {}, env = {} } = {}) {
  const snap = snapshot || (publisher || ledger || analytics ? null : JSON.parse(fs.readFileSync(snapshotPath, 'utf8')));
  const need = id => { const p = getPlatform(id); if (!p) { const e = new Error('unknown platform ' + id); e.status = 404; throw e; } return p; };
  const fromSnap = (key, id) => snap?.platforms?.[id]?.[key];
  const api = {
    version: READ_API_VERSION,
    getPlatforms: () => out(PLATFORMS.map(p => ({ id: p.id, kind: p.kind, label: p.label, formats: p.formats, scheduling: p.scheduling, implemented: p.implemented !== false, dataMode: snap ? (snap.platforms?.[p.id]?.dataMode || 'mock') : 'real' }))),
    getPlatformStatus(id) { const p = need(id); if (snap) return out(fromSnap('status', id));
      const lm = liveMode(id, { liveFlags, env, approvals }); const posts = publisher ? publisher.posts({ platform: p.kind }) : [];
      const counts = {}; posts.forEach(x => { counts[x.status] = (counts[x.status] || 0) + 1; });
      return out({ platformId: id, dataMode: 'real', mode: lm.live ? 'LIVE' : 'DRY-RUN', liveGate: lm, connected: null, postCounts: counts, asOf: new Date().toISOString() }); },
    getContentPipeline(id) { const p = need(id); if (snap) return out(fromSnap('pipeline', id));
      const items = (publisher ? publisher.posts({ platform: p.kind }) : []).map(x => ({ postId: x.id, contentId: x.contentId, status: x.status, reviewStatus: x.content?.reviewStatus || null, createdAt: x.createdAt, error: x.error }));
      return out({ platformId: id, dataMode: 'real', items }); },
    getAnalytics(id, range = {}) { need(id); if (snap) { const a = fromSnap('analytics', id); return out({ ...a, range: { since: range.since || a.range.since, until: range.until || a.range.until } }); }
      return out(analytics ? analytics(id, range) : { platformId: id, dataMode: 'real', range, totals: null, unavailable: ['no analytics provider'] }); },
    getRevenue(id) { need(id); if (snap) return out(fromSnap('revenue', id));
      const rows = ledger ? ledger.all(id) : []; const t = ledger ? ledger.totals(id) : { confirmed: {}, estimated: {} };
      return out({ platformId: id, dataMode: 'real', confirmed: { totals: t.confirmed, entries: rows.filter(r => r.status === 'confirmed') }, unconfirmed: { totals: t.estimated, entries: rows.filter(r => r.status === 'estimated' && !r.supersededBy) }, viewsAreRevenue: false }); },
    getCapabilities(id) { const p = need(id); const c = capabilitiesFor(p.kind, p.id); return out({ platformId: id, dataMode: 'static-docs', ...c }); },
  };
  return Object.freeze(api);
}
let _default; const def = () => (_default ||= createReadApi());
module.exports = { READ_API_VERSION, createReadApi,
  getPlatforms: () => def().getPlatforms(), getPlatformStatus: id => def().getPlatformStatus(id), getContentPipeline: id => def().getContentPipeline(id),
  getAnalytics: (id, r) => def().getAnalytics(id, r), getRevenue: id => def().getRevenue(id), getCapabilities: id => def().getCapabilities(id) };
