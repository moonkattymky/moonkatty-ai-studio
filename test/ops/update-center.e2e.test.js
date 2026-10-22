'use strict';
// E2E-UC: full Update Center cycle against a fake GitHub Releases server on 127.0.0.1 (real HTTP, real zip archives, real Ed25519
// signatures with EPHEMERAL test keys, real SQLite + real Approval Center tables/permissions module, real files). Install runs the
// directory installer under a temp root (never /Applications). macOS-only steps (codesign/spctl/launchctl/Electron) are BLOCKED here.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const UC = require('../../lib/ops/update-center.js'); const AI = require('../../lib/ops/app-identity.js');
const { createDirInstaller } = require('../../lib/ops/update-installer.js'); const { createApprovalsAdapter } = require('../../lib/ops/update-center-mount.js');
const { createUpdateBackups } = require('../../lib/ops/update-backup.js'); const { open } = require('../../lib/db.js');
const worldSchema = require('../../lib/world/schema.js'); const { createPermissions } = require('../../lib/world/permissions.js'); const { wireWorld } = require('../../lib/world/wiring.js');
const core = require('../../public/core.js'); const sec = require('../../lib/security.js');
const { makeZip, startFakeGitHub, sha } = require('../helpers/fake-gh-releases.js');
const REPO = 'moonkattymky/moonkatty-ai-studio', APP = 'MOONKATTY AI STUDIO', CURRENT = '1.3.1';
const PROD = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio' }, startDirs: [] });
const tmp = p => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'uc-e2e-' + (p || '')));
const appZip = (version, extra = {}) => makeZip({ [APP + '.app/']: '', [APP + '.app/Contents/']: '', [APP + '.app/Contents/Info.plist']: '<plist>com.moonkatty.aistudio</plist>',
  [APP + '.app/Contents/Resources/']: '', [APP + '.app/Contents/Resources/version.txt']: version, [APP + '.app/Contents/Resources/app.js']: crypto.randomBytes(200 * 1024).toString('base64'), ...extra });
const sigOf = (mb, priv) => JSON.stringify({ v: 1, alg: 'ed25519', keyId: UC.keyIdOf(crypto.createPublicKey(priv)), sig: crypto.sign(null, mb, priv).toString('base64') });
function mkRelease({ version = '1.3.2', priv, archive, appVersion = version, manifest = {}, sig, assetUrlOverride } = {}) {
  const tag = `v${version}-mac-preview`, name = `MOONKATTY-AI-STUDIO-${version}-arm64-mac.zip`; const zip = archive || appZip(appVersion);
  const m = { manifestVersion: 1, version, channel: 'preview', sourceCommit: 'b43dc54'.padEnd(40, '0'), branch: 'feat/e2e-update-center', arch: 'arm64', platform: 'darwin', bundleId: 'com.moonkatty.aistudio', appName: APP, dataDirName: APP,
    launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: APP, defaultPort: 8787, dbSchemaVersion: 6, minUpgradeFrom: '1.1.2', isolated: false, isolatedFrom: [], signing: 'adhoc', notarized: false,
    builtAt: new Date(Date.now() - 3600e3).toISOString(), assets: [{ name, size: zip.length, sha256: sha(zip) }], knownIssues: ['тестовый релиз'], ...manifest };
  const mb = Buffer.from(JSON.stringify(m)); const files = { [name]: zip, 'release-manifest.json': mb, 'release-manifest.json.sig': Buffer.from(sig ?? sigOf(mb, priv)) };
  return { tag, name, m, files, zip, api: base => ({ tag_name: tag, name: 'MOONKATTY ' + version, draft: false, prerelease: true, published_at: new Date(Date.now() - 1800e3).toISOString(), body: '## Изменения\n- Update Center e2e\n## Known issues\n- нет',
    assets: Object.entries(files).map(([n, b]) => ({ name: n, size: b.length, browser_download_url: (assetUrlOverride && assetUrlOverride[n]) || `${base}/${REPO}/releases/download/${tag}/${n}` })) }) };
}
// environment: data dir with DB + settings + user files, installed "app" (dir) under a temp root, real Approval Center tables
async function env(t, o = {}) {
  const gh = await startFakeGitHub({ repo: REPO }); t.after(() => gh.close());
  const root = tmp('root'), data = tmp('data'); t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(data, { recursive: true, force: true }); });
  const dbFile = path.join(data, 'studio.db'); const db = open(dbFile); t.after(() => { try { db.close(); } catch {} });
  db.exec("CREATE TABLE items (col TEXT, id TEXT, data TEXT, PRIMARY KEY(col,id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO items VALUES ('tasks','t1','{\"title\":\"user task\"}');"); worldSchema.migrate(db);
  fs.writeFileSync(path.join(data, 'settings.json'), '{"lang":"ru"}'); fs.mkdirSync(path.join(data, 'workspace')); fs.writeFileSync(path.join(data, 'workspace', 'project.txt'), 'user data');
  const appDir = path.join(root, 'Applications', APP + '.app', 'Contents', 'Resources'); fs.mkdirSync(appDir, { recursive: true }); fs.writeFileSync(path.join(appDir, 'version.txt'), CURRENT);
  const restarts = []; const installer = createDirInstaller({ root, stagingDir: path.join(data, 'ops', 'update-center', 'staging'), restart: async target => { restarts.push(target); },
    health: async ({ expectVersion }) => { const v = fs.readFileSync(path.join(root, 'Applications', APP + '.app', 'Contents', 'Resources', 'version.txt'), 'utf8');
      const dataOk = fs.existsSync(path.join(data, 'settings.json')) && db.prepare('SELECT COUNT(*) n FROM items').get().n === 1; return { ok: v === expectVersion && dataOk, body: { version: v, dataOk } }; } });
  const approvals = createApprovalsAdapter({ db, core, sec }); const P = createPermissions({ db, core, sec });
  const app = { locals: {} }; let deps = null; wireWorld({ app, world: { setDeps: d => { deps = d; }, applySavings: () => null }, services: null, env: {} });
  const kp = o.kp || crypto.generateKeyPairSync('ed25519');
  const ring = { prod: new Map([[UC.keyIdOf(kp.publicKey), { key: kp.publicKey, stub: false, status: 'active' }]]), test: new Map(), revoked: new Set(), problems: [], stubOnly: { prod: false, test: false } };
  const backups = createUpdateBackups({ db, openDb: open, dir: path.join(data, 'ops', 'update-center', 'backups'), dataDir: data, dbFile });
  const U = UC.createUpdateCenter({ hardGateOverrideForTests: true, testEndpoints: { api: gh.base }, dir: path.join(data, 'ops', 'update-center'), current: CURRENT, keyring: ring, identity: PROD,
    update: { schemaCheck: () => ({ ok: true, schemaVersion: 6, source: 'meta', tables: ['items', 'meta'] }) }, db, backups, installer, approvals, env: {}, fetchImpl: globalThis.fetch, healthUrl: 'http://127.0.0.1:1/api/health' });
  app.locals.updateCenterExecutor = (p, ctx) => U.executeInstall(p, ctx);
  // Owner approval exactly as Approval Center does it (lib/world/index.js approve route + execApproval): status approved by the owner,
  // params hash re-checked, id consumed once, then the action's executor (wiring.js critical_settings → kind app_update) is called.
  const ownerApproves = async id => { const row = db.prepare('SELECT * FROM world_approvals WHERE id = ?').get(id); assert.equal(row.status, 'pending');
    db.prepare("UPDATE world_approvals SET status='approved', decided_by='igor', decided_at=? WHERE id=?").run(core.now(), id);
    const payload = JSON.parse(row.payload_json); assert.equal(P.paramsHash(payload), row.params_hash); assert.equal(P.consume(id), true, 'single use');
    return deps.executors.critical_settings(payload, { approvalId: id, actor: 'igor@session', requestedBy: row.requested_by }); };
  const appVersion = () => fs.readFileSync(path.join(root, 'Applications', APP + '.app', 'Contents', 'Resources', 'version.txt'), 'utf8');
  return { gh, U, kp, db, data, root, restarts, approvals, P, ownerApproves, appVersion, deps };
}

test('E2E full cycle: GitHub check → info → real download (progress) → SHA+signature → backup → owner approval → install → restart → health → history', async t => {
  const E = await env(t); const r = mkRelease({ priv: E.kp.privateKey }); E.gh.S.releases = [r];
  const st = await E.U.check(); const rel = st.releases.find(x => x.tag === r.tag);
  assert.equal(rel.verified, true, rel.problems.join()); assert.equal(rel.newer, true); assert.equal(st.available, r.tag);
  assert.equal(rel.version, '1.3.2'); assert.ok(rel.publishedAt); assert.match(rel.changelog, /Update Center e2e/); assert.equal(rel.assets.find(a => a.name === r.name).size, r.zip.length);
  assert.ok(E.gh.S.log.some(l => l.path === `/repos/${REPO}/releases`), 'real HTTP request to the fake API');
  const seen = []; const iv = setInterval(() => { const d = E.U.status().releases[0].download; if (d) seen.push(d.received); }, 1); // progress readable while downloading
  const D = await E.U.download(r.tag); clearInterval(iv); assert.equal(D.status, 'verified'); assert.equal(D.sha256, sha(r.zip)); assert.equal(fs.readFileSync(D.file).length, r.zip.length);
  assert.ok(E.gh.S.log.some(l => /^\/assets\//.test(l.path)), 'followed the 302 to the asset host');
  const req = E.U.requestInstall(r.tag, { actor: 'igor@session' }); assert.equal(req.status, 'pending_owner'); assert.match(req.approvalId, /\w+/);
  assert.equal(E.appVersion(), CURRENT, 'nothing installed before the owner approves');
  await assert.rejects(E.U.executeInstall(req.params, { approvalId: req.approvalId }), /NO_APPROVAL|подтверждения/);
  const res = await E.ownerApproves(req.approvalId);
  assert.equal(res.executed, true, JSON.stringify(res)); assert.equal(E.appVersion(), '1.3.2'); assert.equal(E.restarts.length, 1);
  assert.ok(fs.existsSync(path.join(E.root, 'Applications', APP + '-previous.app')), 'previous version kept for rollback');
  assert.equal(E.db.prepare('SELECT COUNT(*) n FROM items').get().n, 1); assert.equal(fs.readFileSync(path.join(E.data, 'settings.json'), 'utf8'), '{"lang":"ru"}');
  const s2 = E.U.status(); assert.equal(s2.install.stage, 'done'); assert.equal(s2.backup.verified, true); assert.equal(s2.backup.files.count >= 2, true);
  const acts = s2.history.map(h => h.action + ':' + h.result); for (const x of ['check:ok', 'download:verified', 'install-request:pending_owner', 'backup:verified', 'install:installed']) assert.ok(acts.includes(x), x + ' in ' + acts);
  await assert.rejects(E.ownerApproves(req.approvalId), /pending|approved/, 'approval cannot be replayed');
});

test('E2E rollback: new version fails health → previous version restored, data intact, history rolled_back', async t => {
  const E = await env(t); const r = mkRelease({ priv: E.kp.privateKey, appVersion: '0.0.0-broken' }); E.gh.S.releases = [r];
  await E.U.check(); await E.U.download(r.tag); const req = E.U.requestInstall(r.tag, { actor: 'igor@session' });
  const res = await E.ownerApproves(req.approvalId); assert.equal(res.executed, false); assert.equal(res.status, 'rolled_back', JSON.stringify(res));
  assert.equal(E.appVersion(), CURRENT); assert.equal(E.restarts.length, 2, 'restart new, then restart previous');
  assert.ok(fs.readdirSync(path.join(E.root, 'Applications')).some(n => /-failed-\d+\.app$/.test(n)), 'failed version renamed, not deleted');
  assert.equal(E.db.prepare('SELECT COUNT(*) n FROM items').get().n, 1); const s = E.U.status(); assert.equal(s.install.stage, 'rolled-back'); assert.equal(s.history[0].result, 'rolled_back');
});

test('E2E corrupt archive: bytes differ from the signed SHA → deleted; signed-but-broken zip → rejected; nothing installed', async t => {
  const E = await env(t); const r = mkRelease({ priv: E.kp.privateKey }); E.gh.S.releases = [r]; await E.U.check();
  const bad = Buffer.from(r.zip); bad[bad.length >> 1] ^= 0xff; r.files[r.name] = bad; // corrupted in transit/at rest on the server
  await assert.rejects(E.U.download(r.tag), e => e.code === 'HASH_MISMATCH'); assert.equal(E.U.status().releases[0].download.status, 'failed');
  assert.ok(!fs.readdirSync(path.join(E.data, 'ops', 'update-center', 'downloads', r.tag)).length, 'corrupt file removed');
  const trunc = r.zip.subarray(0, r.zip.length - 30); const r2 = mkRelease({ version: '1.3.3', priv: E.kp.privateKey, archive: trunc }); E.gh.S.releases = [r2]; await E.U.check();
  await assert.rejects(E.U.download(r2.tag), e => e.code === 'BAD_ARCHIVE'); assert.throws(() => E.U.requestInstall(r2.tag, { actor: 'igor@session' }), /не загружен|BLOCKED|запрещена/); assert.equal(E.appVersion(), CURRENT);
});

test('E2E unreachable server: check fails cleanly (NETWORK), lastCheck/history record it, nothing changes', async t => {
  const E = await env(t); await E.gh.close();
  await assert.rejects(E.U.check(), e => e.code === 'NETWORK' || /сеть/.test(e.message)); const s = E.U.status(); assert.equal(s.lastCheck.ok, false); assert.equal(s.history[0].action, 'check'); assert.equal(s.history[0].result, 'failed'); assert.equal(E.appVersion(), CURRENT);
});

test('E2E bad signature: wrong key / garbage sig / unsigned → unverified, download and install refused', async t => {
  const E = await env(t); const other = crypto.generateKeyPairSync('ed25519');
  E.gh.S.releases = [mkRelease({ priv: other.privateKey }), mkRelease({ version: '1.3.3', sig: '{"v":1,"alg":"ed25519","keyId":"' + UC.keyIdOf(E.kp.publicKey) + '","sig":"' + Buffer.alloc(64).toString('base64') + '"}' }), mkRelease({ version: '1.3.4', sig: '' })];
  const st = await E.U.check(); for (const r of st.releases) { assert.equal(r.verified, false, r.tag); assert.ok(r.problems.length); assert.throws(() => E.U.prepareDownload(r.tag), e => e.code === 'UNVERIFIED'); assert.throws(() => E.U.requestInstall(r.tag, { actor: 'igor@session' }), e => e.code === 'UNVERIFIED'); }
});

test('E2E interrupted download: socket cut mid-file → interrupted + partial kept → resume with Range → verified', async t => {
  const E = await env(t); const r = mkRelease({ priv: E.kp.privateKey }); E.gh.S.releases = [r]; await E.U.check();
  E.gh.S.cutOnce = { name: r.name, after: Math.floor(r.zip.length / 2) };
  await assert.rejects(E.U.download(r.tag)); const d1 = E.U.status().releases[0].download; assert.equal(d1.status, 'interrupted', d1.error); assert.ok(d1.received > 0 && d1.received < r.zip.length, String(d1.received));
  const D = await E.U.download(r.tag); assert.equal(D.status, 'verified'); assert.ok(E.gh.S.log.some(l => l.range === `bytes=${d1.received}-`), 'resumed with Range');
});

test('E2E arbitrary URLs rejected: foreign hosts/ports, redirects off the allowlist, non-loopback test endpoints, endpoints in packaged app', async t => {
  const E = await env(t); const repos = [REPO]; const ep = UC.loopbackEndpoints({ api: E.gh.base });
  for (const u of ['http://127.0.0.1:1/repos/' + REPO + '/releases', 'http://localhost' + E.gh.base.slice(16) + '/repos/' + REPO + '/releases', E.gh.base + '/repos/evil/fork/releases', 'https://evil.example/x', 'file:///etc/passwd', E.gh.base.replace('http:', 'https:') + '/repos/' + REPO + '/releases'])
    assert.throws(() => UC.assertUrl(u, { repos, initial: true, ep }), /не разрешён|allowlist|127\.0\.0\.1|разрешены/, u);
  assert.throws(() => UC.assertUrl('http://127.0.0.2:80/x', { repos, initial: false, ep }), /REDIRECT|127|чужой/);
  for (const bad of ['http://10.0.0.1:80', 'https://127.0.0.1:443', 'http://127.0.0.1', 'http://127.0.0.1:9/path']) assert.throws(() => UC.loopbackEndpoints({ api: bad }), /127\.0\.0\.1/, bad);
  assert.throws(() => UC.createUpdateCenter({ dir: tmp(), current: CURRENT, testEndpoints: { api: E.gh.base }, packaged: true, keyring: { prod: new Map(), test: new Map(), revoked: new Set(), problems: [], stubOnly: {} } }), /собранном/);
  assert.throws(() => UC.assertUrl(E.gh.base + '/repos/' + REPO + '/releases', { repos, initial: true }), /HTTPS/, 'production policy never allows loopback http');
  // a signed release whose asset URL points elsewhere: the manifest is never fetched from a foreign host
  const r = mkRelease({ priv: E.kp.privateKey, assetUrlOverride: { 'release-manifest.json': 'http://127.0.0.1:1/evil.json' } }); E.gh.S.releases = [r];
  const st = await E.U.check(); assert.equal(st.releases[0].verified, false); assert.match(st.releases[0].problems.join(), /не разрешён|URL/);
  // redirect to a foreign port is refused during download
  const r2 = mkRelease({ version: '1.3.3', priv: E.kp.privateKey }); E.gh.S.releases = [r2]; await E.U.check();
  E.gh.S.overrides[`/${REPO}/releases/download/${r2.tag}/${r2.name}`] = (req, res) => { res.statusCode = 302; res.setHeader('location', 'http://127.0.0.1:1/x.zip'); res.end(); return true; };
  await assert.rejects(E.U.download(r2.tag), e => e.code === 'REDIRECT_NOT_ALLOWED');
});

test('E2E agent cannot install: request ≠ approval; confirm:true ignored; unapproved/unconsumed/tampered approvals refused; approval only via owner', async t => {
  const E = await env(t); const r = mkRelease({ priv: E.kp.privateKey }); E.gh.S.releases = [r]; await E.U.check(); await E.U.download(r.tag);
  const req = E.U.requestInstall(r.tag, { actor: 'igor@app' }); // an agent / app-token caller can only create a PENDING request
  const row = E.db.prepare('SELECT * FROM world_approvals WHERE id = ?').get(req.approvalId); assert.equal(row.status, 'pending'); assert.equal(row.requested_by, 'igor@app'); assert.equal(row.action, 'critical_settings');
  await assert.rejects(E.U.executeInstall(req.params, {}), e => e.code === 'NO_APPROVAL');
  await assert.rejects(E.U.executeInstall({ ...req.params, confirm: true }, { approvalId: req.approvalId }), e => e.code === 'NO_APPROVAL');
  await assert.rejects(E.deps.executors.critical_settings({ ...req.params, confirm: true }, { approvalId: req.approvalId }), e => e.code === 'NO_APPROVAL', 'executor path without Approval Center decision');
  E.db.prepare("UPDATE world_approvals SET status='approved', decided_by='igor' WHERE id=?").run(req.approvalId);
  await assert.rejects(E.U.executeInstall(req.params, { approvalId: req.approvalId }), e => e.code === 'NO_APPROVAL', 'approved but not consumed by Approval Center');
  E.P.consume(req.approvalId);
  await assert.rejects(E.U.executeInstall({ ...req.params, target: '/tmp/evil.app' }, { approvalId: req.approvalId }), e => e.code === 'NO_APPROVAL', 'params differ from the approved hash');
  assert.equal(E.appVersion(), CURRENT); assert.equal(E.restarts.length, 0);
  // the legacy password-only approve no longer grants anything
  assert.throws(() => E.U.installParams('v9.9.9'), /не найден/);
});

test('E2E SHA+archive swap: attacker replaces archive AND its SHA in the manifest → signature fails; swap after download → install refused', async t => {
  const E = await env(t); const r = mkRelease({ priv: E.kp.privateKey }); E.gh.S.releases = [r];
  const evil = appZip('6.6.6-evil'); const m2 = { ...r.m, assets: [{ name: r.name, size: evil.length, sha256: sha(evil) }] }; // keep the old (now invalid) signature
  r.files[r.name] = evil; r.files['release-manifest.json'] = Buffer.from(JSON.stringify(m2));
  let st = await E.U.check(); assert.equal(st.releases[0].verified, false); assert.match(st.releases[0].problems.join(), /подпись/); assert.throws(() => E.U.prepareDownload(r.tag), e => e.code === 'UNVERIFIED');
  // legit release downloaded, then the archive on disk is swapped (same size) before approval executes
  const ok = mkRelease({ version: '1.3.3', priv: E.kp.privateKey }); E.gh.S.releases = [ok]; await E.U.check(); const D = await E.U.download(ok.tag);
  const req = E.U.requestInstall(ok.tag, { actor: 'igor@session' }); const ev2 = appZip('6.6.6-evil'); fs.writeFileSync(D.file, ev2.length === ok.zip.length ? ev2 : Buffer.concat([ev2, Buffer.alloc(Math.max(0, ok.zip.length - ev2.length))]).subarray(0, ok.zip.length));
  const res = await E.ownerApproves(req.approvalId).catch(e => ({ error: e.message, code: e.code })); assert.ok(res.error || res.executed === false, JSON.stringify(res));
  assert.match(String(res.error || res.status), /SHA-256|BLOCKED|запрещена|архив/); assert.equal(E.appVersion(), CURRENT);
  assert.equal(E.U.status().releases.find(x => x.tag === ok.tag).download.status, 'tampered');
});
