// Test-only preload: every non-loopback fetch fails like a dead network (S5-NV-02 offline test).
const real = globalThis.fetch;
globalThis.fetch = (u, o) => { const h = new URL(String(u && u.url || u)).hostname; if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(h)) return real(u, o);
  const e = new TypeError('fetch failed'); e.cause = Object.assign(new Error('getaddrinfo ENOTFOUND ' + h), { code: 'ENOTFOUND' }); return Promise.reject(e); };
const dns = require('dns'), realLookup = dns.lookup;
dns.lookup = (h, o, cb) => { if (['localhost', '127.0.0.1', '::1'].includes(h) || !h) return realLookup(h, o, cb); cb = typeof o === 'function' ? o : cb; const e = Object.assign(new Error('getaddrinfo ENOTFOUND ' + h), { code: 'ENOTFOUND' }); process.nextTick(() => cb(e)); };
