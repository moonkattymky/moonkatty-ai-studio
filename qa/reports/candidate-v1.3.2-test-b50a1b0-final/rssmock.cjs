// QA-only preload: no real network. Loopback passes; known RSS hosts get a canned feed; everything else fails like a dead network.
const real = globalThis.fetch; const iso = h => new Date(Date.now() - h * 3600e3).toUTCString();
const rss = items => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.map(i => `<item><title>${i.t}</title><link>${i.l}</link><description>${i.d}</description><pubDate>${i.p}</pubDate></item>`).join('')}</channel></rss>`;
const FEEDS = { 'www.nasa.gov': rss([{ t: 'NASA Conducts RS-25 Engine Test at Stennis', l: 'https://www.nasa.gov/a1', d: 'NASA fired RS-25 engine for 500 seconds at Stennis Space Center.', p: iso(3) }]),
  'feeds.bbci.co.uk': rss([{ t: 'NASA conducts RS-25 engine test at Stennis center', l: 'https://www.bbc.co.uk/news/b1', d: 'The engine ran for 500 seconds in Mississippi, NASA said.', p: iso(2) }]) };
globalThis.fetch = (u, o) => { const h = new URL(String(u && u.url || u)).hostname; if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)) return real(u, o);
  if (FEEDS[h]) return Promise.resolve(new Response(FEEDS[h], { status: 200, headers: { 'content-type': 'application/rss+xml' } }));
  const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND ' + h), { code: 'ENOTFOUND' }); return Promise.reject(e); };
