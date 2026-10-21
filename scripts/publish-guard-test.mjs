// Security recheck v1.2.3-test: publishing provenance + Keychain seal key, legacy/unsealed rows, restore sanitizing,
// fail-closed integrity-checked flavor, TEST publisher/egress lockdown, and tampering of the BUILT bundle (if dist/ exists).
// Usage: node scripts/publish-guard-test.mjs   (fake credentials only; fake `security` binary; temp dirs)
import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os'; import crypto from 'crypto'; import { createRequire } from 'module';
const require = createRequire(import.meta.url); const { DatabaseSync } = require('node:sqlite');
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 200) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms)); const kids = [];
const FAKE_SEC = path.resolve('scripts/test-fixtures/fake-security.mjs'); const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), 'mk-pg-' + p + '-'));
const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
function start({ flavor, port, UD, keychain = true, cwd = process.cwd(), serverJs = 'server.js', extraEnv = {} }) {
  const KC = UD + '/kc'; fs.mkdirSync(KC, { recursive: true });
  const env = { ...process.env, NODE_ENV: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(port), HOME: UD, FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log', ...extraEnv };
  if (flavor) env.STUDIO_FLAVOR = flavor; else delete env.STUDIO_FLAVOR; if (keychain) env.STUDIO_TEST_SECURITY_BIN = FAKE_SEC; else delete env.STUDIO_TEST_SECURITY_BIN;
  const p = spawn(process.execPath, [serverJs, ...(extraEnv.__args || [])], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); kids.push(p); let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  const exited = new Promise(r => p.on('exit', c => r(c)));
  return { p, out: () => out, exited, KC, B: `http://127.0.0.1:${port}` };
}
async function ready(s) { for (let i = 0; i < 60; i++) { try { if ((await fetch(s.B + '/api/health')).ok) return true; } catch {} if (s.p.exitCode !== null) return false; await sleep(250); } return false; }
async function login(s, setup = true) {
  const r = await fetch(s.B + (setup ? '/api/auth/setup' : '/api/auth/login'), { method: 'POST', headers: R, body: JSON.stringify({ username: 'qa', password: 'fake-password-123' }) });
  const A = { ...R, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  return async (m, u, b) => { const x = await fetch(s.B + u, { method: m, headers: A, body: b === undefined ? undefined : JSON.stringify(b) }); let j = null; try { j = await x.json(); } catch {} return { s: x.status, j }; };
}
const stop = async s => { if (s.p.exitCode === null) { s.p.kill(); await s.exited; } };
const sealOf = (key, id, p) => crypto.createHmac('sha256', key).update([id, p.platform, p.responseId, p.at, p.callerModule].join('|')).digest('hex');
const sealed = (key, id, rid) => { const p = { platform: 'facebook', responseId: rid, at: '2026-10-01T00:00:00.000Z', callerModule: 'meta-publisher' }; p.seal = sealOf(key, id, p); return { id, title: 'sealed ' + id, status: 'published', externalId: rid, publishedAt: p.at, publication: p }; };
const dbPut = (db, o) => db.prepare('INSERT OR REPLACE INTO items (col, id, data) VALUES (?, ?, ?)').run('queue', o.id, JSON.stringify(o));

try {
  // ---------- A. HTTP cannot publish; restore demotes (prod + test flavors, source tree) ----------
  for (const [flavor, port] of [['prod', 8841], ['test', 8842]]) {
    const UD = tmp('http-' + flavor); const s = start({ flavor, port, UD }); await ready(s); const api = await login(s); const T = `[${flavor}] `;
    const it = (await api('POST', '/api/queue', { title: 'QA post', text: 'hello', platform: 'facebook', channelId: 'c1', status: 'published', externalId: '111_222' })).j;
    ok(T + 'POST cannot create published/externalId', it.status === 'pending_approval' && !it.externalId);
    for (const body of [{ status: 'published' }, { status: 'published', externalId: '123456_789012' }, { externalId: '123456_789012' }, { publishedAt: '2026-01-01' }, { publication: { platform: 'facebook', responseId: '123456', callerModule: 'meta-publisher', seal: 'ab'.repeat(32) } }]) {
      const r = await api('PUT', '/api/queue/' + it.id, body); ok(T + 'PUT ' + JSON.stringify(body).slice(0, 60) + ' → 403', r.s === 403 && r.j?.code === 'published_internal_only', 'HTTP ' + r.s); }
    const forged = [{ id: 'q1', title: 'a', status: 'published', externalId: '999_888', publishedAt: '2026-01-01T00:00:00Z', publication: { platform: 'facebook', responseId: '999_888', callerModule: 'meta-publisher', at: 'x', seal: '00'.repeat(32) } },
      { id: 'q2', title: 'b', status: 'approved' }, { id: 'q3', title: 'c', status: 'retry', nextRetryAt: '2026-01-01T00:00:00Z' }, { id: 'q4', title: 'd', status: 'scheduled' }, { id: 'q5', title: 'e', status: 'pending_approval' }, { id: 'q6', title: 'f', status: 'rejected', externalId: '777' }];
    const pr = await api('POST', '/api/restore/prepare', { data: { queue: forged } }); const rr = await api('POST', '/api/restore', { token: pr.j.token, confirm: 'ЗАМЕНИТЬ' });
    const q = (await api('GET', '/api/queue')).j; const by = Object.fromEntries(q.map(x => [x.id, x]));
    ok(T + 'restore: every queue item enters pending_approval (incl. rejected-with-externalId)', rr.s === 200 && q.length === 6 && q.every(x => x.status === 'pending_approval'));
    ok(T + 'restore: forged externalId/publishedAt/publication dropped, historical_* kept', !by.q1.externalId && !by.q1.publication && by.q1.historical_status === 'published' && by.q1.historical_externalId === '999_888' && by.q6.historical_externalId === '777');
    const h = await api('PUT', '/api/queue/q2', { historical_status: 'x', title: 'b2' }); ok(T + 'historical_* not writable via CRUD', h.s === 200 && h.j.historical_status === 'approved');
    const pub = await api('POST', '/api/queue/q1/publish');
    if (flavor === 'test') ok(T + '/publish → 403 publishing_disabled', pub.s === 403 && pub.j?.code === 'publishing_disabled');
    else ok(T + '/publish on restored item does not publish', pub.s >= 400 && (await api('GET', '/api/queue/q1')).j.status !== 'published', 'HTTP ' + pub.s);
    if (flavor === 'test') { await api('POST', '/api/integrations', { id: 'meta', name: 'Meta', url: 'https://graph.facebook.com/v19.0/me' }); const et = await api('POST', '/api/integrations/meta/test');
      ok(T + 'egress: graph.facebook.com blocked (not in allowlist)', !et.j?.ok && /blocked_url/.test(JSON.stringify(et.j))); }
    const kc = fs.existsSync(s.KC + '/kc.json') ? JSON.parse(fs.readFileSync(s.KC + '/kc.json', 'utf8')) : {};
    ok(T + 'no seal key created without a real publication (Keychain item absent, DB meta absent)', !Object.keys(kc).some(k => k.endsWith('|publish-seal-key')) && !new DatabaseSync(UD + '/studio.db').prepare("SELECT v FROM meta WHERE k='publishSealKey'").get());
    await stop(s);
  }

  // ---------- B. Seal key: DB copy → Keychain (stdin only), removed from studio.db; unsealed/legacy rows demoted ----------
  { const UD = tmp('seal'); let s = start({ flavor: 'prod', port: 8843, UD }); await ready(s); await login(s); await stop(s);
    const K = crypto.randomBytes(32).toString('hex'), KB = Buffer.from(K, 'hex'), WRONG = crypto.randomBytes(32);
    { const db = new DatabaseSync(UD + '/studio.db'); db.prepare("INSERT OR REPLACE INTO meta (k, v) VALUES ('publishSealKey', ?)").run(K);
      dbPut(db, sealed(KB, 'r1', '1234567890_1234567890')); dbPut(db, { id: 'r2', title: 'legacy', status: 'published', externalId: '5555566666' }); dbPut(db, { id: 'r3', title: 'legacy no id', status: 'published' });
      dbPut(db, sealed(WRONG, 'r4', '1234567899')); const r5 = sealed(KB, 'r5', '1234567898'); r5.externalId = '1234567897'; dbPut(db, r5); db.close(); }
    const UD2 = tmp('seal-nokc'); fs.cpSync(UD, UD2, { recursive: true, filter: f => !f.includes('/kc') });
    s = start({ flavor: 'prod', port: 8843, UD }); await ready(s); const api = await login(s, false);
    const kc = JSON.parse(fs.readFileSync(s.KC + '/kc.json', 'utf8')); const argv = fs.readFileSync(s.KC + '/argv.log', 'utf8');
    ok('seal key migrated into Keychain service «MOONKATTY AI STUDIO» / publish-seal-key', kc['MOONKATTY AI STUDIO|publish-seal-key'] === K);
    ok('seal key never in argv of `security` (stdin -X only)', !argv.includes(K) && !argv.includes(Buffer.from(K).toString('hex')) && /\["-i"\]/.test(argv));
    ok('seal key removed from studio.db (meta.publishSealKey absent)', !new DatabaseSync(UD + '/studio.db').prepare("SELECT v FROM meta WHERE k='publishSealKey'").get());
    ok('studio.db contains no copy of the key anywhere', !fs.readFileSync(UD + '/studio.db').includes(K) && !(fs.existsSync(UD + '/studio.db-wal') && fs.readFileSync(UD + '/studio.db-wal').includes(K)));
    const g = async id => (await api('GET', '/api/queue/' + id)).j;
    const r1 = await g('r1'); ok('validly sealed row stays published', r1.status === 'published' && r1.publication?.seal);
    const e1 = await api('PUT', '/api/queue/r1', { title: 'renamed sealed' }); ok('title edit on validly sealed row allowed, stays published', e1.s === 200 && e1.j.status === 'published');
    for (const [id, n] of [['r2', 'legacy published + externalId (no seal)'], ['r3', 'legacy published without externalId'], ['r4', 'seal made with another key'], ['r5', 'seal valid but externalId swapped']]) {
      const x = await g(id); ok(`startup migration demotes ${n} → pending_approval + historical_*`, x.status === 'pending_approval' && x.historical_status === 'published' && !x.externalId && !x.publication); }
    const e2 = await api('PUT', '/api/queue/r2', { title: 'legacy edit' }); ok('title edit on demoted legacy row stays pending_approval', e2.s === 200 && e2.j.status === 'pending_approval' && !e2.j.externalId);
    { const db = new DatabaseSync(UD + '/studio.db'); dbPut(db, { id: 'r6', title: 'direct write', status: 'published', externalId: '4444455555' }); dbPut(db, { ...sealed(WRONG, 'r7', '1234567896') }); db.close(); }
    const e6 = await api('PUT', '/api/queue/r6', { title: 'edit after direct DB write' }); ok('edit of a directly-written unsealed published row → 403 (no legacy pass)', e6.s === 403 && e6.j?.code === 'published_internal_only');
    const e7 = await api('PUT', '/api/queue/r7', { title: 'x' }); ok('edit of a row sealed with a foreign key → 403', e7.s === 403);
    await stop(s);
    s = start({ flavor: 'prod', port: 8843, UD }); await ready(s); const api2 = await login(s, false);
    ok('restart demotes rows written behind the server\'s back', (await api2('GET', '/api/queue/r6')).j.status === 'pending_approval' && (await api2('GET', '/api/queue/r7')).j.status === 'pending_approval');
    ok('sealed row still valid after restart (key read from Keychain)', (await api2('GET', '/api/queue/r1')).j.status === 'published'); await stop(s);
    // no Keychain available → key deleted from DB, NOTHING can be validated or sealed → everything demoted, publishing refused
    s = start({ flavor: 'prod', port: 8844, UD: UD2, keychain: false }); await ready(s); const api3 = await login(s, false);
    ok('no Keychain: key still removed from studio.db (never kept as fallback)', !new DatabaseSync(UD2 + '/studio.db').prepare("SELECT v FROM meta WHERE k='publishSealKey'").get());
    ok('no Keychain: even the formerly valid sealed row is demoted (publishing refused without key)', (await api3('GET', '/api/queue/r1')).j.status === 'pending_approval');
    await stop(s); }

  // ---------- B2. v1 (v1.1.2-shaped) DB with a published row → migration → title edit ----------
  { const UD = tmp('v1'); fs.mkdirSync(UD, { recursive: true }); const d = new DatabaseSync(UD + '/studio.db');
    d.exec("CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta VALUES ('seeded','2026-01-01');");
    dbPut(d, { id: 'old-pub', title: 'v1 published', status: 'published', externalId: '5555566666', publishedAt: '2025-12-01T00:00:00Z' }); d.close();
    const s = start({ flavor: 'prod', port: 8845, UD }); await ready(s); const api = await login(s);
    const x = (await api('GET', '/api/queue/old-pub')).j; ok('v1 DB migrated: published row → pending_approval, historical_externalId kept', x.status === 'pending_approval' && x.historical_externalId === '5555566666' && x.historical_publishedAt === '2025-12-01T00:00:00Z');
    const e = await api('PUT', '/api/queue/old-pub', { title: 'v1 title edit' }); ok('v1 migrated row: title edit does NOT restore published', e.s === 200 && e.j.status === 'pending_approval' && !e.j.externalId);
    ok('v1 migrated row: pre-migration backup written', fs.readdirSync(UD + '/backups').some(f => /^pre-migration-v1-to-v4-.*\.db$/.test(f))); await stop(s); }

  // ---------- C. Flavor markers (source copy of studio-config) ----------
  const mk = (flavor, opts = {}) => { const T = tmp('flv'); fs.mkdirSync(T + '/lib'); fs.copyFileSync('lib/studio-config.js', T + '/lib/studio-config.js');
    const baked = `'use strict';\n// GENERATED\nmodule.exports = '${flavor}';\n`; const sha = crypto.createHash('sha256').update(baked).digest('hex');
    fs.writeFileSync(T + '/lib/flavor.baked.js', baked); fs.writeFileSync(T + '/lib/flavor.lock.json', JSON.stringify({ flavor, bakedSha256: sha }));
    fs.writeFileSync(T + '/package.json', JSON.stringify({ name: 'x', studioFlavor: flavor, studioFlavorSha256: sha })); return T; };
  const probe = (T, envx = {}, args = []) => String(spawnSync(process.execPath, ['-e', 'const c=require(process.argv[1]+"/lib/studio-config.js");console.log(c.FLAVOR+"|"+c.FLAVOR_SOURCE+"|"+c.appId)', T, ...args], { env: { ...process.env, HOME: T, ...envx } }).stdout).trim();
  { const T = mk('test');
    for (const [n, envx, args] of [['STUDIO_FLAVOR=prod NODE_ENV=test', { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' }], ['STUDIO_FLAVOR=prod NODE_ENV=production', { STUDIO_FLAVOR: 'prod', NODE_ENV: 'production' }], ['MK_FLAVOR/FLAVOR=prod', { MK_FLAVOR: 'prod', FLAVOR: 'prod' }], ['CLI --flavor=prod --prod', {}, ['--flavor=prod', '--prod']]])
      ok('markers: baked TEST not overridable: ' + n, probe(T, envx, args) === 'test|baked|com.moonkatty.aistudio.test', probe(T, envx, args)); }
  for (const [n, f, want] of [
    ['flavor.baked.js rewritten to prod', T => fs.writeFileSync(T + '/lib/flavor.baked.js', "'use strict';\n// GENERATED\nmodule.exports = 'prod';\n"), 'markers-disagree'],
    ['flavor.baked.js bytes changed, value kept (SHA-256 mismatch)', T => fs.writeFileSync(T + '/lib/flavor.baked.js', "'use strict';\n// GENERATED x\nmodule.exports = 'test';\n"), 'baked-sha256-mismatch'],
    ['studioFlavor in package.json changed to prod', T => { const p = JSON.parse(fs.readFileSync(T + '/package.json')); p.studioFlavor = 'prod'; fs.writeFileSync(T + '/package.json', JSON.stringify(p)); }, 'markers-disagree'],
    ['flavor.lock.json flavor changed to prod', T => { const p = JSON.parse(fs.readFileSync(T + '/lib/flavor.lock.json')); p.flavor = 'prod'; fs.writeFileSync(T + '/lib/flavor.lock.json', JSON.stringify(p)); }, 'markers-disagree'],
    ['flavor.baked.js deleted', T => fs.rmSync(T + '/lib/flavor.baked.js'), 'markers-missing'],
    ['flavor.lock.json deleted', T => fs.rmSync(T + '/lib/flavor.lock.json'), 'markers-missing'],
    ['studioFlavor* removed from package.json', T => fs.writeFileSync(T + '/package.json', '{"name":"x"}'), 'markers-missing'],
    ['invalid baked value staging', T => { const b = "'use strict';\nmodule.exports = 'staging';\n"; fs.writeFileSync(T + '/lib/flavor.baked.js', b); }, 'baked-invalid'],
    ['all markers removed (packaged tree has no scripts/) + STUDIO_FLAVOR=prod', T => { for (const x of ['/lib/flavor.baked.js', '/lib/flavor.lock.json']) fs.rmSync(T + x); fs.writeFileSync(T + '/package.json', '{"name":"x"}'); }, 'none']]) {
    const T = mk('test'); f(T); const r = probe(T, { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' }); ok('tamper (source copy): ' + n + ' → FLAVOR null', r.startsWith('null|' + want), r); }

  // ---------- D. TEST lockdown in source ----------
  { const env = { ...process.env, STUDIO_FLAVOR: 'test' };
    const e = JSON.parse(spawnSync(process.execPath, ['-e', 'const e=require("./lib/egress.js");console.log(JSON.stringify({pub:[...e.PUBLIC_HOSTS],soc:e.SOCIAL_HOSTS}))'], { env }).stdout);
    ok('TEST egress allowlist excludes all social APIs', e.soc.length >= 3 && e.soc.every(h => !e.pub.includes(h)), e.pub.join(','));
    const m = spawnSync(process.execPath, ['-e', 'require("./meta.js")'], { env }); ok('meta.js refuses to load in TEST flavor', m.status !== 0 && /publisher disabled/.test(String(m.stderr)));
    const m2 = spawnSync(process.execPath, ['-e', 'require("./meta.js")'], { env: { ...process.env, STUDIO_FLAVOR: '' } }); ok('meta.js refuses to load with unknown flavor', m2.status !== 0 && /publisher disabled/.test(String(m2.stderr))); }

  // ---------- E. BUILT bundle (dist/) + tampering ----------
  const RES = 'dist/mac-arm64/MOONKATTY AI STUDIO TEST.app/Contents/Resources';
  if (fs.existsSync(RES + '/app.asar')) {
    const X = tmp('asar'); spawnSync('npx', ['--yes', '@electron/asar@3', 'extract', RES + '/app.asar', X], { stdio: 'ignore' });
    const list = String(spawnSync('npx', ['--yes', '@electron/asar@3', 'list', RES + '/app.asar']).stdout);
    ok('bundle: meta.js NOT shipped (absent from app.asar and app.asar.unpacked)', !/^\/meta\.js$/m.test(list) && !fs.existsSync(RES + '/app.asar.unpacked/meta.js') && list.includes('/server.js'));
    const U0 = RES + '/app.asar.unpacked'; const pkg = JSON.parse(fs.readFileSync(U0 + '/package.json', 'utf8')); const lockA = JSON.parse(fs.readFileSync(X + '/desktop/flavor.lock.json', 'utf8'));
    const bsha = crypto.createHash('sha256').update(fs.readFileSync(U0 + '/lib/flavor.baked.js')).digest('hex');
    ok('bundle: markers consistent (baked test, lock, studioFlavor, SHA-256 in package.json + asar lock)', pkg.studioFlavor === 'test' && pkg.studioFlavorSha256 === bsha && lockA.flavor === 'test' && lockA.bakedSha256 === bsha && JSON.parse(fs.readFileSync(U0 + '/lib/flavor.lock.json')).bakedSha256 === bsha);
    const guard = U => { const r = spawnSync(process.execPath, ['-e', 'const g=require(process.argv[1]+"/desktop/flavor-guard.js");console.log(JSON.stringify(g.check(process.argv[2])))', X, U]); try { return JSON.parse(r.stdout); } catch { return { ok: null, err: String(r.stderr) }; } };
    const copy = () => { const U = tmp('unp'); fs.cpSync(U0, U, { recursive: true }); return U; };
    ok('bundle: Electron flavor-guard (asar lock) accepts the untouched tree', guard(U0).ok === true && guard(U0).flavor === 'test');
    let port = 8850; const run = async (U, envx = {}, args = []) => { const UD = tmp('bud'); const s = start({ flavor: envx.STUDIO_FLAVOR, port: port++, UD, cwd: U, extraEnv: { ...envx, __args: args } });
      const up = await ready(s); let h = null; if (up) { try { h = await (await fetch(s.B + '/api/health')).json(); } catch {} } await stop(s); const code = up ? 'running' : await s.exited; return { code, h, out: s.out() }; };
    let r = await run(U0, { STUDIO_FLAVOR: 'prod', NODE_ENV: 'production' }, ['--flavor=prod', '--prod']);
    ok('bundle: untouched + STUDIO_FLAVOR=prod NODE_ENV=production --flavor=prod → still TEST', r.code === 'running' && r.h?.flavor === 'test' && r.h?.version === pkg.version, JSON.stringify(r.h));
    const T1 = copy(); fs.writeFileSync(T1 + '/lib/flavor.baked.js', fs.readFileSync(T1 + '/lib/flavor.baked.js', 'utf8').replace("'test'", "'prod'"));
    r = await run(T1, { STUDIO_FLAVOR: 'prod' }); ok('bundle tamper: flavor.baked.js → prod → exit 78', r.code === 78, r.out.slice(-150)); ok('bundle tamper: … and Electron guard refuses', guard(T1).ok === false);
    const T2 = copy(); { const b = fs.readFileSync(T2 + '/lib/flavor.baked.js', 'utf8').replace("'test'", "'prod'"); fs.writeFileSync(T2 + '/lib/flavor.baked.js', b); const sh = crypto.createHash('sha256').update(b).digest('hex');
      fs.writeFileSync(T2 + '/lib/flavor.lock.json', JSON.stringify({ flavor: 'prod', bakedSha256: sh })); const p = JSON.parse(fs.readFileSync(T2 + '/package.json')); p.studioFlavor = 'prod'; p.studioFlavorSha256 = sh; fs.writeFileSync(T2 + '/package.json', JSON.stringify(p)); }
    r = await run(T2); ok('bundle tamper: ALL unpacked markers consistently rewritten to prod → server exit 78 (publisher not shipped)', r.code === 78 && /модуль публикации недоступен/.test(r.out), r.out.slice(-150));
    ok('bundle tamper: … and Electron guard refuses (asar lock still test)', guard(T2).ok === false);
    const T3 = copy(); fs.rmSync(T3 + '/lib/flavor.baked.js'); r = await run(T3, { STUDIO_FLAVOR: 'prod' }); ok('bundle tamper: flavor.baked.js deleted → exit 78', r.code === 78);
    const T4 = copy(); for (const x of ['/lib/flavor.baked.js', '/lib/flavor.lock.json']) fs.rmSync(T4 + x); { const p = JSON.parse(fs.readFileSync(T4 + '/package.json')); delete p.studioFlavor; delete p.studioFlavorSha256; fs.writeFileSync(T4 + '/package.json', JSON.stringify(p)); }
    for (const ne of ['production', 'test']) { r = await run(T4, { STUDIO_FLAVOR: 'prod', NODE_ENV: ne }); ok(`bundle tamper: all markers removed + STUDIO_FLAVOR=prod NODE_ENV=${ne} → exit 78`, r.code === 78); }
    const T5 = copy(); fs.copyFileSync('meta.js', T5 + '/meta.js'); r = await run(T5, { STUDIO_FLAVOR: 'prod' });
    ok('bundle tamper: meta.js planted into TEST tree → server stays TEST, publisher not loaded', r.code === 'running' && r.h?.flavor === 'test'); ok('bundle tamper: … Electron guard refuses (publisher present)', guard(T5).ok === false && /publisher/.test(guard(T5).reason));
    const T6 = copy(); { const p = JSON.parse(fs.readFileSync(T6 + '/package.json')); p.studioFlavorSha256 = '0'.repeat(64); fs.writeFileSync(T6 + '/package.json', JSON.stringify(p)); } r = await run(T6); ok('bundle tamper: studioFlavorSha256 changed → exit 78', r.code === 78);
  } else console.log('SKIP: bundle checks (no dist build)');
} finally { for (const k of kids) try { k.kill(); } catch {} }
const failed = res.filter(x => !x[1]).map(x => x[0]); console.log(JSON.stringify({ passed: res.length - failed.length, failed })); process.exit(failed.length ? 1 : 0);
