'use strict';
const path = require('path'); const fs = require('fs'); const crypto = require('crypto'); const { svgToPng, wrapWords, PALETTE } = require('../video/graphics');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
/** Branded infographic panel (own work, 3840x2160) — used instead of an irrelevant stock image. Text only from the verified story. */
/** showHeadline=false (default): headline is already on the lower-third — never print it twice. */
function panelSvg({ category = 'news', headline, fact, showHeadline = false }) {
  const W = 3840, H = 2160; const lines = wrapWords(headline, 26).slice(0, 3); const P = PALETTE || {};
  const stars = Array.from({ length: 140 }, (_, i) => { const r = crypto.createHash('md5').update(headline + i).digest(); return `<circle cx="${r[0] * 15}" cy="${r[1] * 8.5}" r="${1 + r[2] % 4}" fill="#fff" opacity="${0.2 + (r[3] % 60) / 100}"/>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b0b2e"/><stop offset=".6" stop-color="#2a1660"/><stop offset="1" stop-color="#0d1f4f"/></linearGradient>
<radialGradient id="p" cx=".78" cy=".35" r=".35"><stop offset="0" stop-color="${P.gold || '#f5c542'}" stop-opacity=".55"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#g)"/>${stars}<circle cx="${W * 0.78}" cy="${H * 0.35}" r="${H * 0.33}" fill="url(#p)"/><circle cx="${W * 0.78}" cy="${H * 0.35}" r="${H * 0.16}" fill="none" stroke="${P.gold || '#f5c542'}" stroke-width="8" opacity=".6"/>
<text x="${W * 0.22}" y="${H * 0.3}" font-family="Oswald" font-size="120" fill="${P.gold || '#f5c542'}" letter-spacing="10">${esc(String(category).toUpperCase())}</text>
${showHeadline ? lines.map((l, i) => `<text x="${W * 0.22}" y="${H * 0.42 + i * 190}" font-family="Oswald" font-weight="700" font-size="160" fill="#fff">${esc(l)}</text>`).join('') : `<text x="${W * 0.22}" y="${H * 0.42}" font-family="Oswald" font-weight="700" font-size="200" fill="#fff" letter-spacing="12">MOONKATTY NEWS</text>`}
${fact ? `<text x="${W * 0.22}" y="${H * 0.42 + lines.length * 190 + 120}" font-family="Inter" font-size="110" fill="#c4b5fd">${esc(fact.value + ' ' + fact.label)} · source: ${esc(fact.source)}</text>` : ''}</svg>`;
}
function panelFallbackFactory({ library, dir, runFn }) {
  fs.mkdirSync(dir, { recursive: true });
  return async ({ story, headline, fact }) => { const id = 'gen-' + crypto.createHash('sha1').update(story.id + headline).digest('hex').slice(0, 10); const f = path.join(dir, id + '.png');
    await svgToPng(panelSvg({ category: story.category, headline, fact }), f, runFn);
    return { ...library.addGenerated({ id, newsId: story.id, title: `Branded panel: ${headline}`, width: 3840, height: 2160, sha256: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') }), localPath: f }; };
}
module.exports = { panelSvg, panelFallbackFactory };
