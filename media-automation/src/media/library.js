'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { JsonStore } = require('../store'); const { run } = require('../video/exec');
const { licenseUrl, attributionLine } = require('./licenses'); const { UA } = require('./providers');

const BROAD = new Set(['mars', 'moon', 'earth', 'sun', 'jupiter', 'saturn', 'venus', 'mercury', 'crater', 'express', 'station', 'solar', 'orbiter', 'rover', 'telescope', 'international', 'space', 'artemis', 'texas', 'america']);
const GENERIC = new Set(['nasa', 'esa', 'image', 'photo', 'file', 'new', 'first', 'mission', 'space', 'news', 'live', 'during', 'from', 'with', 'jpg', 'png', 'three', 'words', 'time', 'celebrating', 'improves', 'analysis', 'photos', 'conduct', 'flights', 'welcomes', 'newest', 'progress', 'advances', 'over', 'around', 'video', 'captures', 'mesmerizing']);
/** Candidate must share at least one significant query term with its title/description/keywords. */
function relevant(q, c) {
  const terms = String(q).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3 && !GENERIC.has(w)); if (!terms.length) return true;
  const hay = ` ${c.title} ${c.description || ''} ${(c.keywords || []).join(' ')} `.toLowerCase(); const hit = t => new RegExp('[^a-z0-9]' + t + '[^a-z0-9]').test(hay); const hits = terms.filter(hit).length;
  // proper nouns (capitalized in the query, e.g. BepiColombo, Schiaparelli) are distinctive: at least one must match when present
  const proper = String(q).split(/[^A-Za-z0-9-]+/).filter(w => /^[A-Z]/.test(w) && w.length > 3 && !GENERIC.has(w.toLowerCase())).map(w => w.toLowerCase());
  const distinct = proper.filter(w => !BROAD.has(w)); if (distinct.length ? !distinct.some(hit) : proper.length && !proper.some(hit)) return false; return hits >= Math.min(2, terms.length);
}
/** Layout for a still at a target frame: never upscales content. */
function layoutFor(asset, W, H, { kbZoom = 1.12 } = {}) {
  const cover = Math.max(W / asset.width, H / asset.height) * kbZoom;
  if (cover <= 1) return { mode: 'kenburns', scale: cover };
  const fit = Math.min((W * 0.9) / asset.width, (H * (W > H ? 0.78 : 0.5)) / asset.height, 1); // <=1 : downscale only
  const fw = Math.round(asset.width * fit), fh = Math.round(asset.height * fit);
  if (Math.min(fw, fh) < Math.min(W, H) * 0.4) return { mode: 'reject', reason: `too small for ${W}x${H} without upscaling (${asset.width}x${asset.height})` };
  return { mode: 'blurfill', fgWidth: fw - (fw % 2), fgHeight: fh - (fh % 2) };
}

/**
 * MediaLibrary: finds, licenses-checks, downloads and records assets. Each asset:
 * { id, newsId, provider, sourceUrl, pageUrl, title, author, credit, license, licenseUrl, attributionRequired, attribution, width, height, localPath, sha256, fetchedAt }
 */
class MediaLibrary {
  constructor({ dir, providers, fetchFn = globalThis.fetch, runFn = run, minShortSide = 720 }) {
    fs.mkdirSync(dir, { recursive: true }); this.dir = dir; this.store = new JsonStore(path.join(dir, 'library.json'));
    Object.assign(this, { providers, fetchFn, runFn, minShortSide });
  }
  assets(filter = {}) { return Object.values(this.store.get('assets', {})).filter(a => Object.entries(filter).every(([k, v]) => a[k] === v)); }
  rejections() { return this.store.get('rejections', []); }
  _reject(c, reason) { this.store.update('rejections', r => [...r, { provider: c.provider, id: c.id, pageUrl: c.pageUrl, reason, at: new Date().toISOString() }].slice(-500), []); }
  async _download(url, dest) {
    const r = await this.fetchFn(url, { headers: { 'user-agent': UA } }); if (!r.ok) throw new Error(`download HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 60e6) throw new Error('file too large'); fs.writeFileSync(dest, buf); return buf;
  }
  async _probe(file) { const { stdout } = await this.runFn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]); const [w, h] = stdout.trim().split(',').map(Number); return { width: w, height: h }; }
  /** Find up to `count` licensed images for a news item. queries: [{ provider, q }] tried in order. */
  async findForNews(newsId, queries, { count = 2 } = {}) {
    const have = this.assets({ newsId }); if (have.length >= count) return have.slice(0, count);
    const got = [...have];
    for (const { provider, q } of queries) {
      const p = this.providers[provider]; if (!p) continue;
      let cands; try { cands = await p.search(q); } catch (e) { this._reject({ provider, id: q }, 'search failed: ' + e.message); continue; }
      for (let c of cands) {
        if (got.length >= count) break;
        if (got.some(a => a.pageUrl === c.pageUrl) || this.assets().some(a => a.pageUrl === c.pageUrl && a.newsId !== newsId)) continue; // no reuse across stories
        if (!c.license.ok) { this._reject(c, c.license.reason); continue; }
        if (!relevant(q, c)) { this._reject(c, 'not relevant to query'); continue; }
        if (c.width && Math.min(c.width, c.height) < this.minShortSide) { this._reject(c, `too small ${c.width}x${c.height}`); continue; }
        try {
          c = await p.resolve(c); if (!c?.url) { this._reject(c || {}, 'no downloadable file'); continue; }
          const id = crypto.createHash('sha1').update(c.provider + c.id).digest('hex').slice(0, 12); const ext = /\.png($|\?)/i.test(c.url) ? '.png' : '.jpg';
          const dest = path.join(this.dir, id + ext); const buf = fs.existsSync(dest) ? fs.readFileSync(dest) : await this._download(c.url, dest);
          const dim = await this._probe(dest);
          if (Math.min(dim.width, dim.height) < this.minShortSide) { this._reject(c, `too small ${dim.width}x${dim.height}`); fs.rmSync(dest, { force: true }); continue; }
          const a = { id, newsId, provider: c.provider, kind: 'image', sourceUrl: c.url, pageUrl: c.pageUrl, title: c.title, author: c.author, credit: c.credit, description: c.description,
            license: c.license.id, licenseRaw: c.license.raw, licenseUrl: c.licenseUrlRaw || licenseUrl(c.license.id), attributionRequired: !!(c.attributionRequired ?? c.license.attributionRequired),
            shareAlike: !!c.license.shareAlike, licenseNote: c.license.note || null, query: q, ...dim, localPath: dest, sha256: crypto.createHash('sha256').update(buf).digest('hex'), fetchedAt: new Date().toISOString() };
          a.attribution = attributionLine(a); this.store.update('assets', x => ({ ...x, [a.id]: a }), {}); got.push(a);
        } catch (e) { this._reject(c, 'fetch failed: ' + e.message); }
      }
      if (got.length >= count) break;
    }
    return got;
  }
  /** Rights file for an episode. */
  /** Register an own generated graphic (branded infographic panel) used when no relevant licensed asset exists. */
  addGenerated(a) { const asset = { provider: 'moonkatty-generated', kind: 'image', license: 'Own-work', licenseUrl: null, attributionRequired: false, author: 'MOONKATTY NEWS', attribution: 'Graphic: MOONKATTY NEWS (no stock image available)', fetchedAt: new Date().toISOString(), ...a };
    this.store.update('assets', x => ({ ...x, [asset.id]: asset }), {}); return asset; }
  rightsReport(assetIds, extra = {}) {
    const all = this.store.get('assets', {}); const items = assetIds.map(id => all[id]).filter(Boolean);
    return { generatedAt: new Date().toISOString(), policy: 'Allowed: PD, CC0, NASA media (guidelines), CC BY, CC BY-SA (incl. ESA CC BY-SA 3.0 IGO). Rejected: NC, ND, unknown, logos/insignia.',
      assets: items.map(({ localPath, ...a }) => a), ...extra };
  }
}
module.exports = { MediaLibrary, layoutFor, relevant };
