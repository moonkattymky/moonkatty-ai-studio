// Independent attack of feat/update-center-v130. Temp data only. Fake passwords. No GitHub. No install.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const ROOT = process.env.UC_ROOT || '/tmp/mk-uc130';
const { startServer } = require(path.join(ROOT, 'test/helpers/uc-server.js'));
const UC = require(path.join(ROOT, 'lib/ops/update-center.js'));
const UB = require(path.join(ROOT, 'lib/ops/update-backup.js'));
const UM = require(path.join(ROOT, 'lib/ops/update.js'));
const { open: openDb } = require(path.join(ROOT, 'lib/db.js'));
const fails = [];
const notes = [];
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) fails.push({ name, detail: detail == null ? '' : String(detail).slice(0, 500) });
  notes.push({ name, ok, detail: detail == null ? '' : String(detail).slice(0, 500) });
  return ok;
}
function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function keygen() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const id = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  return { id, pem, publicKey, privateKey };
}
function ownerDir(k, set = 'test') {
  const d = tmp('mk-uc-kr-'); fs.chmodSync(d, 0o700);
  fs.writeFileSync(path.join(d, 'keyring.json'), JSON.stringify({ keys: { [k.id]: { file: 'owner.pub.pem', set, status: 'active' } }, revoked: [] }), { mode: 0o600 });
  fs.writeFileSync(path.join(d, 'owner.pub.pem'), k.pem, { mode: 0o644 });
  return d;
}
function center(env) {
  return UC.createUpdateCenter({ dir: tmp('mk-uc-dir-'), current: '1.3.0-test', identity: { flavor: 'test', known: true, bundleId: 'com.moonkatty.aistudio.test', appName: 'MOONKATTY AI STUDIO TEST', dataDirName: 'MOONKATTY AI STUDIO TEST', launchdLabel: 'com.moonkatty.aistudio.test.server', keychainServicePrefix: 'MOONKATTY AI STUDIO.test', defaultPort: 8687, channels: ['test'], appPath: '/Applications/MOONKATTY AI STUDIO TEST.app' }, env, healthUrl: 'http://127.0.0.1:1/api/health', fetchImpl: async () => { throw new Error('network refused by attack harness'); } });
}

async function gateAndFd() {
  check('HARD_GATE.closed is the code constant true', UC.HARD_GATE.closed === true, JSON.stringify(UC.HARD_GATE));
  const src = fs.readFileSync(path.join(ROOT, 'lib/ops/update-center.js'), 'utf8');
  check('mechanismStatus has no env switch for the hard gate', !/process\.env\.[A-Z0-9_]*HARD/.test(src) && /HARD_GATE\.closed && !hardGateOverrideForTests/.test(src));
  for (const f of ['lib/ops/update-center-mount.js', 'server.js', 'public/update-ui.js', 'lib/studio-config.js']) {
    check(f + ' does not pass hardGateOverrideForTests', !fs.readFileSync(path.join(ROOT, f), 'utf8').includes('hardGateOverrideForTests'));
  }
  const k = keygen(); const dir = ownerDir(k);
  const opened = []; const orig = fs.openSync;
  fs.openSync = function (p, ...a) { opened.push(String(p)); return orig.call(fs, p, ...a); };
  let rd;
  try { rd = UC.readExternalKeyring(dir, process.getuid()); }
  finally { fs.openSync = orig; }
  check('Linux read mode is fd-relative', rd.mode === 'fd-relative', JSON.stringify({ mode: rd.mode, problem: rd.problem }));
  const rel = opened.filter(p => /keyring\.json$/.test(p) || /owner\.pub\.pem$/.test(p));
  check('keyring bytes are opened under /proc/self/fd', rel.length >= 2 && rel.every(p => p.startsWith('/proc/self/fd/')), rel.join(' | '));
  const baseEnv = { OPS_UPDATE_KEYRING_DIR: dir };
  const flagSets = [
    {},
    { OPS_UPDATE_DOWNLOAD_ENABLED: '1' },
    { OPS_UPDATE_DOWNLOAD_ENABLED: 'true' },
    { OPS_UPDATE_DOWNLOAD_ENABLED: '1', OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1', OPS_UPDATE_NODES: '1', STUDIO_OPS_UPDATE: '1' },
    { HARD_GATE: '0', HARD_GATE_CLOSED: 'false', OPS_UPDATE_HARD_GATE: '0', OPS_UPDATE_HARD_GATE_CLOSED: 'false', hardGateOverrideForTests: 'true', STUDIO_HARD_GATE: 'open' },
  ];
  for (const extra of flagSets) {
    const st = center({ ...baseEnv, ...extra }).status();
    check('env does not enable download: ' + (Object.keys(extra).join(',') || 'key-only'), st.mechanism.downloadEnabled === false && st.mechanism.installEnabled === false && st.mechanism.hardGate === true && st.signature.state === 'READY', JSON.stringify({ sig: st.signature.state, mech: st.mechanism }));
  }
  const openedByTestFlag = UC.createUpdateCenter({ hardGateOverrideForTests: true, dir: tmp('mk-uc-ov-'), current: '1.3.0-test', env: {}, healthUrl: 'http://127.0.0.1:1/api/health', identity: { flavor: 'test', known: true, bundleId: 'com.moonkatty.aistudio.test', appName: 'T', dataDirName: 'T', launchdLabel: 't', keychainServicePrefix: 't', defaultPort: 8687, channels: ['test'], appPath: '/Applications/T.app' } }).status();
  check('constructor flag hardGateOverrideForTests is what opens the gate', openedByTestFlag.mechanism.downloadEnabled === true && openedByTestFlag.mechanism.hardGate === false, JSON.stringify(openedByTestFlag.mechanism));
  const was = UC.HARD_GATE.closed;
  try {
    UC.HARD_GATE.closed = false;
    const mutated = center({ ...baseEnv, OPS_UPDATE_DOWNLOAD_ENABLED: '1' }).status();
    check('in-process HARD_GATE.closed=false plus the download flag enables download', mutated.mechanism.downloadEnabled === true, JSON.stringify(mutated.mechanism));
    const mutatedNoFlag = center(baseEnv).status();
    check('mutating the constant without OPS_UPDATE_DOWNLOAD_ENABLED=1 stays disabled', mutatedNoFlag.mechanism.downloadEnabled === false, JSON.stringify(mutatedNoFlag.mechanism));
  } finally { UC.HARD_GATE.closed = was; }
  check('constant restored', UC.HARD_GATE.closed === true);
}

function schemaAndBackup() {
  check('KNOWN_SCHEMAS is 1..6', JSON.stringify(UC.KNOWN_SCHEMAS) === JSON.stringify([1, 2, 3, 4, 5, 6]));
  const mgr = UM.createUpdateManager({ supportedSchema: 6 });
  function fake(version, tables) {
    return { prepare(sql) { return { all() { if (/sqlite_master/.test(sql)) return tables.map(name => ({ name })); if (/table_info/.test(sql)) return [{ name: 'input' }]; return []; }, get() { if (/schemaVersion/.test(sql)) return version == null ? undefined : { v: String(version) }; return {}; } }; } };
  }
  for (const v of [1, 2, 3, 4, 5, 6]) {
    const s = mgr.schemaCheck(fake(v, ['items', 'meta']));
    check('schemaCheck accepts ' + v, s.ok === true && s.schemaVersion === v, JSON.stringify(s));
  }
  check('schemaCheck rejects 0', mgr.schemaCheck(fake(null, ['meta'])).ok === false);
  check('schemaCheck rejects 7', mgr.schemaCheck(fake(7, ['items', 'meta'])).ok === false, JSON.stringify(mgr.schemaCheck(fake(7, ['items', 'meta']))));
  const ident = { bundleId: 'com.moonkatty.aistudio.test', dataDirName: 'MOONKATTY AI STUDIO TEST', appName: 'MOONKATTY AI STUDIO TEST', launchdLabel: 'com.moonkatty.aistudio.test.server', keychainServicePrefix: 'MOONKATTY AI STUDIO.test' };
  for (const v of [1, 2, 3, 4, 5, 6, 7, 0]) {
    const c = UC.compatCheck({ dbSchemaVersion: v, isolated: true, ...ident }, { schemaVersion: 6, supported: 6, ok: true, tables: ['items', 'meta'], source: 'meta' }, ident);
    if (v >= 1 && v <= 6) check('compat known schema ' + v + ' is not rejected as unknown', c.ok === true || !/неизвестная версия/.test(c.detail || ''), c.detail);
    else check('compat rejects schema ' + v, c.ok === false, c.detail);
  }
  const d = tmp('mk-uc-db-'); const file = path.join(d, 'live.db');
  const db = openDb(file);
  db.exec("CREATE TABLE items (id TEXT); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta (k, v) VALUES ('schemaVersion', '6'); INSERT INTO items (id) VALUES ('row1');");
  const backups = UB.createUpdateBackups({ db, openDb, dir: path.join(d, 'backups') });
  const made = backups.create();
  const ver = backups.verify(made.id);
  const trial = backups.testRestore(made.id);
  check('backup create returns sha256', /^[0-9a-f]{64}$/.test(made.sha256), made.sha256);
  check('backup verify matches sidecar', ver.ok === true, JSON.stringify(ver));
  check('trial restore integrity ok with items and meta', trial.ok === true && trial.integrity === 'ok', JSON.stringify(trial));
  const live = db.prepare('SELECT id FROM items').all();
  check('live db still has the row', live.length === 1 && live[0].id === 'row1', JSON.stringify(live));
  const sidecar = path.join(d, 'backups', made.id + '.sha256');
  fs.writeFileSync(sidecar, '0'.repeat(64) + '  ' + made.id + '\n');
  const bad = backups.verify(made.id);
  check('tampered sidecar fails SHA-256', bad.ok === false && /SHA-256/.test((bad.problems || []).join(' ')), JSON.stringify(bad));
  fs.writeFileSync(sidecar, made.sha256 + '  ' + made.id + '\n');
  const body = path.join(d, 'backups', made.id);
  const origBytes = fs.readFileSync(body);
  fs.writeFileSync(body, Buffer.concat([origBytes, Buffer.from('tamper')]));
  check('tampered database bytes fail SHA-256', backups.verify(made.id).ok === false);
  fs.writeFileSync(body, origBytes);
  check('restored bytes verify again', backups.verify(made.id).ok === true);
  db.close();
}

async function http() {
  const off = await startServer({ port: 18961 });
  try {
    const r = await off.j('GET', '/api/ops/update-center');
    check('routes absent without STUDIO_OPS_UPDATE', r.status === 404, r.status + ' ' + JSON.stringify(r.body).slice(0, 180));
    const health = await off.j('GET', '/api/health', {});
    check('default server is TEST flavor', health.body && health.body.flavor === 'test' && health.body.schemaVersion === 6, JSON.stringify(health.body).slice(0, 240));
  } finally { await off.cleanup(); }

  const k = keygen(); const kr = ownerDir(k);
  const env = {
    STUDIO_OPS_UPDATE: '1', OPS_UPDATE_DOWNLOAD_ENABLED: '1', OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1',
    OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1', OPS_UPDATE_NODES: '1', OPS_UPDATE_KEYRING_DIR: kr,
    HARD_GATE: '0', hardGateOverrideForTests: 'true',
  };
  const s = await startServer({ port: 18962, env });
  try {
    const anon = await s.j('GET', '/api/ops/update-center', s.R);
    check('unauthenticated GET is 401', anon.status === 401, JSON.stringify(anon.body));
    const postAnon = await s.j('POST', '/api/ops/update-center/check', s.R, {});
    check('unauthenticated POST is 401', postAnon.status === 401, JSON.stringify(postAnon.body));
    const noHdr = await s.j('POST', '/api/ops/update-center/check', { cookie: s.A.cookie, 'content-type': 'application/json' }, {});
    check('missing CSRF header is 403', noHdr.status === 403, JSON.stringify(noHdr.body));
    const evil = await s.j('POST', '/api/ops/update-center/check', { ...s.A, origin: 'https://evil.example' }, {});
    check('foreign Origin is 403', evil.status === 403, JSON.stringify(evil.body));
    const nul = await s.j('POST', '/api/ops/update-center/v1.3.1-test/approve', { ...s.A, origin: 'null' }, { password: 'fake-password-123' });
    check('Origin null is 403', nul.status === 403, JSON.stringify(nul.body));
    const sfs = await s.j('POST', '/api/ops/update-center/backup', { ...s.A, 'sec-fetch-site': 'cross-site' }, {});
    check('Sec-Fetch-Site cross-site is 403', sfs.status === 403, JSON.stringify(sfs.body));
    const agent = await s.j('GET', '/api/ops/update-center', { ...s.R, authorization: 'Bearer nk_agent0123456789.secretsecretsecretsecret' });
    check('node-agent bearer is 401', agent.status === 401, JSON.stringify(agent.body));
    const bogus = await s.j('GET', '/api/ops/update-center', { ...s.R, 'x-studio-app-token': 'a'.repeat(64) });
    check('wrong app token is 401', bogus.status === 401, JSON.stringify(bogus.body));
    const st = await s.j('GET', '/api/ops/update-center');
    check('authenticated status is TEST and the gate stays closed', st.status === 200 && st.body.identity.flavor === 'test' && st.body.identity.bundleId === 'com.moonkatty.aistudio.test' && st.body.identity.known === true && st.body.mechanism.downloadEnabled === false && st.body.mechanism.installEnabled === false && st.body.mechanism.hardGate === true && st.body.signature.state === 'READY', JSON.stringify({ id: st.body.identity, mech: st.body.mechanism, sig: st.body.signature }).slice(0, 500));
    const dl = await s.j('POST', '/api/ops/update-center/v1.9.9-test/download', s.A, { hardGateOverrideForTests: true, password: 'fake-password-123' });
    check('download stays disabled on TEST with every flag', dl.status === 400 && dl.body.code === 'UPDATE_DISABLED', JSON.stringify(dl.body).slice(0, 300));
    const ap0 = await s.j('POST', '/api/ops/update-center/v1.9.9-test/approve', s.A, {});
    check('approve without a password is 403', ap0.status === 403, JSON.stringify(ap0.body));
    const ap1 = await s.j('POST', '/api/ops/update-center/v1.9.9-test/approve', s.A, { password: 'wrong-password' });
    check('approve with the wrong password is 403', ap1.status === 403, JSON.stringify(ap1.body));
    const ai0 = await s.j('POST', '/api/ops/update-center/v1.9.9-test/auto-install', s.A, { password: 'wrong-password', dryRun: false });
    check('auto-install with the wrong password is 403', ai0.status === 403, JSON.stringify(ai0.body));
    const ai1 = await s.j('POST', '/api/ops/update-center/v1.9.9-test/auto-install', s.A, { password: 'fake-password-123', dryRun: false });
    check('right password still cannot auto-install', ai1.status === 400 && (ai1.body.code === 'UPDATE_DISABLED' || ai1.body.code === 'AUTO_INSTALL_DISABLED'), JSON.stringify(ai1.body).slice(0, 300));
    const q = await s.j('POST', '/api/queue', s.A, { id: 'q-uc', title: 'bypass', status: 'published', externalId: 'evil', kind: 'news' });
    const pub = await s.j('POST', '/api/queue/q-uc/publish', s.A, {});
    check('TEST publish route stays 403', pub.status === 403 && pub.body.code === 'publishing_disabled', 'queue ' + q.status + ' publish ' + JSON.stringify(pub.body));
  } finally { await s.cleanup(); }

  const poisoned = await startServer({ port: 18963, env: { STUDIO_OPS_UPDATE: '1', OPS_UPDATE_DOWNLOAD_ENABLED: '1', STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio', hardGateOverrideForTests: 'true' } });
  try {
    const st = await poisoned.j('GET', '/api/ops/update-center');
    check('prod bundle id on the TEST server stays unknown and download stays off', st.status === 200 && st.body.identity.known === false && st.body.mechanism.downloadEnabled === false && st.body.mechanism.hardGate === true, JSON.stringify({ id: st.body.identity, mech: st.body.mechanism }).slice(0, 500));
  } finally { await poisoned.cleanup(); }
}

(async () => {
  await gateAndFd();
  schemaAndBackup();
  await http();
  const out = { fails: fails.length, notes: notes.length, failed: fails, notes };
  fs.mkdirSync('/tmp/uc130-logs', { recursive: true });
  fs.writeFileSync('/tmp/uc130-logs/attack.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ fails: fails.length, notes: notes.length, failed: fails.map(f => f.name) }, null, 2));
  if (fails.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
