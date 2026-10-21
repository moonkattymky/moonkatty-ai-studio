// OpenCode Basic Auth tests: mock LOCAL OpenCode servers that REQUIRE Basic Auth (fake password only), a test-only
// fake `security` binary standing in for the macOS Keychain, and leak checks (SQLite, WAL, backups, logs, API, argv,
// stdout/stderr, localStorage). Usage: node scripts/opencode-auth-test.mjs
import http from 'http'; import net from 'net'; import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path';
const PW = 'test-fake-pw-123', WRONG = 'wrong-fake-pw-456', USER = 'opencode';
const B64 = Buffer.from(`${USER}:${PW}`).toString('base64'), HEX = Buffer.from(PW).toString('hex');
const P = 8796, P2 = 8797, OC = 14096, OC403 = 14097, OCHANG = 14098, OCREF = 14099;
const UD = '/tmp/mk-oc-test', UD2 = '/tmp/mk-oc-test-nokc', KC = '/tmp/mk-oc-fakekc'; for (const d of [UD, UD2, KC]) fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(KC);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
let seenAuth = 0;
const mock = http.createServer((q, r) => { const want = 'Basic ' + B64;
  if (q.headers.authorization !== want) { r.writeHead(401, { 'www-authenticate': 'Basic realm="opencode"' }); return r.end('Unauthorized'); }
  seenAuth++; if (q.url === '/global/health') { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ healthy: true, version: '1.0.0-mock' })); }
  r.writeHead(404); r.end(); }).listen(OC, '127.0.0.1');
const m403 = http.createServer((q, r) => { r.writeHead(403); r.end('Forbidden ' + (q.headers.authorization || '')); }).listen(OC403, '127.0.0.1'); // echoes the header back: must be scrubbed
const hang = net.createServer(() => {}).listen(OCHANG, '127.0.0.1');
const outLog = [];
function start(port, dir, kc) {
  const env = { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: process.env.STUDIO_FLAVOR || 'prod', STUDIO_DATA_DIR: dir, PORT: String(port), NODE_ENV: 'test' }; delete env.STUDIO_TEST_SECURITY_BIN;
  if (kc) Object.assign(env, { STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log' });
  const s = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); s.stdout.on('data', d => outLog.push(String(d))); s.stderr.on('data', d => outLog.push(String(d))); return s;
}
const srv = start(P, UD, true), srv2 = start(P2, UD2, false); await sleep(2500);
const bodies = [];
async function call(port, m, p, b, h) { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: h, body: b === undefined ? undefined : typeof b === 'string' ? b : JSON.stringify(b) }); const t = await r.text(); bodies.push(t); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; }
const H = port => ({ 'x-studio-app-token': fs.readFileSync((port === P ? UD : UD2) + '/app-token', 'utf8').trim(), 'content-type': 'application/json', 'x-studio-request': '1' });
const A = (m, p, b) => call(P, m, p, b, H(P));
await A('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' });
// --- auth / CSRF on new endpoints
ok('GET /api/opencode/auth requires auth (401)', (await call(P, 'GET', '/api/opencode/auth')).status === 401);
ok('PUT /api/opencode/auth requires auth (401)', (await call(P, 'PUT', '/api/opencode/auth', { password: PW }, { 'content-type': 'application/json', 'x-studio-request': '1' })).status === 401);
ok('POST /api/opencode/test requires auth (401)', (await call(P, 'POST', '/api/opencode/test', undefined, { 'x-studio-request': '1' })).status === 401);
const noCsrf = { ...H(P) }; delete noCsrf['x-studio-request'];
ok('PUT without X-Studio-Request rejected (CSRF 403)', (await call(P, 'PUT', '/api/opencode/auth', { password: PW }, noCsrf)).status === 403);
ok('POST test with foreign Origin rejected (403)', (await call(P, 'POST', '/api/opencode/test', undefined, { ...H(P), origin: 'http://evil.example' })).status === 403);
ok('PUT with Sec-Fetch-Site cross-site rejected (403)', (await call(P, 'PUT', '/api/opencode/auth', { password: PW }, { ...H(P), 'sec-fetch-site': 'cross-site' })).status === 403);
let g = await A('GET', '/api/opencode/auth');
ok('initial state: keychain available (fake), hasPassword=false, default user opencode', g.j.keychain?.available === true && g.j.hasPassword === false && g.j.username === 'opencode', JSON.stringify(g.j.keychain));
// --- validation
for (const [u, why] of [['http://192.168.1.10:4096', 'LAN'], ['http://evil.example:4096', 'remote host'], ['http://127.0.0.1.nip.io:4096', 'rebinding-style host'], ['file:///etc/passwd', 'file:'], ['http://opencode:x@127.0.0.1:4096', 'userinfo'], ['javascript:alert(1)', 'js'], ['http://127.0.0.1:4096/?a=1', 'query']])
  ok('URL refused: ' + why, (await A('PUT', '/api/opencode/auth', { url: u })).status === 400);
ok('non-loopback refusal has clear RU message', /только локальные адреса/.test((await A('PUT', '/api/opencode/auth', { url: 'http://10.0.0.5:4096' })).j.error));
ok('bad username refused', (await A('PUT', '/api/opencode/auth', { username: 'op encode\n' })).status === 400);
ok('password with newline refused (stdin protocol safety)', (await A('PUT', '/api/opencode/auth', { password: 'a\nb' })).status === 400);
ok('password > 256 chars refused', (await A('PUT', '/api/opencode/auth', { password: 'x'.repeat(257) })).status === 400);
ok('password of wrong type refused', (await A('PUT', '/api/opencode/auth', { password: { $gt: '' } })).status === 400);
ok('unknown fields refused', (await A('PUT', '/api/opencode/auth', { url: 'http://127.0.0.1:4096', token: 'x' })).status === 400);
ok('generic CRUD cannot set non-loopback OpenCode URL', (await A('PUT', '/api/integrations/opencode', { url: 'http://evil.example' })).status === 400);
await A('PUT', '/api/integrations/opencode', { password: PW, note: 'x' });
ok('generic CRUD strips a password field', !JSON.stringify((await A('GET', '/api/integrations/opencode')).j).includes(PW));
const mal = await call(P, 'PUT', '/api/opencode/auth', `{"password":"${PW}"`, H(P));
ok('malformed JSON with password → 400, generic error', mal.status === 400 && !mal.t.includes(PW));
// --- connection checks
ok('settings saved (loopback URL, user)', (await A('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}`, username: USER })).status === 200);
let t = await A('POST', '/api/opencode/test');
ok('no password → 401 handled, RU message', t.j.ok === false && t.j.status === 401 && /требует пароль/.test(t.j.detail), t.j.detail);
let s = await A('PUT', '/api/opencode/auth', { password: PW });
ok('password saved → hasPassword=true, response has no password', s.status === 200 && s.j.hasPassword === true && !s.t.includes(PW) && !('password' in s.j));
t = await A('POST', '/api/opencode/test');
ok('correct Basic Auth → Подключено', t.j.ok === true && t.j.status === 200 && /Подключено/.test(t.j.detail) && seenAuth > 0, t.j.detail);
ok('status after success = Подключено', (await A('GET', '/api/opencode/auth')).j.status === 'Подключено');
await A('PUT', '/api/opencode/auth', { password: WRONG }); t = await A('POST', '/api/opencode/test');
ok('wrong password → 401, RU message, no leak', t.j.status === 401 && /Неверный логин или пароль/.test(t.j.detail) && !t.t.includes(WRONG), t.j.detail);
await A('PUT', '/api/opencode/auth', { username: 'alice', password: PW }); t = await A('POST', '/api/opencode/test');
ok('wrong username → 401', t.j.status === 401); await A('PUT', '/api/opencode/auth', { username: USER });
await A('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC403}` }); t = await A('POST', '/api/opencode/test');
ok('403 → RU message, echoed Authorization scrubbed', t.j.status === 403 && /Доступ запрещён/.test(t.j.detail) && !t.t.includes(B64) && !t.t.includes(PW), t.j.detail);
await A('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OCREF}` }); t = await A('POST', '/api/opencode/test');
ok('connection refused → RU message', t.j.code === 'refused' && /Соединение отклонено/.test(t.j.detail), t.j.detail);
await A('PUT', '/api/opencode/auth', { url: `http://localhost:${OCHANG}` }); t = await A('POST', '/api/opencode/test');
ok('timeout → RU message (5 s)', t.j.code === 'timeout' && /таймаут/.test(t.j.detail) && t.j.ms < 8000, t.j.detail + ' ' + t.j.ms + 'ms');
t = await A('POST', '/api/integrations/opencode/test');
ok('legacy /api/integrations/opencode/test goes through the safe check', t.j.code === 'timeout');
await A('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}` }); ok('back to working server', (await A('POST', '/api/opencode/test')).j.ok === true);
// --- leak checks
await A('POST', '/api/backups/run'); const exp = await A('GET', '/api/backup');
ok('backup export has no password/base64', !exp.t.includes(PW) && !exp.t.includes(B64));
const files = []; const walk = d => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); fs.statSync(f).isDirectory() ? walk(f) : files.push(f); } }; walk(UD);
const leaks = files.filter(f => { const b = fs.readFileSync(f).toString('latin1'); return [PW, WRONG, B64, HEX].some(x => b.includes(x)); });
ok(`no password in ANY data file (SQLite/WAL/backups/tokens; ${files.length} files)`, !leaks.length, leaks.join(','));
ok('backup file(s) created and clean', files.some(f => f.includes('/backups/')));
const logs = (await A('GET', '/api/logs')).t; ok('audit log has OpenCode entries but no password/Authorization', /integration:opencode/.test(logs) && ![PW, WRONG, B64].some(x => logs.includes(x)));
const argv = fs.readFileSync(KC + '/argv.log', 'utf8');
ok('Keychain calls never carry the password in argv (plain or hex)', !argv.includes(PW) && !argv.includes(HEX) && !argv.includes(Buffer.from(WRONG).toString('hex')) && /"-i"/.test(argv));
ok('Keychain item uses service "MOONKATTY AI STUDIO" / account opencode-server-password', /MOONKATTY AI STUDIO\|opencode-server-password/.test(fs.readFileSync(KC + '/kc.json', 'utf8')));
// --- UI: localStorage / sessionStorage / DOM after saving via the form
let ui = 'skipped';
try { const { chromium } = await import('playwright-core'); const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
  const p = await (await b.newContext()).newPage(); await p.goto(`http://127.0.0.1:${P}/`); await p.waitForSelector('#auth form');
  await p.fill('input[name=username]', 'igor'); await p.fill('input[name=password]', 'fake-admin-pw-1'); await p.click('#auth button'); await p.waitForSelector('#app:not(.hidden) #view .card');
  await p.evaluate(() => location.hash = 'settings'); await p.waitForSelector('#ocForm'); await p.waitForTimeout(500);
  await p.fill('#ocPw', PW); await p.click('#ocSave'); await p.waitForTimeout(800); await p.click('#ocTest'); await p.waitForTimeout(1500);
  const st = await p.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, pwv: document.querySelector('#ocPw').value, html: document.documentElement.outerHTML }));
  const resTxt = await p.textContent('#ocResult'); ui = resTxt;
  ok('UI: password field cleared, not in localStorage/sessionStorage/DOM', !st.includes(PW));
  ok('UI: «Проверить подключение» shows result', /Подключено/.test(resTxt), resTxt);
  await p.screenshot({ path: '/tmp/mk-oc-settings-ru.png', fullPage: true });
  await p.evaluate(() => localStorage.setItem('mk-lang', 'en')); await p.reload(); await p.waitForSelector('#ocForm'); await p.waitForTimeout(800);
  ok('UI: EN translation of the OpenCode card', /Test connection/.test(await p.textContent('#ocCard')) && /server access/.test(await p.textContent('#ocCard')));
  await p.evaluate(() => localStorage.setItem('mk-lang', 'uk')); await p.reload(); await p.waitForSelector('#ocForm'); await p.waitForTimeout(800);
  ok('UI: UK translation of the OpenCode card', /Перевірити підключення/.test(await p.textContent('#ocCard')));
  await b.close();
} catch (e) { ok('UI checks ran', false, e.message); }
// --- Keychain unavailable → «Не подключено», no fallback storage
await call(P2, 'POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' }, H(P2));
const n = await call(P2, 'GET', '/api/opencode/auth', undefined, H(P2));
ok('no Keychain → feature shown unavailable (Не подключено)', n.j.keychain?.available === false && n.j.status === 'Не подключено' && n.j.hasPassword === false);
const n2 = await call(P2, 'PUT', '/api/opencode/auth', { password: PW }, H(P2));
ok('no Keychain → saving password refused (409), no fallback', n2.status === 409 && /Не подключено/.test(n2.j.error));
const f2 = []; (function w(d) { for (const x of fs.readdirSync(d)) { const f = path.join(d, x); fs.statSync(f).isDirectory() ? w(f) : f2.push(f); } })(UD2);
ok('no Keychain → password not written anywhere', !f2.some(f => fs.readFileSync(f).toString('latin1').includes(PW)));
// --- clear
s = await A('PUT', '/api/opencode/auth', { clearPassword: true }); ok('clearPassword removes Keychain item', s.j.hasPassword === false && !fs.readFileSync(KC + '/kc.json', 'utf8').includes('opencode-server-password'));
ok('no password in any API response body', !bodies.some(x => x.includes(PW) || x.includes(B64)));
srv.kill('SIGTERM'); srv2.kill('SIGTERM'); await sleep(400);
ok('no password in server stdout/stderr', !outLog.join('').includes(PW) && !outLog.join('').includes(B64));
mock.close(); m403.close(); hang.close();
console.log(JSON.stringify({ passed: res.filter(x => x[1]).length, failed: res.filter(x => !x[1]).map(x => x[0]) }));
process.exit(res.every(x => x[1]) ? 0 : 1);
