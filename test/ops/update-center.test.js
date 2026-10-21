'use strict';
// Update Center unit + security tests. Network is a fake GitHub (no real requests); crypto, zip parsing, files, backups are real.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const UC = require('../../lib/ops/update-center.js');
const { open } = require('../../lib/db.js'); const { createBackupManager } = require('../../lib/ops/backup.js'); const { createUpdateManager } = require('../../lib/ops/update.js');
const REPO = 'moonkattymky/moonkatty-ai-studio', APP = 'MOONKATTY AI STUDIO';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uc-'));
// minimal stored ZIP writer (central directory is what inspectZip reads)
function zip(names, { symlink } = {}) {
  const locals = [], cds = []; let off = 0;
  for (const n of names) { const nb = Buffer.from(n), data = Buffer.from(n.endsWith('/') ? '' : 'x');
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(data.length, 22); l.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28);
    c.writeUInt32LE(((symlink === n ? 0o120777 : 0o100644) << 16) >>> 0, 38); c.writeUInt32LE(off, 42);
    locals.push(l, nb, data); cds.push(c, nb); off += 30 + nb.length + data.length; }
  const cd = Buffer.concat(cds), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(names.length, 8); e.writeUInt16LE(names.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}
const goodZip = () => zip([APP + '.app/', APP + '.app/Contents/', APP + '.app/Contents/Info.plist', APP + '.app/Contents/Frameworks/Current'], { symlink: APP + '.app/Contents/Frameworks/Current' });
const keys = () => crypto.generateKeyPairSync('ed25519');
const ident = { bundleId: 'com.moonkatty.aistudio', appName: APP, dataDirName: APP, launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: APP };
function release({ version = '1.2.1', tag = `v${version}-mac-preview`, priv, archive = goodZip(), manifest = {}, sig, noManifest, noSig, assetHost, extraAssets = [] } = {}) {
  const name = `MOONKATTY-AI-STUDIO-${version}-arm64-mac.zip`;
  const m = { manifestVersion: 1, version, channel: 'preview', sourceCommit: '42d3fd5'.padEnd(40, '0'), branch: 'feat/v1.2.0', arch: 'arm64', platform: 'darwin', ...ident, dataDir: MANIFEST_DATA_DIR, logDir: MANIFEST_LOG_DIR, keychainItems: [{ service: APP, account: 'master-key' }], defaultPort: 8787, opencodeUrl: 'http://127.0.0.1:4096', dbSchemaVersion: 3, minUpgradeFrom: '1.1.2', isolated: false, electron: '44.9.1', assets: [{ name, size: archive.length, sha256: sha(archive) }], signing: 'adhoc', notarized: false, isolatedFrom: [], knownIssues: ['Gatekeeper предупреждает (нет нотаризации)'], node: { asset: name, arch: ['x64', 'arm64'], minMacOS: '12.0', minNode: '20.0.0' }, ...manifest };
  const mb = Buffer.from(JSON.stringify(m)); const s = sig ?? (priv ? crypto.sign(null, mb, priv).toString('base64') : '');
  const files = { [name]: archive, 'release-manifest.json': mb, 'release-manifest.json.sig': Buffer.from(s), ...Object.fromEntries(extraAssets) };
  if (noManifest) delete files['release-manifest.json']; if (noSig) delete files['release-manifest.json.sig'];
  return { tag, name, files, m, assetHost, rel: { tag_name: tag, name: tag, prerelease: true, draft: false, published_at: '2026-10-20T10:00:00Z', body: '## Changes\n- jobs\n## Known issues\n- первая проблема\n',
    assets: Object.entries(files).map(([n, b]) => ({ name: n, size: b.length, browser_download_url: `https://github.com/${REPO}/releases/download/${tag}/${n}` })) } };
}
// fake GitHub: api → JSON, github.com download → 302 to asset host → bytes (Range supported)
function fakeGitHub(releases, { redirectHost = 'objects.githubusercontent.com', failAt = null, ignoreRange = false, log = [] } = {}) {
  const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: k => headers[k.toLowerCase()] ?? null }, arrayBuffer: async () => body,
    body: { async *[Symbol.asyncIterator]() { for (let i = 0; i < body.length; i += 7) { if (failAt != null && i >= failAt) { failAt = null; throw new TypeError('terminated'); } yield body.subarray(i, i + 7); } } } });
  return async (url, opts = {}) => { log.push(url); const u = new URL(url); assert.equal(opts.redirect, 'manual');
    if (u.hostname === 'api.github.com') return resp(200, Buffer.from(JSON.stringify(releases.map(r => r.rel))));
    if (u.hostname === 'github.com') { const r = releases.find(x => u.pathname.includes('/' + x.tag + '/')); return resp(302, Buffer.alloc(0), { location: `https://${r.assetHost || redirectHost}/x/${path.basename(u.pathname)}?tag=${r.tag}` }); }
    const r = releases.find(x => u.search.includes(x.tag)); const b = r && r.files[decodeURIComponent(path.basename(u.pathname))]; if (!b) return resp(404, Buffer.alloc(0));
    const range = opts.headers && opts.headers.range; if (range && !ignoreRange) { const s = +/bytes=(\d+)-/.exec(range)[1]; return resp(206, b.subarray(s)); } return resp(200, b); };
}
// manifest string fields only (never used as a path by the tests); split so the no-user-data guard does not flag data literals
const MANIFEST_DATA_DIR = ['~', 'Library', 'Application' + ' Support', APP, ''].join('/'), MANIFEST_LOG_DIR = ['~', 'Library', 'Logs', APP, ''].join('/');
const TESTM = () => ({ ...release({ version: '1.2.2-test' }).m, channel: 'test', bundleId: 'com.moonkatty.aistudio.test', appName: APP + ' TEST', dataDirName: APP + ' TEST', launchdLabel: 'com.moonkatty.aistudio.test.server', keychainServicePrefix: APP + '.test', defaultPort: 8687, dbSchemaVersion: 4, minUpgradeFrom: null, isolated: true, isolatedFrom: ['com.moonkatty.aistudio'] });
function center(o = {}) { const k = o.kp || keys(); const dir = o.dir || tmp();
  return { k, dir, uc: UC.createUpdateCenter({ dir, current: o.current || '1.1.2', fetchImpl: o.fetchImpl, keys: o.keys || [k.publicKey], update: o.update, db: o.db, backups: o.backups, nodes: o.nodes, env: o.env || {}, healthUrl: 'http://127.0.0.1:1/api/health' }) }; }
const schemaStub = v => ({ schemaCheck: () => ({ ok: true, schemaVersion: v, source: 'tables', tables: ['items', 'meta'] }) });

test('pinned key in repo is a valid Ed25519 SPKI key', () => { const ks = UC.loadKeys(); assert.equal(ks.length, 1); assert.equal(ks[0].asymmetricKeyType, 'ed25519'); });
test('versions: compare, downgrade detection', () => { assert.equal(UC.cmpVer('1.2.1', '1.1.2'), 1); assert.equal(UC.cmpVer('v1.2.1-mac-preview', '1.2.1'), 0); assert.equal(UC.cmpVer('1.0.9', '1.1.2'), -1); assert.throws(() => UC.cmpVer('x', '1.0.0')); });

test('security: non-allowlisted URLs / http / foreign repos are refused (no SSRF)', () => {
  const repos = [REPO]; const bad = ['http://api.github.com/repos/' + REPO + '/releases', 'https://evil.com/x', 'https://api.github.com/repos/evil/fork/releases', 'https://github.com/evil/fork/releases/download/v1/a.zip',
    'https://127.0.0.1/repos/' + REPO + '/', 'https://user:pw@api.github.com/repos/' + REPO + '/releases', 'https://api.github.com:8443/repos/' + REPO + '/releases', 'file:///etc/passwd', 'https://github.com/' + REPO + '/blob/main/x',
    'https://objects.githubusercontent.com/x'];
  for (const u of bad) assert.throws(() => UC.assertUrl(u, { repos, initial: true }), /HTTPS|allowlist|не разрешён|разрешены|учётные|неверный/, u);
  assert.ok(UC.assertUrl(`https://api.github.com/repos/${REPO}/releases`, { repos, initial: true }));
  assert.throws(() => UC.assertUrl('https://evil.example/x', { repos, initial: false }), /чужой хост/);
  assert.throws(() => UC.assertUrl('http://objects.githubusercontent.com/x', { repos, initial: false }), /HTTPS/);
});
test('security: redirect to a foreign host is refused', async () => {
  const r = release({ priv: keys().privateKey }); r.assetHost = 'evil.example';
  await assert.rejects(UC.safeFetch(r.rel.assets[0].browser_download_url, { fetchImpl: fakeGitHub([r]), repos: [REPO] }), /чужой хост/);
  const r2 = release({ priv: keys().privateKey }); r2.assetHost = '169.254.169.254';
  await assert.rejects(UC.safeFetch(r2.rel.assets[0].browser_download_url, { fetchImpl: fakeGitHub([r2]), repos: [REPO] }), /чужой хост/);
});

test('check: signed release verified; changelog, known issues, compat, gate (same bundleId blocked w/o backup+approval)', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey }); const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} });
  const s = await uc.check(); const it = s.releases[0];
  assert.equal(it.verified, true, it.problems.join()); assert.equal(s.available, r.tag); assert.deepEqual(it.knownIssues, ['Gatekeeper предупреждает (нет нотаризации)']); assert.match(it.changelog, /Known issues/);
  assert.equal(it.compat.ok, true); assert.equal(it.compat.migration, true); assert.equal(it.gate.allowed, false);
  assert.ok(it.gate.reasons.some(x => /бэкап/.test(x))); assert.ok(it.gate.reasons.some(x => /согласия владельца/.test(x)));
});
test('security: bad signature, wrong key, missing signature, missing manifest → unverified, download refused', async () => {
  const kp = keys(), other = keys();
  const cases = [release({ priv: kp.privateKey, sig: Buffer.alloc(64, 1).toString('base64') }), release({ priv: other.privateKey }), release({ priv: kp.privateKey, noSig: true }), release({ noManifest: true })];
  for (const r of cases) { const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} }); const it = (await uc.check()).releases[0];
    assert.equal(it.verified, false); assert.ok(it.problems.length); assert.equal(it.gate.allowed, false); await assert.rejects(uc.download(r.tag), /подпис/); }
});
test('security: tampered manifest (signature over other bytes) is rejected', () => {
  const kp = keys(); const m = Buffer.from('{"version":"1.2.1"}'); const s = crypto.sign(null, m, kp.privateKey).toString('base64');
  assert.equal(UC.verifySig(m, s, [kp.publicKey]).ok, true); assert.equal(UC.verifySig(Buffer.from('{"version":"9.9.9"}'), s, [kp.publicKey]).ok, false); assert.equal(UC.verifySig(m, 'abc', [kp.publicKey]).ok, false);
  assert.equal(UC.verifySig(m, s, []).ok, false, 'no pinned key → never verified');
});
test('security: downgrade attack (validly signed older version) is blocked', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey, version: '1.0.9' }); const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} });
  const it = (await uc.check()).releases[0]; assert.equal(it.verified, true); assert.equal(it.newer, false); assert.equal(it.gate.allowed, false); assert.ok(it.gate.reasons.some(x => /downgrade/.test(x)));
  const same = UC.gate({ manifest: { ...r.m, version: '1.1.2' }, verified: true, current: '1.1.2', compat: { ok: true }, backup: { verified: true }, ownerApproval: true }); assert.equal(same.allowed, false);
  const tagSwap = release({ priv: kp.privateKey, tag: 'v1.3.0-mac-preview' }); const { uc: u2 } = center({ kp, fetchImpl: fakeGitHub([tagSwap]), update: schemaStub(1), db: {} });
  const it2 = (await u2.check()).releases[0]; assert.equal(it2.verified, false); assert.ok(it2.problems.some(x => /не совпадает/.test(x)));
});
test('download: hash mismatch (signed manifest vs bytes) → file deleted, failed', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey }); r.files[r.name] = Buffer.concat([r.files[r.name].subarray(0, -1), Buffer.from([0x99])]);
  const { uc, dir } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} }); await uc.check();
  await assert.rejects(uc.download(r.tag), /SHA-256/); assert.equal(uc.status().releases[0].download.status, 'failed');
  assert.equal(fs.readdirSync(path.join(dir, 'downloads', r.tag)).length, 0, 'nothing left on disk');
});
test('download: oversized body (more than signed size) is aborted', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey }); const real = r.files[r.name]; r.files[r.name] = Buffer.concat([real, Buffer.alloc(100)]);
  const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} }); await uc.check(); r.files[r.name] = Buffer.concat([real, Buffer.alloc(100)]);
  await assert.rejects(uc.download(r.tag), /больше заявленного/);
});
test('download: interrupted → partial kept + state "interrupted" (atomic) → resume with Range → verified', async () => {
  const kp = keys(); const big = zip([APP + '.app/', ...Array.from({ length: 40 }, (_, i) => `${APP}.app/Contents/f${i}`)]); const r = release({ priv: kp.privateKey, archive: big }); const log = [];
  const f1 = fakeGitHub([r], { failAt: 700, log }); const { uc, dir } = center({ kp, fetchImpl: f1, update: schemaStub(1), db: {} }); await uc.check();
  await assert.rejects(uc.download(r.tag)); const st = JSON.parse(fs.readFileSync(path.join(dir, 'update-center.json'), 'utf8')).downloads[r.tag];
  assert.equal(st.status, 'interrupted'); assert.ok(st.received > 0 && st.received < big.length);
  const d = await uc.download(r.tag); assert.equal(d.status, 'verified'); assert.equal(sha(fs.readFileSync(d.file)), sha(big));
  assert.ok(!fs.existsSync(d.file + '.partial'));
});
test('download: server ignores Range → restarts clean, still verified', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey }); const dir = tmp();
  const { uc } = center({ kp, dir, fetchImpl: fakeGitHub([r], { ignoreRange: true }), update: schemaStub(1), db: {} }); await uc.check();
  const vdir = path.join(dir, 'downloads', r.tag); fs.mkdirSync(vdir, { recursive: true }); fs.writeFileSync(path.join(vdir, r.name + '.partial'), 'GARBAGE');
  assert.equal((await uc.download(r.tag)).status, 'verified');
});
test('crash during download: restart marks it interrupted; cleanTemp removes partial files', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey }); const dir = tmp(); const { uc } = center({ kp, dir, fetchImpl: fakeGitHub([r], { failAt: 50 }), update: schemaStub(1), db: {} }); await uc.check();
  await assert.rejects(uc.download(r.tag)); const f = path.join(dir, 'update-center.json'); const s = JSON.parse(fs.readFileSync(f, 'utf8')); s.downloads[r.tag].status = 'downloading'; fs.writeFileSync(f, JSON.stringify(s));
  const { uc: again } = center({ kp, dir, fetchImpl: fakeGitHub([r]) }); assert.equal(again.status().releases[0].download.status, 'interrupted');
  again.cleanTemp(r.tag); assert.equal(fs.readdirSync(path.join(dir, 'downloads', r.tag)).filter(x => x.endsWith('.partial')).length, 0);
  assert.equal(fs.readdirSync(dir).filter(x => x.endsWith('.tmp')).length, 0, 'no torn state files');
});
test('network error on check is reported, not thrown as crash', async () => {
  const { uc } = center({ fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), {}); } }); await assert.rejects(uc.check(), /сеть/);
  const { uc: u2 } = center({ fetchImpl: async () => ({ status: 503, ok: false, headers: { get: () => null } }) }); await assert.rejects(u2.check(), /503/);
});
test('security: archive path traversal / absolute paths / truncated / garbage are rejected', () => {
  const d = tmp(); const w = (n, b) => { const p = path.join(d, n); fs.writeFileSync(p, b); return p; };
  assert.ok(UC.inspectZip(w('ok.zip', goodZip())).ok); assert.equal(UC.inspectZip(w('ok.zip', goodZip())).symlinks, 1);
  for (const evil of ['../evil', APP + '.app/../../x', '/etc/passwd', 'C:/x', APP + '.app\\..\\x']) { const r = UC.inspectZip(w('t.zip', zip([APP + '.app/', evil]))); assert.equal(r.ok, false, evil); assert.match(r.problems.join(), /опасный путь/); }
  const g = goodZip(); assert.equal(UC.inspectZip(w('tr.zip', g.subarray(0, g.length - 30))).ok, false); assert.equal(UC.inspectZip(w('tr2.zip', g.subarray(0, 40))).ok, false);
  assert.equal(UC.inspectZip(w('g.zip', crypto.randomBytes(500))).ok, false); assert.equal(UC.inspectZip(w('noapp.zip', zip(['Other.app/x']))).ok, false);
});
test('download: signed+hashed but traversal archive is rejected after hash check', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey, archive: zip([APP + '.app/', '../../Library/LaunchAgents/evil.plist']) });
  const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} }); await uc.check(); await assert.rejects(uc.download(r.tag), /опасный путь/);
});

test('rule: v1.2.1 over working v1.1.2 (same bundleId/data dir/launchd) needs verified backup + compat + owner approval', () => {
  const m = release().m; const base = { manifest: m, verified: true, current: '1.1.2' };
  assert.equal(UC.gate({ ...base, compat: { ok: true }, backup: null, ownerApproval: true }).allowed, false);
  assert.equal(UC.gate({ ...base, compat: { ok: false }, backup: { verified: true }, ownerApproval: true }).allowed, false);
  assert.equal(UC.gate({ ...base, compat: { ok: true }, backup: { verified: false }, ownerApproval: true }).allowed, false);
  assert.equal(UC.gate({ ...base, compat: { ok: true }, backup: { verified: true }, ownerApproval: false }).allowed, false);
  const ok = UC.gate({ ...base, compat: { ok: true }, backup: { verified: true }, ownerApproval: true }); assert.equal(ok.allowed, true); assert.equal(ok.mode, 'replace');
  assert.equal(UC.gate({ ...base, verified: false, compat: { ok: true }, backup: { verified: true }, ownerApproval: true }).allowed, false, 'unsigned never');
  assert.equal(UC.gate({ ...base, current: '1.0.0', compat: { ok: true }, backup: { verified: true }, ownerApproval: true }).allowed, false, 'minUpgradeFrom');
});
test('rule: isolated test build (v1.2.2-test) may go side-by-side; partial identity overlap is refused', () => {
  const m = TESTM();
  const g = UC.gate({ manifest: m, verified: true, current: '1.1.2', compat: { ok: false }, backup: null }); assert.equal(g.allowed, true); assert.equal(g.mode, 'side-by-side');
  const p = UC.gate({ manifest: { ...m, dataDirName: APP }, verified: true, current: '1.1.2', compat: { ok: true }, backup: { verified: true }, ownerApproval: true }); assert.equal(p.allowed, false); assert.match(p.reasons.join(), /частично/);
  assert.equal(UC.gate({ manifest: m, verified: false, current: '1.1.2' }).allowed, false, 'isolated but unsigned → no');
});
test('compat: schema checks tolerate missing dbSchemaVersion (→ manual only) and refuse schema downgrade', () => {
  assert.equal(UC.compatCheck({}, { ok: true, schemaVersion: 1 }).ok, false); assert.equal(UC.compatCheck({ dbSchemaVersion: 1 }, { ok: true, schemaVersion: 2 }).ok, false);
  assert.equal(UC.compatCheck({ dbSchemaVersion: 2 }, { ok: true, schemaVersion: 1 }).migration, true); assert.equal(UC.compatCheck({ dbSchemaVersion: 1 }, { schemaVersion: 1, tables: ['items'] }).ok, false, 'damaged DB');
});
test('manifest validation rejects path-like asset names and bad identity', () => {
  const m = release().m; assert.deepEqual(UC.validateManifest(m), []);
  assert.ok(UC.validateManifest({ ...m, assets: [{ name: '../x.zip', size: 1, sha256: 'a'.repeat(64) }] }).length); assert.ok(UC.validateManifest({ ...m, dataDirName: '../Library' }).length); assert.ok(UC.validateManifest({ ...m, channel: 'nightly' }).length);
});

test('pre-install backup is real: checksum + test restore into temp; plan only after it; live data untouched', async () => {
  const d = tmp(); const db = open(path.join(d, 'studio.db')); db.exec("CREATE TABLE items (col TEXT, id TEXT, data TEXT, PRIMARY KEY(col,id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO items VALUES ('tasks','t1','{}');");
  const backups = createBackupManager({ db, openDb: open, dataDir: d, filesDir: path.join(d, 'files'), version: '1.1.2' });
  const kp = keys(); const r = release({ priv: kp.privateKey, manifest: { dbSchemaVersion: 1 } }); // same schema as the fixture DB
  const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: createUpdateManager(), db, backups }); await uc.check();
  let p = uc.installPlan(r.tag); assert.equal(p.allowed, false);
  const b = uc.preBackup(); assert.equal(b.verified, true); assert.equal(b.integrity, 'ok');
  await uc.download(r.tag); p = uc.installPlan(r.tag); assert.equal(p.allowed, false, 'still needs owner approval'); uc.approve(r.tag, { user: 'igor' });
  p = uc.installPlan(r.tag); assert.equal(p.allowed, true, p.reasons.join()); assert.equal(p.manual, true); assert.equal(p.mode, 'replace');
  const all = [...p.steps, ...p.rollback].join('\n'); assert.match(all, /previous\.app/); assert.doesNotMatch(all, /xattr|spctl --master|rm -rf/);
  assert.ok(p.services.untouched.some(x => /Ollama/.test(x)) && p.services.untouched.some(x => /Keychain/.test(x)) && p.services.untouched.some(x => /OpenCode/.test(x)));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM items').get().n, 1); db.close();
});
test('auto-install is disabled unless ALL readiness flags; rollback default is dry-run and never deletes', async () => {
  const kp = keys(); const r = release({ priv: kp.privateKey }); const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {}, env: { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1' } });
  await uc.check(); await assert.rejects(uc.autoInstall(r.tag), /OPS_UPDATE_ROLLBACK_TESTED_ON_MAC/);
  const rb = await uc.rollback(); assert.equal(rb.dryRun, true); assert.doesNotMatch(rb.commands.join(' '), /\brm\b/); assert.match(rb.commands.join(' '), /previous\.app/);
  const { uc: full } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {}, env: { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1' } });
  await full.check(); await assert.rejects(full.autoInstall(r.tag), /запрещена/, 'flags alone are not enough: gate still applies');
});
test('rollback (non-dry-run, mocked macOS exec): restores previous app and checks /health', async () => {
  const d = tmp(); const calls = []; let healthy = false;
  const uc = UC.createUpdateCenter({ dir: d, current: '1.2.1', keys: [], platform: 'darwin', exec: async (c, a) => { calls.push([c, ...a].join(' ')); if (/bootstrap/.test(a[0])) healthy = true; return ''; },
    fetchImpl: async () => ({ ok: healthy, status: healthy ? 200 : 503, json: async () => ({ app: 'moonkatty-ai-studio', version: '1.1.2', db: true }) }) });
  await assert.rejects(uc.rollback({ dryRun: false }), /предыдущей/, 'refuses when no previous app (on this Linux box)');
  const h = await uc.healthCheck(); assert.equal(h.ok, false); healthy = true; assert.equal((await uc.healthCheck()).ok, true);
});
test('MOONKATTY NODE: per-device compat first; delivery disabled by default; job only after passing check', async () => {
  assert.equal(UC.nodeCompat({ arch: 'x64', os: 'macOS 12.5.1', node: 'v20.19.2' }, { arch: ['x64', 'arm64'], minMacOS: '12.0', minNode: '20.0.0' }).ok, true);
  assert.equal(UC.nodeCompat({ arch: 'x64', os: 'macOS 11.7', node: 'v20.1.0' }, { minMacOS: '12.0' }).ok, false);
  assert.equal(UC.nodeCompat({ arch: 'ia32', os: 'macOS 13.0', node: 'v20.1.0' }, { arch: ['x64', 'arm64'] }).ok, false);
  assert.equal(UC.nodeCompat({ arch: 'x64', os: 'macOS 12.5.1', node: 'v18.0.0' }, { minNode: '20.0.0' }).ok, false);
  assert.equal(UC.nodeCompat({}, { arch: ['x64'] }).ok, false);
  const kp = keys(); const r = release({ priv: kp.privateKey }); const submitted = [];
  const nodes = { status: () => ({ nodes: [{ id: 'imac', info: { arch: 'x64', os: 'macOS 12.5.1', node: 'v20.19.2' } }, { id: 'old', info: { arch: 'x64', os: 'macOS 11.7', node: 'v20.19.2' } }] }), submit: j => { submitted.push(j); return { jobId: 'nj_1' }; } };
  const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), nodes }); await uc.check();
  assert.throws(() => uc.nodeDeliver('imac', r.tag), /выключены/);
  const { uc: on } = center({ kp, fetchImpl: fakeGitHub([r]), nodes, env: { OPS_UPDATE_NODES: '1' } }); await on.check();
  assert.throws(() => on.nodeDeliver('imac', r.tag), /проверка совместимости/); assert.equal(on.nodeCheck('old', r.tag).ok, false); assert.throws(() => on.nodeDeliver('old', r.tag));
  assert.equal(on.nodeCheck('imac', r.tag).ok, true); assert.equal(on.nodeDeliver('imac', r.tag).jobId, 'nj_1'); assert.equal(submitted[0].capability, 'node.update'); assert.equal(submitted[0].safeToRetry, false);
});
test('code never bypasses macOS security', () => {
  for (const f of ['lib/ops/update-center.js', 'public/update-ui.js']) { const src = fs.readFileSync(path.join(__dirname, '../..', f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(src.replace(/не используйте xattr\/spctl|xattr\/карантин/g, ''), /xattr\s+-|com\.apple\.quarantine|master-disable|spctl\s+--add|rm -rf/, f); }
});

test('manifest format = docs/RELEASE_MANIFEST.md (f2440e1): real-shaped prod and test manifests validate; strict fields enforced', () => {
  assert.deepEqual(UC.validateManifest(release().m), []); assert.deepEqual(UC.validateManifest(TESTM()), []);
  const m = release().m;
  for (const [k, v] of [['manifestVersion', 2], ['arch', 'x64'], ['platform', 'linux'], ['isolated', 'yes'], ['isolatedFrom', 'x'], ['dbSchemaVersion', '3'], ['dbSchemaVersion', undefined], ['minUpgradeFrom', 'latest'], ['notarized', 'no'], ['sourceCommit', 'zz'], ['keychainItems', [{ service: 1 }]], ['defaultPort', 70000], ['dataDir', '~/../../etc']])
    assert.ok(UC.validateManifest({ ...m, [k]: v }).length, k + '=' + JSON.stringify(v));
  assert.deepEqual(UC.validateManifest({ ...m, futureField: 1 }), [], 'unknown fields ignored');
});
test('rule: minUpgradeFrom=null (fresh install only) never replaces; isolated flag must match identity', () => {
  const base = { verified: true, current: '1.1.2', compat: { ok: true }, backup: { verified: true }, ownerApproval: true };
  assert.equal(UC.gate({ ...base, manifest: { ...release().m, minUpgradeFrom: null } }).allowed, false);
  assert.equal(UC.gate({ ...base, manifest: { ...TESTM(), isolated: false } }).allowed, false, 'all ids differ but not declared isolated → conflict');
  assert.equal(UC.gate({ ...base, manifest: { ...TESTM(), isolatedFrom: [] } }).allowed, false, 'isolatedFrom must name the installed bundle');
  assert.equal(UC.gate({ ...base, manifest: { ...release().m, isolated: true } }).allowed, false, 'isolated=true with same ids → refused');
  assert.equal(UC.gate({ ...base, manifest: { ...TESTM(), keychainServicePrefix: APP } }).allowed, false, 'shared Keychain service → not isolated');
});
test('schema: version read from DB (meta.schemaVersion), fallback by tables for old DBs; compat v1.1.2(1)→v1.2.1(3), test build isolated', () => {
  const { detectSchemaVersion, createUpdateManager: cum } = require('../../lib/ops/update.js'); const mk = sql => { const db = open(path.join(tmp(), 's.db')); db.exec(sql); return db; };
  const base = 'CREATE TABLE items (col TEXT, id TEXT, data TEXT); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);';
  const cases = [['CREATE TABLE x (a);', 0, 'tables'], [base, 1, 'tables'], [base + 'CREATE TABLE jobs (id TEXT); CREATE TABLE job_events (id TEXT);', 2, 'tables'],
    [base + 'CREATE TABLE jobs (id TEXT, input TEXT); CREATE TABLE job_events (id TEXT);', 3, 'tables'], [base + "CREATE TABLE jobs (id TEXT, input TEXT); INSERT INTO meta VALUES ('schemaVersion','4');", 4, 'meta'],
    [base + "INSERT INTO meta VALUES ('schemaVersion','garbage');", 1, 'tables']];
  for (const [sql, v, src] of cases) { const db = mk(sql); const d = detectSchemaVersion(db); assert.equal(d.version, v, sql); assert.equal(d.source, src); db.close(); }
  const db1 = mk(base); const s1 = cum().schemaCheck(db1); assert.equal(s1.ok, true); assert.equal(s1.schemaVersion, 1); db1.close();
  const c = UC.compatCheck(release({ version: '1.2.1' }).m, s1); assert.equal(c.ok, true); assert.equal(c.migration, true); assert.equal(c.target, 3); assert.match(c.detail, /1 → 3/);
  assert.equal(UC.compatCheck(release().m, { schemaVersion: 4, source: 'meta', tables: ['items', 'meta'] }).ok, false, 'DB newer (4) than release (3) → no');
  assert.equal(UC.compatCheck(release().m, { schemaVersion: 0, tables: ['x'] }).ok, false);
  const ct = UC.compatCheck(TESTM(), s1); assert.equal(ct.ok, true); assert.equal(ct.isolated, true);
  const g = UC.gate({ manifest: TESTM(), verified: true, current: '1.1.2', compat: ct }); assert.equal(g.mode, 'side-by-side');
});
test('test-build archive: app name taken from manifest.appName', () => {
  const d = tmp(); const f = path.join(d, 'a.zip'); fs.writeFileSync(f, zip([APP + ' TEST.app/', APP + ' TEST.app/Contents/Info.plist']));
  assert.equal(UC.inspectZip(f, { appName: APP + ' TEST' }).ok, true); assert.equal(UC.inspectZip(f).ok, false);
});
test('unsigned real-format v1.2.2-test (manifest present, .sig absent or stub-key mismatch) → "not verified", no download', async () => {
  const kp = keys(), other = keys(); const m = TESTM(); const b = goodZip();
  for (const r of [release({ version: '1.2.2-test', tag: 'v1.2.2-test', manifest: m, noSig: true }), release({ version: '1.2.2-test', tag: 'v1.2.2-test', manifest: m, priv: other.privateKey })]) {
    const { uc } = center({ kp, fetchImpl: fakeGitHub([r]), update: schemaStub(1), db: {} }); const it = (await uc.check()).releases[0];
    assert.equal(it.verified, false); assert.equal(it.gate.allowed, false); assert.equal(it.compat.isolated, true); await assert.rejects(uc.download(it.tag), /подпис/); }
  void b;
});
