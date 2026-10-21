'use strict';
class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} for ${url}`); this.status = status; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
/** GET text with retries on network errors, 5xx, 429. fetchFn is injectable (global fetch by default). */
async function fetchWithRetry(url, { fetchFn = globalThis.fetch, retries = 3, backoffMs = 500, timeoutMs = 15000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeoutMs);
      let res; try { res = await fetchFn(url, { signal: ac.signal, headers: { 'user-agent': 'MoonkattyNewsEngine/0.1' } }); } finally { clearTimeout(t); }
      if (res.ok) return await res.text();
      lastErr = new HttpError(res.status, url);
      if (!(res.status >= 500 || res.status === 429)) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && !(e.status >= 500 || e.status === 429)) throw e;
    }
    if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
  }
  throw lastErr;
}
module.exports = { fetchWithRetry, HttpError };
