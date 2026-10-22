// Independent HTTP/process checks for v1.2.2-test @ 7327a1e.
// Scratch directories, fake password, no platform calls. Exit 0 only when every control passes.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite');
const SRC = process.env.STUDIO_SRC || '/tmp/mk-src-v122f';
const PKG = process.env.STUDIO_PKG || '/tmp/mk-v122-app/MOONKATTY AI STUDIO TEST.app/Contents/Resources/app.asar.unpacked';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-final-'));
const PW = 'fake-recheck-only-1';
const controls = [];
const findings = [];
const rec = (name, ok, detail = '') => { controls.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) }); console.log((ok ? 'CONTROL PASS ' : 'CONTROL FAIL ') + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); };
const finding = (name, detail = '') => { findings.push({ name, detail: String(detail).slice(0, 500) }); console.log('FINDING ' + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); };

const sleep = ms => new Promise(r => setTimeout(r, ms));
function start(cwd, port, extra = {}, args = []) {
  const dir = extra.STUDIO_DATA_DIR || fs.mkdtempSync(path.join(ROOT, 'd-'));
  const env = { ...process.env, NODE_ENV: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', STUDIO_ADMIN_PASSWORD: '', ...extra };
  delete env.STUDIO_SECRET_KEY;
  const p = spawn(process.execPath, ['server.js', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return { p, dir, port, get out() { return out; }, stop: () => { try { p.kill('SIGTERM'); } catch {} } };
}
async function waitUp(s, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (s.p.exitCode != null) return null;
    try { const r = await fetch(`http://127.0.0.1:${s.port}/api/health`, { signal: AbortSignal.timeout(800) }); if (r.ok) return await r.json(); } catch {}
    await sleep(150);
  }
  return null;
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
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
}
function openDb(file) { return new DatabaseSync(file); }
function queueRow(db, id) {
  const r = db.prepare('SELECT data FROM items WHERE col = ? AND id = ?').get('queue', id);
  return r ? JSON.parse(r.data) : null;
}
function sealFor(keyHex, id, pub) {
  return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update([id, pub.platform, pub.responseId, pub.at, pub.callerModule].join('|')).digest('hex');
}

async function httpMatrix(label, s) {
  const h = await waitUp(s);
  rec(label + ' health', !!h && h.app === 'moonkatty-ai-studio', JSON.stringify(h && { flavor: h.flavor, product: h.product, version: h.version, schemaVersion: h.schemaVersion, keySource: h.keySource }));
  if (!h) return null;
  const A = await login(s.port);
  const unauth = await api(s.port, { 'content-type': 'application/json', 'x-studio-request': '1' }, 'POST', '/api/queue', { title: 'x', status: 'published', externalId: '12345' });
  rec(label + ' unauthenticated POST rejected', unauth.s === 401, 'HTTP ' + unauth.s);
  const bodies = [
    { status: 'published', externalId: '1234567890', publication: { seal: 'ab'.repeat(32) } },
    { status: 'approved', externalId: '1234567890' },
    { status: 'retry', nextRetryAt: '2099-01-01T00:00:00.000Z' }
  ];
  for (const b of bodies) {
    const r = await api(s.port, A, 'POST', '/api/queue', { title: 'n', text: 't', platform: 'facebook', brand: 'news', channelId: 'c1', ...b });
    rec(label + ' POST ' + JSON.stringify(b).slice(0, 60) + ' cannot store published/externalId', r.s === 201 && r.j.status === 'pending_approval' && !r.j.externalId && !r.j.publication, JSON.stringify({ http: r.s, status: r.j && r.j.status, externalId: r.j && r.j.externalId }));
  }
  const made = await api(s.port, A, 'POST', '/api/queue', { title: 'news', text: 'hello', platform: 'facebook', brand: 'news', channelId: 'c1' });
  const id = made.j && made.j.id;
  const puts = [
    { status: 'published' },
    { externalId: '123456789012' },
    { publication: { platform: 'facebook', responseId: '123456789012', callerModule: 'meta-publisher', at: '2026-01-01T00:00:00.000Z', seal: 'cd'.repeat(32) } },
    { status: 'Published' }
  ];
  for (const b of puts) {
    const r = await api(s.port, A, 'PUT', '/api/queue/' + id, b);
    const expect403 = b.status === 'published' || 'externalId' in b || 'publication' in b;
    if (expect403) rec(label + ' PUT ' + JSON.stringify(b).slice(0, 70) + ' → 403', r.s === 403 && r.j && r.j.code === 'published_internal_only', 'HTTP ' + r.s + ' ' + (r.j && r.j.code));
  }
  const afterCase = await api(s.port, A, 'GET', '/api/queue/' + id);
  rec(label + ' a non-exact status string is not stored as published', afterCase.j && afterCase.j.status !== 'published', afterCase.j && afterCase.j.status);
  const patch = await api(s.port, A, 'PATCH', '/api/queue/' + id, { status: 'published', externalId: '1234567890' });
  rec(label + ' PATCH does not publish', patch.s === 404, 'HTTP ' + patch.s);
  const pub = await api(s.port, A, 'POST', '/api/queue/' + id + '/publish', {});
  const reply = await api(s.port, A, 'POST', '/api/comments/nope/reply', { text: 'hi' });
  if (h.flavor === 'test') {
    rec(label + ' /publish disabled', pub.s === 403 && pub.j && pub.j.code === 'publishing_disabled', 'HTTP ' + pub.s);
    rec(label + ' /reply disabled', reply.s === 403 && reply.j && reply.j.code === 'publishing_disabled', 'HTTP ' + reply.s);
  } else {
    rec(label + ' prod /publish does not mark the row published', pub.s >= 400, 'HTTP ' + pub.s + ' ' + (pub.j && pub.j.error));
    const again = await api(s.port, A, 'GET', '/api/queue/' + id);
    rec(label + ' row still not published after /publish', again.j && again.j.status !== 'published', again.j && again.j.status);
  }
  const cmt = await api(s.port, A, 'POST', '/api/comments', { id: 'c-approved', text: 'hi', status: 'approved', draft: 'hi' });
  if (cmt.s === 201 && cmt.j && cmt.j.status === 'approved') finding(label + ' POST /api/comments stores status approved', cmt.j.status);
  else rec(label + ' comment create did not store approved', true, 'HTTP ' + cmt.s + ' ' + (cmt.j && cmt.j.status));
  const forged = [
    { id: '../outside', title: 'trav', status: 'published', externalId: '999888777', publishedAt: '2026-01-01T00:00:00Z', publication: { platform: 'facebook', responseId: '999888777', callerModule: 'meta-publisher', seal: '00'.repeat(32) } },
    { id: 'keep-rej', title: 'r', status: 'rejected' },
    { id: 'hist-preset', title: 'h', status: 'published', externalId: '1111122222', historical_status: 'draft', historical_externalId: 'should-stay' }
  ];
  const prep = await api(s.port, A, 'POST', '/api/restore/prepare', { data: { queue: forged } });
  const one = await api(s.port, A, 'POST', '/api/restore', { data: { queue: forged }, confirm: 'ЗАМЕНИТЬ' });
  rec(label + ' one-step restore rejected', one.s === 400 && one.j && one.j.code === 'confirm_required', 'HTTP ' + one.s);
  const bad = await api(s.port, A, 'POST', '/api/restore', { token: prep.j && prep.j.token, confirm: 'NO' });
  rec(label + ' wrong confirm rejected', bad.s === 400, 'HTTP ' + bad.s);
  const ok = await api(s.port, A, 'POST', '/api/restore', { token: prep.j && prep.j.token, confirm: 'ЗАМЕНИТЬ' });
  rec(label + ' two-step restore ok', ok.s === 200 && ok.j && ok.j.backup && ok.j.backup.sha256, 'HTTP ' + ok.s);
  const rows = await api(s.port, A, 'GET', '/api/queue');
  const by = Object.fromEntries((rows.j || []).map(x => [x.id, x]));
  const trav = by['../outside'];
  rec(label + ' restore forces pending_approval and drops seal fields', trav && trav.status === 'pending_approval' && !trav.externalId && !trav.publishedAt && !trav.publication, JSON.stringify(trav && { status: trav.status, externalId: trav.externalId, historical_status: trav.historical_status }));
  rec(label + ' rejected without externalId stays rejected', by['keep-rej'] && by['keep-rej'].status === 'rejected', by['keep-rej'] && by['keep-rej'].status);
  rec(label + ' pre-set historical_* is kept and does not publish', by['hist-preset'] && by['hist-preset'].status === 'pending_approval' && by['hist-preset'].historical_status === 'draft' && !by['hist-preset'].externalId, JSON.stringify(by['hist-preset'] && { status: by['hist-preset'].status, historical_status: by['hist-preset'].historical_status, historical_externalId: by['hist-preset'].historical_externalId }));
  const outside = path.join(ROOT, 'outside');
  rec(label + ' restore id ../outside creates no file outside the data dir', !fs.existsSync(outside) && !fs.existsSync(path.join(s.dir, '..', 'outside')), 'outside=' + fs.existsSync(outside));
  const histPut = await api(s.port, A, 'PUT', '/api/queue/hist-preset', { historical_status: 'published', historical_externalId: 'forged-over-http', title: 'still' });
  rec(label + ' historical_* not writable and not a publish grant', histPut.s === 200 && histPut.j && histPut.j.historical_status === 'draft' && histPut.j.historical_externalId === 'should-stay' && histPut.j.status === 'pending_approval' && histPut.j.title === 'still', JSON.stringify({ http: histPut.s, status: histPut.j && histPut.j.status, historical_status: histPut.j && histPut.j.historical_status, historical_externalId: histPut.j && histPut.j.historical_externalId }));
  const reuse = await api(s.port, A, 'POST', '/api/restore', { token: prep.j.token, confirm: 'ЗАМЕНИТЬ' });
  rec(label + ' restore token single use', reuse.s === 403, 'HTTP ' + reuse.s);
  const bk = fs.readdirSync(path.join(s.dir, 'backups')).filter(f => f.startsWith('pre-restore-') && f.endsWith('.db'));
  let side = false;
  if (bk[0]) { const file = path.join(s.dir, 'backups', bk[0]); const sideTxt = fs.readFileSync(file + '.sha256', 'utf8'); const hex = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); side = sideTxt.startsWith(hex); }
  rec(label + ' pre-restore sqlite backup matches its sha256', side, bk[0] || 'none');
  const eg = await api(s.port, A, 'POST', '/api/integrations', { id: 'meta', name: 'Meta', url: 'https://graph.facebook.com/v19.0/me' });
  const et = await api(s.port, A, 'POST', '/api/integrations/meta/test');
  if (h.flavor === 'test') rec(label + ' graph.facebook.com blocked before connect', et.s === 400 && et.j && et.j.code === 'blocked_url', JSON.stringify(et.j).slice(0, 180));
  else rec(label + ' prod integration row can be created (host was not contacted)', eg.s === 201 || eg.s === 200, 'HTTP ' + eg.s + ' test-not-called');
  const ig = await api(s.port, A, 'POST', '/api/integrations', { id: 'ig', name: 'IG', url: 'https://graph.instagram.com/me' });
  const tg = await api(s.port, A, 'POST', '/api/integrations', { id: 'tg', name: 'TG', url: 'https://api.telegram.org/botx/getMe' });
  const igt = h.flavor === 'test' ? await api(s.port, A, 'POST', '/api/integrations/ig/test') : { s: 0, j: null };
  const tgt = h.flavor === 'test' ? await api(s.port, A, 'POST', '/api/integrations/tg/test') : { s: 0, j: null };
  if (h.flavor === 'test') rec(label + ' instagram and telegram hosts blocked', igt.j && igt.j.code === 'blocked_url' && tgt.j && tgt.j.code === 'blocked_url', JSON.stringify({ ig: ig.s, igt: igt.j && igt.j.code, tg: tg.s, tgt: tgt.j && tgt.j.code }));
  const db = openDb(path.join(s.dir, 'studio.db'));
  const key = db.prepare("SELECT v FROM meta WHERE k = 'publishSealKey'").get();
  db.close();
  rec(label + ' rejected HTTP publish does not create publishSealKey', !key, key ? 'key exists' : 'absent');
  return { A, flavor: h.flavor };
}

async function forge(label, s, info) {
  s.stop(); await sleep(300);
  const id = 'forged-local';
  const bare = { id, title: 'local', status: 'published', externalId: '123456789012', publishedAt: '2026-10-21T00:00:00.000Z' };
  const db0 = openDb(path.join(s.dir, 'studio.db'));
  db0.prepare('INSERT OR REPLACE INTO items (col, id, data) VALUES (?, ?, ?)').run('queue', id, JSON.stringify(bare));
  db0.close();
  const s2 = start(SRC, s.port + 20, { STUDIO_FLAVOR: info.flavor, NODE_ENV: 'test', STUDIO_DATA_DIR: s.dir });
  const h = await waitUp(s2);
  const A = await login(s2.port);
  const got = await api(s2.port, A, 'GET', '/api/queue/' + id);
  rec(label + ' GET returns a published row written straight into SQLite', h && got.s === 200 && got.j && got.j.status === 'published' && !got.j.publication, JSON.stringify({ http: got.s, status: got.j && got.j.status }));
  const legacy = await api(s2.port, A, 'PUT', '/api/queue/' + id, { title: 'legacy-edit' });
  if (legacy.s === 200 && legacy.j && legacy.j.status === 'published' && legacy.j.title === 'legacy-edit') finding(label + ' legacyPublished accepts an unsealed published row written into SQLite; a later HTTP title edit keeps it published', JSON.stringify({ http: legacy.s, status: legacy.j.status, externalId: legacy.j.externalId }));
  else rec(label + ' unsealed SQLite published row is not editable as legacy', false, JSON.stringify({ http: legacy.s, body: legacy.j }));
  const bogus = { platform: 'facebook', responseId: '123456789012', at: '2026-10-21T00:00:00.000Z', callerModule: 'meta-publisher', seal: '00'.repeat(32) };
  s2.stop(); await sleep(300);
  const dbB = openDb(path.join(s.dir, 'studio.db'));
  const withPub = Object.assign({}, bare, { title: 'sealed-attempt', publication: bogus });
  dbB.prepare('INSERT OR REPLACE INTO items (col, id, data) VALUES (?, ?, ?)').run('queue', id, JSON.stringify(withPub));
  dbB.close();
  const s2b = start(SRC, s.port + 22, { STUDIO_FLAVOR: info.flavor, NODE_ENV: 'test', STUDIO_DATA_DIR: s.dir });
  await waitUp(s2b);
  const Ab = await login(s2b.port);
  const rejected = await api(s2b.port, Ab, 'PUT', '/api/queue/' + id, { title: 'no-seal' });
  rec(label + ' put() rejects a published row whose seal does not match', rejected.s === 403 && rejected.j && rejected.j.code === 'published_internal_only', 'HTTP ' + rejected.s + ' ' + (rejected.j && rejected.j.code));
  const db1 = openDb(path.join(s.dir, 'studio.db'));
  const keyRow = db1.prepare("SELECT v FROM meta WHERE k = 'publishSealKey'").get();
  db1.close();
  rec(label + ' checking a bad seal creates publishSealKey in the same database', !!keyRow && /^[0-9a-f]{64}$/.test(keyRow.v), keyRow ? 'hex length ' + keyRow.v.length : 'absent');
  if (!keyRow) { s2b.stop(); return; }
  const dump = await api(s2b.port, Ab, 'GET', '/api/backup');
  rec(label + ' publishSealKey is absent from /api/backup', !dump.t.includes(keyRow.v), 'backup bytes ' + dump.t.length);
  const pub = { platform: 'facebook', responseId: '123456789012', at: '2026-10-21T00:00:00.000Z', callerModule: 'meta-publisher' };
  pub.seal = sealFor(keyRow.v, id, pub);
  const httpTry = await api(s2b.port, Ab, 'PUT', '/api/queue/' + id, { publication: pub, externalId: pub.responseId, status: 'published' });
  rec(label + ' HTTP still rejects a seal computed from the database key', httpTry.s === 403, 'HTTP ' + httpTry.s);
  s2b.stop(); await sleep(300);
  const db2 = openDb(path.join(s.dir, 'studio.db'));
  const cur = queueRow(db2, id) || bare;
  cur.publication = pub; cur.externalId = pub.responseId; cur.status = 'published'; cur.publishedAt = pub.at;
  db2.prepare('INSERT OR REPLACE INTO items (col, id, data) VALUES (?, ?, ?)').run('queue', id, JSON.stringify(cur));
  db2.close();
  const s3 = start(SRC, s.port + 21, { STUDIO_FLAVOR: info.flavor, NODE_ENV: 'test', STUDIO_DATA_DIR: s.dir });
  await waitUp(s3);
  const A3 = await login(s3.port);
  const touch = await api(s3.port, A3, 'PUT', '/api/queue/' + id, { title: 'renamed-by-http' });
  rec(label + ' put() accepts the HMAC once the same-database key is written beside the row', touch.s === 200 && touch.j && touch.j.status === 'published' && touch.j.title === 'renamed-by-http', JSON.stringify({ http: touch.s, status: touch.j && touch.j.status, title: touch.j && touch.j.title }));
  finding(label + ' HMAC key is meta.publishSealKey inside studio.db. A local reader can forge a seal that put() accepts. No HTTP route accepts that seal.', 'key hex length ' + keyRow.v.length);
  s3.stop();
}

function flavorProbes() {
  const baked = fs.readFileSync(path.join(PKG, 'lib/flavor.baked.js'), 'utf8');
  const pj = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  rec('packaged flavor.baked.js exports test', /module\.exports = 'test'/.test(baked), baked.trim());
  rec('packaged package.json studioFlavor is test', pj.studioFlavor === 'test' && pj.productName === 'MOONKATTY AI STUDIO TEST', JSON.stringify({ studioFlavor: pj.studioFlavor, productName: pj.productName }));
  const probe = (cwd, env) => {
    const r = spawnSync(process.execPath, ['-e', 'process.argv.push("--flavor=prod","--prod"); const c=require("./lib/studio-config.js"); process.stdout.write([c.FLAVOR,c.FLAVOR_SOURCE,c.appId,c.defaultPort,c.keychainService,c.launchdLabel,c.product].join("|"))'], { cwd, env: { ...process.env, ...env } });
    return { code: r.status, out: String(r.stdout), err: String(r.stderr).slice(0, 200) };
  };
  const overrides = [
    ['STUDIO_FLAVOR=prod NODE_ENV=production', { STUDIO_FLAVOR: 'prod', NODE_ENV: 'production' }, []],
    ['STUDIO_FLAVOR=prod NODE_ENV=test', { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' }, []],
    ['MK_FLAVOR and FLAVOR', { MK_FLAVOR: 'prod', FLAVOR: 'prod', NODE_ENV: 'production' }, []],
    ['argv present inside the process', { NODE_ENV: 'production' }, []]
  ];
  for (const [n, env, args] of overrides) {
    const r = probe(PKG, env);
    rec('packaged flavor stays test against ' + n, r.out === 'test|baked|com.moonkatty.aistudio.test|8687|MOONKATTY AI STUDIO.test|com.moonkatty.aistudio.test.server|MOONKATTY AI STUDIO TEST', r.out || r.err);
  }
  const home = path.join(ROOT, 'home');
  fs.mkdirSync(path.join(home, 'Library/Application Support/MOONKATTY AI STUDIO TEST'), { recursive: true });
  fs.writeFileSync(path.join(home, 'Library/Application Support/MOONKATTY AI STUDIO TEST/desktop.json'), JSON.stringify({ flavor: 'prod', studioFlavor: 'prod' }));
  const desk = probe(PKG, { HOME: home, NODE_ENV: 'production', STUDIO_FLAVOR: 'prod' });
  rec('desktop.json flavor:prod does not switch the packaged build', desk.out.startsWith('test|baked|'), desk.out);

  const bakB = fs.readFileSync(path.join(PKG, 'lib/flavor.baked.js'));
  const bakP = fs.readFileSync(path.join(PKG, 'package.json'));
  const restore = () => { fs.writeFileSync(path.join(PKG, 'lib/flavor.baked.js'), bakB); fs.writeFileSync(path.join(PKG, 'package.json'), bakP); };
  try {
    fs.rmSync(path.join(PKG, 'lib/flavor.baked.js'));
    const onlyPkg = probe(PKG, { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' });
    rec('missing flavor.baked.js still uses package.json studioFlavor=test', onlyPkg.out.startsWith('test|package.json|'), onlyPkg.out);
    const pj2 = JSON.parse(bakP.toString()); delete pj2.studioFlavor; fs.writeFileSync(path.join(PKG, 'package.json'), JSON.stringify(pj2));
    const none = spawnSync(process.execPath, ['server.js'], { cwd: PKG, env: { ...process.env, NODE_ENV: 'production', STUDIO_FLAVOR: 'prod', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: path.join(ROOT, 'none'), PORT: '8930' }, timeout: 4000 });
    rec('missing baked file and studioFlavor with NODE_ENV=production → exit 78', none.status === 78 && /сборка не определена/.test(String(none.stderr)), 'exit ' + none.status + ' signal ' + none.signal + ' ' + String(none.stderr).slice(0, 180));
    const hatch = spawnSync(process.execPath, ['-e', 'const c=require("./lib/studio-config.js"); process.stdout.write(c.FLAVOR+"|"+c.FLAVOR_SOURCE)'], { cwd: PKG, env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'prod' } });
    finding('deleting flavor.baked.js and studioFlavor lets NODE_ENV=test STUDIO_FLAVOR=prod select prod', String(hatch.stdout));
    fs.writeFileSync(path.join(PKG, 'lib/flavor.baked.js'), "module.exports = 'staging';\n");
    fs.writeFileSync(path.join(PKG, 'package.json'), bakP);
    const bad = spawnSync(process.execPath, ['server.js'], { cwd: PKG, env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'prod', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: path.join(ROOT, 'bad'), PORT: '8931' }, timeout: 4000 });
    rec('invalid baked flavor → exit 78, env cannot rescue', bad.status === 78, 'exit ' + bad.status + ' ' + String(bad.stderr).slice(0, 160));
    fs.writeFileSync(path.join(PKG, 'lib/flavor.baked.js'), "module.exports = 'prod';\n");
    const hooked = path.join(ROOT, 'meta-hook.cjs');
    const logf = path.join(ROOT, 'meta-loads.txt');
    fs.writeFileSync(hooked, "const fs=require('fs'); const M=require('module'); const o=M.prototype.require; M.prototype.require=function(id){ if(String(id).includes('meta.js')) fs.appendFileSync(process.env.META_LOG, String(id)+'\\n'); return o.apply(this, arguments); };\n");
    const prodLoad = spawnSync(process.execPath, ['-e', 'require("./server.js")'], { cwd: PKG, env: { ...process.env, NODE_OPTIONS: '--require ' + hooked, META_LOG: logf, NODE_ENV: 'production', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: path.join(ROOT, 'prodload'), PORT: '8932', HOST: '127.0.0.1' }, timeout: 2500 });
    const loads = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8') : '';
    finding('editing unpacked lib/flavor.baked.js to prod makes this tree load meta.js', 'exit ' + prodLoad.status + ' loads=' + JSON.stringify(loads.trim()));
    fs.writeFileSync(logf, '');
    fs.writeFileSync(path.join(PKG, 'lib/flavor.baked.js'), bakB);
    const testLoad = spawnSync(process.execPath, ['server.js'], { cwd: PKG, env: { ...process.env, NODE_OPTIONS: '--require ' + hooked, META_LOG: logf, NODE_ENV: 'production', STUDIO_FLAVOR: 'prod', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: path.join(ROOT, 'testload'), PORT: '8933', HOST: '127.0.0.1' }, timeout: 2500 });
    const loads2 = fs.existsSync(logf) ? fs.readFileSync(logf, 'utf8').trim() : '';
    rec('packaged test flavor does not require meta.js', loads2 === '', 'signal/exit ' + testLoad.status + ' ' + testLoad.signal + ' loads=' + JSON.stringify(loads2));
    try { process.kill(testLoad.pid, 'SIGTERM'); } catch {}
  } finally { restore(); }

  const srcNone = spawnSync(process.execPath, ['server.js'], { cwd: SRC, env: { ...process.env, NODE_ENV: 'production', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: path.join(ROOT, 'srcnone'), PORT: '8934' }, timeout: 4000 });
  rec('source tree without a baked flavor ignores STUDIO_FLAVOR unless NODE_ENV=test (exit 78)', srcNone.status === 78, 'exit ' + srcNone.status);
  const home2 = path.join(ROOT, 'home2');
  const prodDir = path.join(home2, 'Library/Application Support/MOONKATTY AI STUDIO/studio-data');
  fs.mkdirSync(prodDir, { recursive: true });
  const guard = spawnSync(process.execPath, ['server.js'], { cwd: PKG, env: { ...process.env, HOME: home2, NODE_ENV: 'production', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: prodDir, PORT: '8935' }, timeout: 4000 });
  rec('packaged test build refuses a data dir inside the production Application Support folder (exit 78)', guard.status === 78 && /PROD_PATH_REFUSED|ОТКАЗ/.test(String(guard.stderr)), 'exit ' + guard.status + ' ' + String(guard.stderr).slice(0, 180));
}

function staticChecks() {
  const runner = fs.readFileSync(path.join(SRC, 'runner.js'), 'utf8');
  const allow = (runner.match(/\(allow file-write\*[\s\S]*?\)\n/) || [''])[0];
  const code = allow.split('//')[0];
  rec('seatbelt allow list has no /private/tmp or /private/var/folders', code.includes('tmpDir(dir)') && !code.includes('/private/tmp') && !code.includes('/private/var/folders'), code.slice(0, 220));
  const ks = fs.readFileSync(path.join(SRC, 'lib/keystore.js'), 'utf8');
  const oc = fs.readFileSync(path.join(SRC, 'lib/opencode-auth.js'), 'utf8');
  rec('keystore and OpenCode password use security -i stdin', /sec\(\['-i'\]/.test(ks) && /run\(\['-i'\]/.test(oc), 'static');
  const bl = fs.readFileSync(path.join(SRC, 'lib/blender.js'), 'utf8');
  rec('blender spawn is shell:false with a minimal env', /shell:\s*false/.test(bl) && /PATH:/.test(bl) && !/STUDIO_SECRET_KEY/.test(bl), 'static');
  const kc = path.join(ROOT, 'kc'); fs.mkdirSync(kc);
  const argv = path.join(kc, 'argv.log');
  const r = spawnSync(process.execPath, ['-e', "const fs=require('fs'); const path=require('path'); const dir=process.env.KC_DIR; const k=require('./lib/keystore.js'); const out=k.loadKey(dir); if(!String(out.source).includes('keychain')) process.exit(2); const log=fs.readFileSync(process.env.FAKE_KEYCHAIN_ARGV_LOG,'utf8'); if(!log.includes('\"-i\"')) process.exit(3);"], { cwd: SRC, env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', KC_DIR: kc, STUDIO_TEST_SECURITY_BIN: path.join(SRC, 'scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: path.join(kc, 'kc.json'), FAKE_KEYCHAIN_ARGV_LOG: argv } });
  const log = fs.existsSync(argv) ? fs.readFileSync(argv, 'utf8') : '';
  rec('fake security argv is only -i or find-generic-password flags', r.status === 0 && log.includes('"-i"') && !log.includes('"-w","'), 'exit ' + r.status + ' err ' + String(r.stderr).slice(0, 160) + ' argv ' + log.replace(/\s+/g, ' ').slice(0, 240));
}

async function migration() {
  const dir = path.join(ROOT, 'mig'); fs.mkdirSync(dir);
  const dbp = path.join(dir, 'studio.db');
  const db = openDb(dbp);
  db.exec("CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);");
  db.prepare('INSERT INTO items VALUES (?, ?, ?)').run('tasks', 'keep-me', JSON.stringify({ id: 'keep-me', title: 'QA-MIG-KEEP', status: 'done' }));
  db.prepare('INSERT INTO items VALUES (?, ?, ?)').run('queue', 'old-pub', JSON.stringify({ id: 'old-pub', title: 'from-v1', status: 'published', externalId: '5555566666', platform: 'facebook', channelId: 'c1', text: 'x' }));
  db.prepare('INSERT INTO meta VALUES (?, ?)').run('seeded', '2026-01-01');
  db.close();
  const s = start(SRC, 8940, { STUDIO_FLAVOR: 'test', NODE_ENV: 'test', STUDIO_DATA_DIR: dir, STUDIO_ADMIN_PASSWORD: PW, STUDIO_ADMIN_USER: 'qa' });
  const h = await waitUp(s);
  const A = await login(s.port);
  const task = await api(s.port, A, 'GET', '/api/tasks/keep-me');
  const bks = fs.existsSync(path.join(dir, 'backups')) ? fs.readdirSync(path.join(dir, 'backups')).filter(f => /^pre-migration-v1-to-v4-.*\.db$/.test(f)) : [];
  let match = false;
  if (bks[0]) { const f = path.join(dir, 'backups', bks[0]); match = fs.readFileSync(f + '.sha256', 'utf8').startsWith(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')); }
  rec('pre-migration backup exists and matches sha256', !!h && bks.length === 1 && match, bks[0] || 'none');
  rec('migrated db still has the seeded task', task.s === 200 && task.j && task.j.title === 'QA-MIG-KEEP', 'HTTP ' + task.s + ' ' + (task.j && task.j.title));
  const old = await api(s.port, A, 'GET', '/api/queue/old-pub');
  const edited = await api(s.port, A, 'PUT', '/api/queue/old-pub', { title: 'edited-after-upgrade' });
  if (old.j && old.j.status === 'published' && edited.j && edited.j.status === 'published' && edited.j.title === 'edited-after-upgrade' && !edited.j.publication) finding('a v1 database row already stored as published has no seal after migration, and HTTP can keep editing it', JSON.stringify({ before: old.j.status, after: edited.j.status, externalId: edited.j.externalId }));
  else rec('migrated published row was sealed or demoted', false, JSON.stringify({ get: old.j && old.j.status, put: edited.s }));
  s.stop();
}

async function main() {
  console.log('ROOT ' + ROOT);
  const testSrv = start(SRC, 8911, { STUDIO_FLAVOR: 'test', NODE_ENV: 'test' });
  const prodSrv = start(SRC, 8912, { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' });
  const pkgSrv = start(PKG, 8913, { NODE_ENV: 'production', STUDIO_FLAVOR: 'prod' }, ['--flavor=prod', '--prod']);
  const testInfo = await httpMatrix('source-test', testSrv);
  const prodInfo = await httpMatrix('source-prod', prodSrv);
  const pkgHealth = await waitUp(pkgSrv);
  rec('packaged server ignores STUDIO_FLAVOR=prod and --flavor=prod', pkgHealth && pkgHealth.flavor === 'test' && pkgHealth.product === 'MOONKATTY AI STUDIO TEST', JSON.stringify(pkgHealth && { flavor: pkgHealth.flavor, product: pkgHealth.product, version: pkgHealth.version }));
  if (pkgHealth) {
    const A = await login(8913);
    const made = await api(8913, A, 'POST', '/api/queue', { title: 'pkg', status: 'published', externalId: '1234567890', publication: { seal: 'aa'.repeat(32) } });
    rec('packaged POST cannot store published', made.s === 201 && made.j.status === 'pending_approval' && !made.j.externalId, JSON.stringify({ http: made.s, status: made.j.status }));
    const put = await api(8913, A, 'PUT', '/api/queue/' + made.j.id, { status: 'published', externalId: '123456789012' });
    rec('packaged PUT published → 403', put.s === 403 && put.j.code === 'published_internal_only', 'HTTP ' + put.s);
    const pub = await api(8913, A, 'POST', '/api/queue/' + made.j.id + '/publish');
    rec('packaged /publish → 403 publishing_disabled', pub.s === 403 && pub.j.code === 'publishing_disabled', 'HTTP ' + pub.s);
    const eg = await api(8913, A, 'POST', '/api/integrations', { id: 'meta', name: 'Meta', url: 'https://graph.facebook.com/v19.0/me' });
    const et = await api(8913, A, 'POST', '/api/integrations/meta/test');
    rec('packaged graph.facebook.com blocked', et.s === 400 && et.j && et.j.code === 'blocked_url', 'create ' + eg.s + ' ' + JSON.stringify(et.j).slice(0, 140));
  }
  pkgSrv.stop();
  await forge('source-test', testSrv, testInfo);
  prodSrv.stop();
  flavorProbes();
  staticChecks();
  await migration();
  const failed = controls.filter(c => !c.ok);
  const out = { root: ROOT, controlsPassed: controls.length - failed.length, controlsFailed: failed.map(c => c.name), findings: findings.map(f => f.name) };
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify({ controls, findings }, null, 2));
  console.log('RESULTS_FILE ' + path.join(ROOT, 'results.json'));
  console.log(JSON.stringify(out));
  console.log('EXIT:' + (failed.length ? 1 : 0));
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
