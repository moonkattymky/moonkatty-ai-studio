// Invariant recheck of v1.2.4-test @ b7101c4 against the v1.2.3 harness. Fake password only.
// Scratch directories, fake password, no platform calls. Exit 0 only when every control passes.
// Findings record reproduced residuals; they do not by themselves fail the process.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const SRC = process.env.STUDIO_SRC || '/tmp/mk-v124f';
const BUILD = process.env.STUDIO_BUILD || '/tmp/mk-v124f';
const APP = process.env.STUDIO_APP || path.join(BUILD, 'dist/mac-arm64/MOONKATTY AI STUDIO TEST.app');
const ZIP = process.env.STUDIO_ZIP || path.join(BUILD, 'dist/MOONKATTY-AI-STUDIO-TEST-1.2.4-test-arm64-mac.zip');
const CLAIMED = '879aef8e9a7386a5bd8332eb1473d37f3cc5ef44bad730a360b3591a4d7f76ba';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-v124f-'));
const PW = 'fake-recheck-only-1';
const FAKE_SEC = path.join(SRC, 'scripts/test-fixtures/fake-security.mjs');
const controls = [];
const findings = [];
const rec = (name, ok, detail = '') => { controls.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) }); console.log((ok ? 'CONTROL PASS ' : 'CONTROL FAIL ') + name + (detail ? ' — ' + String(detail).slice(0, 360) : '')); };
const finding = (sev, name, detail = '') => { findings.push({ sev, name, detail: String(detail).slice(0, 500) }); console.log('FINDING ' + sev + ' ' + name + (detail ? ' — ' + String(detail).slice(0, 360) : '')); };

const sleep = ms => new Promise(r => setTimeout(r, ms));
let portN = 8940;
function start(cwd, extra = {}, args = []) {
  const port = extra.PORT || String(++portN);
  const dir = extra.STUDIO_DATA_DIR || fs.mkdtempSync(path.join(ROOT, 'd-'));
  const env = { ...process.env, NODE_ENV: 'test', STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ...extra, PORT: String(port) };
  delete env.STUDIO_SECRET_KEY;
  delete env.STUDIO_ADMIN_PASSWORD;
  const p = spawn(process.execPath, ['server.js', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return { p, dir, port: String(port), env, get out() { return out; }, stop() { try { p.kill('SIGTERM'); } catch {} } };
}
async function waitUp(s, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (s.p.exitCode != null) return null;
    try { const r = await fetch(`http://127.0.0.1:${s.port}/api/health`, { signal: AbortSignal.timeout(800) }); if (r.ok) return await r.json(); } catch {}
    await sleep(120);
  }
  return null;
}
async function exitOf(s, ms = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (s.p.exitCode != null) return s.p.exitCode; await sleep(50); }
  return s.p.exitCode;
}
async function login(port) {
  const R = { 'content-type': 'application/json', 'x-studio-request': '1' };
  let r = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, { method: 'POST', headers: R, body: JSON.stringify({ username: 'qa', password: PW }) });
  if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: R, body: JSON.stringify({ username: 'qa', password: PW }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { ...R, cookie };
}
async function api(port, headers, method, p, body) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
}
function sealFor(keyHex, id, pub) {
  return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update([id, pub.platform, pub.responseId, pub.at, pub.callerModule].join('|')).digest('hex');
}
function hasBytes(file, secret) {
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file).includes(Buffer.from(secret, 'utf8'));
}
function v1db(dir, extras = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'studio.db'));
  db.exec(`CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
           CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);`);
  const ins = db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)');
  ins.run('tasks', 'keep-me', JSON.stringify({ id: 'keep-me', title: 'QA-MIG-KEEP', status: 'queued' }));
  if (extras.queue) ins.run('queue', extras.queue.id, JSON.stringify(extras.queue));
  if (extras.meta) { const m = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)'); for (const [k, v] of Object.entries(extras.meta)) m.run(k, v); }
  db.close();
}
function probeFlavor(dir, env = {}) {
  const r = spawnSync(process.execPath, ['-e', 'const c=require("./lib/studio-config.js"); process.stdout.write([c.FLAVOR, c.FLAVOR_SOURCE, c.appId, c.defaultPort, c.keychainService, c.launchdLabel, c.opencodeUrl, c.product, c.autoStartServer, c.checkUpdates].join("|"))'], { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8' });
  return (r.stdout || '').trim();
}
function copyTree(dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(SRC, dest, { recursive: true, filter: s => !s.includes(`${path.sep}node_modules`) && !s.includes(`${path.sep}.git`) });
  const nm = path.join(SRC, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dest, 'node_modules'));
}
function writeMarkers(dir, flavor) {
  const baked = `'use strict';\n// GENERATED\nmodule.exports = '${flavor}';\n`;
  const sha = crypto.createHash('sha256').update(baked).digest('hex');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib/flavor.baked.js'), baked);
  fs.writeFileSync(path.join(dir, 'lib/flavor.lock.json'), JSON.stringify({ flavor, bakedSha256: sha }) + '\n');
  const pkgP = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgP, 'utf8'));
  pkg.studioFlavor = flavor; pkg.studioFlavorSha256 = sha;
  fs.writeFileSync(pkgP, JSON.stringify(pkg));
  return sha;
}
function clearMarkers(dir) {
  for (const f of ['lib/flavor.baked.js', 'lib/flavor.lock.json', 'desktop/flavor.lock.json']) { try { fs.rmSync(path.join(dir, f)); } catch {} }
  const pkgP = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgP, 'utf8'));
  delete pkg.studioFlavor; delete pkg.studioFlavorSha256;
  fs.writeFileSync(pkgP, JSON.stringify(pkg));
}

async function main() {
  // ---------- zip hash ----------
  if (fs.existsSync(ZIP)) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(ZIP)).digest('hex');
    rec('rebuilt zip SHA-256 equals claimed 879aef8e…76ba', hash === CLAIMED, hash);
  } else rec('rebuilt zip present', false, ZIP);

  // ---------- isolation constants, NODE_ENV ignored ----------
  const iso = probeFlavor(SRC, { STUDIO_FLAVOR: 'test', NODE_ENV: 'production' }).split('|');
  rec('source checkout STUDIO_FLAVOR=test ignores NODE_ENV=production', iso[0] === 'test' && iso[1] === 'env(source-checkout)', iso.join('|'));
  rec('bundle id com.moonkatty.aistudio.test', iso[2] === 'com.moonkatty.aistudio.test', iso[2]);
  rec('port 8687', iso[3] === '8687', iso[3]);
  rec('Keychain service MOONKATTY AI STUDIO.test', iso[4] === 'MOONKATTY AI STUDIO.test', iso[4]);
  rec('launchd com.moonkatty.aistudio.test.server', iso[5] === 'com.moonkatty.aistudio.test.server', iso[5]);
  rec('OpenCode 4097', iso[6] === 'http://127.0.0.1:4097', iso[6]);
  rec('data product MOONKATTY AI STUDIO TEST', iso[7] === 'MOONKATTY AI STUDIO TEST', iso[7]);
  rec('autoStartServer false and checkUpdates false', iso[8] === 'false' && iso[9] === 'false', iso.slice(8).join('|'));
  const none = probeFlavor(SRC, { NODE_ENV: 'test' });
  rec('no default flavor when STUDIO_FLAVOR is unset', none.startsWith('null|none') || none.startsWith('|none'), none);
  const noEnv = spawnSync(process.execPath, ['server.js'], { cwd: SRC, env: { ...process.env, STUDIO_SQLITE: 'node', NODE_ENV: 'production', PORT: '1' }, encoding: 'utf8', timeout: 4000 });
  rec('server with no flavor exits 78', noEnv.status === 78, 'status=' + noEnv.status + ' ' + (noEnv.stderr || '').slice(0, 180));

  // ---------- updater symbols ----------
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  const lock = fs.readFileSync(path.join(SRC, 'package-lock.json'), 'utf8');
  const mainJs = fs.readFileSync(path.join(SRC, 'desktop/main.js'), 'utf8');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
  rec('package.json has no electron-updater', !deps['electron-updater'], Object.keys(deps).join(','));
  rec('package-lock has no electron-updater', !lock.includes('electron-updater'));
  rec('desktop/main.js has no autoUpdater or setFeedURL', !/autoUpdater|setFeedURL|electron-updater/.test(mainJs));
  rec('automatic check returns immediately unless checkUpdates is on', /if \(!manual && !c\.checkUpdates\) return;/.test(mainJs));
  rec('manual check fetches the pinned GitHub releases URL and does not install', /api\.github\.com\/repos\/\$\{REPO\}\/releases/.test(mainJs) && /Автоматическая установка не выполняется/.test(mainJs) && /const REPO = 'moonkattymky\/moonkatty-ai-studio'/.test(mainJs));

  // ---------- egress: policy rejects social hosts before DNS ----------
  const eg = spawnSync(process.execPath, ['-e', `
    const e = require('./lib/egress.js');
    (async () => {
      let dns = 0;
      const resolver = async () => { dns++; return [{ address: '1.1.1.1', family: 4 }]; };
      const hosts = ['https://graph.facebook.com/v19.0/me', 'https://graph.instagram.com/me', 'https://api.telegram.org/botx/getMe'];
      const out = [];
      for (const u of hosts) out.push(await e.vet('meta', u, { resolver }));
      process.stdout.write(JSON.stringify({ dns, pub: [...e.PUBLIC_HOSTS], out: out.map(x => x.code + ':' + (x.error||'').slice(0,80)) }));
    })();
  `], { cwd: SRC, env: { ...process.env, STUDIO_FLAVOR: 'test', NODE_ENV: 'production' }, encoding: 'utf8' });
  let egj = {}; try { egj = JSON.parse(eg.stdout); } catch {}
  rec('TEST egress blocks three social hosts before DNS', egj.dns === 0 && Array.isArray(egj.out) && egj.out.length === 3 && egj.out.every(x => x.startsWith('blocked_url')), JSON.stringify(egj));
  rec('api.github.com remains on the public allowlist', Array.isArray(egj.pub) && egj.pub.includes('api.github.com') && !egj.pub.some(h => /facebook|instagram|telegram/.test(h)), (egj.pub || []).join(','));

  const metaRefuse = spawnSync(process.execPath, ['-e', 'require("./meta.js")'], { cwd: SRC, env: { ...process.env, STUDIO_FLAVOR: 'test' }, encoding: 'utf8' });
  rec('meta.js refuses to load when flavor is test', metaRefuse.status !== 0 && /publisher disabled/.test(metaRefuse.stderr || ''), (metaRefuse.stderr || '').slice(0, 200));

  // ---------- Keychain migration ----------
  const KEY = crypto.randomBytes(32).toString('hex');
  const pub = { platform: 'facebook', responseId: '123456789012', at: '2026-01-02T03:04:05.000Z', callerModule: 'meta-publisher' };
  pub.seal = sealFor(KEY, 'sealed-ok', pub);
  const sealed = { id: 'sealed-ok', title: 'sealed', status: 'published', platform: 'facebook', externalId: pub.responseId, publishedAt: pub.at, publication: { ...pub } };
  const kcDir = fs.mkdtempSync(path.join(ROOT, 'kc-'));
  const kcFile = path.join(kcDir, 'kc.json'); const argvLog = path.join(kcDir, 'argv.log');
  const data1 = path.join(kcDir, 'data');
  v1db(data1, { queue: sealed, meta: { publishSealKey: KEY } });
  const s1 = start(SRC, { STUDIO_DATA_DIR: data1, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_TEST_SECURITY_BIN: FAKE_SEC, FAKE_KEYCHAIN_FILE: kcFile, FAKE_KEYCHAIN_ARGV_LOG: argvLog });
  const h1 = await waitUp(s1);
  rec('server with fake Keychain starts', !!h1 && h1.flavor === 'test', JSON.stringify(h1 && { flavor: h1.flavor, product: h1.product, version: h1.version, keySource: h1.keySource }));
  let backupHas = true; let row = null; let edit = null;
  if (h1) {
    const A = await login(s1.port);
    const b = await api(s1.port, A, 'GET', '/api/backup');
    backupHas = b.t.includes(KEY);
    row = (await api(s1.port, A, 'GET', '/api/queue/sealed-ok')).j;
    edit = await api(s1.port, A, 'PUT', '/api/queue/sealed-ok', { title: 'renamed-sealed' });
    const forged = await api(s1.port, A, 'PUT', '/api/queue/sealed-ok', { status: 'published', externalId: '9999911111' });
    rec('HTTP cannot replace a sealed externalId', forged.s === 403 && forged.j && forged.j.code === 'published_internal_only', 'HTTP ' + forged.s);
  }
  const out1 = s1.out; s1.stop(); await sleep(300);
  const kc = fs.existsSync(kcFile) ? JSON.parse(fs.readFileSync(kcFile, 'utf8')) : {};
  const kcKey = kc['MOONKATTY AI STUDIO.test|publish-seal-key'];
  rec('legacy publishSealKey moved to Keychain account publish-seal-key', kcKey === KEY, kcKey ? 'present' : 'absent');
  rec('studio.db does not contain the seal key', !hasBytes(path.join(data1, 'studio.db'), KEY));
  rec('WAL does not contain the seal key', !hasBytes(path.join(data1, 'studio.db-wal'), KEY));
  rec('server stdout/stderr does not contain the seal key', !out1.includes(KEY));
  rec('GET /api/backup does not contain the seal key', !backupHas);
  const argvLines = fs.existsSync(argvLog) ? fs.readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  rec('security argv never contains the seal key', argvLines.every(a => !JSON.stringify(a).includes(KEY)), 'lines=' + argvLines.length);
  rec('Keychain writes are argv ["-i"] only', argvLines.some(a => a.length === 1 && a[0] === '-i') && argvLines.filter(a => a.includes('-w') && a[0] === 'add-generic-password').length === 0, JSON.stringify(argvLines.filter(a => a[0] === '-i' || a[0] === 'add-generic-password').slice(0, 6)));
  rec('valid seal survives migration and a title edit stays published', row && row.status === 'published' && edit && edit.s === 200 && edit.j.status === 'published' && edit.j.title === 'renamed-sealed' && edit.j.externalId === pub.responseId, JSON.stringify({ get: row && row.status, put: edit && edit.s }));
  const db1 = new DatabaseSync(path.join(data1, 'studio.db'));
  const metaLeft = db1.prepare("SELECT v FROM meta WHERE k = 'publishSealKey'").get();
  db1.close();
  rec('meta.publishSealKey row is gone after migration', !metaLeft);
  const s1b = start(SRC, { STUDIO_DATA_DIR: data1, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_TEST_SECURITY_BIN: FAKE_SEC, FAKE_KEYCHAIN_FILE: kcFile, FAKE_KEYCHAIN_ARGV_LOG: argvLog });
  const h1b = await waitUp(s1b); s1b.stop();
  const db1b = new DatabaseSync(path.join(data1, 'studio.db'));
  const metaLeft2 = db1b.prepare("SELECT v FROM meta WHERE k = 'publishSealKey'").get();
  db1b.close();
  rec('second start does not write the seal key back into studio.db', !!h1b && !metaLeft2 && !hasBytes(path.join(data1, 'studio.db'), KEY));

  // ---------- no Keychain: key deleted, even a valid seal is demoted, publishing stays off ----------
  const KEY2 = crypto.randomBytes(32).toString('hex');
  const pub2 = { platform: 'instagram', responseId: '1234567890', at: '2026-01-03T00:00:00.000Z', callerModule: 'meta-publisher' };
  pub2.seal = sealFor(KEY2, 'sealed-nokc', pub2);
  const data2 = path.join(ROOT, 'nokc');
  v1db(data2, { queue: { id: 'sealed-nokc', title: 'x', status: 'published', platform: 'instagram', externalId: pub2.responseId, publishedAt: pub2.at, publication: pub2 }, meta: { publishSealKey: KEY2 } });
  const env2 = { ...process.env, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'test', NODE_ENV: 'test', STUDIO_DATA_DIR: data2, PORT: String(++portN), HOST: '127.0.0.1' };
  delete env2.STUDIO_TEST_SECURITY_BIN; delete env2.STUDIO_SECRET_KEY;
  const s2 = start(SRC, env2);
  const h2 = await waitUp(s2);
  let dem = null;
  if (h2) { const A = await login(s2.port); dem = (await api(s2.port, A, 'GET', '/api/queue/sealed-nokc')).j; const pubr = await api(s2.port, A, 'POST', '/api/queue/sealed-nokc/publish'); rec('TEST /publish is 403 without relying on Keychain', pubr.s === 403 && pubr.j.code === 'publishing_disabled', 'HTTP ' + pubr.s); }
  const out2 = s2.out; s2.stop(); await sleep(200);
  rec('without Keychain the DB key is still deleted', !hasBytes(path.join(data2, 'studio.db'), KEY2) && !out2.includes(KEY2));
  rec('without Keychain a previously valid seal is demoted to pending_approval', dem && dem.status === 'pending_approval' && dem.historical_status === 'published' && dem.historical_externalId === pub2.responseId && !dem.externalId && !dem.publication, JSON.stringify(dem && { status: dem.status, historical_externalId: dem.historical_externalId, externalId: dem.externalId }));

  // ---------- migrated v1 row (the earlier attack) ----------
  const data3 = path.join(ROOT, 'v1');
  v1db(data3, { queue: { id: 'old-pub', title: 'legacy title', status: 'published', platform: 'facebook', externalId: '5555566666', publishedAt: '2025-12-01T00:00:00Z' } });
  const s3 = start(SRC, { STUDIO_DATA_DIR: data3, STUDIO_FLAVOR: 'test', NODE_ENV: 'production' });
  const h3 = await waitUp(s3);
  if (h3) {
    const A = await login(s3.port);
    const g = (await api(s3.port, A, 'GET', '/api/queue/old-pub')).j;
    rec('v1 old-pub is pending_approval with historical_externalId', g && g.status === 'pending_approval' && g.historical_externalId === '5555566666' && g.historical_status === 'published' && g.historical_publishedAt === '2025-12-01T00:00:00Z' && !g.externalId, JSON.stringify(g && { status: g.status, historical_externalId: g.historical_externalId, externalId: g.externalId }));
    const e = await api(s3.port, A, 'PUT', '/api/queue/old-pub', { title: 'v1 title edit' });
    rec('v1 title edit stays pending_approval and does not restore published', e.s === 200 && e.j.status === 'pending_approval' && e.j.title === 'v1 title edit' && !e.j.externalId, 'HTTP ' + e.s + ' status=' + (e.j && e.j.status));
    const back = fs.readdirSync(path.join(data3, 'backups')).filter(f => /^pre-migration-v1-to-v4-/.test(f));
    const backDb = back.find(f => f.endsWith('.db'));
    rec('pre-migration backup exists and matches its sha256 sidecar', !!backDb && back.includes(backDb + '.sha256') && crypto.createHash('sha256').update(fs.readFileSync(path.join(data3, 'backups', backDb))).digest('hex') === fs.readFileSync(path.join(data3, 'backups', backDb + '.sha256'), 'utf8').trim().split(/\s+/)[0], back.join(','));
    const task = (await api(s3.port, A, 'GET', '/api/tasks/keep-me')).j;
    rec('v1 task QA-MIG-KEEP survived', task && task.title === 'QA-MIG-KEEP', task && task.title);
    const post = await api(s3.port, A, 'POST', '/api/queue', { title: 'n', text: 't', platform: 'facebook', status: 'published', externalId: '1234567890', publication: { seal: 'ab'.repeat(32) } });
    rec('POST cannot store published', post.s === 201 && post.j.status === 'pending_approval' && !post.j.externalId && !post.j.publication, JSON.stringify({ http: post.s, status: post.j && post.j.status }));
    const made = await api(s3.port, A, 'POST', '/api/queue', { title: 'news', text: 'hello', platform: 'facebook', channelId: 'c1' });
    const id = made.j && made.j.id;
    const putP = await api(s3.port, A, 'PUT', '/api/queue/' + id, { status: 'published', externalId: '123456789012' });
    rec('PUT published/externalId is 403', putP.s === 403 && putP.j.code === 'published_internal_only', 'HTTP ' + putP.s);
    const weird = await api(s3.port, A, 'PUT', '/api/queue/' + id, { status: 'Published' });
    rec('wrong-case Published is not the published state', weird.s === 200 && weird.j.status === 'Published' && !weird.j.externalId, JSON.stringify({ http: weird.s, status: weird.j && weird.j.status }));
    if (weird.j && weird.j.status === 'Published') finding('info', 'PUT status "Published" is stored as that string', 'It is not status published and has no externalId. The test build still will not call the publisher.');
    // direct SQL insert while the server is up
    const live = new DatabaseSync(path.join(data3, 'studio.db'));
    live.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run('queue', 'sql-pub', JSON.stringify({ id: 'sql-pub', title: 'from-sql', status: 'published', platform: 'facebook', externalId: '5555566666', publishedAt: '2025-12-01T00:00:00Z' }));
    live.close();
    const gsql = await api(s3.port, A, 'GET', '/api/queue/sql-pub');
    const esql = await api(s3.port, A, 'PUT', '/api/queue/sql-pub', { title: 'edited' });
    rec('live SQL published row: HTTP title edit is 403', gsql.s === 200 && esql.s === 403 && esql.j.code === 'published_internal_only', JSON.stringify({ get: gsql.s, getStatus: gsql.j && gsql.j.status, put: esql.s, code: esql.j && esql.j.code }));
    if (gsql.j && gsql.j.status === 'published') finding('low', 'a published row inserted into the live database stays visible as published until the next start', 'HTTP cannot edit it (403). demoteUnsealed runs at startup only. No publisher call.');
    // comments
    const c = await api(s3.port, A, 'POST', '/api/comments', { workspaceId: 'mk-fb', platform: 'facebook', author: 'qa', text: 'hello', status: 'approved', draft: 'a reply', demo: false });
    rec('POST /api/comments forces a non-approved status', c.s === 201 && c.j && (c.j.status === 'new' || c.j.status === 'drafted') && c.j.status !== 'approved', JSON.stringify({ http: c.s, status: c.j && c.j.status }));
    const reply = await api(s3.port, A, 'POST', '/api/comments/' + (c.j && c.j.id) + '/reply', {});
    const c2 = await api(s3.port, A, 'GET', '/api/comments/' + (c.j && c.j.id));
    rec('comment reply is 403 publishing_disabled and does not store a replyId', reply.s === 403 && reply.j.code === 'publishing_disabled' && c2.j && !c2.j.replyId && c2.j.status !== 'replied', JSON.stringify({ reply: reply.s, code: reply.j && reply.j.code, status: c2.j && c2.j.status }));
    // social integration URL cannot connect
    const integ = await api(s3.port, A, 'POST', '/api/integrations', { id: 'meta-qa', name: 'Meta', url: 'https://graph.facebook.com/v19.0', testPath: '/me' });
    const ig = await api(s3.port, A, 'POST', '/api/integrations', { id: 'ig-qa', name: 'IG', url: 'https://graph.instagram.com', testPath: '/me' });
    const tg = await api(s3.port, A, 'POST', '/api/integrations', { id: 'tg-qa', name: 'TG', url: 'https://api.telegram.org', testPath: '/botx/getMe' });
    const tMeta = await api(s3.port, A, 'POST', '/api/integrations/meta-qa/test');
    const tIg = await api(s3.port, A, 'POST', '/api/integrations/ig-qa/test');
    const tTg = await api(s3.port, A, 'POST', '/api/integrations/tg-qa/test');
    rec('HTTP integration test blocks facebook/instagram/telegram', [tMeta, tIg, tTg].every(x => x.s === 400 && x.j.code === 'blocked_url') && integ.s === 201 && ig.s === 201 && tg.s === 201, JSON.stringify([tMeta, tIg, tTg].map(x => x.s + ':' + (x.j && x.j.code))));
    // approved queue item is not auto-published
    const ap = await api(s3.port, A, 'POST', '/api/queue', { title: 'auto', text: 'body', platform: 'facebook', channelId: 'c1', status: 'approved' });
    rec('POST queue approved is forced to pending_approval', ap.s === 201 && ap.j.status === 'pending_approval', ap.j && ap.j.status);
    await sleep(800);
    const logs = await api(s3.port, A, 'GET', '/api/logs');
    const pubLogs = (logs.j || []).filter(l => l.source === 'publishing' || /Опубликовано/.test(String(l.message || '')));
    rec('no publisher log lines after startup tick', pubLogs.length === 0, 'n=' + pubLogs.length);
  } else rec('v1 server started', false, s3.out.slice(-300));
  s3.stop();
  // restart demotes the live SQL row
  const s3b = start(SRC, { STUDIO_DATA_DIR: data3, STUDIO_FLAVOR: 'test' });
  const h3b = await waitUp(s3b);
  if (h3b) {
    const A = await login(s3b.port);
    const g = (await api(s3b.port, A, 'GET', '/api/queue/sql-pub')).j;
    rec('after restart the SQL-inserted published row is pending_approval', g && g.status === 'pending_approval' && g.historical_externalId === '5555566666' && !g.externalId, JSON.stringify(g && { status: g.status, historical_externalId: g.historical_externalId }));
    const edit2 = await api(s3b.port, A, 'PUT', '/api/queue/sql-pub', { title: 'after-demote' });
    rec('after demotion a title edit stays pending_approval', edit2.s === 200 && edit2.j.status === 'pending_approval' && edit2.j.title === 'after-demote', 'HTTP ' + edit2.s);
  }
  s3b.stop();

  // ---------- prod data path ----------
  const home = path.join(ROOT, 'home');
  const prodData = path.join(home, 'Library', 'Application Support', 'MOONKATTY AI STUDIO');
  fs.mkdirSync(prodData, { recursive: true });
  const prodRun = spawnSync(process.execPath, ['server.js'], { cwd: SRC, env: { ...process.env, HOME: home, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'test', NODE_ENV: 'test', STUDIO_DATA_DIR: prodData, PORT: String(++portN), HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
  rec('TEST server refuses the v1.1.2 data directory (exit 78)', prodRun.status === 78 && /PROD_PATH_REFUSED|production-версии|ОТКАЗ/.test((prodRun.stderr || '') + (prodRun.stdout || '')), 'status=' + prodRun.status + ' ' + ((prodRun.stderr || prodRun.stdout || '').slice(0, 220)));

  // ---------- flavor tamper on a fake .app path ----------
  const fakeApp = path.join(ROOT, 'Fake.app', 'Contents', 'Resources', 'app.asar.unpacked');
  copyTree(fakeApp);
  writeMarkers(fakeApp, 'test');
  const stay = probeFlavor(fakeApp, { STUDIO_FLAVOR: 'prod', NODE_ENV: 'production', MK_FLAVOR: 'prod', FLAVOR: 'prod' });
  rec('markers inside .app ignore STUDIO_FLAVOR and NODE_ENV', stay.startsWith('test|baked|com.moonkatty.aistudio.test'), stay);
  const onlyBaked = path.join(ROOT, 'FakeBaked.app', 'Contents', 'Resources', 'app.asar.unpacked');
  copyTree(onlyBaked); writeMarkers(onlyBaked, 'test');
  fs.writeFileSync(path.join(onlyBaked, 'lib/flavor.baked.js'), "'use strict';\n// GENERATED\nmodule.exports = 'prod';\n");
  const bakedSrv = spawnSync(process.execPath, ['server.js'], { cwd: onlyBaked, env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'prod', NODE_ENV: 'production', STUDIO_DATA_DIR: path.join(ROOT, 'dbaked'), PORT: '1', HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
  rec('rewriting only flavor.baked.js exits 78', bakedSrv.status === 78, 'status=' + bakedSrv.status + ' ' + (bakedSrv.stderr || '').slice(0, 160));
  const delApp = path.join(ROOT, 'FakeDel.app', 'Contents', 'Resources', 'app.asar.unpacked');
  copyTree(delApp); writeMarkers(delApp, 'test'); clearMarkers(delApp);
  for (const ne of ['production', 'test']) {
    const r = spawnSync(process.execPath, ['server.js', '--flavor=prod'], { cwd: delApp, env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'prod', NODE_ENV: ne, STUDIO_DATA_DIR: path.join(ROOT, 'ddel-' + ne), PORT: '1', HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
    rec('deleted markers + STUDIO_FLAVOR=prod NODE_ENV=' + ne + ' exits 78', r.status === 78, 'status=' + r.status + ' src=' + probeFlavor(delApp, { STUDIO_FLAVOR: 'prod', NODE_ENV: ne }));
  }
  const allProd = path.join(ROOT, 'FakeProd.app', 'Contents', 'Resources', 'app.asar.unpacked');
  copyTree(allProd); writeMarkers(allProd, 'prod'); fs.rmSync(path.join(allProd, 'meta.js'));
  const noMeta = spawnSync(process.execPath, ['server.js'], { cwd: allProd, env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'test', NODE_ENV: 'test', STUDIO_DATA_DIR: path.join(ROOT, 'dnometa'), PORT: '1', HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
  rec('all markers rewritten to prod without meta.js exits 78', noMeta.status === 78 && /модуль публикации недоступен|meta\.js/.test((noMeta.stderr || '') + (noMeta.stdout || '')), 'status=' + noMeta.status + ' ' + (noMeta.stderr || noMeta.stdout || '').slice(0, 200));

  // residual: consistent prod markers AND a planted meta.js, server.js started directly
  const residual = path.join(ROOT, 'FakeResidual.app', 'Contents', 'Resources', 'app.asar.unpacked');
  copyTree(residual); writeMarkers(residual, 'prod');
  const rs = start(residual, { STUDIO_FLAVOR: 'test', NODE_ENV: 'test', STUDIO_DATA_DIR: path.join(ROOT, 'dres') });
  const hr = await waitUp(rs, 8000);
  const rsCode = hr ? 'running' : await exitOf(rs);
  rs.stop();
  const residualWorks = hr && hr.flavor === 'prod';
  rec('residual recorded: direct server.js with prod markers and meta.js', true, residualWorks ? 'reproduced flavor=prod' : ('not reproduced code=' + rsCode + ' ' + rs.out.slice(-180)));
  if (residualWorks) finding('low', 'local rewrite of every marker plus a planted meta.js, then node server.js, loads the publisher', 'Electron is not in this path. A packaged app whose asar lock still says test is refused by desktop/flavor-guard.js. Reproduced on a fake .app tree, not via HTTP. Ad-hoc signature does not stop a local file replace.');
  else finding('info', 'direct prod-marker + meta.js start did not come up', 'code=' + rsCode);

  // ---------- built bundle ----------
  const unpacked = path.join(APP, 'Contents/Resources/app.asar.unpacked');
  const asarPath = path.join(APP, 'Contents/Resources/app.asar');
  if (fs.existsSync(unpacked) && fs.existsSync(asarPath)) {
    const asar = require(path.join(BUILD, 'node_modules/@electron/asar'));
    const list = asar.listPackage(asarPath);
    rec('built TEST app does not contain meta.js', !list.includes('/meta.js') && !fs.existsSync(path.join(unpacked, 'meta.js')), 'asar entries ' + list.length);
    const bpkg = JSON.parse(fs.readFileSync(path.join(unpacked, 'package.json'), 'utf8'));
    const block = JSON.parse(fs.readFileSync(path.join(unpacked, 'lib/flavor.lock.json'), 'utf8'));
    const bbaked = fs.readFileSync(path.join(unpacked, 'lib/flavor.baked.js'));
    const bsha = crypto.createHash('sha256').update(bbaked).digest('hex');
    const extracted = path.join(ROOT, 'asar-extract');
    asar.extractAll(asarPath, extracted);
    const alock = JSON.parse(fs.readFileSync(path.join(extracted, 'desktop/flavor.lock.json'), 'utf8'));
    rec('built markers agree on test and the baked SHA-256', /module\.exports = 'test'/.test(bbaked.toString()) && bpkg.studioFlavor === 'test' && bpkg.studioFlavorSha256 === bsha && block.flavor === 'test' && block.bakedSha256 === bsha && alock.flavor === 'test' && alock.bakedSha256 === bsha, bsha);
    const guard = root => {
      const r = spawnSync(process.execPath, ['-e', 'const g=require(process.argv[1]); process.stdout.write(JSON.stringify(g.check(process.argv[2])))', path.join(extracted, 'desktop/flavor-guard.js'), root], { encoding: 'utf8' });
      try { return JSON.parse(r.stdout); } catch { return { ok: false, reason: r.stderr }; }
    };
    rec('flavor-guard accepts the unpacked tree against the asar lock', guard(unpacked).ok === true && guard(unpacked).flavor === 'test', JSON.stringify(guard(unpacked)));
    const plist = require('child_process').spawnSync('python3', ['-c', 'import plistlib,sys; d=plistlib.load(open(sys.argv[1],"rb")); print(d.get("CFBundleIdentifier")); print(d["ElectronAsarIntegrity"])', path.join(APP, 'Contents/Info.plist')], { encoding: 'utf8' });
    rec('Info.plist bundle id is the test id', (plist.stdout || '').split('\n')[0] === 'com.moonkatty.aistudio.test', (plist.stdout || '').split('\n')[0]);
    let asarOk = false; let asarDetail = '';
    try {
      const { readAsarHeader } = require(path.join(BUILD, 'node_modules/app-builder-lib/out/asar/asar.js'));
      const { header } = await readAsarHeader(asarPath);
      const headerSha = crypto.createHash('sha256').update(header).digest('hex');
      asarDetail = headerSha;
      asarOk = (plist.stdout || '').toLowerCase().includes(headerSha);
    } catch (e) { asarDetail = e.message; }
    rec('ElectronAsarIntegrity matches the asar header hash', asarOk, asarDetail.slice(0, 180));
    const tamper = path.join(ROOT, 'unpacked-copy');
    fs.cpSync(unpacked, tamper, { recursive: true, dereference: true });
    fs.writeFileSync(path.join(tamper, 'lib/flavor.baked.js'), fs.readFileSync(path.join(tamper, 'lib/flavor.baked.js'), 'utf8').replace("'test'", "'prod'"));
    const t1 = spawnSync(process.execPath, ['server.js'], { cwd: tamper, env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'prod', NODE_ENV: 'production', STUDIO_DATA_DIR: path.join(ROOT, 'b1'), PORT: '1', HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
    rec('built-tree: only baked file rewritten exits 78', t1.status === 78, 'status=' + t1.status);
    rec('built-tree: flavor-guard refuses that rewrite', guard(tamper).ok === false, JSON.stringify(guard(tamper)));
    const tamperAll = path.join(ROOT, 'unpacked-all');
    fs.cpSync(unpacked, tamperAll, { recursive: true, dereference: true });
    const nb = fs.readFileSync(path.join(tamperAll, 'lib/flavor.baked.js'), 'utf8').replace("'test'", "'prod'");
    fs.writeFileSync(path.join(tamperAll, 'lib/flavor.baked.js'), nb);
    const nsha = crypto.createHash('sha256').update(nb).digest('hex');
    fs.writeFileSync(path.join(tamperAll, 'lib/flavor.lock.json'), JSON.stringify({ flavor: 'prod', bakedSha256: nsha }));
    const np = JSON.parse(fs.readFileSync(path.join(tamperAll, 'package.json'), 'utf8')); np.studioFlavor = 'prod'; np.studioFlavorSha256 = nsha; fs.writeFileSync(path.join(tamperAll, 'package.json'), JSON.stringify(np));
    const t2 = spawnSync(process.execPath, ['server.js'], { cwd: tamperAll, env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: path.join(ROOT, 'b2'), PORT: '1', HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
    rec('built-tree: all markers prod and no meta.js exits 78', t2.status === 78 && /модуль публикации недоступен/.test((t2.stderr || '') + (t2.stdout || '')), 'status=' + t2.status + ' ' + (t2.stderr || '').slice(0, 160));
    rec('built-tree: flavor-guard still refuses (asar lock is test)', guard(tamperAll).ok === false, JSON.stringify(guard(tamperAll)));
    const tamperDel = path.join(ROOT, 'unpacked-del');
    fs.cpSync(unpacked, tamperDel, { recursive: true, dereference: true });
    clearMarkers(tamperDel);
    const t3 = spawnSync(process.execPath, ['server.js'], { cwd: tamperDel, env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'prod', NODE_ENV: 'test', STUDIO_DATA_DIR: path.join(ROOT, 'b3'), PORT: '1', HOST: '127.0.0.1' }, encoding: 'utf8', timeout: 5000 });
    rec('built-tree: deleted markers + STUDIO_FLAVOR=prod NODE_ENV=test exits 78', t3.status === 78, 'status=' + t3.status + ' ' + probeFlavor(tamperDel, { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' }));
    const tamperMeta = path.join(ROOT, 'unpacked-meta');
    fs.cpSync(unpacked, tamperMeta, { recursive: true, dereference: true });
    const nb2 = `'use strict';\n// GENERATED\nmodule.exports = 'prod';\n`;
    const sha2 = crypto.createHash('sha256').update(nb2).digest('hex');
    fs.writeFileSync(path.join(tamperMeta, 'lib/flavor.baked.js'), nb2);
    fs.writeFileSync(path.join(tamperMeta, 'lib/flavor.lock.json'), JSON.stringify({ flavor: 'prod', bakedSha256: sha2 }));
    const np2 = JSON.parse(fs.readFileSync(path.join(tamperMeta, 'package.json'), 'utf8')); np2.studioFlavor = 'prod'; np2.studioFlavorSha256 = sha2; fs.writeFileSync(path.join(tamperMeta, 'package.json'), JSON.stringify(np2));
    fs.copyFileSync(path.join(SRC, 'meta.js'), path.join(tamperMeta, 'meta.js'));
    const rs2 = start(tamperMeta, { STUDIO_FLAVOR: 'test', NODE_ENV: 'production', STUDIO_DATA_DIR: path.join(ROOT, 'b4') });
    const hr2 = await waitUp(rs2, 8000);
    rs2.stop();
    rec('built-tree residual: markers prod + planted meta.js starts as prod', !!(hr2 && hr2.flavor === 'prod'), hr2 ? JSON.stringify({ flavor: hr2.flavor, product: hr2.product }) : rs2.out.slice(-200));
    rec('built-tree residual: flavor-guard refuses because asar lock is unchanged', guard(tamperMeta).ok === false, JSON.stringify(guard(tamperMeta)));
    if (hr2 && hr2.flavor === 'prod') finding('low', 'shipped unpacked server.js plus a planted meta.js and rewritten markers runs the publisher', 'desktop/flavor-guard.js returns not ok against the original asar lock, so the Electron shell should exit 78. Direct node does not consult that lock. Severity low for the Mac mini test if the .app files are not replaced.');
  } else rec('built app present for bundle tamper', false, APP);

  const failed = controls.filter(c => !c.ok);
  console.log(JSON.stringify({ controls: controls.length, failed: failed.length, findings: findings.length, root: ROOT }, null, 0));
  if (failed.length) console.log('FAILED ' + failed.map(f => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
