/* MOONKATTY AI CONTROL service worker — caches ONLY same-origin static assets.
 * Never caches /api/* (stage 2 read-only Studio proxy), /aic/* (login/session) or any cross-origin request. */
const VERSION = '__BUILD_VERSION__';
const CACHE = 'aic-static-' + VERSION;
const PRECACHE = __PRECACHE__;
const STATIC_RE = /\.(?:html|css|js|webmanifest|png|webp|jpg|jpeg|svg|ico)$/i;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('aic-static-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
function isApi(url) { return /(^|\/)(api|aic)(\/|$)/.test(url.pathname); }
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // never touch cross-origin
  if (isApi(url)) return;                               // never cache /api/* or /aic/* — straight to network
  const isNav = req.mode === 'navigate';
  if (!isNav && !STATIC_RE.test(url.pathname)) return;  // only static assets
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = isNav ? new URL('./index.html', self.registration.scope).href : req;
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic' && !isNav) cache.put(req, res.clone());
    return res;
  })());
});
