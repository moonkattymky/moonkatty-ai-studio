// MOONKATTY AI CONTROL — local server (Stage 2).
// Binds to 127.0.0.1 ONLY. Serves the static build (dist/) and, in LIVE mode, acts as a same-origin READ-ONLY
// proxy to an existing MOONKATTY AI STUDIO instance (default: the TEST instance http://127.0.0.1:8687).
//   node ai-control/server.mjs                    → LIVE (Studio TEST 8687) on http://127.0.0.1:8697
//   AIC_MODE=demo node ai-control/server.mjs      → Stage 1 DEMO prototype, no proxy at all (works offline)
//   STUDIO_URL=http://127.0.0.1:8787 AIC_ALLOW_PROD=1 …  → production Studio (only when explicitly configured)
// Security model: see docs/STAGE2_INTEGRATION.md. Only an allowlist of GET paths reaches the Studio; the owner password
// is passed once to the Studio's own /api/auth/login and never stored; the Studio session token stays server-side.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8697);
// 8690 = Node API (TLS) of the TEST build, 8790 = Node API of prod, 8791 = node-agent status, 8795 = approval-server /
// security tests, 8787/8687 = Studio prod/test, 4096/4097 = OpenCode prod/test.  → AI CONTROL uses 8697.
const FORBIDDEN_PORTS = new Set([8787, 8687, 8690, 8790, 8791, 8795, 4096, 4097]);
if (FORBIDDEN_PORTS.has(PORT)) { console.error(`Port ${PORT} is reserved for other MOONKATTY services; pick another.`); process.exit(1); }
const MODE = (process.env.AIC_MODE || (process.argv.includes('--demo') ? 'demo' : 'live')).toLowerCase() === 'demo' ? 'demo' : 'live';
const STUDIO = new URL(process.env.STUDIO_URL || 'http://127.0.0.1:8687');
if (MODE === 'live') {
  if (STUDIO.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(STUDIO.hostname) || STUDIO.username || STUDIO.password || (STUDIO.pathname !== '/' && STUDIO.pathname !== '')) {
    console.error('STUDIO_URL must be http://127.0.0.1:<port> (loopback only, no credentials, no path).'); process.exit(1);
  }
  if (STUDIO.port === '8787' && process.env.AIC_ALLOW_PROD !== '1') { console.error('STUDIO_URL points to PRODUCTION (8787). Set AIC_ALLOW_PROD=1 to confirm explicitly.'); process.exit(1); }
}
const IDLE_MS = process.env.AIC_IDLE_SEC ? Math.max(3_000, Number(process.env.AIC_IDLE_SEC) * 1000) : Math.max(60_000, Number(process.env.AIC_IDLE_MIN || 15) * 60_000); // AIC_IDLE_SEC: tests only
const MAX_MS = 12 * 3600_000;
const COOKIE_SECURE = process.env.AIC_COOKIE_SECURE === '1';
const QUIET = process.env.AIC_QUIET === '1';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SEC = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex, nofollow',
};
const JSONH = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
function send(res, code, body, headers = {}) { res.writeHead(code, { ...SEC, ...headers }); res.end(body); }
const sendJson = (res, code, obj, extra = {}) => send(res, code, JSON.stringify(obj), { ...JSONH, ...extra });
// Request log: method, path (no query), status. Never bodies, cookies or headers.
const logLine = (m, p, s) => { if (!QUIET) console.log(`${new Date().toISOString()} ${m} ${p} ${s}`); };

/* ---------- READ-ONLY allowlist (existing Studio GET endpoints only) ---------- */
// [regex on the path, allowed query keys, response redaction]
const dropKeys = (keys) => (o) => { if (o && typeof o === 'object') for (const k of keys) delete o[k]; return o; };
const ALLOW = [
  [/^\/api\/health$/, [], null],
  [/^\/api\/system$/, [], dropKeys(['dbPath'])],
  [/^\/api\/runtime$/, [], (o) => { if (o) { delete o.dataDir; if (o.blender) delete o.blender.tried; if (o.opencode) delete o.opencode.path; } return o; }],
  [/^\/api\/agents$/, [], (a) => Array.isArray(a) ? a.map((x) => ({ ...x, actionLog: undefined })) : a],
  [/^\/api\/tasks$/, [], null],
  [/^\/api\/jobs$/, ['limit', 'status'], (a) => Array.isArray(a) ? a.map((j) => ({ id: j.id, kind: j.kind, type: j.type, status: j.status, publicStatus: j.publicStatus, agentId: j.agentId, taskId: j.taskId, title: j.task?.title || null, createdAt: j.createdAt || j.created_at, updatedAt: j.updatedAt || j.updated_at, progress: j.progress })) : a],
  [/^\/api\/episodes$/, [], null],
  [/^\/api\/channels$/, [], null],
  [/^\/api\/posts$/, [], null],
  [/^\/api\/queue$/, [], null],
  [/^\/api\/files$/, [], null],
  [/^\/api\/projects$/, [], null],
  [/^\/api\/logs$/, [], null],
  [/^\/api\/reports$/, [], null],
  [/^\/api\/world\/mission$/, [], null],
  [/^\/api\/world\/command-center$/, [], null],
  [/^\/api\/world\/approvals$/, [], null],
  [/^\/api\/ops\/nodes$/, [], (o) => o && ({ enabled: o.enabled, port: o.port, listening: o.listening, nodes: (o.nodes || []).map((n) => ({ id: n.id, name: n.name, role: n.role, online: n.online, status: n.status, lastSeen: n.lastSeen, revoked: n.revoked, enrolled: n.enrolled, platform: n.platform, version: n.version, metrics: n.metrics })), alerts: o.alerts, devices: o.devices })],
  [/^\/api\/ops\/update-center$/, [], (o) => o && ({ current: o.current, flavor: o.identity?.flavor ?? null, available: typeof o.available === 'string' ? o.available : null, releases: Array.isArray(o.releases) ? o.releases.length : null,
    lastCheck: o.lastCheck ? { at: o.lastCheck.at ?? null, ok: o.lastCheck.ok ?? null } : null, keysLoaded: o.keysLoaded ?? null, autoInstall: o.autoInstall ? { enabled: !!o.autoInstall.enabled } : null, gated: true })],
  [/^\/api\/backups$/, [], (a) => Array.isArray(a) ? { count: a.length, latest: a[0] || null } : a],
];
export const ALLOWLIST = ALLOW.map(([re]) => re.source);
const SECRET_KEYS = /^(password|passwordHash|token|authorization|cookie|secret|apiKey|accessToken|refreshToken|clientSecret|privateKey|sessions?)$/i;
function scrub(v, d = 0) {
  if (d > 12 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => scrub(x, d + 1));
  const o = {}; for (const [k, x] of Object.entries(v)) { if (!SECRET_KEYS.test(k)) o[k] = scrub(x, d + 1); } return o;
}

/* ---------- sessions (in memory only) ---------- */
const sessions = new Map(); // sha256(sid) → { studio, user, created, last }
const hsid = (s) => createHash('sha256').update(s).digest('hex');
function sidOf(req) { const m = /(?:^|;\s*)aic_sid=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie || ''); return m ? m[1] : null; }
function cookie(v, maxAge) { return `aic_sid=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`; }
async function studioLogout(tok) { try { await fetch(new URL('/api/auth/logout', STUDIO), { method: 'POST', headers: { cookie: `mk_session=${tok}`, 'x-studio-request': '1' }, signal: AbortSignal.timeout(5000) }); } catch { /* Studio offline */ } }
function getSess(req) {
  const sid = sidOf(req); if (!sid) return null;
  const k = hsid(sid), s = sessions.get(k); if (!s) return null;
  const now = Date.now();
  if (now - s.last > IDLE_MS || now - s.created > MAX_MS) { sessions.delete(k); studioLogout(s.studio); return { expired: true }; }
  s.last = now; return { key: k, ...s, ref: s };
}
setInterval(() => { const now = Date.now(); for (const [k, s] of sessions) if (now - s.last > IDLE_MS || now - s.created > MAX_MS) { sessions.delete(k); studioLogout(s.studio); } }, 30_000).unref();

/* ---------- request guards ---------- */
const OK_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function sameOriginWrite(req) { // our own POSTs (login/logout): custom header + same origin; a cross-site form cannot do both
  if (req.headers['x-aic-request'] !== '1') return false;
  const o = req.headers.origin; if (o && !OK_HOSTS.has((() => { try { return new URL(o).host; } catch { return ''; } })())) return false;
  const sfs = req.headers['sec-fetch-site']; if (sfs && !['same-origin', 'none'].includes(sfs)) return false;
  return true;
}
async function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => { let n = 0; const ch = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else ch.push(c); });
    req.on('end', () => resolve(Buffer.concat(ch).toString('utf8'))); req.on('error', reject); });
}

async function handleAic(req, res, p) {
  if (p === '/aic/config' && req.method === 'GET') return sendJson(res, 200, { mode: MODE, studio: MODE === 'live' ? { port: Number(STUDIO.port || 80), prod: STUDIO.port === '8787' } : null, idleMin: Math.max(1, Math.round(IDLE_MS / 60000)), readOnly: true });
  if (MODE !== 'live') return sendJson(res, 404, { error: 'DEMO mode: no Studio connection' });
  // 200 either way (no console noise in the browser); { user: null } = not logged in
  if (p === '/aic/session' && req.method === 'GET') { const s = getSess(req); return s && !s.expired ? sendJson(res, 200, { user: s.user, idleMin: Math.max(1, Math.round(IDLE_MS / 60000)) }) : sendJson(res, 200, { user: null, expired: !!s?.expired }, s?.expired ? { 'Set-Cookie': cookie('', 0) } : {}); }
  if (p === '/aic/login') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'csrf' });
    let body; try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'bad_request' }); }
    const username = String(body?.username || '').slice(0, 64), password = String(body?.password || '');
    if (!username || !password || password.length > 256) return sendJson(res, 400, { error: 'bad_request' });
    let r; try { r = await fetch(new URL('/api/auth/login', STUDIO), { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ username, password }), signal: AbortSignal.timeout(10000) }); }
    catch { return sendJson(res, 502, { error: 'studio_unreachable' }); }
    body = null; // drop the password reference
    if (r.status === 429) return sendJson(res, 429, { error: 'too_many_attempts' });
    if (!r.ok) return sendJson(res, 401, { error: 'bad_credentials' });
    const m = /(?:^|[;,]\s*)mk_session=([a-f0-9]{16,})/.exec(r.headers.get('set-cookie') || '');
    if (!m) return sendJson(res, 502, { error: 'studio_no_session' });
    const sid = randomBytes(32).toString('base64url');
    sessions.set(hsid(sid), { studio: m[1], user: username, created: Date.now(), last: Date.now() });
    return sendJson(res, 200, { ok: true, user: username, idleMin: Math.max(1, Math.round(IDLE_MS / 60000)) }, { 'Set-Cookie': cookie(sid, Math.round(MAX_MS / 1000)) });
  }
  if (p === '/aic/logout') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
    if (!sameOriginWrite(req)) return sendJson(res, 403, { error: 'csrf' });
    const s = getSess(req); if (s && !s.expired) { sessions.delete(s.key); await studioLogout(s.studio); }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  }
  return sendJson(res, 404, { error: 'not_found' });
}

async function handleApi(req, res, url, p) {
  if (MODE !== 'live') return sendJson(res, 404, { error: 'no API in DEMO mode' });
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'read_only', note: 'Управление — после отдельного разрешения' }, { Allow: 'GET' });
  const rule = ALLOW.find(([re]) => re.test(p));
  if (!rule) return sendJson(res, 403, { error: 'not_allowlisted' });
  const s = getSess(req);
  if (!s || s.expired) return sendJson(res, 401, { error: s?.expired ? 'session_expired' : 'auth_required' }, s?.expired ? { 'Set-Cookie': cookie('', 0) } : {});
  const target = new URL(p, STUDIO);
  for (const k of rule[1]) { const v = url.searchParams.get(k); if (v != null && /^[A-Za-z0-9_-]{1,32}$/.test(v)) target.searchParams.set(k, v); }
  let r; try { r = await fetch(target, { method: 'GET', headers: { cookie: `mk_session=${s.studio}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
  catch { return sendJson(res, 502, { error: 'studio_unreachable' }); }
  if (r.status === 401) { sessions.delete(s.key); return sendJson(res, 401, { error: 'session_expired' }, { 'Set-Cookie': cookie('', 0) }); }
  const text = await r.text();
  // An allowlisted endpoint the Studio does not serve (e.g. Update Center not mounted → 404, mission missing → 503) is
  // «НЕТ ДАННЫХ», not an error: answer 200 with a marker so the PWA renders the gap without console noise.
  if (r.status === 404 || r.status === 503) return sendJson(res, 200, { __nodata: true, studioStatus: r.status });
  if (!r.ok) return sendJson(res, 502, { error: 'studio_status_' + r.status });
  let data; try { data = JSON.parse(text); } catch { return sendJson(res, 502, { error: 'studio_not_json' }); }
  data = scrub(data); if (rule[2]) data = rule[2](data);
  // Studio Set-Cookie and other headers are never forwarded: only our own security headers + JSON.
  return sendJson(res, 200, data);
}

const server = http.createServer(async (req, res) => {
  let p = '-';
  res.on('finish', () => logLine(req.method, p, res.statusCode));
  try {
    if (!OK_HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(res, 421, 'Misdirected Request', { 'Content-Type': 'text/plain' });
    const url = new URL(req.url, `http://${HOST}`);
    p = decodeURIComponent(url.pathname);
    if (p.startsWith('/aic/')) return await handleAic(req, res, p);
    if (p.startsWith('/api/') || p === '/api') return await handleApi(req, res, url, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(dist, p));
    if (!file.startsWith(dist + path.sep)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': ext === '.html' || p.endsWith('/sw.js') || ext === '.webmanifest' ? 'no-cache' : 'public, max-age=3600' };
    if (p.endsWith('/sw.js')) headers['Service-Worker-Allowed'] = '/';
    if (req.method === 'HEAD') return send(res, 200, null, headers);
    send(res, 200, await readFile(file), headers);
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 413 ? 413 : 500, e.code === 413 ? 'Payload Too Large' : 'Internal Server Error', { 'Content-Type': 'text/plain' });
  }
});

if (!process.argv.includes('--no-build')) await build({ quiet: QUIET });
server.listen(PORT, HOST, () => console.log(`MOONKATTY AI CONTROL (${MODE.toUpperCase()}${MODE === 'live' ? ' → Studio ' + STUDIO.origin + ', только чтение' : ''}) → http://${HOST}:${PORT}/  (local only)`));
export default server;
