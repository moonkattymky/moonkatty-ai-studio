'use strict';
class ApiError extends Error {
  constructor(platform, status, body, retryAfterSec) { super(`${platform} API ${status}: ${String(body).slice(0, 300)}`); Object.assign(this, { platform, status, retryAfterSec }); this.transient = status === 429 || status >= 500; }
}
async function call(fetchFn, platform, url, opts = {}) {
  let res; try { res = await fetchFn(url, opts); } catch (e) { const err = new Error(`${platform} network: ${e.message}`); err.transient = true; throw err; }
  const text = await res.text(); let body; try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (!res.ok) { const ra = res.headers?.get?.('retry-after'); throw new ApiError(platform, res.status, typeof body === 'string' ? body : JSON.stringify(body), ra ? +ra : null); }
  return { body, headers: res.headers, status: res.status };
}
module.exports = { ApiError, call };
