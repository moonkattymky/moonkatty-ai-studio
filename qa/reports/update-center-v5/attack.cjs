'use strict';
// Re-audit of Update Center at 8b0fbc6 (diff against 5100568). No install, no publish, no live GitHub.
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = process.env.UC_SRC || '/tmp/mk-uc5';
const dirty = spawnSync('git', ['-C', ROOT, 'status', '--short'], { encoding: 'utf8' });
if ((dirty.stdout || '').trim()) {
  console.error('product worktree is not clean');
  process.exit(2);
}
const HEAD = spawnSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

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

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'qa-uc5-'));
function pair() {
  const keys = crypto.generateKeyPairSync('ed25519');
  const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
  return { keys, pub, id: UC.keyIdOf(keys.publicKey) };
}
function writeRing(dir, id, pub, { mode = 0o700, fileMode = 0o644, jsonMode = 0o600, name = 'k.pub.pem', revoked = [], extraKeys = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, mode);
  const keys = extraKeys || { [id]: { file: name, set: 'prod', status: 'active' } };
  if (!extraKeys) {
    fs.writeFileSync(path.join(dir, name), pub);
    fs.chmodSync(path.join(dir, name), fileMode);
  }
  fs.writeFileSync(path.join(dir, 'keyring.json'), JSON.stringify({ version: 1, keys, revoked }) + '\n');
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
const ENV_SPOOF = {
  STUDIO_FLAVOR: 'dev',
  NODE_ENV: 'development',
  ELECTRON_IS_PACKAGED: '0',
  ELECTRON_RUN_AS_NODE: '1',
  OPS_UPDATE_PACKAGED: '0',
  STUDIO_PACKAGED: 'false',
  STUDIO_DEV: '1',
};

function signedRelease(keys, { version = '1.3.0', channel = 'preview', builtAt = '2026-10-21T12:00:00.000Z', assetVersion, tag } = {}) {
  const name = `MOONKATTY-AI-STUDIO-${assetVersion || version}-arm64-mac.zip`;
  const manifest = {
    manifestVersion: 1, version, channel, sourceCommit: 'a'.repeat(40), arch: 'arm64', platform: 'darwin',
    bundleId: 'com.moonkatty.aistudio', appName: APP, dataDirName: APP,
    launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: APP, defaultPort: 8787,
    dbSchemaVersion: 1, minUpgradeFrom: '1.1.2', isolated: false, isolatedFrom: [],
    signing: 'adhoc', notarized: false, builtAt,
    assets: [{ name, size: 32, sha256: 'ab'.repeat(32) }],
  };
  const mb = Buffer.from(JSON.stringify(manifest));
  const sig = crypto.sign(null, mb, keys.keys.privateKey);
  const sigBuf = Buffer.from(JSON.stringify({ v: 1, alg: 'ed25519', keyId: keys.id, sig: sig.toString('base64') }));
  const useTag = tag || (channel === 'preview' ? `v${version}-mac-preview` : `v${version}`);
  return { tag: useTag, mb, sig: sigBuf, name, manifest };
}

async function checkRelease(rel, { current = '1.1.2', currentBuiltAt, now = Date.parse('2026-10-21T12:00:00.000Z'), env = {}, centerImpl = UC, packaged } = {}) {
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
  if (packaged !== undefined) opt.packaged = packaged;
  const uc = centerImpl.createUpdateCenter(opt);
  const st = await uc.check();
  const item = st.releases[0];
  let download = null;
  try { uc.prepareDownload(item.tag); download = 'allowed'; } catch (e) { download = e.code; }
  return { uc, rel: item, buildAge: st.buildAge, signature: st.signature, download };
}

function unpackCopy() {
  const root = path.join(tmp(), 'MOONKATTY AI STUDIO.app', 'Contents', 'Resources', 'app.asar.unpacked');
  fs.cpSync(path.join(ROOT, 'lib'), path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'desktop'), { recursive: true });
  const asarSibling = path.join(path.dirname(root), 'app.asar');
  fs.mkdirSync(path.join(asarSibling, 'desktop'), { recursive: true });
  return {
    root,
    mod: path.join(root, 'lib/ops/update-center.js'),
    info: path.join(root, 'desktop/build-info.json'),
    asarInfo: path.join(asarSibling, 'desktop/build-info.json'),
  };
}

function sigOf(keys, body) {
  const mb = Buffer.from(body);
  const sig = crypto.sign(null, mb, keys.keys.privateKey);
  return { mb, sig: Buffer.from(JSON.stringify({ v: 1, alg: 'ed25519', keyId: keys.id, sig: sig.toString('base64') })) };
}

async function main() {
  check('hold', 'audited commit is 8b0fbc6', HEAD.startsWith('8b0fbc6'), HEAD);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check('hold', 'asarUnpack lists desktop/build-info.json and the package version is still 1.1.2', pkg.version === '1.1.2' && pkg.build.asarUnpack.includes('desktop/build-info.json') && pkg.build.asarUnpack.includes('lib/**'), pkg.build.asarUnpack);
  const indexSrc = fs.readFileSync(path.join(ROOT, 'lib/ops/index.js'), 'utf8');
  const call = indexSrc.slice(indexSrc.indexOf('createUpdateCenter('), indexSrc.indexOf('createUpdateCenter(') + 420);
  check('hold', 'lib/ops/index.js does not pass packaged and does not read an env flag for it', call.includes('createUpdateCenter({') && !call.includes('packaged') && !/ELECTRON_IS_PACKAGED|OPS_UPDATE_PACKAGED/.test(indexSrc), call.split('\n')[0]);
  check('hold', 'O_NOFOLLOW is present on this platform', !!fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
  check('hold', 'SUPPORTED_SCHEMA is 1', UM.SUPPORTED_SCHEMA === 1, UM.SUPPORTED_SCHEMA);

  const owner = pair();
  const attacker = pair();
  const ring = tmp();
  writeRing(ring, owner.id, owner.pub);
  const empty = UC.signatureStatus(UC.loadKeyrings({ env: {} }), 'prod');
  check('hold', 'an empty prod ring is BLOCKED', empty.state === 'BLOCKED' && empty.message === UC.BLOCKED_NO_KEY, empty.message);
  const flagUc = UC.createUpdateCenter({ dir: tmp(), current: '1.1.2', identity: PROD, env: {}, healthUrl: 'http://127.0.0.1:1/api/health', currentBuiltAt: '2026-06-01T00:00:00.000Z' });
  check('hold', 'the four auto-install flags and node updates stay off', flagUc.flags.autoInstall === false && flagUc.flags.signatureReady === false && flagUc.flags.backupReady === false && flagUc.flags.rollbackTestedOnRealMac === false && flagUc.flags.nodeUpdates === false, flagUc.flags);

  const layout = unpackCopy();
  const packed = require(layout.mod);
  check('hold', 'a module path inside app.asar.unpacked is packaged', packed.isPackagedPath() === true && UC.isPackagedPath() === false && UC.isPackagedPath('/tmp/app.asar/lib/ops') === true, { packed: layout.mod, dev: __dirname });

  const newer = signedRelease(owner, { builtAt: '2026-10-21T12:00:00.000Z' });
  const older = signedRelease(owner, { builtAt: '2026-01-01T00:00:00.000Z', version: '1.3.0', tag: 'v1.3.0-mac-preview' });
  const baseEnv = { ...ENV_SPOOF, OPS_UPDATE_KEYRING_DIR: ring };

  const saved = {};
  for (const [k, v] of Object.entries(ENV_SPOOF)) { saved[k] = process.env[k]; process.env[k] = v; }
  let missing;
  try {
    missing = await checkRelease(newer, { env: baseEnv, centerImpl: packed });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  check('hold', 'env cannot force dev mode: a packaged path with no build-info fails closed', missing.buildAge.packaged === true && missing.buildAge.failClosed === true && missing.buildAge.message === packed.BUILD_INFO_BLOCKED && missing.rel.verified === false && missing.rel.problems.includes(packed.BUILD_INFO_BLOCKED) && missing.download === 'UNVERIFIED' && missing.signature.state === 'READY', { buildAge: missing.buildAge, verified: missing.rel.verified, download: missing.download, signature: missing.signature.state, problems: missing.rel.problems });

  fs.writeFileSync(layout.asarInfo, JSON.stringify({ builtAt: '2026-06-01T00:00:00.000Z', commit: 'abc' }));
  const asarOnly = await checkRelease(newer, { env: baseEnv, centerImpl: packed });
  check('hold', 'a build-info that exists only inside app.asar is invisible to the unpacked server and is BLOCKED', asarOnly.buildAge.failClosed === true && asarOnly.rel.verified === false && asarOnly.download === 'UNVERIFIED', asarOnly.buildAge);

  const samples = [
    ['empty', ''],
    ['whitespace', '   \n'],
    ['truncated brace', '{'],
    ['truncated object', '{"builtAt":"2026-06-01T00:00:00.000Z"'],
    ['null builtAt', '{"builtAt":null}'],
    ['empty builtAt', '{"builtAt":""}'],
    ['unparsed builtAt', '{"builtAt":"not-a-date"}'],
    ['commit only', '{"commit":"abc"}'],
    ['numeric builtAt', '{"builtAt":1700000000}'],
    ['boolean builtAt', '{"builtAt":true}'],
  ];
  const corrupt = [];
  for (const [name, body] of samples) {
    fs.writeFileSync(layout.info, body);
    const got = await checkRelease(newer, { env: baseEnv, centerImpl: packed });
    const ok = got.buildAge.failClosed === true && got.buildAge.message === packed.BUILD_INFO_BLOCKED && got.rel.verified === false && got.rel.problems.includes(packed.BUILD_INFO_BLOCKED) && got.download === 'UNVERIFIED';
    corrupt.push({ name, ok, verified: got.rel.verified, download: got.download, message: got.buildAge.message });
  }
  check('hold', 'a corrupted or partial build-info is BLOCKED on a packaged path', corrupt.every(c => c.ok), corrupt);

  fs.writeFileSync(layout.info, '{"builtAt":"2026-06-01"}');
  const dateOnly = await checkRelease(newer, { env: baseEnv, centerImpl: packed });
  check('measured', 'a date-only builtAt parses, so a packaged app with that file is not fail-closed', dateOnly.buildAge.available === true && dateOnly.buildAge.builtAt === '2026-06-01' && dateOnly.rel.verified === true && dateOnly.download === 'allowed', { buildAge: dateOnly.buildAge, verified: dateOnly.rel.verified, download: dateOnly.download });

  fs.writeFileSync(layout.info, JSON.stringify({ commit: 'abc', builtAt: '2026-06-01T00:00:00.000Z' }));
  const aged = await checkRelease(older, { env: baseEnv, centerImpl: packed });
  const fresh = await checkRelease(newer, { env: baseEnv, centerImpl: packed });
  check('hold', 'a readable unpacked build-info rejects an older signed builtAt and accepts a newer one', aged.rel.verified === false && aged.download === 'UNVERIFIED' && /старше сборки/.test(aged.rel.problems.join('\n')) && fresh.rel.verified === true && fresh.download === 'allowed' && fresh.buildAge.packaged === true && fresh.buildAge.builtAt === '2026-06-01T00:00:00.000Z', { older: aged.rel.problems, newer: { verified: fresh.rel.verified, download: fresh.download } });

  fs.rmSync(layout.info, { force: true });
  const dev = await checkRelease(newer, { env: baseEnv, centerImpl: UC });
  check('hold', 'the same env on a dev path stays a warning and the release stays verified', UC.isPackagedPath() === false && dev.buildAge.packaged === false && dev.buildAge.failClosed !== true && String(dev.buildAge.message).includes(UC.BUILD_AGE_NA) && dev.rel.verified === true && dev.download === 'allowed' && !(dev.rel.problems || []).includes(UC.BUILD_INFO_BLOCKED), { buildAge: dev.buildAge, verified: dev.rel.verified, warnings: dev.rel.warnings || null });

  const forced = await checkRelease(newer, { env: baseEnv, centerImpl: packed, packaged: false });
  check('measured', 'createUpdateCenter({ packaged: false }) overrides the path check; index.js does not pass it', forced.buildAge.packaged === false && forced.buildAge.failClosed !== true && forced.rel.verified === true, { buildAge: forced.buildAge, verified: forced.rel.verified });

  const good = tmp();
  writeRing(good, owner.id, owner.pub);
  check('hold', 'a mode 0700 directory owned by this uid is READY', stateOf(good).state === 'READY' && load(good).prod.has(owner.id), null);

  const parent = tmp();
  const child = path.join(parent, 'kr');
  writeRing(child, owner.id, owner.pub);
  fs.chmodSync(parent, 0o1777);
  const sticky = stateOf(child);
  fs.chmodSync(parent, 0o777);
  const world = stateOf(child);
  const worldKr = load(child);
  fs.chmodSync(parent, 0o755);
  const ownerOnly = stateOf(child);
  fs.chmodSync(parent, 0o770);
  const group = stateOf(child);
  fs.chmodSync(parent, 0o700);
  check('hold', 'a world-writable parent without the sticky bit is BLOCKED', world.state === 'BLOCKED' && /без sticky/.test(world.message) && worldKr.blocked && !worldKr.prod.has(owner.id), world.message);
  check('hold', 'a sticky 1777 parent and a 0755 parent stay READY', sticky.state === 'READY' && ownerOnly.state === 'READY', { sticky: sticky.state, ownerOnly: ownerOnly.state });
  check('measured', 'a group-writable 0770 parent is not covered by the other-write check and stays READY', group.state === 'READY' && load(child).prod.has(owner.id), group.message);

  spawnSync('sudo', ['-n', 'chgrp', 'nogroup', parent]);
  fs.chmodSync(parent, 0o770);
  const plant = path.join(parent, 'plant');
  const nobodySwap = spawnSync('sudo', ['-n', '-u', 'nobody', 'mv', child, plant], { encoding: 'utf8' });
  let nobodyBlocked = null;
  if (nobodySwap.status === 0) {
    const foreign = path.join(parent, 'kr');
    writeRing(foreign, attacker.id, attacker.pub);
    spawnSync('sudo', ['-n', 'chown', '-R', 'nobody:nogroup', foreign]);
    const st = stateOf(foreign);
    nobodyBlocked = { state: st.state, attacker: load(foreign).prod.has(attacker.id), message: st.message };
    spawnSync('sudo', ['-n', 'rm', '-rf', foreign]);
    spawnSync('sudo', ['-n', 'mv', plant, child]);
  }
  fs.chmodSync(parent, 0o700);
  check('measured', 'nobody in the group can rename a keyring out of a 0770 parent, and a nobody-owned ring is BLOCKED', nobodySwap.status === 0 && nobodyBlocked && nobodyBlocked.state === 'BLOCKED' && nobodyBlocked.attacker === false, { mv: nobodySwap.status, stderr: nobodySwap.stderr, nobodyBlocked });

  const realParent = tmp();
  const kr = path.join(realParent, 'kr');
  writeRing(kr, owner.id, owner.pub);
  const via = path.join(tmp(), 'var', 'kr');
  fs.symlinkSync(realParent, path.dirname(via));
  check('hold', 'a symlinked parent in the /var shape is READY', stateOf(via).state === 'READY' && load(via).prod.has(owner.id), null);
  const unsafeReal = tmp();
  fs.chmodSync(unsafeReal, 0o777);
  const unsafeKr = path.join(unsafeReal, 'kr');
  writeRing(unsafeKr, owner.id, owner.pub);
  const viaUnsafe = path.join(tmp(), 'alias', 'kr');
  fs.symlinkSync(unsafeReal, path.dirname(viaUnsafe));
  const unsafeSt = stateOf(viaUnsafe);
  check('hold', 'a resolved parent that is 0777 without sticky is BLOCKED even when the logical parent looks private', unsafeSt.state === 'BLOCKED' && /без sticky/.test(unsafeSt.message), unsafeSt.message);

  const linkDir = path.join(tmp(), 'link');
  fs.symlinkSync(good, linkDir);
  check('hold', 'the keyring directory itself as a symlink is BLOCKED', stateOf(linkDir).state === 'BLOCKED' && /символическая ссылка/.test(stateOf(linkDir).message), stateOf(linkDir).message);
  const fileLink = tmp();
  writeRing(fileLink, owner.id, owner.pub);
  const outside = path.join(tmp(), 'out.pub.pem');
  fs.writeFileSync(outside, attacker.pub, { mode: 0o644 });
  fs.rmSync(path.join(fileLink, 'k.pub.pem'));
  fs.symlinkSync(outside, path.join(fileLink, 'k.pub.pem'));
  const fileKr = load(fileLink);
  check('hold', 'a symlinked .pub.pem is BLOCKED and the outside key is not loaded', fileKr.blocked && !fileKr.prod.has(attacker.id) && !fileKr.prod.has(owner.id), fileKr.blocked);

  const base = tmp();
  writeRing(base, owner.id, owner.pub);
  const ext = tmp();
  writeRing(ext, attacker.id, attacker.pub, { revoked: [owner.id] });
  const revoked = UC.loadKeyrings({ dir: base, env: { OPS_UPDATE_KEYRING_DIR: ext } });
  const body = sigOf(owner, '{"v":1}');
  const verdict = UC.verifySig(body.mb, body.sig, revoked, 'preview');
  check('hold', 'a revocation in the external keyring removes the base key and the signature fails', !revoked.blocked && revoked.revoked.has(owner.id) && !revoked.prod.has(owner.id) && revoked.prod.has(attacker.id) && verdict.ok === false && /отозван/.test(verdict.reason), { revoked: [...revoked.revoked], reason: verdict.reason, state: UC.signatureStatus(revoked).state });

  const self = tmp();
  writeRing(self, attacker.id, attacker.pub, { revoked: [attacker.id] });
  const selfKr = UC.loadKeyrings({ dir: base, env: { OPS_UPDATE_KEYRING_DIR: self } });
  check('hold', 'an external ring that revokes its own key does not load that key', selfKr.revoked.has(attacker.id) && !selfKr.prod.has(attacker.id) && selfKr.prod.has(owner.id) && !selfKr.blocked && UC.signatureStatus(selfKr).state === 'READY', { state: UC.signatureStatus(selfKr).state, revoked: [...selfKr.revoked] });

  const rejected = tmp();
  writeRing(rejected, attacker.id, attacker.pub, { mode: 0o777, revoked: [owner.id] });
  const rejectedKr = UC.loadKeyrings({ dir: base, env: { OPS_UPDATE_KEYRING_DIR: rejected } });
  check('hold', 'a rejected external directory does not apply its revocations', rejectedKr.blocked && rejectedKr.prod.has(owner.id) && !rejectedKr.revoked.has(owner.id) && !rejectedKr.prod.has(attacker.id), rejectedKr.blocked);

  const mixed = tmp();
  fs.chmodSync(mixed, 0o700);
  const fakeId = '0123456789abcdef';
  const mixedKeys = {
    [fakeId]: { set: 'prod', status: 'active', publicKeyPem: '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n' },
    [attacker.id]: { set: 'prod', status: 'active', publicKeyPem: attacker.pub },
  };
  fs.writeFileSync(path.join(mixed, 'keyring.json'), JSON.stringify({ version: 1, keys: mixedKeys, revoked: [owner.id] }) + '\n', { mode: 0o600 });
  fs.chmodSync(path.join(mixed, 'keyring.json'), 0o600);
  fs.chmodSync(mixed, 0o700);
  const mixedKr = UC.loadKeyrings({ dir: base, env: { OPS_UPDATE_KEYRING_DIR: mixed } });
  check('hold', 'a bad external entry is merged as a problem, its revocation still applies, and the valid key loads', !mixedKr.blocked && mixedKr.problems.some(p => p.includes('ПРИВАТНЫЙ')) && mixedKr.revoked.has(owner.id) && !mixedKr.prod.has(owner.id) && mixedKr.prod.has(attacker.id) && !mixedKr.prod.has(fakeId), mixedKr.problems);

  const origOpen = fs.openSync;
  const origLstat = fs.lstatSync;
  function withWindow(real, evil, { restore }) {
    let swapped = false;
    let restored = false;
    fs.openSync = function patched(p, flags, ...rest) {
      const dirOpen = (flags & fs.constants.O_DIRECTORY) === fs.constants.O_DIRECTORY;
      if (!swapped && !dirOpen && String(p) === path.join(real, 'keyring.json')) {
        const park = real + '.park';
        fs.renameSync(real, park);
        fs.renameSync(evil, real);
        swapped = true;
      }
      return origOpen.call(this, p, flags, ...rest);
    };
    fs.lstatSync = function patched(p, ...rest) {
      if (restore && swapped && !restored && path.resolve(String(p)) === path.resolve(real)) {
        fs.renameSync(real, evil);
        fs.renameSync(real + '.park', real);
        restored = true;
      }
      return origLstat.call(this, p, ...rest);
    };
    try { return { kr: load(real), swapped, restored }; }
    finally { fs.openSync = origOpen; fs.lstatSync = origLstat; }
  }

  const winReal = path.join(tmp(), 'kr');
  const winEvil = path.join(tmp(), 'evil');
  writeRing(winReal, owner.id, owner.pub);
  writeRing(winEvil, attacker.id, attacker.pub);
  const won = withWindow(winReal, winEvil, { restore: true });
  const wonSt = UC.signatureStatus(won.kr, 'prod');
  check('residual', 'no openat: swapping the real directory after the directory fd and restoring it before the final lstat loads the attacker key', won.swapped && won.restored && wonSt.state === 'READY' && won.kr.prod.has(attacker.id) && !won.kr.prod.has(owner.id) && !won.kr.blocked, { state: wonSt.state, swapped: won.swapped, restored: won.restored, blocked: won.kr.blocked || null });

  const leftReal = path.join(tmp(), 'kr');
  const leftEvil = path.join(tmp(), 'evil');
  writeRing(leftReal, owner.id, owner.pub);
  writeRing(leftEvil, attacker.id, attacker.pub);
  const left = withWindow(leftReal, leftEvil, { restore: false });
  check('hold', 'leaving the swapped directory in place fails the dev/ino recheck and does not merge the attacker key', left.swapped && left.kr.blocked && /подменена/.test(left.kr.blocked) && !left.kr.prod.has(attacker.id), left.kr.blocked);
  if (fs.existsSync(leftReal + '.park')) {
    fs.rmSync(leftReal, { recursive: true, force: true });
    fs.renameSync(leftReal + '.park', leftReal);
  }

  const v4 = raceNobody(owner, attacker, 20000);
  check('measured', 'higher-volume race: nobody retargets a parent symlink in a non-sticky 0777 directory', true, v4);
  if (v4.hits > 0) check('residual', 'the parent-symlink race loaded the attacker key', true, v4);
  else check('hold', 'the parent-symlink race loaded no attacker key', v4.loads > 1000 && v4.hits === 0, v4);

  const live = raceSameUser(owner, attacker, 12000);
  check('measured', 'higher-volume race: same-user rename of the real directory during loads', true, live);
  if (live.hits > 0) check('residual', 'the live same-user rename race loaded the attacker key', true, live);

  const hard = tmp();
  const hardFile = path.join(tmp(), 'mine.pub.pem');
  fs.writeFileSync(hardFile, owner.pub, { mode: 0o644 });
  fs.linkSync(hardFile, path.join(hard, 'k.pub.pem'));
  fs.writeFileSync(path.join(hard, 'keyring.json'), JSON.stringify({ version: 1, keys: { [owner.id]: { file: 'k.pub.pem', set: 'prod', status: 'active' } }, revoked: [] }), { mode: 0o600 });
  fs.chmodSync(hard, 0o700);
  const hardSt = fs.lstatSync(path.join(hard, 'k.pub.pem'));
  check('measured', 'a same-user hardlink is a regular file and is loaded', hardSt.nlink >= 2 && !hardSt.isSymbolicLink() && stateOf(hard).state === 'READY', { nlink: hardSt.nlink });

  const summary = { head: HEAD, results: results.length, failed: results.filter(r => !r.ok).length, findings, results };
  fs.writeFileSync(path.join(OUT, 'attack.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ results: summary.results, failed: summary.failed, findings: findings.length }));
  if (summary.failed) process.exit(1);
}

function raceNobody(owner, attacker, ms) {
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
    const end = Date.now() + ${ms + 1000};
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
  let readyOwner = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let kr;
    try { kr = load(logical); } catch { continue; }
    loads += 1;
    if (kr.prod.has(attacker.id)) hits += 1;
    else if (kr.blocked) blocked += 1;
    else if (kr.prod.has(owner.id)) readyOwner += 1;
  }
  try { child.kill('SIGKILL'); } catch {}
  return { loads, hits, blocked, readyOwner, ms };
}

function raceSameUser(owner, attacker, ms) {
  const parent = tmp();
  const real = path.join(parent, 'kr');
  const evil = path.join(tmp(), 'evil');
  const park = path.join(tmp(), 'park');
  writeRing(real, owner.id, owner.pub);
  writeRing(evil, attacker.id, attacker.pub);
  const child = spawn(process.execPath, ['-e', `
    const fs = require('fs');
    const real = ${JSON.stringify(real)};
    const evil = ${JSON.stringify(evil)};
    const park = ${JSON.stringify(park)};
    const end = Date.now() + ${ms + 500};
    while (Date.now() < end) {
      try {
        fs.renameSync(real, park);
        fs.renameSync(evil, real);
        fs.renameSync(real, evil);
        fs.renameSync(park, real);
      } catch {}
    }
  `], { stdio: 'ignore' });
  let loads = 0;
  let hits = 0;
  let blocked = 0;
  let readyOwner = 0;
  let errors = 0;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    let kr;
    try { kr = load(real); } catch (e) { errors += 1; continue; }
    loads += 1;
    if (kr.prod.has(attacker.id)) hits += 1;
    else if (kr.blocked) blocked += 1;
    else if (kr.prod.has(owner.id)) readyOwner += 1;
  }
  try { child.kill('SIGKILL'); } catch {}
  try {
    if (!fs.existsSync(real) && fs.existsSync(park)) fs.renameSync(park, real);
  } catch {}
  return { loads, hits, blocked, readyOwner, errors, ms };
}

main().catch((e) => { console.error(e); process.exit(1); });
