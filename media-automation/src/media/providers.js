'use strict';
const { classify } = require('./licenses');
const UA = 'MoonkattyMediaAutomation/0.2 (news video research; contact via github.com/moonkattymky)';
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
async function getJson(fetchFn, url) { const r = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'application/json' } }); if (!r.ok) { const e = new Error(`HTTP ${r.status} ${url}`); e.status = r.status; e.transient = r.status >= 500 || r.status === 429; throw e; } return JSON.parse(await r.text()); }
/** NASA Image and Video Library (images-api.nasa.gov). Rejects logos/insignia. Picks ~orig file. */
class NasaImagesProvider {
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.name = 'nasa'; }
  async search(q, { limit = 8 } = {}) {
    const d = await getJson(this.fetchFn, `https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=${limit * 2}`);
    const out = [];
    for (const it of d.collection?.items || []) {
      const m = it.data?.[0]; if (!m) continue;
      if (/\b(logo|insignia|emblem|patch|seal)\b/i.test(`${m.title} ${(m.keywords || []).join(' ')}`)) continue;
      out.push({ provider: 'nasa', id: m.nasa_id, title: m.title, description: strip(m.description).slice(0, 300), author: m.photographer || m.secondary_creator || null, credit: `NASA${m.center ? ' ' + m.center : ''}`,
        pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(m.nasa_id)}`, manifest: it.href, date: m.date_created, license: classify('', { source: 'nasa' }), keywords: m.keywords || [] });
      if (out.length >= limit) break;
    }
    return out;
  }
  async resolve(c) { // pick largest jpg from manifest
    const files = await getJson(this.fetchFn, c.manifest.replace(/ /g, '%20'));
    const pick = files.find(f => /~orig\.jpe?g$/i.test(f)) || files.find(f => /~large\.jpe?g$/i.test(f)) || files.find(f => /\.jpe?g$/i.test(f));
    return pick ? { ...c, url: pick.replace(/^http:/, 'https:').replace(/ /g, '%20') } : null;
  }
}
/** Wikimedia Commons: only free licenses accepted by policy; author/attribution from extmetadata. */
class CommonsProvider {
  constructor({ fetchFn = globalThis.fetch, thumbWidth = 2560 } = {}) { this.fetchFn = fetchFn; this.thumbWidth = thumbWidth; this.name = 'commons'; }
  async search(q, { limit = 8 } = {}) {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrnamespace=6&gsrlimit=${limit * 2}&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=${this.thumbWidth}`;
    const d = await getJson(this.fetchFn, u); const out = [];
    for (const p of Object.values(d.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0))) {
      const ii = p.imageinfo?.[0]; if (!ii || !/jpe?g|png/.test(ii.mime || '')) continue; const em = ii.extmetadata || {};
      const lic = classify(em.LicenseShortName?.value || em.License?.value || '', { source: 'commons' });
      if (em.NonFree?.value === 'true') continue;
      const usesThumb = ii.thumburl && ii.thumbwidth && ii.thumbwidth < ii.width;
      out.push({ provider: 'commons', id: p.title, title: p.title.replace(/^File:/, ''), description: strip(em.ImageDescription?.value).slice(0, 300), author: strip(em.Artist?.value) || null, credit: strip(em.Credit?.value).slice(0, 120) || null,
        pageUrl: ii.descriptionurl, url: usesThumb ? ii.thumburl : ii.url, width: usesThumb ? ii.thumbwidth : ii.width, height: usesThumb ? ii.thumbheight : ii.height, license: lic, licenseUrlRaw: em.LicenseUrl?.value || null,
        attributionRequired: em.AttributionRequired?.value === 'true' || lic.attributionRequired });
      if (out.length >= limit) break;
    }
    return out;
  }
  async resolve(c) { return c; }
}
module.exports = { NasaImagesProvider, CommonsProvider, UA };
