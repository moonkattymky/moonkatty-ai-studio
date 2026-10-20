'use strict';
// Integration: real server process on a temp data dir with STUDIO_OPS_MOBILE=1 + STUDIO_OPS_RESOURCES=1 (Ollama URL points to a closed port).
const test = require('node:test'); const assert = require('node:assert/strict');
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..', '..'); const PORT = 8811; const B = `http://127.0.0.1:${PORT}`;
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-mobile-'));
let srv, cookie, A; const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raw = (method, p, headers = {}) => new Promise(r => { const q = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r({ status: s.statusCode, body: d })); }); q.end(); });
const M = tok => ({ ...R, authorization: 'Bearer ' + tok });
const j = async (m, p, h, b) => { const r = await fetch(B + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) }); let body = null; try { body = await r.json(); } catch {} return { status: r.status, body }; };
test.before(async () => {
  srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, STUDIO_DATA_DIR: UD, PORT: String(PORT), STUDIO_OPS_MOBILE: '1', STUDIO_OPS_RESOURCES: '1', OPS_OLLAMA_URL: 'http://127.0.0.1:1' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(200); }
  const r = await fetch(B + '/api/auth/setup', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) });
  cookie = (r.headers.get('set-cookie') || '').split(';')[0]; A = { ...R, cookie };
});
test.after(() => { srv.kill('SIGTERM'); fs.rmSync(UD, { recursive: true, force: true }); });
let tok, tokRo, tokPub;
test('owner creates scoped tokens; only hashes are stored', async () => {
  let r = await j('POST', '/api/ops/mobile-tokens', A, { label: 'iPhone' }); assert.equal(r.status, 201); tok = r.body.token; assert.match(tok, /^mkm_/);
  tokRo = (await j('POST', '/api/ops/mobile-tokens', A, { label: 'ro', scopes: ['read'] })).body.token;
  tokPub = (await j('POST', '/api/ops/mobile-tokens', A, { label: 'pub', scopes: ['read', 'materials:review', 'materials:publish'] })).body.token;
  r = await j('GET', '/api/ops/mobile-tokens', A); assert.equal(r.body.length, 3); assert.ok(r.body.every(x => !('hash' in x) && !('token' in x)));
  await sleep(300); const dbBytes = fs.readdirSync(UD).filter(f => f.startsWith('studio.db')).map(f => fs.readFileSync(path.join(UD, f)).toString('latin1')).join('');
  assert.ok(!dbBytes.includes(tok) && !dbBytes.includes(tokRo), 'plaintext token must not be in DB');
  assert.equal((await j('POST', '/api/ops/mobile-tokens', M(tok), {})).status, 401, 'mobile token cannot mint tokens');
});
test('auth required on every mobile route', async () => {
  for (const p of ['/summary', '/tasks', '/media', '/materials', '/notifications', '/me', '/nope']) assert.equal((await fetch(B + '/api/mobile' + p)).status, 401, p);
  assert.equal((await j('GET', '/api/mobile/summary', { authorization: 'Bearer mkm_forged' })).status, 401);
  assert.equal((await j('POST', '/api/mobile/tasks/x/start', R)).status, 401);
});
test('mobile token is rejected outside /api/mobile (generic CRUD, restore, reset, backup, settings)', async () => {
  for (const [m, p] of [['GET', '/api/tasks'], ['GET', '/api/integrations'], ['GET', '/api/backup'], ['POST', '/api/restore'], ['POST', '/api/reset'], ['PUT', '/api/integrations/ollama'], ['GET', '/api/meta/config'], ['GET', '/api/ops/status'], ['DELETE', '/api/tasks/x']])
    assert.equal((await j(m, p, M(tok), m === 'GET' ? undefined : { confirm: 'RESET', data: {} })).status, 401, m + ' ' + p);
  assert.equal((await fetch(B + '/files/x', { headers: { authorization: 'Bearer ' + tok } })).status, 401);
  assert.ok((await j('GET', '/api/agents', A)).body.length > 3, 'data intact');
});
test('existing protections still apply: host check + CSRF', async () => {
  assert.equal((await raw('GET', '/api/mobile/summary', { host: 'evil.example:' + PORT, authorization: 'Bearer ' + tok })).status, 421);
  assert.equal((await j('POST', '/api/mobile/agents/news/start', { authorization: 'Bearer ' + tok })).status, 403, 'no X-Studio-Request');
  assert.equal((await j('POST', '/api/mobile/agents/news/start', { ...M(tok), origin: 'http://evil.example' })).status, 403, 'cross origin');
});
test('summary / tasks / notifications', async () => {
  const s = (await j('GET', '/api/mobile/summary', M(tok))).body;
  assert.ok(Array.isArray(s.agents) && s.tasks.byStatus && 'last10min' in s.errors && s.system.memTotal > 0 && /uncalibrated/.test(s.resources.mode) && 'memory' in s.system);
  assert.ok(Array.isArray((await j('GET', '/api/mobile/notifications', M(tok))).body.logs));
  assert.equal((await j('GET', '/api/mobile/me', M(tokRo))).body.scopes.join(), 'read');
});
test('start/stop: allowlisted agents only, never code tasks; scopes enforced', async () => {
  const mk = async b => (await j('POST', '/api/tasks', A, { status: 'failed', priority: 'normal', ...b })).body.id;
  const ok = await mk({ title: 'news t', agentId: 'news' }), dir = await mk({ title: 'dir t', agentId: 'director' }), code = await mk({ title: 'code t', agentId: 'news', kind: 'code' });
  assert.equal((await j('POST', `/api/mobile/tasks/${dir}/start`, M(tok))).status, 403);
  assert.equal((await j('POST', `/api/mobile/tasks/${code}/start`, M(tok))).status, 403);
  assert.equal((await j('POST', `/api/mobile/tasks/${ok}/start`, M(tokRo))).status, 403, 'read-only scope');
  let r = await j('POST', `/api/mobile/tasks/${ok}/start`, M(tok)); assert.equal(r.status, 200); assert.ok(['queued', 'in_progress', 'blocked'].includes(r.body.task.status));
  r = await j('POST', `/api/mobile/tasks/${ok}/stop`, M(tok)); assert.equal(r.status, 200);
  assert.equal((await j('POST', '/api/mobile/agents/director/start', M(tok))).status, 403);
  assert.equal((await j('POST', '/api/mobile/agents/news/stop', M(tok))).status, 200);
  assert.equal((await j('POST', '/api/mobile/agents/news/explode', M(tok))).status, 404);
  const t = (await j('GET', '/api/tasks/' + code, A)).body; assert.notEqual(t.codeApproved, true);
});
test('materials approve/reject; queue approval needs materials:publish scope', async () => {
  const id = (await j('POST', '/api/tasks', A, { title: 'draft', agentId: 'content', status: 'waiting_approval', result: 'text' })).body.id;
  assert.ok((await j('GET', '/api/mobile/materials', M(tok))).body.tasks.some(t => t.id === id));
  let r = await j('POST', `/api/mobile/materials/task/${id}/approve`, M(tok), { note: 'ok' }); assert.equal(r.status, 200); assert.equal(r.body.status, 'done');
  assert.equal((await j('POST', `/api/mobile/materials/task/${id}/approve`, M(tok), {})).status, 409);
  const qid = (await j('POST', '/api/queue', A, { title: 'post', channelId: 'fb-mk', status: 'pending_approval', text: 'hello' })).body.id;
  assert.equal((await j('POST', `/api/mobile/materials/queue/${qid}/approve`, M(tok), {})).status, 403);
  r = await j('POST', `/api/mobile/materials/queue/${qid}/approve`, M(tokPub), {}); assert.ok([200, 400].includes(r.status), 'guardrails decide: ' + JSON.stringify(r.body));
  const q2 = (await j('POST', '/api/queue', A, { title: 'post2', channelId: 'fb-mk', status: 'pending_approval' })).body.id;
  r = await j('POST', `/api/mobile/materials/queue/${q2}/reject`, M(tok), {}); assert.equal(r.body.status, 'rejected');
});
test('media: listing + safe download, unknown id 404', async () => {
  const up = await fetch(B + '/api/files/upload?name=a.html', { method: 'POST', headers: { ...A, 'content-type': 'text/html' }, body: '<script>1</script>' }); const f = await up.json();
  assert.ok((await j('GET', '/api/mobile/media', M(tok))).body.some(x => x.id === f.id));
  const r = await fetch(B + '/api/mobile/media/' + f.id, { headers: { authorization: 'Bearer ' + tok } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition') || '', /attachment/); assert.match(r.headers.get('content-security-policy') || '', /sandbox/);
  assert.equal((await fetch(B + '/api/mobile/media/..%2fstudio.db', { headers: { authorization: 'Bearer ' + tok } })).status, 404);
});
test('revoke token', async () => {
  const l = (await j('GET', '/api/ops/mobile-tokens', A)).body; const ro = l.find(x => x.label === 'ro');
  assert.equal((await j('DELETE', '/api/ops/mobile-tokens/' + ro.id, A)).body.ok, true);
  assert.equal((await j('GET', '/api/mobile/summary', M(tokRo))).status, 401);
});
test('mobile UI page served with strict CSP', async () => {
  const r = await fetch(B + '/mobile.html'); assert.equal(r.status, 200); assert.match(r.headers.get('content-security-policy'), /script-src 'self'(;|$)/);
  assert.doesNotMatch(await r.text(), /<script>(?!<\/script>)/);
});
