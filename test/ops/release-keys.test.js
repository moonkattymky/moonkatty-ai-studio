'use strict';
// Release-key integration tests (v1.3.0-test): keys are generated at test runtime only (tmp dir, outside the repo) with
// scripts/release-keygen.mjs + release-sign.mjs; nothing secret is committed. Covers: valid sig accepted, tampered package /
// tampered manifest rejected, wrong keyId / revoked key rejected, empty prod keyring => BLOCKED fail-closed, auto-install off by default,
// owner keyring via OPS_UPDATE_KEYRING_DIR, and a scan proving no private key material is in git or in the packaged file list.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'); const { execFileSync } = require('child_process');
const UC = require('../../lib/ops/update-center.js'); const AI = require('../../lib/ops/app-identity.js');
const ROOT = path.join(__dirname, '../..'); const REPO = 'moonkattymky/moonkatty-ai-studio', APP = 'MOONKATTY AI STUDIO';
const sha = b => crypto.createHash('sha256').update(b).digest('hex'); const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rk-'));
const PASS = crypto.randomBytes(18).toString('base64'); // runtime-only test passphrase
const PROD = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio' }, startDirs: [] });

function keygen(channel = 'prod') { const out = path.join(tmp(), 'keys');
  const j = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/release-keygen.mjs'), '--channel', channel, '--out', out, '--json'], { env: { ...process.env, RELEASE_KEY_PASSPHRASE: PASS } }));
  assert.equal(fs.statSync(j.privateKeyFile).mode & 0o777, 0o600, 'private key must be chmod 600'); return j; }
function ownerKeyringDir(k, extra = {}) { const d = tmp(); fs.chmodSync(d, 0o700); fs.copyFileSync(k.publicKeyFile, path.join(d, path.basename(k.publicKeyFile)));
  fs.writeFileSync(path.join(d, 'keyring.json'), JSON.stringify({ version: 1, keys: { [k.keyId]: { ...k.keyringEntry, status: 'active' } }, revoked: [], ...extra })); return d; }
function sign(k, manifestBuf) { const d = tmp(), mf = path.join(d, 'release-manifest.json'); fs.writeFileSync(mf, manifestBuf);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/release-sign.mjs'), '--key', k.privateKeyFile, '--manifest', mf], { env: { ...process.env, RELEASE_KEY_PASSPHRASE: PASS }, stdio: 'pipe' });
  return fs.readFileSync(mf + '.sig'); }
function zip(names) { const locals = [], cds = []; let off = 0;
  for (const n of names) { const nb = Buffer.from(n), data = Buffer.from(n.endsWith('/') ? '' : 'x');
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28);
    c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(off, 42); locals.push(l, nb, data); cds.push(c, nb); off += 30 + nb.length + data.length; }
  const cd = Buffer.concat(cds), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(names.length, 8); e.writeUInt16LE(names.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]); }
function release({ version = '1.3.0', noBuiltAt = false, builtAt, assetVersion, signWith, tamperArchive = false, tamperManifest = false, sigOverride } = {}) {
  const archive = zip([APP + '.app/', APP + '.app/Contents/', APP + '.app/Contents/Info.plist']); const name = `MOONKATTY-AI-STUDIO-${assetVersion || version}-arm64-mac.zip`, tag = `v${version}-mac-preview`;
  const m = { manifestVersion: 1, version, channel: 'preview', sourceCommit: 'a'.repeat(40), arch: 'arm64', platform: 'darwin', bundleId: 'com.moonkatty.aistudio', appName: APP, dataDirName: APP,
    launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: APP, defaultPort: 8787, dbSchemaVersion: 3, minUpgradeFrom: '1.1.2', isolated: false, isolatedFrom: [], signing: 'adhoc', notarized: false,
    ...(noBuiltAt ? {} : { builtAt: builtAt || new Date().toISOString() }), assets: [{ name, size: archive.length, sha256: sha(archive) }] };
  let mb = Buffer.from(JSON.stringify(m)); const sig = sigOverride || (signWith ? sign(signWith, mb) : Buffer.alloc(0));
  if (tamperManifest) mb = Buffer.from(JSON.stringify({ ...m, minUpgradeFrom: '1.0.0' })); // bytes changed after signing
  const arc = tamperArchive ? Buffer.from(archive) : archive; if (tamperArchive) arc[arc.length - 30] ^= 0xff; // modified package bytes
  const files = { [name]: arc, 'release-manifest.json': mb, 'release-manifest.json.sig': sig };
  return { tag, files, rel: { tag_name: tag, name: tag, prerelease: true, draft: false, published_at: new Date().toISOString(), body: '',
    assets: Object.entries(files).map(([n, b]) => ({ name: n, size: b.length, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${n}` })) } };
}
function fake(r) { const resp = (status, body, h = {}) => ({ status, ok: status < 300, headers: { get: k => h[k.toLowerCase()] ?? null }, arrayBuffer: async () => body, body: { async *[Symbol.asyncIterator]() { yield body; } } });
  return async url => { const u = new URL(url); if (u.hostname === 'api.github.com') return resp(200, Buffer.from(JSON.stringify([r.rel])));
    if (u.hostname === 'github.com') return resp(302, Buffer.alloc(0), { location: 'https://objects.githubusercontent.com/x/' + path.basename(u.pathname) });
    const b = r.files[decodeURIComponent(path.basename(u.pathname))]; return b ? resp(200, b) : resp(404, Buffer.alloc(0)); }; }
const center = (r, env = {}) => UC.createUpdateCenter({ dir: tmp(), current: '1.2.2', fetchImpl: fake(r), identity: PROD, env, healthUrl: 'http://127.0.0.1:1/api/health' });

test('auto-update flags are OFF by default (all four unset) and auto-install refuses', async () => {
  const uc = center(release(), {}); assert.deepEqual([uc.flags.autoInstall, uc.flags.signatureReady, uc.flags.backupReady, uc.flags.rollbackTestedOnRealMac], [false, false, false, false]);
  const a = uc.status().autoInstall; assert.equal(a.enabled, false); assert.deepEqual(a.missing.sort(), ['OPS_UPDATE_AUTO_INSTALL', 'OPS_UPDATE_BACKUP_VERIFIED_READY', 'OPS_UPDATE_ROLLBACK_TESTED_ON_MAC', 'OPS_UPDATE_SIGNATURE_READY']);
  await assert.rejects(uc.autoInstall('v1.3.0-mac-preview'), { code: 'AUTO_INSTALL_DISABLED' });
  for (const v of ['true', 'yes', 'on', '0', '']) assert.equal(center(release(), { OPS_UPDATE_AUTO_INSTALL: v, OPS_UPDATE_SIGNATURE_READY: v, OPS_UPDATE_BACKUP_VERIFIED_READY: v, OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: v }).status().autoInstall.enabled, false, 'only "1" enables');
  const desk = fs.readFileSync(path.join(ROOT, 'desktop/main.js'), 'utf8'); assert.match(desk, /checkUpdates: false/); assert.doesNotMatch(desk, /electron-updater/);
});

test('empty prod keyring => BLOCKED: нет публичного ключа владельца (fail-closed), status/page still work', async () => {
  const k = keygen(); const r = release({ signWith: k }); const uc = center(r); // repo keyring: prod set empty
  const st = uc.status(); assert.equal(st.signature.state, 'BLOCKED'); assert.equal(st.signature.message, 'BLOCKED: нет публичного ключа владельца'); assert.equal(st.signature.failClosed, true);
  const c = await uc.check(); const rel = c.releases[0]; assert.equal(rel.verified, false); assert.ok(rel.problems.includes(UC.BLOCKED_NO_KEY), rel.problems.join('; '));
  assert.throws(() => uc.prepareDownload(r.tag), { code: 'UNVERIFIED' }); assert.equal(uc.installPlan(r.tag).allowed, false);
  const all = center(r, { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1' });
  await all.check(); await assert.rejects(all.autoInstall(r.tag), { code: 'SIGNATURE_BLOCKED' });
  const ui = fs.readFileSync(path.join(ROOT, 'public/update-ui.js'), 'utf8'); assert.match(ui, /ucSigStatus/); assert.match(ui, /U\.signature\.message/);
});

test('owner public key via OPS_UPDATE_KEYRING_DIR: valid signature accepted, download verified, still manual install only', async () => {
  const k = keygen(); const r = release({ signWith: k }); const env = { OPS_UPDATE_KEYRING_DIR: ownerKeyringDir(k) }; const uc = center(r, env);
  assert.equal(uc.status().signature.state, 'READY'); const rel = (await uc.check()).releases[0]; assert.equal(rel.verified, true, rel.problems.join('; ')); assert.equal(rel.keyId, k.keyId);
  const d = await uc.download(r.tag); assert.equal(d.status, 'verified'); const p = uc.installPlan(r.tag); assert.equal(p.manual, true); assert.equal(p.autoInstall.enabled, false);
  await assert.rejects(uc.autoInstall(r.tag), { code: 'AUTO_INSTALL_DISABLED' });
});

test('tampered package (modified bytes) is rejected and deleted', async () => {
  const k = keygen(); const r = release({ signWith: k, tamperArchive: true }); const uc = center(r, { OPS_UPDATE_KEYRING_DIR: ownerKeyringDir(k) });
  assert.equal((await uc.check()).releases[0].verified, true); await assert.rejects(uc.download(r.tag), { code: 'HASH_MISMATCH' }); assert.equal(uc.status().releases[0].download.status, 'failed');
});

test('tampered manifest (bytes changed after signing) is rejected', async () => {
  const k = keygen(); const r = release({ signWith: k, tamperManifest: true }); const uc = center(r, { OPS_UPDATE_KEYRING_DIR: ownerKeyringDir(k) });
  const rel = (await uc.check()).releases[0]; assert.equal(rel.verified, false); assert.match(rel.problems.join(), /не прошла проверку/); assert.throws(() => uc.prepareDownload(r.tag), { code: 'UNVERIFIED' });
});

test('wrong keyId, unknown key and revoked key are rejected', async () => {
  const k = keygen(), other = keygen(); const dir = ownerKeyringDir(k);
  const good = release({ signWith: k }); const s = JSON.parse(good.files['release-manifest.json.sig']);
  const wrongId = release({ sigOverride: Buffer.from(JSON.stringify({ ...s, keyId: other.keyId })) }); // claims another keyId
  let rel = (await center(wrongId, { OPS_UPDATE_KEYRING_DIR: dir }).check()).releases[0]; assert.equal(rel.verified, false);
  rel = (await center(release({ signWith: other }), { OPS_UPDATE_KEYRING_DIR: dir }).check()).releases[0]; assert.equal(rel.verified, false); assert.match(rel.problems.join(), /не входит в доверенный набор/);
  const revDir = ownerKeyringDir(k, { revoked: [k.keyId] }); rel = (await center(good, { OPS_UPDATE_KEYRING_DIR: revDir }).check()).releases[0];
  assert.equal(rel.verified, false); assert.match(rel.problems.join(), /BLOCKED|отозван/);
  const noId = release({ sigOverride: Buffer.from(JSON.stringify({ v: 1, alg: 'ed25519', sig: s.sig })) }); rel = (await center(noId, { OPS_UPDATE_KEYRING_DIR: dir }).check()).releases[0]; assert.equal(rel.verified, false);
});

test('keyring refuses private key material (only public keys can be configured)', () => {
  const k = keygen(); const d = tmp(); fs.copyFileSync(k.privateKeyFile, path.join(d, 'oops.pub.pem'));
  fs.writeFileSync(path.join(d, 'keyring.json'), JSON.stringify({ keys: { [k.keyId]: { file: 'oops.pub.pem', set: 'prod', status: 'active' } } }));
  const kr = UC.loadKeyrings({ env: { OPS_UPDATE_KEYRING_DIR: d } }); assert.equal(kr.prod.size, 0); assert.match(kr.problems.join(), /ПРИВАТНЫЙ/);
  assert.equal(UC.signatureStatus(kr).state, 'BLOCKED');
});

test('QA-UC-006: signed builtAt is used for the max-age check (republished old bytes stay blocked)', () => {
  const m = { ...JSON.parse(release().files['release-manifest.json']), builtAt: '2020-01-01T00:00:00Z' };
  const g = UC.gate({ manifest: m, verified: true, current: '1.2.2', installed: PROD, compat: { ok: true }, backup: { verified: true }, approval: { manifestSha256: 'h' }, manifestSha256: 'h', publishedAt: new Date().toISOString() });
  assert.equal(g.allowed, false); assert.match(g.reasons.join(), /replay/);
});

test('no private key material in git or in the packaged file list; ignore/exclude patterns present', () => {
  const PRIV = UC.PRIVATE_RE; const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString().split('\0').filter(Boolean);
  const bad = files.filter(f => /\.(key|p8|p12|pfx|priv)$/i.test(f) || /private.*\.pem$/i.test(f) || (fs.existsSync(path.join(ROOT, f)) && fs.statSync(path.join(ROOT, f)).size < 5e6 && PRIV.test(fs.readFileSync(path.join(ROOT, f), 'latin1'))));
  assert.deepEqual(bad, [], 'private key material tracked in git');
  const pkg = require('../../package.json'); for (const p of ['!**/*.key', '!**/*.p12', '!**/*private*.pem']) assert.ok(pkg.build.files.includes(p), 'build.files must exclude ' + p);
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'); for (const p of ['*.key', '*.p12', '*private*.pem']) assert.ok(gi.split('\n').includes(p), '.gitignore must contain ' + p);
  // everything electron-builder would package (include globs) must be free of private keys
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const packaged = ['ops', 'lib', 'public', 'desktop'].flatMap(d => walk(path.join(ROOT, d))).concat(['package.json', 'server.js', 'meta.js', 'runner.js'].map(f => path.join(ROOT, f)));
  assert.deepEqual(packaged.filter(f => fs.statSync(f).size < 5e6 && PRIV.test(fs.readFileSync(f, 'latin1'))).map(f => path.relative(ROOT, f)), []);
  for (const f of fs.readdirSync(path.join(ROOT, 'lib/ops/update-keys'))) assert.ok(/\.pub\.pem$|^keyring\.json$|^README\.md$/.test(f), 'unexpected file in update-keys: ' + f);
});

// ---------- QA-UC-007: external keyring dir is fail-closed ----------
const UID = typeof process.getuid === 'function' ? process.getuid() : 0;
const ext = (d, uid = UID) => UC.loadKeyrings({ env: { OPS_UPDATE_KEYRING_DIR: d }, uid });
test('QA-UC-007: correct 0700 dir owned by current uid -> READY', () => {
  const k = keygen(); const d = ownerKeyringDir(k); fs.chmodSync(d, 0o700); const kr = ext(d); assert.equal(UC.signatureStatus(kr).state, 'READY', kr.problems.join('; '));
});
test('QA-UC-007: 0777 / 0750 dir -> BLOCKED', () => {
  const k = keygen(); for (const mode of [0o777, 0o750, 0o701]) { const d = ownerKeyringDir(k); fs.chmodSync(d, mode); const st = UC.signatureStatus(ext(d));
    assert.equal(st.state, 'BLOCKED'); assert.match(st.message, /права папки .* нужны 700/); }
});
test('QA-UC-007: wrong owner (injected uid) -> BLOCKED', () => {
  const k = keygen(); const d = ownerKeyringDir(k); const st = UC.signatureStatus(ext(d, UID + 4242)); assert.equal(st.state, 'BLOCKED'); assert.match(st.message, /владелец папки/);
});
test('QA-UC-007: symlinked pub key pointing outside the dir -> BLOCKED; symlinked keyring.json -> BLOCKED', () => {
  const k = keygen(); const d = ownerKeyringDir(k); const pub = path.join(d, path.basename(k.publicKeyFile)); fs.rmSync(pub); fs.symlinkSync(k.publicKeyFile, pub);
  let st = UC.signatureStatus(ext(d)); assert.equal(st.state, 'BLOCKED'); assert.match(st.message, /символическая ссылка/);
  const d2 = ownerKeyringDir(k); const outside = path.join(tmp(), 'keyring.json'); fs.renameSync(path.join(d2, 'keyring.json'), outside); fs.symlinkSync(outside, path.join(d2, 'keyring.json'));
  st = UC.signatureStatus(ext(d2)); assert.equal(st.state, 'BLOCKED'); assert.match(st.message, /keyring\.json: символическая ссылка/);
});
test('QA-UC-007: symlinked dir -> BLOCKED, and a BLOCKED keyring rejects even a valid signature', async () => {
  const k = keygen(); const d = ownerKeyringDir(k); const link = path.join(tmp(), 'kr-link'); fs.symlinkSync(d, link);
  const st = UC.signatureStatus(ext(link)); assert.equal(st.state, 'BLOCKED'); assert.match(st.message, /символическая ссылка/);
  const r = release({ signWith: k }); const uc = center(r, { OPS_UPDATE_KEYRING_DIR: link }); assert.equal(uc.status().signature.state, 'BLOCKED');
  const rel = (await uc.check()).releases[0]; assert.equal(rel.verified, false); assert.match(rel.problems.join(), /BLOCKED: внешний keyring/);
});
test('QA-UC-006: manifest without signed builtAt is not verified and download is refused', async () => {
  const k = keygen(); const r = release({ signWith: k, noBuiltAt: true }); const uc = center(r, { OPS_UPDATE_KEYRING_DIR: ownerKeyringDir(k) });
  const rel = (await uc.check()).releases[0]; assert.equal(rel.verified, false); assert.match(rel.problems.join(), /builtAt/); assert.throws(() => uc.prepareDownload(r.tag), { code: 'UNVERIFIED' });
  assert.ok(UC.validateManifest({ ...JSON.parse(release().files['release-manifest.json']), builtAt: 'not-a-date' }).some(x => /builtAt/.test(x)));
});
test('release-sign.mjs writes builtAt into the manifest before signing (signature covers it)', () => {
  const k = keygen(); const d = tmp(), mf = path.join(d, 'release-manifest.json'); fs.writeFileSync(mf, JSON.stringify({ channel: 'preview', version: '1.3.0' }));
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/release-sign.mjs'), '--key', k.privateKeyFile, '--manifest', mf], { env: { ...process.env, RELEASE_KEY_PASSPHRASE: PASS }, stdio: 'pipe' });
  const mb = fs.readFileSync(mf); const m = JSON.parse(mb); assert.ok(Number.isFinite(Date.parse(m.builtAt)));
  const s = JSON.parse(fs.readFileSync(mf + '.sig')); assert.ok(crypto.verify(null, mb, crypto.createPublicKey(fs.readFileSync(k.publicKeyFile)), Buffer.from(s.sig, 'base64')));
});

// ---------- signed version policy / anti-rollback ----------
const centerAt = (r, env, o = {}) => UC.createUpdateCenter({ dir: tmp(), current: o.current || '1.2.2', fetchImpl: fake(r), identity: PROD, env, currentBuiltAt: o.currentBuiltAt ?? null, healthUrl: 'http://127.0.0.1:1/api/health' });
const firstRel = async (r, k, o) => { const uc = centerAt(r, { OPS_UPDATE_KEYRING_DIR: ownerKeyringDir(k) }, o); const rel = (await uc.check()).releases[0]; return { uc, rel }; };
test('signed version: tampered version (manifest bytes changed after signing) is rejected', async () => {
  const k = keygen(); const r = release({ signWith: k }); const m = JSON.parse(r.files['release-manifest.json']);
  r.files['release-manifest.json'] = Buffer.from(JSON.stringify({ ...m, version: '9.9.9' })); const { uc, rel } = await firstRel(r, k);
  assert.equal(rel.verified, false); assert.throws(() => uc.prepareDownload(r.tag), { code: 'UNVERIFIED' });
});
test('signed version must match tag and package name', async () => {
  const k = keygen(); const r = release({ signWith: k, version: '1.3.0' }); r.rel.tag_name = r.tag = 'v1.4.0-mac-preview';
  assert.equal((await firstRel(r, k)).rel.verified, false);
  const r2 = release({ signWith: k, version: '1.3.0', assetVersion: '1.4.0' }); const { rel } = await firstRel(r2, k); assert.equal(rel.verified, false); assert.match(rel.problems.join(), /не соответствует подписанной версии/);
});
test('anti-rollback: downgrade and equal version vs current are rejected', async () => {
  const k = keygen();
  let { rel } = await firstRel(release({ signWith: k, version: '1.2.1' }), k, { current: '1.2.2' }); assert.equal(rel.verified, false); assert.match(rel.problems.join(), /anti-rollback.*старше/);
  ({ rel } = await firstRel(release({ signWith: k, version: '1.2.2' }), k, { current: '1.2.2' })); assert.equal(rel.verified, false); assert.match(rel.problems.join(), /anti-rollback.*равна/);
  ({ rel } = await firstRel(release({ signWith: k, version: '1.3.0' }), k, { current: '1.2.2' })); assert.equal(rel.verified, true, rel.problems.join('; '));
});
test('builtAt: future beyond skew rejected; older than current build rejected; missing rejected', async () => {
  const k = keygen();
  let { rel } = await firstRel(release({ signWith: k, builtAt: new Date(Date.now() + 3600e3).toISOString() }), k); assert.equal(rel.verified, false); assert.match(rel.problems.join(), /в будущем/);
  ({ rel } = await firstRel(release({ signWith: k, builtAt: new Date(Date.now() + 60e3).toISOString() }), k)); assert.equal(rel.verified, true, 'within 5 min skew: ' + rel.problems.join('; '));
  ({ rel } = await firstRel(release({ signWith: k, builtAt: '2026-01-01T00:00:00Z' }), k, { currentBuiltAt: '2026-06-01T00:00:00Z' })); assert.equal(rel.verified, false); assert.match(rel.problems.join(), /старше сборки текущего/);
  ({ rel } = await firstRel(release({ signWith: k, noBuiltAt: true }), k)); assert.equal(rel.verified, false); assert.match(rel.problems.join(), /builtAt/);
});
test('auto-download / auto-install stay off: check() never downloads, no timers', async () => {
  const k = keygen(); const r = release({ signWith: k }); const { uc } = await firstRel(r, k); assert.equal(uc.status().releases[0].download, null); assert.equal(uc.status().autoInstall.enabled, false);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib/ops/update-center.js'), 'utf8'), /setInterval/);
});
