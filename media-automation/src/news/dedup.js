'use strict';
const STOP = new Set('a an the of in on at to for and or is are was were be by with from as after over new says said its it this that'.split(' '));
function normUrl(u) {
  try { const x = new URL(u); x.hash = ''; for (const k of [...x.searchParams.keys()]) if (/^utm_|^fbclid$|^gclid$/.test(k)) x.searchParams.delete(k); return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/$/, '') + x.search).toLowerCase(); }
  catch { return String(u || '').toLowerCase(); }
}
const tokens = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
function jaccard(a, b) { if (!a.size || !b.size) return 0; let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i); }
module.exports = { normUrl, tokens, jaccard };
