'use strict';
const { JsonStore } = require('../store');
const { parts } = require('../schedule/tz');
/** Collects snapshots per published post; errors per post recorded, not fatal. */
class Analytics {
  constructor({ statePath, adapters, secrets }) { this.store = new JsonStore(statePath); Object.assign(this, { adapters, secrets }); }
  async collect(posts) { // posts: [{ id, platform, remoteId, secret, ctx, meta:{ category, publishedAt, durationSec, series } }]
    const out = { ok: 0, errors: [] };
    for (const p of posts) {
      try { const ad = this.adapters[p.platform]; if (!ad) throw new Error('no analytics adapter for ' + p.platform);
        const token = await this.secrets.require(p.secret); const m = await ad.fetch(p.remoteId, { token, ...(p.ctx || {}) });
        this.store.update('snapshots', s => ({ ...s, [p.id]: [...(s[p.id] || []), { ...m, meta: p.meta || {} }] }), {}); out.ok++; }
      catch (e) { out.errors.push({ id: p.id, error: e.message.replace(/bot\d+:[\w-]+/g, 'bot***') }); }
    }
    return out;
  }
  latest() { return Object.entries(this.store.get('snapshots', {})).map(([id, arr]) => ({ id, ...arr[arr.length - 1] })); }
}
/** Rule-based recommendations from latest snapshots. Requires minimum sample size; never invents data. */
function recommend(rows, { tz = 'Asia/Jerusalem', minSample = 3 } = {}) {
  const recs = []; const withViews = rows.filter(r => r.views > 0);
  const er = r => ((r.likes || 0) + (r.comments || 0) + (r.shares || 0)) / r.views;
  const group = (key) => { const g = {}; for (const r of withViews) { const k = key(r); if (k == null) continue; (g[k] = g[k] || []).push(r); } return g; };
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  if (withViews.length < minSample) return [{ type: 'insufficient_data', message: `Need at least ${minSample} posts with views (have ${withViews.length}).` }];
  for (const [platform, rs] of Object.entries(group(r => r.platform))) {
    const hours = {}; for (const r of rs) { if (!r.meta?.publishedAt) continue; const h = parts(Date.parse(r.meta.publishedAt), tz).h; (hours[h] = hours[h] || []).push(r.views); }
    const hs = Object.entries(hours).filter(([, v]) => v.length >= 2).map(([h, v]) => [+h, avg(v)]).sort((a, b) => b[1] - a[1]);
    if (hs.length >= 2) recs.push({ type: 'best_hour', platform, message: `${platform}: posts at ${String(hs[0][0]).padStart(2, '0')}:00 (${tz}) average ${Math.round(hs[0][1])} views vs ${Math.round(hs[hs.length - 1][1])} at ${String(hs[hs.length - 1][0]).padStart(2, '0')}:00.`, hour: hs[0][0] });
    const ret = rs.filter(r => r.avgViewSec != null && r.meta?.durationSec); if (ret.length >= minSample) { const p = avg(ret.map(r => r.avgViewSec / r.meta.durationSec));
      if (p < 0.35) recs.push({ type: 'retention', platform, message: `${platform}: average viewers watch ${Math.round(p * 100)}% — shorten intro / put strongest story first.`, ratio: +p.toFixed(2) }); }
  }
  const cats = Object.entries(group(r => r.meta?.category)).filter(([, v]) => v.length >= 2).map(([c, v]) => [c, avg(v.map(er))]).sort((a, b) => b[1] - a[1]);
  if (cats.length >= 2) recs.push({ type: 'category', message: `Highest engagement: ${cats[0][0]} (${(cats[0][1] * 100).toFixed(1)}%), lowest: ${cats[cats.length - 1][0]} (${(cats[cats.length - 1][1] * 100).toFixed(1)}%).`, ranking: cats.map(([c, v]) => ({ category: c, engagement: +v.toFixed(4) })) });
  const m = avg(withViews.map(r => r.views)); for (const r of withViews) if (r.views < m * 0.3) recs.push({ type: 'underperformer', id: r.id, platform: r.platform, message: `${r.id} on ${r.platform}: ${r.views} views (<30% of average ${Math.round(m)}). Review headline/thumbnail.` });
  return recs;
}
module.exports = { Analytics, recommend };
