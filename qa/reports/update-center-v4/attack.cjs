'use strict';
// Re-audit of Update Center at 5100568 (range 3fc9573..5100568). No install, no publish, no live GitHub.
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.UC_SRC || '/tmp/mk-uc4';
const dirty = spawnSync('git', ['-C', ROOT, 'status', '--short'], { encoding: 'utf8' });
if ((dirty.stdout || '').trim()) {
  console.error('product worktree is not clean');
  process.exit(2);
}

const UC = require(path.join(ROOT, 'lib/ops/update-center.js'));
const UM = require(path.join(ROOT, 'lib/ops/update.js'));
const AI = require(path.join(ROOT, 'lib/ops/app-identity.js'));

const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const findings = [];

function check(kind, name, ok, detail) {
  const row = { kind, name, ok: !!ok, detail: detail == null ? null : detail };
  results.push(row);
  if ((kind === 'residual' || kind === 'finding') && ok) findings.push({ name, detail: row.detail });
  console.log(`${ok ? 'PASS ' : 'FAIL '}${kind} ${name}`);
  return !!ok;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-uc4-'));
function pair() {
  const keys = crypto.generateKeyPairSync('ed25519');
  const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
  return { keys, pub, id: UC.keyIdOf(keys.publicKey) };
}
function writeRing(dir, id, pub, { mode = 0o700, fileMode = 0o644, jsonMode = 0o600, name = 'k.pub.pem', revoked = [] } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, mode);
  fs.writeFileSync(path.join(dir, name), pub);
  fs.chmodSync(path.join(dir, name), fileMode);
  fs.writeFileSync(path.join(dir, 'keyring.json'), JSON.stringify({ version: 1, keys: { [id]: { file: name, set: 'prod', status: 'active' } }, revoked }) + '\n');
  fs.chmodSync(path.join(dir, 'keyring.json'), jsonMode);
  return dir;
}
function load(dir, uid) {
  const opt = { env: { OPS_UPDATE_KEYRING_DIR: dir } };
  if (uid !== undefined) opt.uid = uid;
  return UC.loadKeyrings(opt);
}
function stateOf(dir, uid) {
  return UC.signatureStatus(load(dir, uid), 'prod');
}

const PROD = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio' }, startDirs: [] });
const REPO = 'moonkattymky/moonkatty-ai-studio';
const APP = 'MOONKATTY AI STUDIO';

function signedRelease(keys, { version = '1.3.0', channel = 'preview', builtAt = '2026-10-21T12:00:00.000Z', assetVersion, tag, noBuiltAt = false } = {}) {
  const name = `MOONKATTY-AI-STUDIO-${assetVersion || version}-arm64-mac.zip`;
  const manifest = {
    manifestVersion: 1, version, channel, sourceCommit: 'a'.repeat(40), arch: 'arm64', platform: 'darwin',
    bundleId: 'com.moonkatty.aistudio', appName: APP, dataDirName: APP,
    launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: APP, defaultPort: 8787,
    dbSchemaVersion: 1, minUpgradeFrom: '1.1.2', isolated: false, isolatedFrom: [],
    signing: 'adhoc', notarized: false,
    assets: [{ name, size: 32, sha256: 'ab'.repeat(32) }],
  };
  if (!noBuiltAt) manifest.builtAt = builtAt;
  const mb = Buffer.from(JSON.stringify(manifest));
  const sig = crypto.sign(null, mb, keys.keys.privateKey);
  const sigBuf = Buffer.from(JSON.stringify({ v: 1, alg: 'ed25519', keyId: keys.id, sig: sig.toString('base64') }));
  const useTag = tag || (channel === 'preview' ? `v${version}-mac-preview` : `v${version}`);
  return { tag: useTag, mb, sig: sigBuf, name, manifest };
}

async function checkRelease(rel, { current = '1.1.2', currentBuiltAt, now = Date.parse('2026-10-21T12:00:00.000Z'), env = {}, centerImpl = UC } = {}) {
  const files = { 'release-manifest.json': rel.mb, 'release-manifest.json.sig': rel.sig, [rel.name]: Buffer.alloc(32) };
  const gh = {
    tag_name: rel.tag, name: rel.tag, prerelease: true, draft: false, published_at: '2026-10-21T12:00:00.000Z', body: '',
    assets: Object.entries(files).map(([n, b]) => ({ name: n, size: b.length, browser_download_url: `https://github.com/${REPO}/releases/download/${rel.tag}/${n}` })),
  };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const resp = (status, body, headers = {}) => ({
      status, ok: status < 300,
      headers: { get: (k) => headers[k.toLowerCase()] ?? null },
      arrayBuffer: async () => body,
      body: { async *[Symbol.asyncIterator]() { yield body; } },
    });
    if (u.hostname === 'api.github.com') return resp(200, Buffer.from(JSON.stringify([gh])));
    if (u.hostname === 'github.com') return resp(302, Buffer.alloc(0), { location: 'https://objects.githubusercontent.com/x/' + path.basename(u.pathname) });
    const b = files[decodeURIComponent(path.basename(u.pathname))];
    return b ? resp(200, b) : resp(404, Buffer.alloc(0));
  };
  const opt = { dir: tmp(), current, fetchImpl, identity: PROD, env, healthUrl: 'http://127.0.0.1:1/api/health', now: () => now };
  if (currentBuiltAt !== undefined) opt.currentBuiltAt = currentBuiltAt;
  const uc = centerImpl.createUpdateCenter(opt);
  const st = await uc.check();
  return { uc, rel: st.releases[0], buildAge: st.buildAge, signature: st.signature };
}

function keyringAttacks(owner, attacker) {
  const good = tmp();
  writeRing(good, owner.id, owner.pub);
  const goodSt = stateOf(good);
  check('hold', 'mode 0700 owned by the current uid is READY and the key is public', goodSt.state === 'READY' && load(good).prod.get(owner.id).key.type === 'public', goodSt.state);

  for (const mode of [0o777, 0o755, 0o750, 0o701, 0o707]) {
    const d = tmp();
    writeRing(d, attacker.id, attacker.pub, { mode });
    const st = stateOf(d);
    check('hold', `directory mode ${(mode & 0o777).toString(8)} is BLOCKED and the key is not loaded`, st.state === 'BLOCKED' && !load(d).prod.has(attacker.id) && /права папки/.test(st.message), st.message);
  }

  const looseFile = tmp();
  writeRing(looseFile, attacker.id, attacker.pub, { fileMode: 0o666 });
  check('hold', 'a group/other-writable public key file is BLOCKED', stateOf(looseFile).state === 'BLOCKED' && /запись группе/.test(stateOf(looseFile).message), null);
  const looseJson = tmp();
  writeRing(looseJson, attacker.id, attacker.pub, { jsonMode: 0o666 });
  check('hold', 'a group/other-writable keyring.json is BLOCKED', stateOf(looseJson).state === 'BLOCKED', null);

  const linkDir = path.join(tmp(), 'link');
  fs.symlinkSync(good, linkDir);
  check('hold', 'the keyring directory itself as a symlink is BLOCKED', stateOf(linkDir).state === 'BLOCKED' && /символическая ссылка/.test(stateOf(linkDir).message), null);

  const realParent = tmp();
  const kr = path.join(realParent, 'kr');
  writeRing(kr, owner.id, owner.pub);
  const varLink = path.join(tmp(), 'var');
  fs.symlinkSync(realParent, varLink);
  const viaParent = path.join(varLink, 'kr');
  const parentSt = stateOf(viaParent);
  check('hold', 'a symlinked parent (the /var -> /private/var shape) is READY', parentSt.state === 'READY' && load(viaParent).prod.has(owner.id), parentSt.message);

  const outside = tmp();
  fs.writeFileSync(path.join(outside, 'out.pub.pem'), attacker.pub, { mode: 0o644 });
  const fileLink = tmp();
  writeRing(fileLink, owner.id, owner.pub);
  fs.rmSync(path.join(fileLink, 'k.pub.pem'));
  fs.symlinkSync(path.join(outside, 'out.pub.pem'), path.join(fileLink, 'k.pub.pem'));
  const fileLinkKr = load(fileLink);
  check('hold', 'a symlinked .pub.pem is BLOCKED and the outside key is not loaded', stateOf(fileLink).state === 'BLOCKED' && !fileLinkKr.prod.has(attacker.id) && !fileLinkKr.prod.has(owner.id), stateOf(fileLink).message);

  const ringLink = tmp();
  writeRing(ringLink, owner.id, owner.pub);
  const ringOutside = path.join(tmp(), 'keyring.json');
  fs.renameSync(path.join(ringLink, 'keyring.json'), ringOutside);
  fs.symlinkSync(ringOutside, path.join(ringLink, 'keyring.json'));
  check('hold', 'keyring.json as a symlink is BLOCKED', stateOf(ringLink).state === 'BLOCKED' && /keyring\.json/.test(stateOf(ringLink).message), null);

  const wrong = stateOf(good, process.getuid() + 4242);
  check('hold', 'a directory owned by another uid is BLOCKED', wrong.state === 'BLOCKED' && /владелец/.test(wrong.message), wrong.message);

  const dotDot = path.join(kr, '..', 'kr');
  check('hold', 'a .. segment that resolves back to the same directory is still that directory', stateOf(dotDot).state === 'READY', null);
  const evil = tmp();
  writeRing(evil, attacker.id, attacker.pub, { mode: 0o777 });
  const escape = path.resolve(kr, '..', '..', path.basename(evil));
  const escapeSt = stateOf(escape);
  check('hold', 'a .. path that lands on a mode 0777 directory is BLOCKED', path.resolve(escape) === evil && escapeSt.state === 'BLOCKED' && !load(escape).prod.has(attacker.id), escapeSt.message);

  const traversal = tmp();
  writeRing(traversal, owner.id, owner.pub);
  const travJson = { version: 1, keys: { [attacker.id]: { file: path.join(outside, 'out.pub.pem'), set: 'prod', status: 'active' } }, revoked: [] };
  fs.writeFileSync(path.join(traversal, 'keyring.json'), JSON.stringify(travJson), { mode: 0o600 });
  const trav = load(traversal);
  check('hold', 'an absolute file field is rejected and the outside key is not loaded', trav.blocked && !trav.prod.has(attacker.id), trav.blocked || null);
  const dotted = tmp();
  writeRing(dotted, owner.id, owner.pub);
  fs.writeFileSync(path.join(dotted, 'keyring.json'), JSON.stringify({ version: 1, keys: { [attacker.id]: { file: '../../out.pub.pem', set: 'prod', status: 'active' } }, revoked: [] }), { mode: 0o600 });
  check('hold', 'a file field containing .. is rejected', load(dotted).blocked && !load(dotted).prod.has(attacker.id), null);

  const base = tmp();
  writeRing(base, owner.id, owner.pub);
  const rejected = tmp();
  writeRing(rejected, attacker.id, attacker.pub, { mode: 0o777 });
  const rejJson = JSON.parse(fs.readFileSync(path.join(rejected, 'keyring.json'), 'utf8'));
  rejJson.revoked = [owner.id];
  fs.writeFileSync(path.join(rejected, 'keyring.json'), JSON.stringify(rejJson), { mode: 0o666 });
  const merged = UC.loadKeyrings({ dir: base, env: { OPS_UPDATE_KEYRING_DIR: rejected } });
  check('hold', 'a rejected external directory does not revoke the base key', merged.prod.has(owner.id) && !merged.revoked.has(owner.id) && merged.blocked, null);
}

function parentSwap(owner, attacker) {
  const goodParent = tmp();
  const good = path.join(goodParent, 'kr');
  writeRing(good, owner.id, owner.pub);
  const badParent = tmp();
  fs.chmodSync(badParent, 0o755);
  const bad = path.join(badParent, 'kr');
  writeRing(bad, attacker.id, attacker.pub, { mode: 0o755, fileMode: 0o644, jsonMode: 0o644 });
  fs.chmodSync(bad, 0o755);
  const holder = tmp();
  fs.chmodSync(holder, 0o777);
  const link = path.join(holder, 'link');
  fs.symlinkSync(goodParent, link);
  const logical = path.join(link, 'kr');
  const realJson = path.join(good, 'keyring.json');
  const orig = fs.readFileSync;
  let swapped = false;
  fs.readFileSync = function patched(p, ...args) {
    const data = orig.call(this, p, ...args);
    if (!swapped && path.resolve(String(p)) === realJson) {
      swapped = true;
      fs.unlinkSync(link);
      fs.symlinkSync(badParent, link);
    }
    return data;
  };
  let kr;
  try { kr = load(logical); } finally { fs.readFileSync = orig; }
  const st = UC.signatureStatus(kr, 'prod');
  check('residual', 'retargeting a parent symlink after the mode check and before the second read loads the attacker key', swapped && kr.prod.has(attacker.id) && !kr.prod.has(owner.id) && st.state === 'READY' && !kr.blocked, { state: st.state, blocked: kr.blocked || null, attacker: kr.prod.has(attacker.id) });

  const sticky = tmp();
  fs.chmodSync(sticky, 0o1777);
  const stickyLink = path.join(sticky, 'link');
  fs.symlinkSync(goodParent, stickyLink);
  const asNobody = spawnSync('sudo', ['-n', '-u', 'nobody', 'ln', '-sfn', badParent, stickyLink], { encoding: 'utf8' });
  check('hold', 'on a sticky world-writable parent, nobody cannot retarget the symlink', asNobody.status !== 0, { status: asNobody.status, code: asNobody.status });

  const open = tmp();
  fs.chmodSync(open, 0o777);
  const openLink = path.join(open, 'link');
  fs.symlinkSync(goodParent, openLink);
  const replaced = spawnSync('sudo', ['-n', '-u', 'nobody', 'ln', '-sfn', badParent, openLink], { encoding: 'utf8' });
  const after = fs.realpathSync(openLink);
  check('hold', 'on a non-sticky 0777 parent, nobody can retarget the symlink, and a fresh load then sees the attacker directory and blocks on its owner', replaced.status === 0 && after === badParent && stateOf(path.join(openLink, 'kr')).state === 'BLOCKED' && !load(path.join(openLink, 'kr')).prod.has(attacker.id), { status: replaced.status, state: stateOf(path.join(openLink, 'kr')).message });
}

function raceParent(owner, attacker) {
  const goodParent = tmp();
  const good = path.join(goodParent, 'kr');
  writeRing(good, owner.id, owner.pub);
  const badParent = tmp();
  fs.chmodSync(badParent, 0o755);
  const bad = path.join(badParent, 'kr');
  writeRing(bad, attacker.id, attacker.pub, { mode: 0o755, fileMode: 0o644, jsonMode: 0o644 });
  fs.chmodSync(bad, 0o755);
  const open = tmp();
  fs.chmodSync(open, 0o777);
  const link = path.join(open, 'link');
  fs.symlinkSync(goodParent, link);
  const logical = path.join(link, 'kr');
  const child = spawn('sudo', ['-n', '-u', 'nobody', process.execPath, '-e', `
    const fs = require('fs');
    const link = ${JSON.stringify(link)};
    const good = ${JSON.stringify(goodParent)};
    const bad = ${JSON.stringify(badParent)};
    const end = Date.now() + 4000;
    while (Date.now() < end) {
      try { fs.unlinkSync(link); } catch {}
      try { fs.symlinkSync(bad, link); } catch {}
      try { fs.unlinkSync(link); } catch {}
      try { fs.symlinkSync(good, link); } catch {}
    }
  `], { stdio: 'ignore' });
  let loads = 0;
  let hits = 0;
  let blocked = 0;
  const end = Date.now() + 3500;
  while (Date.now() < end) {
    let kr;
    try { kr = load(logical); } catch { continue; }
    loads += 1;
    if (kr.prod.has(attacker.id)) hits += 1;
    else if (kr.blocked) blocked += 1;
  }
  try { child.kill('SIGTERM'); } catch {}
  check('measured', 'live race: nobody retargets the parent symlink while the keyring is loaded', true, { loads, hits, blocked });
  if (hits > 0) check('residual', 'the live race loaded the attacker key', true, { loads, hits, blocked });
  return { loads, hits, blocked };
}

function hardlinkAndAcl(owner, attacker) {
  const outside = tmp();
  fs.chmodSync(outside, 0o755);
  const outsideFile = path.join(outside, 'mine.pub.pem');
  fs.writeFileSync(outsideFile, owner.pub, { mode: 0o644 });
  const dir = tmp();
  fs.chmodSync(dir, 0o700);
  try { fs.linkSync(outsideFile, path.join(dir, 'k.pub.pem')); } catch (e) {
    check('hold', 'a same-user hardlink could not be created', false, e.code);
    return;
  }
  fs.writeFileSync(path.join(dir, 'keyring.json'), JSON.stringify({ version: 1, keys: { [owner.id]: { file: 'k.pub.pem', set: 'prod', status: 'active' } }, revoked: [] }), { mode: 0o600 });
  const st = fs.lstatSync(path.join(dir, 'k.pub.pem'));
  const loaded = load(dir);
  check('measured', 'a same-user hardlink is a regular file and is loaded', st.nlink >= 2 && !st.isSymbolicLink() && loaded.prod.has(owner.id) && UC.signatureStatus(loaded).state === 'READY', { nlink: st.nlink });

  const foreignDir = tmp();
  fs.chmodSync(foreignDir, 0o755);
  const foreign = path.join(foreignDir, 'n.pub.pem');
  fs.writeFileSync(foreign, attacker.pub, { mode: 0o644 });
  spawnSync('sudo', ['-n', 'chown', 'nobody:nogroup', foreign]);
  const fdir = tmp();
  fs.chmodSync(fdir, 0o700);
  let linkErr = null;
  try { fs.linkSync(foreign, path.join(fdir, 'k.pub.pem')); } catch (e) { linkErr = e.code; }
  if (linkErr) {
    check('hold', 'protected_hardlinks refuses a hardlink to nobody\'s file', linkErr === 'EPERM' || linkErr === 'EACCES', linkErr);
  } else {
    const uid = fs.lstatSync(path.join(fdir, 'k.pub.pem')).uid;
    fs.writeFileSync(path.join(fdir, 'keyring.json'), JSON.stringify({ version: 1, keys: { [attacker.id]: { file: 'k.pub.pem', set: 'prod', status: 'active' } }, revoked: [] }), { mode: 0o600 });
    const kr = load(fdir);
    check('hold', 'a hardlink keeps the other user\'s uid and is BLOCKED', uid !== process.getuid() && !kr.prod.has(attacker.id) && kr.blocked, { uid, state: UC.signatureStatus(kr).state });
  }

  const aclDir = tmp();
  writeRing(aclDir, owner.id, owner.pub, { fileMode: 0o644, jsonMode: 0o644 });
  spawnSync('setfacl', ['-m', 'u:nobody:rwx', aclDir]);
  const widened = fs.statSync(aclDir).mode & 0o777;
  const widenedState = stateOf(aclDir);
  check('hold', 'an effective POSIX ACL widens the group mode bits and the directory is BLOCKED', widened !== 0o700 && widenedState.state === 'BLOCKED', { mode: widened.toString(8), state: widenedState.state });
  const masked = tmp();
  writeRing(masked, owner.id, owner.pub);
  spawnSync('setfacl', ['-n', '-m', 'u:nobody:rwx', masked]);
  spawnSync('setfacl', ['-n', '-m', 'u:nobody:rw', path.join(masked, 'k.pub.pem')]);
  const maskedMode = fs.statSync(masked).mode & 0o777;
  const poke = spawnSync('sudo', ['-n', '-u', 'nobody', 'bash', '-c', `echo x >> ${JSON.stringify(path.join(masked, 'k.pub.pem'))}`], { encoding: 'utf8' });
  check('hold', 'an ACL whose mask is empty leaves mode 0700, stays READY, and nobody cannot write the key', maskedMode === 0o700 && stateOf(masked).state === 'READY' && poke.status !== 0, { mode: maskedMode.toString(8), write: poke.status });
}

function extraModeBits(owner) {
  for (const mode of [0o1700, 0o2700, 0o4700]) {
    const d = tmp();
    writeRing(d, owner.id, owner.pub, { mode });
    const st = stateOf(d);
    const nobody = spawnSync('sudo', ['-n', '-u', 'nobody', 'touch', path.join(d, 'x')]);
    check('measured', `directory mode ${(mode).toString(8)} is accepted and nobody cannot create a file`, st.state === 'READY' && nobody.status !== 0, { state: st.state, touch: nobody.status });
  }
}

async function ageAndVersion(owner) {
  const env = { OPS_UPDATE_KEYRING_DIR: writeRing(tmp(), owner.id, owner.pub) };
  const T = Date.parse('2026-10-21T12:00:00.000Z');
  const iso = (ms) => new Date(ms).toISOString();
  const run = (over, opt) => checkRelease(signedRelease(owner, over), { env, ...opt });

  let r = await run({ builtAt: '2026-01-01T00:00:00.000Z' }, { currentBuiltAt: '2026-06-01T00:00:00.000Z', now: T });
  check('hold', 'builtAt older than the installed build is unverified', r.rel.verified === false && /старше сборки/.test(r.rel.problems.join(' ')), r.rel.problems);

  r = await run({ builtAt: '2026-06-01T00:00:00.000Z' }, { currentBuiltAt: '2026-06-01T00:00:00.000Z', now: T });
  check('measured', 'builtAt equal to the installed build is not treated as older', r.rel.verified === true, r.rel.problems);

  r = await run({ builtAt: iso(T + 5 * 60000) }, { currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'builtAt exactly 5 minutes ahead is accepted', r.rel.verified === true, r.rel.problems);
  r = await run({ builtAt: iso(T + 5 * 60000 + 1) }, { currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'builtAt 5 minutes plus 1 ms ahead is unverified', r.rel.verified === false && /будущем/.test(r.rel.problems.join(' ')), r.rel.problems);
  r = await run({ builtAt: iso(T) }, { currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T - 10 * 60000 });
  check('hold', 'a clock 10 minutes behind rejects a builtAt of "now" (fail closed)', r.rel.verified === false && /будущем/.test(r.rel.problems.join(' ')), r.rel.problems);

  r = await run({ version: '1.10.0' }, { current: '1.9.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', '1.10.0 is newer than 1.9.0', r.rel.verified === true, r.rel.problems);
  r = await run({ version: '1.9.0' }, { current: '1.10.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', '1.9.0 against current 1.10.0 is an unverified downgrade', r.rel.verified === false && /anti-rollback/.test(r.rel.problems.join(' ')), r.rel.problems);
  r = await run({ version: '1.10.0' }, { current: '1.10.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'an equal version is unverified', r.rel.verified === false && /равна/.test(r.rel.problems.join(' ')), r.rel.problems);
  r = await run({ version: '1.10' }, { current: '1.9.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'a two-part version 1.10 is not verified', r.rel.verified === false, r.rel.problems);
  r = await run({ version: '1.3.0-rc.1', current: '1.3.0' }, { current: '1.3.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'a prerelease of the same numbers compares equal and is unverified', UC.cmpVer('1.3.0-rc.1', '1.3.0') === 0 && r.rel.verified === false, r.rel.problems);
  r = await run({ version: 'v1.3.0', tag: 'v1.3.0' }, { current: '1.2.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'a v-prefix on the manifest version does not match tag v1.3.0', r.rel.verified === false, r.rel.problems);
  r = await run({ version: '1.3.0', assetVersion: '11.3.0', tag: 'v1.3.0-mac-preview' }, { current: '1.2.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('residual', 'zip filename 11.3.0 satisfies version 1.3.0 because the check is a substring', r.rel.verified === true, { asset: r.rel.manifest && r.rel.manifest.assets[0].name });
  r = await run({ version: '1.3.0', assetVersion: '1.4.0' }, { current: '1.2.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'a zip name that does not contain the signed version is unverified', r.rel.verified === false && /не соответствует подписанной версии/.test(r.rel.problems.join(' ')), r.rel.problems);
  r = await run({}, { current: '1.3.0', currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  check('hold', 'version 1.3.0 equal to current is unverified even with a fresh builtAt', r.rel.verified === false, r.rel.problems);

  r = await run({ noBuiltAt: true }, { currentBuiltAt: '2026-01-01T00:00:00.000Z', now: T });
  let download = null;
  try { r.uc.prepareDownload(r.rel.tag); download = 'allowed'; } catch (e) { download = e.code; }
  check('hold', 'a manifest without builtAt is unverified and download is refused', r.rel.verified === false && /builtAt/.test(r.rel.problems.join(' ')) && download === 'UNVERIFIED', { download, problems: r.rel.problems });

  const old = signedRelease(owner, { builtAt: '2020-01-01T00:00:00.000Z', version: '1.3.0' }).manifest;
  const g = UC.gate({ manifest: old, verified: true, current: '1.1.2', installed: PROD, compat: { ok: true }, backup: { verified: true }, approval: { manifestSha256: 'h' }, manifestSha256: 'h', publishedAt: '2026-10-21T12:00:00.000Z', now: T });
  check('hold', 'a signed builtAt of 2020 still fails the 365-day gate when published_at is fresh', g.allowed === false && /replay|дн/.test(g.reasons.join(' ')), g.reasons);

  const dev = await run({ builtAt: '2026-01-01T00:00:00.000Z', version: '1.3.0' }, { currentBuiltAt: null, now: T, current: '1.1.2' });
  try { dev.uc.prepareDownload(dev.rel.tag); download = 'allowed'; } catch (e) { download = e.code; }
  check('hold', 'a dev run without build-info says the age check is unavailable', dev.buildAge.available === false && /проверка возраста сборки недоступна/.test(dev.buildAge.message) && (dev.rel.warnings || []).includes(UC.BUILD_AGE_NA), dev.buildAge.message);
  check('residual', 'without build-info an older signed release stays verified and download is allowed', dev.rel.verified === true && download === 'allowed', { warnings: dev.rel.warnings, problems: dev.rel.problems });
  r = await run({ builtAt: iso(T + 3600e3) }, { currentBuiltAt: null, now: T });
  check('hold', 'without build-info a future builtAt is still unverified', r.rel.verified === false && /будущем/.test(r.rel.problems.join(' ')), r.rel.problems);
  r = await run({ version: '1.1.2' }, { currentBuiltAt: null, now: T, current: '1.1.2' });
  check('hold', 'without build-info an equal version is still unverified', r.rel.verified === false && /anti-rollback/.test(r.rel.problems.join(' ')), r.rel.problems);
}

async function packagedLayout(owner) {
  const asar = require('@electron/asar');
  const resources = tmp();
  const unpacked = path.join(resources, 'app.asar.unpacked');
  fs.cpSync(path.join(ROOT, 'lib'), path.join(unpacked, 'lib'), { recursive: true });
  const stage = tmp();
  fs.mkdirSync(path.join(stage, 'desktop'), { recursive: true });
  const builtAt = '2026-06-01T00:00:00.000Z';
  fs.writeFileSync(path.join(stage, 'desktop/build-info.json'), JSON.stringify({ builtAt, commit: 'a'.repeat(40), version: '1.1.2' }));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(stage, 'lib'), { recursive: true });
  const archive = path.join(resources, 'app.asar');
  await asar.createPackage(stage, archive);
  const listed = asar.listPackage(archive).map((x) => x.replace(/\\/g, '/'));
  const unpackedInfo = path.join(unpacked, 'desktop/build-info.json');
  const P = require(path.join(unpacked, 'lib/ops/update-center.js'));
  const seen = P.readBuildInfoBuiltAt();
  const env = { OPS_UPDATE_KEYRING_DIR: writeRing(tmp(), owner.id, owner.pub) };
  const old = await checkRelease(signedRelease(owner, { builtAt: '2026-01-01T00:00:00.000Z', version: '1.3.0' }), { env, centerImpl: P, now: Date.parse('2026-10-21T12:00:00.000Z'), current: '1.1.2' });
  let download = null;
  try { old.uc.prepareDownload(old.rel.tag); download = 'allowed'; } catch (e) { download = e.code; }
  check('residual', 'the unpacked server does not see build-info.json inside app.asar, so an older signed release stays verified', listed.includes('/desktop/build-info.json') && !fs.existsSync(unpackedInfo) && seen == null && old.buildAge.available === false && old.rel.verified === true && download === 'allowed', { seen, download, message: old.buildAge.message });

  const beside = tmp();
  fs.cpSync(path.join(ROOT, 'lib'), path.join(beside, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(beside, 'desktop'), { recursive: true });
  fs.writeFileSync(path.join(beside, 'desktop/build-info.json'), JSON.stringify({ builtAt, commit: 'b'.repeat(40) }));
  const Q = require(path.join(beside, 'lib/ops/update-center.js'));
  const present = await checkRelease(signedRelease(owner, { builtAt: '2026-01-01T00:00:00.000Z' }), { env, centerImpl: Q, now: Date.parse('2026-10-21T12:00:00.000Z') });
  check('hold', 'when build-info.json sits beside the module, an older builtAt is unverified', Q.readBuildInfoBuiltAt() === builtAt && present.rel.verified === false && /старше сборки/.test(present.rel.problems.join(' ')), present.rel.problems);
  fs.rmSync(path.join(beside, 'desktop/build-info.json'));
  const missing = await checkRelease(signedRelease(owner, { builtAt: '2026-01-01T00:00:00.000Z' }), { env, centerImpl: Q, now: Date.parse('2026-10-21T12:00:00.000Z') });
  try { missing.uc.prepareDownload(missing.rel.tag); download = 'allowed'; } catch (e) { download = e.code; }
  check('residual', 'a packaged layout with build-info.json removed does not fail closed', Q.readBuildInfoBuiltAt() == null && missing.buildAge.available === false && /dev-запуск/.test(missing.buildAge.message) && missing.rel.verified === true && download === 'allowed', missing.buildAge.message);
}

function buildInfoWriter() {
  const out = path.join(tmp(), 'build-info.json');
  const missing = spawnSync(process.execPath, [path.join(ROOT, 'scripts/write-build-info.mjs'), '--builder', 'test', '--out', out], { encoding: 'utf8' });
  check('hold', 'write-build-info refuses to run without SOURCE_DATE_EPOCH and does not write the file', missing.status === 1 && !fs.existsSync(out), { status: missing.status });
  const epoch = 1700000000;
  const wrote = spawnSync(process.execPath, [path.join(ROOT, 'scripts/write-build-info.mjs'), '--builder', 'test', '--out', out], { env: { ...process.env, SOURCE_DATE_EPOCH: String(epoch), COMMIT: 'c'.repeat(40) }, encoding: 'utf8' });
  let info = null;
  try { info = JSON.parse(fs.readFileSync(out, 'utf8')); } catch {}
  check('hold', 'write-build-info writes builtAt from SOURCE_DATE_EPOCH', wrote.status === 0 && info && info.builtAt === new Date(epoch * 1000).toISOString() && info.commit === 'c'.repeat(40) && !fs.existsSync(path.join(ROOT, 'desktop/build-info.json')), info && info.builtAt);
  const sh = fs.readFileSync(path.join(ROOT, 'scripts/mac-keyring-check.sh'), 'utf8');
  check('measured', 'mac-keyring-check.sh selects BSD stat on Darwin and GNU stat otherwise, and mktemp stays under TMPDIR', /stat -f '%Lp'/.test(sh) && /stat -f '%u'/.test(sh) && /stat -c '%a'/.test(sh) && /mktemp -d "\$\{TMPDIR:-\/tmp\}/.test(sh), null);
  const parent = tmp();
  const real = path.join(parent, 'real');
  fs.mkdirSync(real);
  const link = path.join(parent, 'var');
  fs.symlinkSync(real, link);
  const script = spawnSync('bash', [path.join(ROOT, 'scripts/mac-keyring-check.sh')], { cwd: ROOT, env: { ...process.env, TMPDIR: link + '/' }, encoding: 'utf8' });
  check('hold', 'mac-keyring-check.sh passes when TMPDIR goes through a parent symlink, and it removes its temp dir', script.status === 0 && /ВСЕ PASS/.test(script.stdout) && /0700/.test(script.stdout) && fs.readdirSync(real).length === 0, { status: script.status, tail: (script.stdout || '').split('\n').slice(-4) });
}

function flagsAndSchema() {
  const uc = UC.createUpdateCenter({ dir: tmp(), current: '1.1.2', identity: PROD, env: {}, healthUrl: 'http://127.0.0.1:1/api/health' });
  check('hold', 'with no external keyring the signature state is BLOCKED and build age is unavailable', uc.status().signature.state === 'BLOCKED' && uc.status().signature.message === UC.BLOCKED_NO_KEY && uc.status().buildAge.available === false, uc.status().signature.message);
  const flags = uc.flags;
  check('hold', 'the four auto-install flags default off', flags.autoInstall === false && flags.signatureReady === false && flags.backupReady === false && flags.rollbackTestedOnRealMac === false, null);
  for (const v of ['true', 'yes', 'on', '0', '']) {
    const u = UC.createUpdateCenter({ dir: tmp(), current: '1.1.2', identity: PROD, env: { OPS_UPDATE_AUTO_INSTALL: v, OPS_UPDATE_SIGNATURE_READY: v, OPS_UPDATE_BACKUP_VERIFIED_READY: v, OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: v }, healthUrl: 'http://127.0.0.1:1/api/health' });
    if (u.status().autoInstall.enabled) check('hold', `flag value ${JSON.stringify(v)} stays off`, false, null);
  }
  check('hold', 'only the exact string 1 is treated as off for the values true/yes/on/0/empty', true, null);
  const one = UC.createUpdateCenter({ dir: tmp(), current: '1.1.2', identity: PROD, env: { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1' }, healthUrl: 'http://127.0.0.1:1/api/health' });
  check('measured', 'all four flags set to 1 enable the auto-install status, and the empty prod ring is still BLOCKED', one.status().autoInstall.enabled === true && one.status().signature.state === 'BLOCKED', null);
  check('hold', 'SUPPORTED_SCHEMA is 1', UM.SUPPORTED_SCHEMA === 1, UM.SUPPORTED_SCHEMA);
  const um = UM.createUpdateManager();
  function fakeDb(version) {
    const tables = ['items', 'meta'];
    if (version >= 2) tables.push('jobs');
    return { prepare(sql) { return { all() { if (String(sql).includes('sqlite_master')) return tables.map((name) => ({ name })); if (String(sql).includes('table_info')) return version >= 3 ? [{ name: 'input' }] : [{ name: 'id' }]; return []; }, get() { return { v: String(version) }; } }; } };
  }
  const s1 = um.schemaCheck(fakeDb(1));
  const s2 = um.schemaCheck(fakeDb(2));
  check('hold', 'schema 1 passes and schema 2 fails closed', s1.ok === true && s2.ok === false && s2.supported === 1, { s1: s1.ok, s2: s2.detail });
}

async function main() {
  const owner = pair();
  const attacker = pair();
  keyringAttacks(owner, attacker);
  parentSwap(owner, attacker);
  const race = raceParent(owner, attacker);
  hardlinkAndAcl(owner, attacker);
  extraModeBits(owner);
  await ageAndVersion(owner);
  await packagedLayout(owner);
  buildInfoWriter();
  flagsAndSchema();
  const endDirty = spawnSync('git', ['-C', ROOT, 'status', '--short'], { encoding: 'utf8' });
  check('hold', 'the product worktree is still clean', !(endDirty.stdout || '').trim(), endDirty.stdout);
  const failed = results.filter((r) => !r.ok);
  const summary = {
    commit: '51005681b646f18093aa9f88668dd691f283105d',
    results: results.length,
    failed: failed.length,
    failedRows: failed,
    findings,
    race,
  };
  const text = JSON.stringify(summary, null, 2);
  if (/PRIVATE KEY/.test(text) || /qa-passphrase/.test(text)) {
    console.error('refusing to write a log that contains key material');
    process.exit(3);
  }
  fs.writeFileSync(path.join(OUT, 'attack.json'), text + '\n');
  console.log(JSON.stringify({ results: summary.results, failed: summary.failed, findings: findings.length, race }));
  if (summary.failed) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
