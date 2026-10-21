// Read-only consumer of Studio 2 Platform Read API v1.0.0.
// Uses media-automation/src/platforms/read-api.js when that module is on disk.
// Otherwise reads the sample snapshot if STUDIO_PLATFORM_SNAPSHOT or the fixture path exists.
// Does not publish, spend, approve, or copy Studio 2 source.
'use strict';
const fs = require('fs');
const path = require('path');
const ND = 'НЕТ ДАННЫХ';
const IDS = ['youtube-news', 'youtube-project', 'tiktok', 'x', 'telegram', 'moonkatty-web', 'instagram', 'facebook'];

function freeze(o) { return JSON.parse(JSON.stringify(o)); }
function moneyLabel(amount, currency, demo) {
  if (amount == null || amount === '') return ND;
  const n = Number(amount);
  if (!Number.isFinite(n)) return ND;
  const text = (currency || 'USD') + ' ' + n.toFixed(2);
  return demo ? { label: 'DEMO ' + text, excludedFromActual: true, demo: true } : { label: text, usd: currency === 'USD' ? n : null, excludedFromActual: false, demo: false };
}
function viewFromSnapshot(snap) {
  const platforms = snap && snap.platforms || {};
  return {
    version: snap.readApiVersion || snap.schemaVersion || '1.0.0',
    getPlatforms: () => IDS.filter(id => platforms[id]).map(id => ({ id, label: id === 'moonkatty-web' ? 'moonkatty.com' : id, dataMode: platforms[id].dataMode || 'mock', implemented: id !== 'moonkatty-web' })),
    getRevenue: id => { if (!platforms[id]) { const e = new Error('unknown platform ' + id); e.status = 404; throw e; } return freeze(platforms[id].revenue); },
    getPlatformStatus: id => freeze(platforms[id] && platforms[id].status),
    getContentPipeline: id => freeze(platforms[id] && platforms[id].pipeline),
    getAnalytics: (id, range) => freeze(Object.assign({}, platforms[id] && platforms[id].analytics, { range: range || {} })),
    getCapabilities: id => ({ platformId: id, dataMode: 'static-docs', unavailable: id === 'moonkatty-web' ? ['no adapter'] : [] })
  };
}
function openPlatformRead() {
  const root = process.env.STUDIO_MEDIA_ROOT || path.join(__dirname, '..', '..', 'media-automation');
  const mod = path.join(root, 'src', 'platforms', 'read-api.js');
  if (fs.existsSync(mod)) {
    const apiMod = require(mod);
    const api = apiMod.createReadApi();
    return { path: 'studio2-read-api', version: apiMod.READ_API_VERSION || api.version, api, publish: false };
  }
  const snapPath = process.env.STUDIO_PLATFORM_SNAPSHOT || path.join(root, 'fixtures', 'platforms-snapshot.sample.json');
  if (fs.existsSync(snapPath)) {
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    return { path: 'fixture-demo', version: '1.0.0', api: viewFromSnapshot(snap), demo: true, publish: false };
  }
  return { path: 'absent', version: null, api: null, demo: false, publish: false };
}
function bucket(entries, demo) {
  const list = Array.isArray(entries) ? entries.filter(e => e && e.status !== 'superseded') : [];
  if (!list.length) return ND;
  const withPayout = list.filter(e => e.payoutId);
  const shown = demo ? list : withPayout;
  if (!shown.length) return ND;
  const first = shown[0];
  const label = moneyLabel(first.amount, first.currency, demo);
  if (label === ND) return ND;
  return Object.assign({}, label, { count: shown.length, payoutId: first.payoutId || null });
}
function summarize(opened) {
  if (!opened || !opened.api) {
    return { source: 'absent', demo: false, publish: false, viewsAreRevenue: false, platforms: IDS.map(id => ({ id, label: id === 'moonkatty-web' ? 'moonkatty.com' : id, confirmed: ND, estimate: ND, note: 'НЕТ ДАННЫХ' })) };
  }
  const demoDefault = opened.path !== 'studio2-read-api';
  const platforms = [];
  for (const row of opened.api.getPlatforms()) {
    const id = row.id;
    let rev = null;
    try { rev = opened.api.getRevenue(id); } catch { rev = null; }
    const demo = demoDefault || (rev && rev.dataMode === 'mock') || row.dataMode === 'mock';
    const noAdapter = id === 'moonkatty-web' || row.implemented === false;
    if (!rev || noAdapter) { platforms.push({ id, label: row.label || id, dataMode: noAdapter ? 'absent' : (demo ? 'mock' : 'real'), confirmed: ND, estimate: ND, note: 'НЕТ ДАННЫХ' }); continue; }
    const confirmedEntries = (rev.confirmed && rev.confirmed.entries || []).filter(e => e && e.payoutId);
    const estimateEntries = rev.unconfirmed && rev.unconfirmed.entries || [];
    const confirmed = demo ? (confirmedEntries.length ? bucket(confirmedEntries, true) : ND) : (confirmedEntries.length ? bucket(confirmedEntries, false) : ND);
    const estimate = estimateEntries.length ? Object.assign({}, bucket(estimateEntries, demo), { label: (demo ? 'DEMO ' : '') + 'не подтверждено' }) : ND;
    platforms.push({ id, label: row.label || id, dataMode: demo ? 'mock' : (rev.dataMode || 'real'), confirmed, estimate, viewsAreRevenue: false, note: demo ? 'DEMO' : null });
  }
  return { source: opened.path, version: opened.version, demo: platforms.some(p => p.dataMode === 'mock'), publish: false, viewsAreRevenue: false, platforms };
}
module.exports = { openPlatformRead, summarize, IDS, ND };
