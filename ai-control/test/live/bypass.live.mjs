// Stage 2 verification (item 6): control functions are blocked SERVER-side and never reach the Studio.
// A recording fake Studio (127.0.0.1:8686, inside the private netns) sits behind a dedicated proxy (8696). Every attack
// is sent as a raw HTTP request (no client-side URL normalisation) with a VALID proxy session; afterwards the recorder
// must have seen only the login and plain GETs of exact allowlisted paths, without override headers or foreign query keys.
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAKE = 8686, PROXY = 8696;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALLOWED = new Set(['/api/health', '/api/system', '/api/runtime', '/api/agents', '/api/tasks', '/api/jobs', '/api/episodes', '/api/channels', '/api/posts', '/api/queue', '/api/files',
  '/api/projects', '/api/logs', '/api/reports', '/api/world/mission', '/api/world/command-center', '/api/world/approvals', '/api/ops/nodes', '/api/ops/update-center', '/api/backups']);

function raw(method, target, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PROXY, method, path: target, headers: { host: `127.0.0.1:${PROXY}`, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers }, setHost: false }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

test.describe.configure({ mode: 'serial' });
test.describe('server-side write/allowlist bypass (fake Studio recorder)', () => {
  let fake, proxy, seen = [], sid = '';
  test.beforeAll(async () => {
    fake = http.createServer((q, s) => {
      let b = ''; q.on('data', (c) => { b += c; });
      q.on('end', () => {
        seen.push({ method: q.method, url: q.url, headers: q.headers });
        if (q.method === 'POST' && q.url === '/api/auth/login') { s.writeHead(200, { 'set-cookie': 'mk_session=0123456789abcdef0123; HttpOnly', 'content-type': 'application/json' }); return s.end('{"ok":true}'); }
        if (q.method === 'POST' && q.url === '/api/auth/logout') { s.writeHead(200); return s.end('{}'); }
        s.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'leak=1' }); s.end('{"ok":true}');
      });
    });
    await new Promise((r) => fake.listen(FAKE, '127.0.0.1', r));
    proxy = spawn(process.execPath, ['server.mjs', '--no-build'], { cwd: root, env: { ...process.env, PORT: String(PROXY), STUDIO_URL: `http://127.0.0.1:${FAKE}`, AIC_MODE: 'live', AIC_QUIET: '1' }, stdio: 'ignore' });
    for (let i = 0; i < 100; i++) { try { await raw('GET', '/aic/config'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const lg = await raw('POST', '/aic/login', { 'content-type': 'application/json', 'x-aic-request': '1', origin: `http://127.0.0.1:${PROXY}` }, JSON.stringify({ username: 'igor', password: 'fake-test-password' }));
    expect(lg.status).toBe(200);
    sid = /aic_sid=([^;]+)/.exec(lg.headers['set-cookie'][0])[1];
  });
  test.afterAll(async () => { proxy?.kill(); await new Promise((r) => fake.close(r)); });

  test('write methods, traversal, encoding, override headers, double slashes and case tricks → 403/405; Studio sees nothing but allowlisted GETs', async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'pure HTTP test — run once');
    const C = { cookie: `aic_sid=${sid}` };
    const results = [];
    const expectIn = async (codes, m, t, h = {}, body = null) => { if (process.env.BYPASS_DEBUG) console.log("REQ", m, t); const r = await raw(m, t, { ...C, ...h }, body); results.push(`${m} ${t} → ${r.status}`); expect(codes, `${m} ${t}`).toContain(r.status); return r; };
    const WRITE_PATHS = ['/api/tasks', '/api/tasks/1/approve', '/api/agents/ceo/start', '/api/world/import', '/api/ops/update-center/install', '/api/backups', '/api/backups/run', '/api/auth/users', '/api/health'];
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'HEAD', 'PROPFIND']) for (const p of WRITE_PATHS) await expectIn([405], m, p, { 'content-type': 'application/json', 'x-studio-request': '1' }, ['HEAD', 'TRACE'].includes(m) ? null : '{}');
    // method override on a write: still 405
    for (const h of ['x-http-method-override', 'x-http-method', 'x-method-override']) {
      await expectIn([405], 'POST', '/api/tasks', { [h]: 'GET', 'content-type': 'application/json' }, '{}');
      await expectIn([405], 'POST', '/api/health?_method=GET', { [h]: 'GET' }, '{}');
    }
    const BYPASS = ['/api/health/../backup', '/api/health/..%2fbackup', '/api/health%2f..%2fbackup', '/api/%2e%2e/backup', '/api/%2E%2E/%2E%2E/etc/passwd', '/api/./backup', '/api/health%00', '/api/health%2500',
      '/api/health/', '/api/health;/../backup', '/api/health%3b', '/api/health%20', '/api/health.json', '/api/healthz', '/api/tasks/1', '/api/tasks%2f1%2fapprove', '/api/jobs/x/cancel',
      '/api/auth/login', '/api/auth/logout', '/api/backup', '/api/ops/update-center/check', '/api/world/import', '/api/ops/nodes/enroll',
      '//api/health', '//api/backup', '///api/backup', '/api//health', '/api//backup', '//127.0.0.1:8787/api/backup', '/\\127.0.0.1/api/backup', '/api\\..\\backup',
      '/API/health', '/Api/tasks', '/api/HEALTH', '/api/Health', '/API/backup', '/AIC/login', '/api/World/command-center',
      '/api/%68ealth', '/api/health%', '/api/%zz', '/%2fapi/health', '/%2Fapi%2Fbackup', '/api%2fbackup', '/api%2Fhealth'];
    for (const p of BYPASS) await expectIn([400, 403, 404, 405], 'GET', p);
    // the ones the brief names explicitly must be 403/405 (never a quiet 404 from the static branch)
    for (const p of ['//api/health', '/api//health', '/API/health', '/Api/tasks', '/api/HEALTH', '/api/%2e%2e/backup', '/api/health/../backup', '//127.0.0.1:8787/api/backup']) await expectIn([403, 405], 'GET', p);
    for (const p of ['/api/health', '/api/tasks', '/api/jobs?limit=5&_method=DELETE&callback=x', '/api/agents?x-http-method-override=DELETE'])
      await expectIn([200], 'GET', p, { 'x-http-method-override': 'DELETE', 'x-http-method': 'DELETE', 'x-method-override': 'PUT', 'x-studio-request': '1', 'content-type': 'application/json' });
    // absolute-form request target pointing at prod: path is used against the configured Studio only
    await expectIn([403], 'GET', 'http://127.0.0.1:8787/api/backup');
    await new Promise((r) => setTimeout(r, 300));
    const toStudio = seen.filter((s) => !(s.method === 'POST' && s.url === '/api/auth/login'));
    for (const s of toStudio) {
      const u = new URL(s.url, 'http://x');
      expect(s.method, s.url).toBe('GET');
      expect(ALLOWED.has(u.pathname), s.url).toBe(true);
      expect([...u.searchParams.keys()].every((k) => ['limit', 'status'].includes(k)), s.url).toBe(true);
      for (const h of ['x-http-method-override', 'x-http-method', 'x-method-override', 'x-studio-request', 'content-type']) expect(s.headers[h], `${h} on ${s.url}`).toBeUndefined();
    }
    expect(toStudio.map((s) => s.url)).toEqual(['/api/health', '/api/tasks', '/api/jobs?limit=5', '/api/agents']);
    test.info().annotations.push({ type: 'results', description: results.join('\n') });
    console.log(`[bypass] ${results.length} attack requests, Studio saw: ${JSON.stringify(seen.map((s) => s.method + ' ' + s.url))}`);
  });
});
