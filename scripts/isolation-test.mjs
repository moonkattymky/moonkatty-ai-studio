// v1.2.2-test suite: build-flavor isolation, production-data guard, no prod migrations, pre-migration backup,
// two-step restore with automatic backup, SSRF-safe integration test, master key never in argv, Ollama load control,
// publishing-queue rules (QA-APR-001/002), TEST build publishing off, sandbox temp dir (QA-OC-001), video_render API.
// Runs the real server.js with STUDIO_FLAVOR=test (NODE_ENV=test) and a FAKE $HOME that contains a fake "production" install.
import { spawn, spawnSync, execFileSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import http from 'http'; import crypto from 'crypto'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const T = '/tmp/mk-iso-test-' + process.pid, HOME = T + '/home', PROD = HOME + '/Library/Application Support/MOONKATTY AI STUDIO', TD = HOME + '/Library/Application Support/MOONKATTY AI STUDIO TEST', KC = T + '/kc';
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(PROD, { recursive: true }); fs.mkdirSync(KC, { recursive: true });
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 300) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tree = d => { const o = {}; const w = p => { for (const n of fs.readdirSync(p)) { const f = path.join(p, n); const st = fs.lstatSync(f); if (st.isDirectory()) w(f); else o[path.relative(d, f)] = sha(f) + ':' + st.mtimeMs; } }; w(d); return o; };
// --- fake production install (v1.1.2 schema = 1: items/meta only) ---
{ const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(PROD + '/studio.db');
  d.exec("CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta VALUES ('seeded','2026-01-01'); INSERT INTO items VALUES ('tasks','prod1','{\"id\":\"prod1\",\"title\":\"PROD\"}');"); d.close();
  fs.writeFileSync(PROD + '/app-token', 'prodtoken'); fs.writeFileSync(PROD + '/desktop.json', '{"port":8787}'); }
const prodBefore = tree(PROD);
const ENV = { ...process.env, HOME, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log' };
delete ENV.STUDIO_SECRET_KEY;

// 1. config module (flavor fixed per build; all identifiers centralized)
{ const r = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./lib/studio-config.js")))'], { env: ENV }); const c = JSON.parse(r.stdout);
  ok('TEST flavor: product / bundle id / launchd label', c.product === 'MOONKATTY AI STUDIO TEST' && c.appId === 'com.moonkatty.aistudio.test' && c.launchdLabel === 'com.moonkatty.aistudio.test.server');
  ok('TEST flavor: Keychain service .test, port ≠ 8787, autostart off, no update checks', c.keychainService === 'MOONKATTY AI STUDIO.test' && c.defaultPort !== 8787 && c.defaultPort === 8687 && c.autoStartServer === false && c.checkUpdates === false);
  const p = JSON.parse(spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./lib/studio-config.js")))'], { env: { ...ENV, STUDIO_FLAVOR: 'prod' } }).stdout);
  ok('prod flavor unchanged (v1.1.2 identifiers)', p.product === 'MOONKATTY AI STUDIO' && p.appId === 'com.moonkatty.aistudio' && p.launchdLabel === 'com.moonkatty.aistudio.server' && p.keychainService === 'MOONKATTY AI STUDIO' && p.defaultPort === 8787);
  const pr = spawnSync(process.execPath, ['-e', 'console.log(require("./lib/studio-config.js").FLAVOR)'], { env: { ...ENV, NODE_ENV: 'production' } });
  ok('STUDIO_FLAVOR ignored outside NODE_ENV=test; no baked flavor → FLAVOR null (no default)', String(pr.stdout).trim() === 'null');
  const sv = spawnSync(process.execPath, ['server.js'], { env: { ...ENV, NODE_ENV: 'production', PORT: '8829' }, timeout: 8000 });
  ok('server.js without baked flavor and without STUDIO_FLAVOR refuses to start (exit 78, clear error)', sv.status === 78 && /сборка не определена/.test(String(sv.stderr))); }
// grep: no hardcoded identifiers outside lib/studio-config.js (code that runs in the app)
{ const files = ['server.js', 'runner.js', 'meta.js', ...fs.readdirSync('lib').filter(f => f.endsWith('.js')).map(f => 'lib/' + f), 'lib/executors/design3d.js', ...fs.readdirSync('desktop').filter(f => f.endsWith('.js')).map(f => 'desktop/' + f)];
  const bad = []; for (const f of files) { if (f === 'lib/studio-config.js') continue; fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { const code = l.replace(/\/\/.*$/, '');
    if (/'MOONKATTY AI STUDIO|com\.moonkatty\.aistudio|Application Support|\b8787\b|'opencode-server-password'|'studio-master-key'|127\.0\.0\.1:4096/.test(code)) bad.push(f + ':' + (i + 1)); }); }
  ok('no hardcoded app name / bundle id / label / Keychain service / port outside studio-config.js', !bad.length, bad.join(' ')); }

// 2. startup guard: test server refuses production data dir (direct, symlink, DB_PATH)
const run = (env, ms = 4000) => new Promise(r => { const p = spawn(process.execPath, ['server.js'], { env: { ...ENV, PORT: '8821', ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); const t = setTimeout(() => { p.kill(); r({ code: 'running', o }); }, ms); p.on('exit', c => { clearTimeout(t); r({ code: c, o }); }); });
{ let r = await run({ STUDIO_DATA_DIR: PROD }); ok('guard: STUDIO_DATA_DIR = production dir → exit 78', r.code === 78 && /ОТКАЗ/.test(r.o), r.o);
  fs.symlinkSync(PROD, T + '/link'); r = await run({ STUDIO_DATA_DIR: T + '/link' }); ok('guard: symlink to production dir → refused', r.code === 78);
  r = await run({ STUDIO_DATA_DIR: T + '/x', DB_PATH: PROD + '/studio.db' }); ok('guard: DB_PATH inside production dir → refused', r.code === 78);
  r = await run({ STUDIO_DATA_DIR: PROD.toUpperCase().replace(HOME.toUpperCase(), HOME) }); ok('guard: differently-cased production path (macOS is case-insensitive) → refused on darwin', process.platform !== 'darwin' || r.code === 78, 'platform ' + process.platform);
  const svc = spawnSync(process.execPath, ['-e', `require('./desktop/service.js').plist({execPath:'/n',serverJs:'/s',dataDir:${JSON.stringify(PROD)},logDir:'/l',port:8687})`], { env: ENV });
  ok('guard: launchd plist generation for production dir → refused', svc.status !== 0 && /ОТКАЗ/.test(svc.stderr));
  const pl = spawnSync(process.execPath, ['-e', `process.stdout.write(require('./desktop/service.js').plist({execPath:'/n',serverJs:'/s',dataDir:${JSON.stringify(TD)},logDir:'/l',port:8687}))`], { env: ENV }).stdout.toString();
  ok('test plist: label com.moonkatty.aistudio.test.server, port 8687, test data dir', pl.includes('<string>com.moonkatty.aistudio.test.server</string>') && pl.includes('<string>8687</string>') && pl.includes(TD) && !pl.includes('aistudio.server<')); }

// 3. real test server in its own data dir (with a v1 DB copied in → migration with automatic backup)
fs.mkdirSync(TD, { recursive: true }); fs.copyFileSync(PROD + '/studio.db', TD + '/studio.db');
const P = 8822, B = `http://127.0.0.1:${P}`;
const OL = 11522; let olConc = 0, olMax = 0, olCalls = 0;
const ollama = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', async () => {
  if (q.url === '/api/tags') return r.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
  if (q.url === '/api/chat') { olConc++; olCalls++; olMax = Math.max(olMax, olConc); await sleep(1500); olConc--; return r.end(JSON.stringify({ message: { content: JSON.stringify({ summary: 'mock plan', tasks: [] }) } })); }
  r.statusCode = 404; r.end(); }); }).listen(OL, '127.0.0.1');
const srv = spawn(process.execPath, ['server.js'], { env: { ...ENV, STUDIO_DATA_DIR: TD, PORT: String(P), STUDIO_CHAT_WAIT_MS: '400', STUDIO_CHAT_MAX_QUEUED: '2' }, stdio: ['ignore', 'pipe', 'pipe'] });
let slog = ''; srv.stdout.on('data', d => slog += d); srv.stderr.on('data', d => slog += d);
for (let i = 0; i < 60; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(250); }
const h = await (await fetch(B + '/api/health')).json();
ok('health reports flavor=test, product TEST, schemaVersion 4', h.flavor === 'test' && h.product === 'MOONKATTY AI STUDIO TEST' && h.schemaVersion === 4, JSON.stringify(h).slice(0, 200));
const bks = fs.readdirSync(TD + '/backups').filter(f => /^pre-migration-v1-to-v4-.*\.db$/.test(f));
ok('QA-DB-001: automatic pre-migration SQLite backup (v1 → v4) with matching .sha256', bks.length === 1 && fs.readFileSync(TD + '/backups/' + bks[0] + '.sha256', 'utf8').startsWith(sha(TD + '/backups/' + bks[0])), bks.join());
{ const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(TD + '/backups/' + bks[0], { readOnly: true }); const t = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name); d.close();
  ok('pre-migration backup is the OLD schema (no jobs table)', !t.includes('jobs') && t.includes('items')); }
const tok = fs.readFileSync(TD + '/app-token', 'utf8').trim(); const H = { 'x-studio-app-token': tok, 'content-type': 'application/json', 'x-studio-request': '1' };
const api = async (m, p, b) => { const r = await fetch(B + p, { method: m, headers: H, body: b && JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-password-123' });
ok('test server used its own data dir (app-token, db in TEST dir)', fs.existsSync(TD + '/app-token') && tok !== 'prodtoken');
ok('OpenCode default URL in TEST build is 127.0.0.1:4097', (await api('GET', '/api/opencode/auth')).j?.url === 'http://127.0.0.1:4097');

// 4. restore: two-step + automatic backup
{ let r = await api('POST', '/api/restore', { data: { tasks: [] } }); ok('restore without confirmation token → rejected, data intact', r.s === 400 && r.j.code === 'confirm_required');
  const before = (await api('GET', '/api/tasks')).j.length;
  r = await api('POST', '/api/restore/prepare', { data: { tasks: [{ id: 'r1', title: 'restored' }] } }); const t1 = r.j.token;
  ok('restore/prepare returns one-time token + counts', /^[a-f0-9]{48}$/.test(t1) && r.j.counts.tasks === 1);
  r = await api('POST', '/api/restore', { token: 'f'.repeat(48), confirm: 'ЗАМЕНИТЬ' }); ok('restore with wrong token → 403', r.s === 403);
  r = await api('POST', '/api/restore', { token: t1 }); ok('restore without confirm word → 400', r.s === 400);
  ok('nothing replaced yet', (await api('GET', '/api/tasks')).j.length === before);
  r = await api('POST', '/api/restore', { token: t1, confirm: 'ЗАМЕНИТЬ' });
  const bf = r.j?.backup && TD + '/backups/' + r.j.backup.file;
  ok('restore with token: backup made first, SHA-256 matches file + sidecar', r.s === 200 && bf && fs.existsSync(bf) && sha(bf) === r.j.backup.sha256 && fs.readFileSync(bf + '.sha256', 'utf8').startsWith(r.j.backup.sha256));
  { const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(bf, { readOnly: true }); const n = d.prepare("SELECT count(*) c FROM items WHERE col='tasks'").get().c; d.close(); ok('pre-restore backup contains the data before replacement', n === before, n + ' vs ' + before); }
  ok('data replaced after confirmation', (await api('GET', '/api/tasks')).j.map(t => t.id).join() === 'r1');
  r = await api('POST', '/api/restore', { token: t1, confirm: 'ЗАМЕНИТЬ' }); ok('token is single-use', r.s === 403); }

// 5. SSRF
{ const E = require(process.cwd() + '/lib/egress.js');
  for (const ip of ['10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.100.100.200', '100.64.1.1', '0.0.0.0', 'fe80::1', 'fd00:ec2::254', '::ffff:10.0.0.1', '::ffff:169.254.169.254', 'fc00::1', '224.0.0.1'])
    if (E.classify(ip) !== 'blocked') ok('classify blocks ' + ip, false);
  ok('classify: private / link-local / metadata / CGNAT / ULA / mapped addresses blocked', ['10.0.0.5', '169.254.169.254', 'fd00:ec2::254', '::ffff:10.0.0.1'].every(i => E.classify(i) === 'blocked') && E.classify('127.0.0.1') === 'loopback' && E.classify('157.240.1.1') === 'public');
  const fakeDns = map => async h => (map[h] || []).map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
  let v = await E.vet('meta', 'https://api.github.com/v19.0/me', { resolver: fakeDns({ 'api.github.com': ['169.254.169.254'] }) }); ok('allowlisted host resolving to metadata IP → blocked after DNS', !v.ok && v.code === 'blocked_ip');
  v = await E.vet('meta', 'https://graph.facebook.com/x', { resolver: fakeDns({ 'graph.facebook.com': ['157.240.1.1', '10.1.1.1'] }) }); ok('any one private address among several → blocked (no rebinding race)', !v.ok);
  v = await E.vet('meta', 'https://api.github.com/x', { resolver: fakeDns({ 'api.github.com': ['157.240.1.1'] }) }); ok('allowlisted host with public IP → allowed', v.ok);
  v = await E.vet('custom', 'https://evil.example.com/', { resolver: fakeDns({ 'evil.example.com': ['93.184.216.34'] }) }); ok('host not in allowlist → blocked', !v.ok && v.code === 'blocked_url');
  v = await E.vet('ollama', 'http://localhost:11434/api/tags', { resolver: fakeDns({ localhost: ['127.0.0.1'] }) }); ok('local integration on loopback + known port → allowed', v.ok);
  v = await E.vet('ollama', 'http://localhost:22/', { resolver: fakeDns({ localhost: ['127.0.0.1'] }) }); ok('local integration on other port → blocked', !v.ok);
  v = await E.vet('ollama', 'http://localhost:11434/', { resolver: fakeDns({ localhost: ['10.0.0.9'] }) }); ok('"localhost" resolving to private IP → blocked', !v.ok);
  v = await E.vet('ollama', 'http://user:pw@127.0.0.1:11434/'); ok('credentials in URL → blocked', !v.ok);
  // endpoint: generic CRUD write of a malicious URL is still refused at test time
  await api('PUT', '/api/integrations/docker', { url: 'http://169.254.169.254', testPath: '/latest/meta-data/' }); let r = await api('POST', '/api/integrations/docker/test');
  ok('endpoint: metadata URL → 400 blocked, no request', r.s === 400 && /blocked/.test(r.j.code));
  await api('PUT', '/api/integrations/docker', { url: 'http://10.0.0.1:2375', testPath: '/_ping' }); r = await api('POST', '/api/integrations/docker/test'); ok('endpoint: private IP → 400', r.s === 400);
  // redirect from an allowed loopback service to metadata is not followed
  const red = http.createServer((q, s) => { s.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); s.end(); }).listen(8080, '127.0.0.1'); await sleep(100);
  await api('PUT', '/api/integrations/openwebui', { url: 'http://127.0.0.1:8080', testPath: '/health' }); r = await api('POST', '/api/integrations/openwebui/test');
  ok('endpoint: redirect is not followed (reported as redirect)', r.s === 200 && r.j.ok === false && r.j.code === 'redirect' && r.j.status === 302); red.close();
  await api('PUT', '/api/integrations/ollama', { url: `http://127.0.0.1:${OL}`, model: 'qwen3:8b' }); r = await api('POST', '/api/integrations/ollama/test'); ok('endpoint: Ollama on non-standard port → blocked (fixed port policy)', r.s === 400); }

// 6. master key: argv never contains the secret (fake security records argv)
{ const argv = fs.readFileSync(KC + '/argv.log', 'utf8'); const kc = JSON.parse(fs.readFileSync(KC + '/kc.json', 'utf8'));
  const key = kc['MOONKATTY AI STUDIO.test|studio-master-key'];
  ok('master key stored in TEST Keychain service "MOONKATTY AI STUDIO.test"', /^[a-f0-9]{64}$/.test(key || '') && !Object.keys(kc).some(k => k.startsWith('MOONKATTY AI STUDIO|')));
  ok('master key never in any security argv (stdin -i only)', !argv.includes(key) && !argv.includes(Buffer.from(key).toString('hex')) && !/"-w","[a-f0-9]{64}"/.test(argv) && argv.split('\n').filter(Boolean).every(l => !l.includes('add-generic-password') || l === '["-i"]'), argv.slice(0, 200)); }

// 7. load control: Director chat goes through the heavy lock; never concurrent; busy → 202 busy_queued; bounded queue
{ const c1 = api('POST', '/api/director/chat', { text: 'plan A' }); await sleep(150);
  const r2 = await api('POST', '/api/director/chat', { text: 'plan B' });
  ok('2nd chat while 1st holds the lock → 202 busy_queued with holder', r2.s === 202 && r2.j.status === 'busy_queued' && /ollama:director/.test(r2.j.heavy.holder || ''), JSON.stringify(r2.j).slice(0, 200));
  const r3 = await api('POST', '/api/director/chat', { text: 'plan C' }); const r4 = await api('POST', '/api/director/chat', { text: 'plan D' });
  ok('queue bounded: beyond STUDIO_CHAT_MAX_QUEUED → 429 busy queue_full', [r3.s, r4.s].includes(429), r3.s + ',' + r4.s);
  const r1 = await c1; ok('1st chat answered by (mock) LLM', r1.s === 200 && /llm:/.test(r1.j.message.planner));
  for (let i = 0; i < 40 && olConc + 0 >= 0; i++) { if ((await api('GET', '/api/chat')).j.filter(m => m.planner === 'llm:qwen3:8b').length >= 2) break; await sleep(250); }
  ok('queued chat completed later in background', (await api('GET', '/api/chat')).j.filter(m => m.planner === 'llm:qwen3:8b').length >= 2);
  ok('Ollama /api/chat never concurrent (max 1)', olMax === 1 && olCalls >= 2, `max ${olMax}, calls ${olCalls}`); }
{ const L = require(process.cwd() + '/lib/heavy-lock.js'); let inOllama = false, overlap = false;
  const bl = L.withHeavy('blender:render', async () => { await sleep(600); if (inOllama) overlap = true; });
  let e1 = null; try { await L.tryHeavy('ollama:director', async () => 1, { waitMs: 150 }); } catch (e) { e1 = e; }
  ok('lock: chat during Blender → busy error after timeout (holder blender)', e1 && e1.busy && e1.code === 'busy' && e1.holder === 'blender:render');
  const vr = L.withHeavy('video_render:x', async () => { await sleep(300); });
  const o = L.tryHeavy('ollama:director', async () => { inOllama = true; await sleep(50); inOllama = false; return 'ran'; }, { waitMs: 5000 });
  await bl; await vr; ok('lock: Ollama runs only after Blender and video_render finished (FIFO, no overlap)', (await o) === 'ran' && !overlap); }
{ const bad = []; for (const f of ['server.js', 'runner.js', ...fs.readdirSync('lib').map(f => 'lib/' + f).filter(f => f.endsWith('.js')), 'lib/executors/design3d.js', 'meta.js']) {
    const src = fs.readFileSync(f, 'utf8'); src.split('\n').forEach((l, i) => { if (/\/api\/(chat|generate)['`]/.test(l) && !/withHeavy|tryHeavy/.test(src.split('\n').slice(Math.max(0, i - 3), i + 1).join('\n'))) bad.push(f + ':' + (i + 1)); }); }
  ok('static: every Ollama generation call (/api/chat, /api/generate) is inside withHeavy/tryHeavy', !bad.length, bad.join(' ')); }

// 8. publishing queue rules + TEST publishing off
{ const ws = (await api('GET', '/api/workspaces')).j[0];
  let r = await api('POST', '/api/queue', { title: 'news x', brand: 'news', kind: 'news', status: 'approved', channelId: ws.channelId, platform: 'facebook' });
  ok('QA-APR-001: POST with status approved → stored as pending_approval', r.s === 201 && r.j.status === 'pending_approval', r.j?.status);
  const id = r.j.id; r = await api('POST', '/api/queue', { title: 'y', status: 'retry', nextRetryAt: '2000-01-01T00:00:00Z' }); ok('POST with status retry → pending_approval, nextRetryAt dropped', r.j.status === 'pending_approval' && !r.j.nextRetryAt);
  r = await api('PUT', '/api/queue/' + id, { status: 'approved' }); ok('approve without fact-check → 400', r.s === 400 && /Проверка фактов|не проверена/.test(r.j.error));
  r = await api('PUT', '/api/queue/' + id, { status: 'retry' }); ok('status retry also gated by fact-check → 400', r.s === 400);
  const lim = ws.limits.postsPerDay; const day = '2030-01-01T10:00:00Z'; const ids = [];
  for (let i = 0; i < lim + 1; i++) { const x = await api('POST', '/api/queue', { title: 'p' + i, channelId: ws.channelId, platform: 'facebook', scheduledAt: day }); ids.push(x.j.id); }
  let lastErr = null; for (const qid of ids) { const x = await api('PUT', '/api/queue/' + qid, { status: 'approved' }); if (x.s !== 200) lastErr = x; }
  ok('daily limit enforced on approve', lastErr && lastErr.s === 400 && /Лимит/.test(lastErr.j.error));
  r = await api('PUT', '/api/queue/' + ids[0], { status: 'published' }); ok('published via HTTP → 403 (internal publisher only)', r.s === 403 && r.j.code === 'published_internal_only');
  r = await api('PUT', '/api/queue/' + ids[0], { status: 'published', externalId: '   ' }); ok('published with blank externalId → 403', r.s === 403);
  r = await api('PUT', '/api/queue/' + ids[0], { status: 'published', externalId: '123_456' }); ok('TEST build: manual published record refused', r.s === 403 && r.j.code === 'published_internal_only');
  r = await api('POST', '/api/queue/' + ids[0] + '/publish'); ok('TEST build: /api/queue/:id/publish → 403', r.s === 403 && r.j.code === 'publishing_disabled');
  ok('TEST build: scheduler never calls meta.tick (source check)', /if \(!CFG\.IS_TEST\) meta\.tick\(\)/.test(fs.readFileSync('server.js', 'utf8'))); }

// 9. backup export (QA-DB-001), sandbox (QA-OC-001), video_render API compat
{ const b = (await api('GET', '/api/backup')).j; ok('backup: jobs + jobEvents + users (hash only)', Array.isArray(b.jobs) && Array.isArray(b.jobEvents) && b.users.length === 1 && Object.keys(b.users[0]).sort().join() === 'passwordHash,username' && !JSON.stringify(b).includes('fake-password-123')); }
{ const prof = spawnSync(process.execPath, ['-e', `const r=require('./runner.js')({get:()=>null,put:()=>{},list:()=>[],log:()=>{},core:{},meta:{},dataDir:${JSON.stringify(T + '/sbx')},brand:'x'});require('fs').mkdirSync(${JSON.stringify(T + '/sbx/opencode-sandbox/t1')},{recursive:true});process.stdout.write(r.sandboxProfile(${JSON.stringify(T + '/sbx/opencode-sandbox/t1')}))`], { env: ENV }).stdout.toString();
  ok('QA-OC-001: sandbox profile has no /private/tmp or /private/var/folders; app temp subdir only', prof.includes('(deny file-write*)') && !/private\/tmp|private\/var\/folders/.test(prof) && prof.includes('/opencode-sandbox/t1/.tmp'), prof.slice(0, 160)); }
{ const VR = require(process.cwd() + '/lib/video-render.js'); ok('video_render: hasExecutor() false with stub, isStub alias true', VR.hasExecutor() === false && VR.isStub() === true); VR.setExecutor(async () => ({ artifacts: [] })); ok('hasExecutor() true after setExecutor; isStub false', VR.hasExecutor() && !VR.isStub()); VR.setExecutor(null); }

srv.kill('SIGTERM'); ollama.close(); await sleep(500);
// 10. production install untouched by everything above
ok('production data dir byte-for-byte unchanged (no migration, no writes)', JSON.stringify(tree(PROD)) === JSON.stringify(prodBefore));
const fails = res.filter(r => !r[1]).map(r => r[0]); console.log(JSON.stringify({ passed: res.length - fails.length, failed: fails })); process.exit(fails.length ? 1 : 0);
