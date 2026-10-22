'use strict';
// Re-audit of Update Center at 3fc9573. No install, no publish, no live GitHub.
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.UC_SRC || '/tmp/mk-uc3';
const UC = require(path.join(ROOT, 'lib/ops/update-center.js'));
const UM = require(path.join(ROOT, 'lib/ops/update.js'));
const AI = require(path.join(ROOT, 'lib/ops/app-identity.js'));
const { startServer } = require(path.join(ROOT, 'test/helpers/server.js'));

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const WHEN = Date.parse('2026-10-21T12:00:00Z');
const results = [];
const findings = [];
const PASS = 'qa-passphrase-not-a-key';

function check(kind, name, ok, detail) {
  const row = { kind, name, ok: !!ok, detail: detail == null ? null : detail };
  results.push(row);
  if (kind === 'residual' && ok) findings.push(name);
  console.log(`${ok ? 'PASS ' : 'FAIL '}${kind} ${name}`);
  return !!ok;
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-uc3-'));
function pair() {
  const keys = crypto.generateKeyPairSync('ed25519');
  const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  return { keys, pub, priv, id: UC.keyIdOf(keys.publicKey) };
}
function writeRing(dir, keys, revoked = []) {
  fs.writeFileSync(path.join(dir, 'keyring.json'), JSON.stringify({ version: 1, keys, revoked }) + '\n', { mode: 0o600 });
}
function loadExt(dir) {
  return UC.loadKeyrings({ env: { OPS_UPDATE_KEYRING_DIR: dir } });
}
function pemFile(dir, name, body) {
  fs.writeFileSync(path.join(dir, name), body, { mode: 0o644 });
}

function manifest(over = {}) {
  return {
    manifestVersion: 1, version: '1.3.0', channel: 'preview', sourceCommit: 'a'.repeat(40), arch: 'arm64', platform: 'darwin',
    bundleId: 'com.moonkatty.aistudio', appName: 'MOONKATTY AI STUDIO', dataDirName: 'MOONKATTY AI STUDIO',
    launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: 'MOONKATTY AI STUDIO', defaultPort: 8787,
    dbSchemaVersion: 1, minUpgradeFrom: '1.1.2', isolated: false, isolatedFrom: [], signing: 'adhoc', notarized: false,
    assets: [{ name: 'MOONKATTY-AI-STUDIO-1.3.0-arm64-mac.zip', size: 32, sha256: 'ab'.repeat(32) }],
    ...over,
  };
}
const PROD = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio' }, startDirs: [] });
const TEST = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio.test' }, startDirs: [] });

function gateAge(extra, publishedAt) {
  const m = manifest(extra);
  if (!Object.prototype.hasOwnProperty.call(extra, 'builtAt')) delete m.builtAt;
  return UC.gate({
    manifest: m, verified: true, current: '1.1.2', installed: PROD, compat: { ok: true }, backup: { verified: true },
    approval: { manifestSha256: 'h' }, manifestSha256: 'h', publishedAt, now: WHEN,
  });
}
function fakeDb(version) {
  const tables = version >= 1 ? ['items', 'meta'] : [];
  if (version >= 2) tables.push('jobs');
  return {
    prepare(sql) {
      return {
        all() {
          if (String(sql).includes('sqlite_master')) return tables.map(name => ({ name }));
          if (String(sql).includes('table_info')) return version >= 3 ? [{ name: 'input' }] : [{ name: 'id' }];
          return [];
        },
        get() { return version >= 1 ? { v: String(version) } : undefined; },
      };
    },
  };
}
function reasonsOf(kr) {
  return kr.problems.join(' | ');
}

function keyringAttacks() {
  const owner = pair();
  const attacker = pair();
  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'outside.pub.pem'), attacker.pub, { mode: 0o644 });
  fs.writeFileSync(path.join(outside, 'outside.key'), attacker.priv, { mode: 0o600 });

  const traversal = tmp();
  writeRing(traversal, { [attacker.id]: { file: path.join(outside, 'outside.pub.pem'), set: 'prod', status: 'active' } });
  const trav = loadExt(traversal);
  check('hold', 'an absolute file path is reduced to the basename and is not read', trav.prod.size === 0 && /no such file|ENOENT|keyId не совпадает|ключ /.test(reasonsOf(trav)), null);

  const dotted = tmp();
  writeRing(dotted, { [attacker.id]: { file: `../../${path.basename(outside)}/outside.pub.pem`, set: 'prod', status: 'active' } });
  const dots = loadExt(dotted);
  check('hold', 'a file field with .. is reduced to the basename and is not read', dots.prod.size === 0, null);

  const parent = tmp();
  writeRing(parent, { [attacker.id]: { file: '..', set: 'prod', status: 'active' } });
  const up = loadExt(parent);
  check('hold', 'a file field of .. does not load a key', up.prod.size === 0, null);

  const linkedPub = tmp();
  fs.symlinkSync(path.join(outside, 'outside.pub.pem'), path.join(linkedPub, 'link.pub.pem'));
  writeRing(linkedPub, { [attacker.id]: { file: 'link.pub.pem', set: 'prod', status: 'active' } });
  const followed = loadExt(linkedPub);
  const followedKey = followed.prod.get(attacker.id);
  check('residual', 'a symlink to a public key outside the keyring directory is loaded', followed.prod.size === 1 && followedKey && followedKey.key.type === 'public', null);

  const linkedPriv = tmp();
  fs.symlinkSync(path.join(outside, 'outside.key'), path.join(linkedPriv, 'link.pub.pem'));
  writeRing(linkedPriv, { [attacker.id]: { file: 'link.pub.pem', set: 'prod', status: 'active' } });
  const privLink = loadExt(linkedPriv);
  check('hold', 'a symlink to a private key PEM is rejected', privLink.prod.size === 0 && /ПРИВАТНЫЙ/.test(reasonsOf(privLink)), null);

  const ringLink = tmp();
  const ringTarget = tmp();
  writeRing(ringTarget, { [attacker.id]: { file: 'a.pub.pem', set: 'prod', status: 'active' } });
  pemFile(ringTarget, 'a.pub.pem', attacker.pub);
  fs.symlinkSync(path.join(ringTarget, 'keyring.json'), path.join(ringLink, 'keyring.json'));
  fs.symlinkSync(path.join(ringTarget, 'a.pub.pem'), path.join(ringLink, 'a.pub.pem'));
  const viaRing = loadExt(ringLink);
  check('residual', 'keyring.json as a symlink is followed', viaRing.prod.has(attacker.id), null);

  const loose = tmp();
  fs.chmodSync(loose, 0o777);
  pemFile(loose, 'a.pub.pem', attacker.pub);
  writeRing(loose, { [attacker.id]: { file: 'a.pub.pem', set: 'prod', status: 'active' } });
  fs.chmodSync(path.join(loose, 'keyring.json'), 0o666);
  fs.chmodSync(path.join(loose, 'a.pub.pem'), 0o666);
  const looseKr = loadExt(loose);
  const looseMode = fs.statSync(loose).mode & 0o777;
  check('residual', 'a mode 0777 keyring directory is loaded and the signature state is READY', looseMode === 0o777 && looseKr.prod.has(attacker.id) && UC.signatureStatus(looseKr, 'prod').state === 'READY', { mode: looseMode.toString(8) });

  const tight = tmp();
  fs.chmodSync(tight, 0o700);
  pemFile(tight, 'a.pub.pem', owner.pub);
  writeRing(tight, { [owner.id]: { file: 'a.pub.pem', set: 'prod', status: 'active' } });
  const tightKr = loadExt(tight);
  check('hold', 'a mode 0700 directory with a public key is READY and the key type is public', (fs.statSync(tight).mode & 0o777) === 0o700 && tightKr.prod.get(owner.id).key.type === 'public' && UC.signatureStatus(tightKr, 'prod').state === 'READY', null);

  const disguises = [
    ['pkcs8 private PEM', attacker.priv, attacker.id],
    ['encrypted pkcs8 PEM', attacker.keys.privateKey.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: PASS }), attacker.id],
    ['public PEM followed by a private PEM', attacker.pub + attacker.priv, attacker.id],
    ['tab inside the private header', attacker.priv.replace('-----BEGIN PRIVATE KEY-----', '-----BEGIN\tPRIVATE KEY-----'), attacker.id],
    ['public header over a private body', attacker.priv.replaceAll('PRIVATE KEY', 'PUBLIC KEY'), attacker.id],
    ['zero-width space in the private header', attacker.priv.replace('PRIVATE KEY', 'PRIVATE\u200bKEY'), attacker.id],
  ];
  for (const [label, body, id] of disguises) {
    const d = tmp();
    pemFile(d, 'k.pub.pem', body);
    writeRing(d, { [id]: { file: 'k.pub.pem', set: 'prod', status: 'active' } });
    const kr = loadExt(d);
    check('hold', `key material «${label}» is rejected`, !kr.prod.get(id), { loaded: !!kr.prod.get(id) });
  }
  const jwkDir = tmp();
  const jwk = attacker.keys.privateKey.export({ format: 'jwk' });
  pemFile(jwkDir, 'k.pub.pem', JSON.stringify(jwk));
  writeRing(jwkDir, { [attacker.id]: { file: 'k.pub.pem', set: 'prod', status: 'active' } });
  const jwkKr = loadExt(jwkDir);
  const jwkKey = jwkKr.prod.get(attacker.id);
  if (jwkKey) {
    let jwkExported = false;
    try { jwkKey.key.export({ type: 'pkcs8', format: 'pem' }); jwkExported = true; } catch { jwkExported = false; }
    check('residual', 'a private JWK is loaded as a public key object', jwkKey.key.type === 'public' && !UC.PRIVATE_RE.test(JSON.stringify(jwk)), { type: jwkKey.key.type });
    check('hold', 'the loaded JWK key object does not export a private PKCS8', jwkExported === false, null);
  } else {
    check('hold', 'a private JWK is rejected', true, null);
  }

  const base = tmp();
  pemFile(base, 'owner.pub.pem', owner.pub);
  writeRing(base, { [owner.id]: { file: 'owner.pub.pem', set: 'prod', status: 'active' } });
  const ext = tmp();
  pemFile(ext, 'attacker.pub.pem', attacker.pub);
  writeRing(ext, { [attacker.id]: { file: 'attacker.pub.pem', set: 'prod', status: 'active' } }, [owner.id]);
  const merged = UC.loadKeyrings({ dir: base, env: { OPS_UPDATE_KEYRING_DIR: ext } });
  check('residual', 'an external keyring revokes the built-in prod key and adds another', !merged.prod.has(owner.id) && merged.prod.has(attacker.id) && merged.revoked.has(owner.id) && UC.signatureStatus(merged, 'prod').state === 'READY', null);

  const stuckBase = tmp();
  pemFile(stuckBase, 'a.pub.pem', attacker.pub);
  writeRing(stuckBase, { [attacker.id]: { file: 'a.pub.pem', set: 'prod', status: 'active' } }, [attacker.id]);
  const clear = tmp();
  pemFile(clear, 'a.pub.pem', attacker.pub);
  writeRing(clear, { [attacker.id]: { file: 'a.pub.pem', set: 'prod', status: 'active' } }, []);
  const still = UC.loadKeyrings({ dir: stuckBase, env: { OPS_UPDATE_KEYRING_DIR: clear } });
  check('hold', 'an external keyring cannot clear a revocation already in the base ring', !still.prod.has(attacker.id) && still.revoked.has(attacker.id), null);

  const both = tmp();
  pemFile(both, 'a.pub.pem', attacker.pub);
  writeRing(both, { [attacker.id]: { file: 'a.pub.pem', set: 'prod', status: 'active' } }, [attacker.id]);
  const same = loadExt(both);
  check('hold', 'a key listed in keys and revoked in the same file is not loaded', !same.prod.has(attacker.id) && same.revoked.has(attacker.id), null);

  const stubId = '24f2c5557922cb89';
  const revokeStub = tmp();
  writeRing(revokeStub, {}, [stubId, 'not-a-key-id']);
  const stubGone = loadExt(revokeStub);
  check('hold', 'an external revocation removes the built-in test stub and does not revive prod', !stubGone.test.has(stubId) && stubGone.prod.size === 0 && UC.signatureStatus(stubGone, 'test').state === 'BLOCKED' && UC.signatureStatus(stubGone, 'prod').state === 'BLOCKED', null);

  const junk = tmp();
  fs.writeFileSync(path.join(junk, 'keyring.json'), JSON.stringify({ version: 1, keys: {}, revoked: { 0: stubId } }));
  const junkKr = loadExt(junk);
  check('hold', 'a revoked object is ignored', junkKr.test.has(stubId) && !junkKr.revoked.has(stubId), null);
}

function ageAndSchema() {
  const oldBuilt = gateAge({ builtAt: '2020-01-01T00:00:00Z' }, '2026-10-21T00:00:00Z');
  check('hold', 'a signed builtAt of 2020 blocks a republished date', oldBuilt.allowed === false && /replay/.test(oldBuilt.reasons.join(' ')), null);
  const freshBuilt = gateAge({ builtAt: '2026-10-01T00:00:00Z' }, '2020-06-01T00:00:00Z');
  check('hold', 'an old published_at still blocks when builtAt is recent', freshBuilt.allowed === false && /replay/.test(freshBuilt.reasons.join(' ')), null);
  const noBuilt = gateAge({}, '2026-10-21T00:00:00Z');
  check('residual', 'a manifest with no builtAt and a fresh published_at is not age-blocked', noBuilt.allowed === true && !/replay/.test(noBuilt.reasons.join(' ')), null);
  const noDates = gateAge({}, null);
  check('residual', 'a missing builtAt and a missing published_at skip the age check', noDates.allowed === true && !/replay/.test(noDates.reasons.join(' ')), null);

  const mgr = UM.createUpdateManager();
  check('hold', 'SUPPORTED_SCHEMA is 1', UM.SUPPORTED_SCHEMA === 1, null);
  const s1 = mgr.schemaCheck(fakeDb(1));
  const s2 = mgr.schemaCheck(fakeDb(2));
  const s3 = mgr.schemaCheck(fakeDb(3));
  const s4 = mgr.schemaCheck(fakeDb(4));
  check('hold', 'schema 1 passes and schemas 2, 3, and 4 fail closed', s1.ok === true && s1.supported === 1 && s2.ok === false && s3.ok === false && s4.ok === false, { s1: s1.schemaVersion, s4: s4.schemaVersion });
  const blocked = UC.compatCheck(manifest({ dbSchemaVersion: 4 }), s4, PROD);
  const g = UC.gate({ manifest: manifest({ dbSchemaVersion: 4 }), verified: true, current: '1.1.2', installed: PROD, compat: blocked, backup: { verified: true }, approval: { manifestSha256: 'h' }, manifestSha256: 'h', now: WHEN });
  check('hold', 'a live schema above the cap blocks the install gate', blocked.ok === false && g.allowed === false && /не поддерживается|совместимости/.test(g.reasons.join(' ')), null);
}

function flagsAndIdentity() {
  const envOff = {};
  const uc = UC.createUpdateCenter({ dir: tmp(), current: '1.1.2', identity: PROD, env: envOff, healthUrl: 'http://127.0.0.1:1/api/health', fetchImpl: async () => { throw new Error('sent'); } });
  check('hold', 'the four auto-install flags default off', uc.flags.autoInstall === false && uc.flags.signatureReady === false && uc.flags.backupReady === false && uc.flags.rollbackTestedOnRealMac === false && uc.status().autoInstall.enabled === false, null);
  const enabledValues = [];
  for (const v of ['true', 'yes', 'on', '0', '']) {
    const on = UC.createUpdateCenter({
      dir: tmp(), current: '1.1.2', identity: PROD, healthUrl: 'http://127.0.0.1:1/api/health', fetchImpl: async () => { throw new Error('sent'); },
      env: { OPS_UPDATE_AUTO_INSTALL: v, OPS_UPDATE_SIGNATURE_READY: v, OPS_UPDATE_BACKUP_VERIFIED_READY: v, OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: v },
    });
    if (on.status().autoInstall.enabled) enabledValues.push(v);
  }
  check('hold', 'true, yes, on, 0, and an empty string leave auto-install off', enabledValues.length === 0, { enabledValues });
  const ones = UC.createUpdateCenter({
    dir: tmp(), current: '1.1.2', identity: PROD, healthUrl: 'http://127.0.0.1:1/api/health', fetchImpl: async () => { throw new Error('sent'); },
    env: { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1' },
  });
  check('hold', 'the string 1 turns the four flags on and the empty prod ring still blocks auto-install', ones.flags.autoInstall === true && ones.status().signature.state === 'BLOCKED', null);

  check('hold', 'a prod bundle id is the prod profile and a test bundle id is the test profile', PROD.known === true && PROD.flavor === 'prod' && TEST.known === true && TEST.flavor === 'test' && TEST.appPath.endsWith('TEST.app'), null);
  const clash = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio.test', STUDIO_FLAVOR: 'prod' }, startDirs: [] });
  check('hold', 'a flavor that contradicts the bundle id is not a known identity', clash.known === false && clash.flavor === 'test', null);

  const desk = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8');
  check('hold', 'Electron checkUpdates stays false', /checkUpdates:\s*false/.test(desk) && !/electron-updater/.test(desk), null);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('hold', 'the mac build identity is still null and Gatekeeper assess is false', pkg.build.mac.identity === null && pkg.build.mac.hardenedRuntime === false && pkg.build.mac.gatekeeperAssess === false && pkg.build.appId === 'com.moonkatty.aistudio', null);
}

function ignorePatterns() {
  const names = [
    'foo.key', 'foo.p8', 'foo.p12', 'foo.pfx', 'foo.priv', 'foo.priv.pem', 'myprivate.pem', 'mysecret.pem',
    'release-prod-abcdef.key', 'lib/ops/update-keys/stub-test-ed25519.pub.pem', 'owner.pem', 'id_ed25519', 'lib/ops/owner.pem',
  ];
  const out = spawnGit(['check-ignore', '-v', '--no-index', '--', ...names]);
  const ignored = new Set();
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const pattern = line.slice(0, tab).split(':').slice(2).join(':');
    const file = line.slice(tab + 1).trim();
    if (!file || pattern.startsWith('!')) continue;
    ignored.add(file);
  }
  const must = ['foo.key', 'foo.p8', 'foo.p12', 'foo.pfx', 'foo.priv', 'foo.priv.pem', 'myprivate.pem', 'mysecret.pem', 'release-prod-abcdef.key'];
  check('hold', 'gitignore excludes the documented private-key names', must.every(n => ignored.has(n)) && !ignored.has('lib/ops/update-keys/stub-test-ed25519.pub.pem'), { ignored: [...ignored] });
  check('residual', 'gitignore does not exclude owner.pem or id_ed25519', !ignored.has('owner.pem') && !ignored.has('id_ed25519') && !ignored.has('lib/ops/owner.pem'), null);
  const files = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).build.files;
  const need = ['!**/*.key', '!**/*.p8', '!**/*.p12', '!**/*.pfx', '!**/*.priv', '!**/*.priv.pem', '!**/*private*.pem', '!**/*secret*.pem'];
  check('hold', 'build.files excludes the documented private-key globs', need.every(p => files.includes(p)), null);
  check('residual', 'build.files has no glob for a private key named owner.pem', !files.some(p => p.includes('owner.pem') || p === '!**/*.pem'), null);
}

function spawnGit(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

async function httpAndIsolation() {
  const signer = pair();
  const mb = Buffer.from(JSON.stringify(manifest({ channel: 'stable', version: '1.3.0' })));
  const sig = Buffer.from(JSON.stringify({ v: 1, alg: 'ed25519', keyId: signer.id, sig: crypto.sign(null, mb, signer.keys.privateKey).toString('base64') }));
  const zipName = 'MOONKATTY-AI-STUDIO-1.3.0-arm64-mac.zip';
  const files = { 'release-manifest.json': mb, 'release-manifest.json.sig': sig, [zipName]: Buffer.from('zip') };
  const rel = { tag_name: 'v1.3.0', name: 'v1.3.0', prerelease: false, draft: false, published_at: '2026-10-21T00:00:00Z', body: '', assets: Object.entries(files).map(([n, b]) => ({ name: n, size: b.length, browser_download_url: `https://github.com/moonkattymky/moonkatty-ai-studio/releases/download/v1.3.0/${n}` })) };
  const fetchImpl = async url => {
    const u = new URL(url);
    const resp = (status, body, headers = {}) => ({ status, ok: status < 300, headers: { get: k => headers[k.toLowerCase()] || null }, arrayBuffer: async () => body, body: { async *[Symbol.asyncIterator]() { yield body; } } });
    if (u.hostname === 'api.github.com') return resp(200, Buffer.from(JSON.stringify([rel])));
    if (u.hostname === 'github.com') return resp(302, Buffer.alloc(0), { location: 'https://objects.githubusercontent.com/x/' + path.basename(u.pathname) });
    const b = files[decodeURIComponent(path.basename(u.pathname))];
    return b ? resp(200, b) : resp(404, Buffer.alloc(0));
  };
  const empty = UC.createUpdateCenter({ dir: tmp(), current: '1.1.2', identity: PROD, env: {}, healthUrl: 'http://127.0.0.1:18971/api/health', fetchImpl });
  const checked = await empty.check();
  let dl = '';
  try { empty.prepareDownload('v1.3.0'); } catch (e) { dl = e.code; }
  let missing = '';
  try { empty.prepareDownload('v9.9.9'); } catch (e) { missing = e.code; }
  let auto = '';
  const armed = UC.createUpdateCenter({
    dir: tmp(), current: '1.1.2', identity: PROD, healthUrl: 'http://127.0.0.1:18971/api/health', fetchImpl,
    env: { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1' },
  });
  await armed.check();
  try { await armed.autoInstall('v1.3.0'); } catch (e) { auto = e.code; }
  const relRow = (checked.releases || []).find(r => r.tag === 'v1.3.0');
  check('hold', 'an empty prod ring blocks download and auto-install in process', empty.status().signature.state === 'BLOCKED' && empty.status().signature.message === UC.BLOCKED_NO_KEY && relRow && relRow.verified === false && dl === 'UNVERIFIED' && missing === 'NOT_FOUND' && auto === 'SIGNATURE_BLOCKED', { dl, missing, auto, verified: relRow && relRow.verified });

  const testKey = pair();
  const dir = tmp();
  pemFile(dir, 't.pub.pem', testKey.pub);
  writeRing(dir, { [testKey.id]: { file: 't.pub.pem', set: 'test', status: 'active' } });
  const body = Buffer.from(JSON.stringify(manifest({
    channel: 'test', version: '1.3.0-test', bundleId: PROD.bundleId, appName: PROD.appName, dataDirName: PROD.dataDirName,
    launchdLabel: PROD.launchdLabel, keychainServicePrefix: PROD.keychainServicePrefix, isolated: false, isolatedFrom: [],
    dbSchemaVersion: 1,
  })));
  const testSig = crypto.sign(null, body, testKey.keys.privateKey);
  const sigBuf = Buffer.from(JSON.stringify({ v: 1, alg: 'ed25519', keyId: testKey.id, sig: testSig.toString('base64') }));
  const kr = UC.loadKeyrings({ env: { OPS_UPDATE_KEYRING_DIR: dir } });
  const verified = UC.verifySig(body, sigBuf, kr, 'test');
  const plan = UC.gate({
    manifest: JSON.parse(body.toString()), verified: verified.ok, current: '1.2.2', installed: TEST, compat: { ok: true },
    backup: { verified: true }, approval: { manifestSha256: 'h' }, manifestSha256: 'h', tag: 'v1.3.0-test', now: WHEN,
  });
  check('hold', 'a test signature on a manifest with prod ids does not install', verified.ok === true && plan.allowed === false && plan.mode === 'blocked' && /идентичность/.test(plan.reasons.join(' ')), { verified: verified.ok, allowed: plan.allowed, mode: plan.mode });

  const prodPlan = UC.gate({
    manifest: JSON.parse(body.toString()), verified: verified.ok, current: '1.2.2', installed: PROD, compat: { ok: true },
    backup: { verified: true }, now: WHEN, tag: 'v1.3.0-test',
  });
  check('hold', 'that same manifest does not replace the prod app', prodPlan.allowed === false && prodPlan.mode === 'blocked' && prodPlan.target !== PROD.appPath, { mode: prodPlan.mode });

  const s = await startServer({ port: 18971, env: { STUDIO_OPS_UPDATE: '1', STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio' } });
  try {
    const health = await s.j('GET', '/api/health', s.R);
    const tasks = await s.j('GET', '/api/tasks');
    const ops = await s.j('GET', '/api/ops/status');
    const st = await s.j('GET', '/api/ops/update-center');
    const down = await s.j('POST', '/api/ops/update-center/v1.3.0-mac-preview/download', s.A, {});
    const autoHttp = await s.j('POST', '/api/ops/update-center/v1.3.0-mac-preview/auto-install', s.A, {});
    const runtime = await s.j('GET', '/api/runtime');
    check('hold', 'with signature BLOCKED, health, tasks, and runtime still answer', health.status === 200 && health.body.ok === true && tasks.status === 200 && Array.isArray(tasks.body) && runtime.status === 200 && ops.body.flags.update === true, { health: health.status, tasks: tasks.status, runtime: runtime.status });
    check('hold', 'the update-center route reports BLOCKED and download is refused', st.status === 200 && st.body.signature.state === 'BLOCKED' && st.body.signature.message === UC.BLOCKED_NO_KEY && st.body.autoInstall.enabled === false && (down.status === 400 || down.status === 404) && autoHttp.status === 400, { down: down.status, auto: autoHttp.status, sig: st.body.signature && st.body.signature.state });
  } finally {
    await s.cleanup();
  }
}

async function main() {
  const dirty = spawnGit(['status', '--short']).trim();
  if (dirty) throw new Error('product worktree is dirty before the attack');
  keyringAttacks();
  ageAndSchema();
  flagsAndIdentity();
  ignorePatterns();
  await httpAndIsolation();
  const failed = results.filter(row => !row.ok);
  const body = JSON.stringify({ controls: results.length, failed: failed.map(row => row.name), findings, results }, null, 2);
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(body) || body.includes(PASS)) throw new Error('attack log would contain key material');
  fs.writeFileSync(path.join(OUT, 'attack.json'), body);
  console.log(JSON.stringify({ controls: results.length, failed: failed.length, findings: findings.length }));
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
