// Independent Update Center attacks against origin/feat/update-center @ 9ffad98.
// Reads that tree. Writes only under /tmp and this report directory.
'use strict';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.UC_SRC || '/tmp/mk-update';
const UC = require(path.join(SRC, 'lib/ops/update-center.js'));
const UM = require(path.join(SRC, 'lib/ops/update.js'));
const BK = require(path.join(SRC, 'lib/ops/backup.js'));
const DB = require(path.join(SRC, 'lib/db.js'));
const { createUpdateCenter, assertUrl, safeFetch, verifySig, inspectZip, gate, compatCheck, loadKeys, CURRENT_IDENTITY, DEFAULT_REPOS } = UC;

const COMMIT = '9ffad98cd8ceae7d94ad82a7aeb44bbfa8c70a7a';
const REPO = DEFAULT_REPOS[0];
const rows = [];
const temps = [];
const note = (id, ok, detail, extra = {}) => {
  const rec = { id, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail), ...extra };
  rows.push(rec);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id}: ${rec.detail}`);
};
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(d); return d; };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const { publicKey: otherPub, privateKey: otherPriv } = crypto.generateKeyPairSync('ed25519');
const sign = (buf, key = privateKey) => crypto.sign(null, buf, key).toString('base64');
const placeholder = loadKeys();

function zipStore(entries) {
  const locals = [], cds = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const crc = zlib.crc32(data) >>> 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, data]);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(0x031e, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((e.mode << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    locals.push(local);
    cds.push(Buffer.concat([cd, name]));
    offset += local.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}
const appFile = (name, data, mode = 0o100644) => ({ name: `MOONKATTY AI STUDIO.app/${name}`, data, mode });
const goodZip = (payload = 'payload-v1') => zipStore([appFile('Contents/Info.plist', payload)]);

function manifestObj(over = {}) {
  return {
    manifestVersion: 1, version: '1.3.0', channel: 'stable', sourceCommit: 'abcdef1234567890', branch: 'main',
    arch: 'arm64', platform: 'darwin', bundleId: 'com.moonkatty.aistudio', appName: 'MOONKATTY AI STUDIO',
    dataDirName: 'MOONKATTY AI STUDIO', launchdLabel: 'com.moonkatty.aistudio.server', keychainServicePrefix: 'MOONKATTY AI STUDIO',
    defaultPort: 8787, dbSchemaVersion: 1, minUpgradeFrom: '1.0.0', isolated: false, isolatedFrom: [],
    signing: 'adhoc', notarized: false, assets: [], ...over
  };
}
function withZip(obj, zip, name) {
  obj.assets = [{ name, sha256: sha256(zip), size: zip.length }];
  return obj;
}
function fakeDb({ version = 1, infer = null } = {}) {
  const tables = infer ? ['items', 'meta', 'jobs'] : ['items', 'meta'];
  return {
    prepare(sql) {
      return {
        all() {
          if (sql.includes('sqlite_master')) return tables.map(name => ({ name }));
          if (sql.includes('table_info')) return infer === 3 ? [{ name: 'id' }, { name: 'input' }] : [{ name: 'id' }];
          return [];
        },
        get() { return version == null ? undefined : { v: String(version) }; }
      };
    }
  };
}
const ARMED = { OPS_UPDATE_AUTO_INSTALL: '1', OPS_UPDATE_SIGNATURE_READY: '1', OPS_UPDATE_BACKUP_VERIFIED_READY: '1', OPS_UPDATE_ROLLBACK_TESTED_ON_MAC: '1' };
const update = UM.createUpdateManager();
const backups = { create() { return { id: 'bk-test' }; }, verify() { return { ok: true, problems: [] }; }, testRestore() { return { ok: true, integrity: 'ok' }; } };

function releaseSet(items) {
  const files = new Map();
  const list = items.map(it => {
    const tag = it.tag;
    const manUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/release-manifest.json`;
    const sigUrl = manUrl + '.sig';
    const zipUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(it.zipName)}`;
    files.set(manUrl, it.raw);
    files.set(sigUrl, Buffer.from(it.sig));
    files.set(zipUrl, it.zip);
    return {
      tag_name: tag, name: tag, draft: false, prerelease: !!it.prerelease, published_at: it.publishedAt || '2020-01-01T00:00:00Z',
      html_url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`, body: it.body || 'changelog',
      assets: [
        { name: 'release-manifest.json', browser_download_url: manUrl, size: it.raw.length },
        { name: 'release-manifest.json.sig', browser_download_url: sigUrl, size: it.sig.length },
        { name: it.zipName, browser_download_url: zipUrl, size: it.zip.length }
      ]
    };
  });
  const api = `https://api.github.com/repos/${REPO}/releases?per_page=20`;
  files.set(api, Buffer.from(JSON.stringify(list)));
  return files;
}
function fetchOf(files, extra = {}) {
  return async (url) => {
    const u = String(url);
    if (extra.on) extra.on(u);
    if (extra.redirect && extra.redirect[u]) return { status: 302, ok: false, headers: { get: (k) => k.toLowerCase() === 'location' ? extra.redirect[u] : null } };
    const buf = files.get(u);
    if (!buf) return { ok: false, status: 404, headers: { get: () => null }, text: async () => '', json: async () => { throw new Error('no'); }, arrayBuffer: async () => Buffer.alloc(0), body: (async function* () {})() };
    return {
      ok: true, status: 200, headers: { get: () => null },
      arrayBuffer: async () => buf, text: async () => buf.toString('utf8'), json: async () => JSON.parse(buf.toString('utf8')),
      body: (async function* () { yield buf; })()
    };
  };
}
function makeCenter(opts = {}) {
  const dir = tmp('mk-uc-');
  const uc = createUpdateCenter({
    dir, current: opts.current || '1.2.0', fetchImpl: opts.fetchImpl, keys: opts.keys || [publicKey],
    update: opts.update || update, backups: opts.backups === undefined ? backups : opts.backups,
    db: opts.db || fakeDb({ version: 1 }), env: opts.env || {}, platform: opts.platform || 'linux',
    exec: opts.exec, healthUrl: opts.healthUrl, now: () => Date.parse('2026-10-21T12:00:00Z')
  });
  return { dir, uc };
}
function pack(over, zip, { tag = 'v1.3.0', zipName = 'MOONKATTY-AI-STUDIO-1.3.0-arm64-mac.zip', key = privateKey, publishedAt, prerelease, rawOverride } = {}) {
  const obj = withZip(manifestObj(over), zip, zipName);
  const raw = rawOverride || Buffer.from(JSON.stringify(obj));
  return { tag, zipName, zip, raw, sig: sign(raw, key), obj, publishedAt, prerelease };
}
async function readyReplace(uc, tag) {
  await uc.preBackup();
  uc.approve(tag, { user: 'owner' });
}

async function libraryAttacks() {
  const repos = DEFAULT_REPOS;
  const badUrls = [
    ['http', 'http://api.github.com/repos/moonkattymky/moonkatty-ai-studio/releases?per_page=1'],
    ['metadata-ip', 'https://169.254.169.254/latest/meta-data/'],
    ['localhost', 'https://127.0.0.1/repos/moonkattymky/moonkatty-ai-studio/releases'],
    ['userinfo', 'https://user:pass@github.com/moonkattymky/moonkatty-ai-studio/releases/download/v1.3.0/a.zip'],
    ['foreign-repo', 'https://api.github.com/repos/evil/other/releases?per_page=1'],
    ['port', 'https://api.github.com:8443/repos/moonkattymky/moonkatty-ai-studio/releases?per_page=1']
  ];
  const urlFails = badUrls.map(([id, u]) => { try { assertUrl(u, { repos, initial: true }); return id + ':allowed'; } catch (e) { return id + ':' + (e.code || e.message); } });
  note('url-policy-blocks-ssrf', urlFails.every(s => !s.endsWith(':allowed')), urlFails.join(' '));

  let redir = '';
  try {
    await safeFetch('https://github.com/moonkattymky/moonkatty-ai-studio/releases/download/v1.3.0/a.zip', {
      repos, fetchImpl: async () => ({ status: 302, ok: false, headers: { get: () => 'http://169.254.169.254/latest/meta-data/' } })
    });
    redir = 'allowed';
  } catch (e) { redir = e.code || e.message; }
  note('redirect-to-metadata-blocked', redir === 'REDIRECT_NOT_ALLOWED' || redir === 'NOT_HTTPS', redir);

  const zip = goodZip('good-bytes');
  const zipName = 'MOONKATTY-AI-STUDIO-1.3.0-arm64-mac.zip';
  const good = pack({}, zip, { zipName });
  const flipped = Buffer.from(good.sig, 'base64'); flipped[0] ^= 0xff;
  const badSig = verifySig(good.raw, flipped.toString('base64'), [publicKey]);
  const goodSig = verifySig(good.raw, good.sig, [publicKey]);
  const placeholderSig = verifySig(good.raw, good.sig, placeholder);
  const otherSig = verifySig(good.raw, sign(good.raw, otherPriv), [publicKey]);
  const either = verifySig(good.raw, good.sig, [otherPub, publicKey]);
  const tampered = Buffer.from(good.raw); const at = tampered.indexOf('abcdef'); tampered[at] ^= 1;
  const tamperedSig = verifySig(tampered, good.sig, [publicKey]);
  note('sig-good-key-accepts', goodSig.ok === true, 'keyId=' + goodSig.keyId);
  note('sig-flipped-rejected', badSig.ok === false, badSig.reason);
  note('sig-tampered-manifest-rejected', tamperedSig.ok === false, tamperedSig.reason);
  note('sig-other-key-rejected', otherSig.ok === false, otherSig.reason);
  note('sig-placeholder-rejects-real', placeholderSig.ok === false && placeholder.length === 1, placeholderSig.reason);
  note('sig-any-loaded-key-passes', either.ok === true, 'OR across loaded keys, keyId=' + either.keyId);
  const keyDir = path.join(SRC, 'lib/ops/update-keys');
  const priv = fs.readdirSync(keyDir).filter(n => /private|release\.key/i.test(n));
  const pem = fs.readFileSync(path.join(keyDir, 'release-ed25519.pub.pem'), 'utf8');
  note('no-private-key-in-tree', priv.length === 0 && !pem.includes('PRIVATE'), priv.join(',') || 'pub only');

  const oldZip = goodZip('old');
  const old = pack({ version: '1.1.9' }, oldZip, { tag: 'v1.1.9', zipName: 'MOONKATTY-AI-STUDIO-1.1.9-arm64-mac.zip', publishedAt: '2024-01-01T00:00:00Z' });
  const staleNewer = pack({ version: '1.2.5' }, goodZip('stale'), { tag: 'v1.2.5', zipName: 'MOONKATTY-AI-STUDIO-1.2.5-arm64-mac.zip', publishedAt: '2020-06-01T00:00:00Z' });
  const same = pack({ version: '1.2.0' }, goodZip('same'), { tag: 'v1.2.0', zipName: 'MOONKATTY-AI-STUDIO-1.2.0-arm64-mac.zip' });
  const suffix = pack({ version: '1.3.0', channel: 'test' }, zip, { tag: 'v1.3.0-test', zipName });
  const files = releaseSet([good, old, staleNewer, same, suffix]);
  const c1 = makeCenter({ fetchImpl: fetchOf(files) });
  const st = await c1.uc.check();
  const by = Object.fromEntries(st.releases.map(r => [r.tag, r]));
  note('tampered-not-in-this-list', by['v1.3.0'] && by['v1.3.0'].verified === true, 'control release verified');
  note('downgrade-blocked', by['v1.1.9'].verified === true && by['v1.1.9'].gate.allowed === false && /не новее/.test(by['v1.1.9'].gate.reasons.join(' ')), by['v1.1.9'].gate.reasons.join(' | '));
  note('same-version-blocked', by['v1.2.0'].gate.allowed === false && /не новее/.test(by['v1.2.0'].gate.reasons.join(' ')), by['v1.2.0'].gate.reasons.join(' | '));
  note('suffix-ignored-by-cmp', UC.cmpVer('1.2.0-test', '1.2.0') === 0 && UC.cmpVer('1.3.0-test', '1.3.0') === 0, 'pre-release suffix does not order');
  note('tag-suffix-still-verifies', by['v1.3.0-test'].verified === true && by['v1.3.0-test'].version === '1.3.0', 'problems=' + by['v1.3.0-test'].problems.join('; '));
  note('historical-newer-still-allowed-by-version', by['v1.2.5'].verified === true && by['v1.2.5'].publishedAt.startsWith('2020-') && by['v1.2.5'].gate.reasons.every(r => !/стар|expiry|replay|протух/i.test(r)), 'publishedAt=' + by['v1.2.5'].publishedAt + ' reasons=' + (by['v1.2.5'].gate.reasons.join(' | ') || 'none'));
  const again = await c1.uc.check();
  note('signed-manifest-replay-has-no-nonce', again.releases.filter(r => r.tag === 'v1.3.0')[0].verified === true, 'second check of the same bytes still verified');

  const badRaw = Buffer.from(good.raw); badRaw[badRaw.indexOf('abcdef')] ^= 1;
  const tamperedFiles = releaseSet([{ ...good, raw: badRaw, sig: good.sig }]);
  const cTamper = makeCenter({ fetchImpl: fetchOf(tamperedFiles) });
  const tamperSt = await cTamper.uc.check();
  const tamperRel = tamperSt.releases[0];
  let dlErr = '';
  try { await cTamper.uc.download('v1.3.0'); dlErr = 'downloaded'; } catch (e) { dlErr = e.code || e.message; }
  note('tampered-manifest-not-verified', tamperRel.verified === false && dlErr === 'UNVERIFIED', `problems=${tamperRel.problems.join(' | ')} download=${dlErr}`);

  const slipZip = zipStore([appFile('Contents/Info.plist', 'x'), { name: '../outside.txt', data: 'pwned', mode: 0o100644 }]);
  const absZip = zipStore([appFile('Contents/Info.plist', 'x'), { name: '/tmp/abs.txt', data: 'pwned', mode: 0o100644 }]);
  const slashZip = zipStore([appFile('Contents/Info.plist', 'x'), { name: '..\\outside.txt', data: 'pwned', mode: 0o100644 }]);
  const linkZip = zipStore([
    appFile('Contents/Info.plist', 'plist'),
    appFile('Contents/MacOS/escape', '/etc/passwd', 0o120777)
  ]);
  const slip = inspectZip(writeZip('slip.zip', slipZip));
  const abs = inspectZip(writeZip('abs.zip', absZip));
  const bsl = inspectZip(writeZip('bsl.zip', slashZip));
  const link = inspectZip(writeZip('link.zip', linkZip));
  note('zip-slip-rejected', slip.ok === false && slip.problems.some(p => p.includes('опасный путь')), slip.problems.join(' | '));
  note('absolute-path-rejected', abs.ok === false && abs.problems.some(p => p.includes('опасный путь')), abs.problems.join(' | '));
  note('backslash-rejected', bsl.ok === false, bsl.problems.join(' | '));
  note('symlink-accepted', link.ok === true && link.symlinks === 1, `ok=${link.ok} symlinks=${link.symlinks} problems=${link.problems.join('|')}`);

  const linkPack = pack({ notarized: false, signing: 'none' }, linkZip, { zipName });
  const cLink = makeCenter({ fetchImpl: fetchOf(releaseSet([linkPack])), platform: 'darwin', env: ARMED, exec: async () => { throw new Error('exec called'); } });
  await cLink.uc.check();
  const dLink = await cLink.uc.download('v1.3.0');
  await readyReplace(cLink.uc, 'v1.3.0');
  const planLink = cLink.uc.installPlan('v1.3.0');
  let autoLink = null, autoErr = '';
  try { autoLink = await cLink.uc.autoInstall('v1.3.0', { dryRun: true }); } catch (e) { autoErr = e.code || e.message; }
  const ditto = autoLink && autoLink.commands.find(c => c.includes('ditto'));
  note('symlink-download-verified', dLink.status === 'verified' && dLink.zip.symlinks === 1, JSON.stringify(dLink.zip));
  note('symlink-plan-and-ditto', planLink.allowed === true && planLink.mode === 'replace' && !!ditto && /ditto -x -k/.test(ditto), ditto || autoErr);

  const extracted = tmp('mk-uc-extract-');
  fs.mkdirSync(extracted, { recursive: true });
  const linkFile = path.join(extracted, 'MOONKATTY AI STUDIO.app', 'Contents', 'MacOS', 'escape');
  fs.mkdirSync(path.dirname(linkFile), { recursive: true });
  fs.symlinkSync('/etc/passwd', linkFile);
  const stLink = fs.lstatSync(linkFile);
  note('symlink-points-outside-extract-root', stLink.isSymbolicLink() && fs.readlinkSync(linkFile) === '/etc/passwd' && !fs.realpathSync(linkFile).startsWith(extracted), fs.readlinkSync(linkFile) + ' -> ' + fs.realpathSync(linkFile));

  const slipPack = pack({}, slipZip, { zipName });
  const cSlip = makeCenter({ fetchImpl: fetchOf(releaseSet([slipPack])) });
  await cSlip.uc.check();
  let slipDl = '';
  try { await cSlip.uc.download('v1.3.0'); slipDl = 'downloaded'; } catch (e) { slipDl = e.code + ':' + e.message; }
  const left = fs.existsSync(path.join(cSlip.dir, 'downloads', 'v1.3.0', zipName)) || fs.existsSync(path.join(cSlip.dir, 'downloads', 'v1.3.0', zipName + '.partial'));
  note('zip-slip-download-deleted', slipDl.startsWith('BAD_ARCHIVE') && left === false, slipDl + ' leftover=' + left);

  const prodIds = { bundleId: CURRENT_IDENTITY.bundleId, dataDirName: CURRENT_IDENTITY.dataDirName, launchdLabel: CURRENT_IDENTITY.launchdLabel, keychainServicePrefix: CURRENT_IDENTITY.keychainServicePrefix };
  const testIds = { bundleId: 'com.moonkatty.aistudio.test', dataDirName: 'MOONKATTY AI STUDIO.test', launchdLabel: 'com.moonkatty.aistudio.test.server', keychainServicePrefix: 'MOONKATTY AI STUDIO.test', isolated: true, isolatedFrom: [CURRENT_IDENTITY.bundleId], channel: 'test' };
  const partial = pack({ ...testIds, version: '1.3.1', dataDirName: CURRENT_IDENTITY.dataDirName, isolated: true }, goodZip('partial'), { tag: 'v1.3.1', zipName: 'MOONKATTY-AI-STUDIO-1.3.1-arm64-mac.zip' });
  const isolated = pack({ ...testIds, version: '1.3.2' }, goodZip('iso'), { tag: 'v1.3.2', zipName: 'MOONKATTY-AI-STUDIO-1.3.2-arm64-mac.zip' });
  const testChannelProd = pack({ channel: 'test', version: '1.3.3' }, goodZip('chan'), { tag: 'v1.3.3', zipName: 'MOONKATTY-AI-STUDIO-1.3.3-arm64-mac.zip' });
  const cId = makeCenter({ fetchImpl: fetchOf(releaseSet([partial, isolated, testChannelProd])), platform: 'darwin', exec: async () => { throw new Error('no'); } });
  const idSt = await cId.uc.check();
  const idBy = Object.fromEntries(idSt.releases.map(r => [r.tag, r]));
  note('identity-hardcoded-prod', idSt.identity.bundleId === 'com.moonkatty.aistudio' && idSt.identity.dataDirName === 'MOONKATTY AI STUDIO', JSON.stringify(idSt.identity));
  note('partial-identity-blocked', idBy['v1.3.1'].verified === true && idBy['v1.3.1'].gate.allowed === false && /частично совпадает/.test(idBy['v1.3.1'].gate.reasons.join(' ')), idBy['v1.3.1'].gate.reasons.join(' | '));
  note('isolated-side-by-side-without-approval', idBy['v1.3.2'].gate.allowed === true && idBy['v1.3.2'].gate.mode === 'side-by-side' && idBy['v1.3.2'].approved === false, idBy['v1.3.2'].gate.mode + ' approved=' + idBy['v1.3.2'].approved);
  await cId.uc.download('v1.3.3');
  await readyReplace(cId.uc, 'v1.3.3');
  const chanPlan = cId.uc.installPlan('v1.3.3');
  note('test-channel-prod-identity-replaces-prod-app', chanPlan.allowed === true && chanPlan.mode === 'replace' && chanPlan.steps.some(s => s.includes('/Applications/MOONKATTY AI STUDIO.app')), 'channel=' + idBy['v1.3.3'].manifest.channel + ' mode=' + chanPlan.mode);

  const installedTest = { bundleId: testIds.bundleId, dataDirName: testIds.dataDirName, launchdLabel: testIds.launchdLabel, keychainServicePrefix: testIds.keychainServicePrefix, working: true };
  const swap = gate({ manifest: manifestObj({ ...prodIds, version: '9.0.0', channel: 'stable', minUpgradeFrom: '1.0.0', isolated: false, isolatedFrom: [] }), verified: true, current: '1.2.0', installed: installedTest, compat: { ok: true }, backup: { verified: true }, ownerApproval: false });
  note('prod-manifest-against-test-install-is-partial-or-blocked', swap.allowed === false, swap.reasons.join(' | ') + ' mode=' + swap.mode);

  const z1 = goodZip('zip-one');
  const z2 = goodZip('zip-two-replaced');
  const first = pack({}, z1, { zipName });
  let phase = first;
  const phaseFiles = () => releaseSet([phase]);
  const seenHealth = [];
  const cTo = makeCenter({
    fetchImpl: (url) => { const u = String(url); if (u.startsWith('http://169')) { seenHealth.push(u); return Promise.resolve({ ok: false, status: 500, json: async () => ({}) }); } return fetchOf(phaseFiles())(url); },
    platform: 'darwin', env: ARMED, exec: async () => { throw new Error('exec should not run on dry-run'); },
    healthUrl: 'http://169.254.169.254/latest/meta-data/'
  });
  await cTo.uc.check();
  const d1 = await cTo.uc.download('v1.3.0');
  const before = sha256(fs.readFileSync(d1.file));
  fs.writeFileSync(d1.file, z2);
  const after = sha256(fs.readFileSync(d1.file));
  await readyReplace(cTo.uc, 'v1.3.0');
  const planTo = cTo.uc.installPlan('v1.3.0');
  const autoTo = await cTo.uc.autoInstall('v1.3.0', { dryRun: true });
  const dittoTo = autoTo.commands.find(c => c.startsWith('/usr/bin/ditto'));
  note('toctou-plan-ignores-replaced-bytes', before !== after && before === first.obj.assets[0].sha256 && planTo.allowed === true && dittoTo.includes(d1.file), `before=${before.slice(0, 12)} after=${after.slice(0, 12)} allowed=${planTo.allowed} ${dittoTo}`);

  phase = pack({}, z2, { zipName });
  await cTo.uc.approve('v1.3.0');
  const approvedHash = (await cTo.uc.check()).releases.find(r => r.tag === 'v1.3.0');
  note('approval-sticks-to-tag-after-resign', approvedHash.approved === true && approvedHash.manifest.assets[0].sha256 === sha256(z2) && approvedHash.manifest.assets[0].sha256 !== sha256(z1), 'new sha=' + approvedHash.manifest.assets[0].sha256.slice(0, 12));

  const bare = makeCenter({});
  let flagErr = '';
  try { await bare.uc.autoInstall('v1.3.0', { dryRun: false }); flagErr = 'ran'; } catch (e) { flagErr = e.code; }
  note('autoinstall-off-without-flags', flagErr === 'AUTO_INSTALL_DISABLED', flagErr);
  const armed = makeCenter({
    fetchImpl: fetchOf(releaseSet([pack({}, goodZip('arm'), { zipName })])),
    env: ARMED,
    platform: 'linux', exec: async () => { throw new Error('must not exec'); }
  });
  await armed.uc.check(); await armed.uc.download('v1.3.0'); await readyReplace(armed.uc, 'v1.3.0');
  let linuxErr = '', execd = false;
  try { await armed.uc.autoInstall('v1.3.0', { dryRun: false }); linuxErr = 'ran'; } catch (e) { linuxErr = e.code; }
  note('autoinstall-refuses-non-mac', linuxErr === 'NOT_MAC' && execd === false, linuxErr);
  let rbErr = '', rbExec = false;
  const rb = makeCenter({ platform: 'linux', exec: async () => { rbExec = true; } });
  try { await rb.uc.rollback({ dryRun: false }); rbErr = 'ran'; } catch (e) { rbErr = e.code; }
  const rbDry = await rb.uc.rollback({ dryRun: true });
  note('rollback-function-dry-run-on-linux', rbErr === 'NOT_MAC' && rbExec === false && rbDry.dryRun === true && rbDry.commands.every(c => c.startsWith('/bin/') || c.startsWith('/usr/')), rbErr + ' dry=' + rbDry.dryRun);
  const legacy = update.plan({ report: [{ ok: true }], backupId: 'X' });
  note('legacy-plan-contains-rm-rf', legacy.rollback.some(s => s.includes('rm -rf')), legacy.rollback.join(' || '));
  const shown = planTo.rollback.join('\n') + '\n' + planTo.steps.join('\n');
  const legacyText = (Array.isArray(planTo.legacy) ? planTo.legacy : []).join('\n');
  note('shown-plan-has-no-xattr-spctl-rm', !/xattr|spctl --master-disable|rm -rf/.test(shown) && /rm -rf/.test(legacyText), 'displayed steps clean; legacy field still contains rm -rf');

  const sc1 = update.schemaCheck(fakeDb({ version: 1 }));
  const sc3 = update.schemaCheck(fakeDb({ version: null, infer: 3 }));
  const sc4 = update.schemaCheck(fakeDb({ version: 4 }));
  const m3 = manifestObj({ dbSchemaVersion: 3, version: '1.3.0' });
  const cc3 = compatCheck(m3, sc3);
  const g3 = gate({ manifest: m3, verified: true, current: '1.2.0', compat: cc3, backup: { verified: true }, ownerApproval: true });
  const ccOld = compatCheck(manifestObj({ dbSchemaVersion: 1 }), sc3);
  const cc99 = compatCheck(manifestObj({ dbSchemaVersion: 99 }), sc4);
  note('schema-cap-does-not-block-gate', sc3.ok === false && sc3.schemaVersion === 3 && sc3.supported === 1 && cc3.ok === true && g3.allowed === true, `schemaCheck.ok=${sc3.ok} v=${sc3.schemaVersion} compat=${cc3.detail} gate=${g3.mode}`);
  note('schema-downgrade-blocked', ccOld.ok === false, ccOld.detail);
  note('schema-99-compat-allows', sc4.ok === false && cc99.ok === true && cc99.migration === true, cc99.detail);
  note('schema-v1-ok', sc1.ok === true && sc1.schemaVersion === 1, sc1.detail);

  const nonDarwin = await update.verifySignature({ appPath: '/Applications/MOONKATTY AI STUDIO.app' });
  note('non-darwin-codesign-reported-ok', nonDarwin.ok === true && nonDarwin.checks.some(c => c.id === 'codesign' && c.ok && c.info), nonDarwin.checks.map(c => c.id + ':' + c.ok).join(','));

  const h = await cTo.uc.healthCheck();
  note('health-url-not-on-allowlist', seenHealth[0] === 'http://169.254.169.254/latest/meta-data/' && h.ok === false, seenHealth[0] + ' result=' + JSON.stringify(h).slice(0, 180));

  const srcUC = fs.readFileSync(path.join(SRC, 'lib/ops/update-center.js'), 'utf8');
  const srcDesk = fs.readFileSync(path.join(SRC, 'desktop/main.js'), 'utf8');
  const srcUi = fs.readFileSync(path.join(SRC, 'public/update-ui.js'), 'utf8');
  const srcIdx = fs.readFileSync(path.join(SRC, 'lib/ops/index.js'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  note('update-center-has-no-interval', !/setInterval\(/.test(srcUC), 'no setInterval in update-center.js');
  note('wiring-has-no-update-timer', !/updateCenter[\s\S]{0,200}setInterval|setTimeout\(\s*\(\)\s*=>\s*updateCenter/.test(srcIdx), 'index.js does not schedule a check');
  note('ui-check-is-a-button', /id="ucCheck"/.test(srcUi) && /ucCheck[\s\S]{0,220}update-center\/check/.test(srcUi) && !/setTimeout\(\s*\(\)\s*=>\s*\{[^}]*update-center\/check/.test(srcUi), 'POST /check is the button handler');
  note('electron-autocheck-on-launch', /checkUpdates:\s*true/.test(srcDesk) && /setTimeout\(\(\) => checkUpdates\(false\), 5000\)/.test(srcDesk), 'DEF.checkUpdates true; timer 5000');
  note('electron-check-does-not-install', /Never downloads or installs/.test(srcDesk) && !/autoUpdater|electron-updater|Squirrel/.test(srcDesk), 'dialog + openExternal only');
  note('no-electron-updater-dep', !pkg.dependencies?.['electron-updater'] && !pkg.devDependencies?.['electron-updater'] && !/autoUpdater/.test(srcDesk), 'package.json has no electron-updater');
  note('gatekeeper-assess-false-in-builder', pkg.build?.mac?.gatekeeperAssess === false && pkg.build?.mac?.identity === null, JSON.stringify({ identity: pkg.build.mac.identity, gatekeeperAssess: pkg.build.mac.gatekeeperAssess, hardenedRuntime: pkg.build.mac.hardenedRuntime }));
}

function writeZip(name, buf) {
  const d = tmp('mk-uc-zip-');
  const f = path.join(d, name);
  fs.writeFileSync(f, buf);
  return f;
}

async function backupRollback() {
  const dataDir = tmp('mk-uc-data-');
  const filesDir = path.join(dataDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  fs.writeFileSync(path.join(filesDir, 'note.txt'), 'keep-me');
  fs.writeFileSync(path.join(dataDir, 'secret.key'), 'not-a-real-secret', { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'app-token'), 'not-a-real-token', { mode: 0o600 });
  const dbFile = path.join(dataDir, 'studio.db');
  const db = DB.open(dbFile);
  db.exec(`CREATE TABLE items (col TEXT, id TEXT, data TEXT, PRIMARY KEY (col, id));
           CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);`);
  db.prepare('INSERT INTO items (col, id, data) VALUES (?,?,?)').run('tasks', 't1', JSON.stringify({ id: 't1', title: 'one' }));
  db.prepare('INSERT INTO meta (k, v) VALUES (?,?)').run('schemaVersion', '1');
  const mgr = BK.createBackupManager({ db, openDb: DB.open, dataDir, filesDir, version: '1.1.2', schemaVersion: 1 });
  const b = mgr.create({ passphrase: 'fake-pass-1234', note: 'pre-update' });
  const v = mgr.verify(b.id);
  const t = mgr.testRestore(b.id, { passphrase: 'fake-pass-1234' });
  const names = fs.readdirSync(path.join(mgr.root, b.id));
  db.prepare("UPDATE meta SET v='3' WHERE k='schemaVersion'").run();
  db.exec('CREATE TABLE migrated (id INTEGER);');
  const empty = tmp('mk-uc-restore-');
  const target = path.join(empty, 'data');
  mgr.restoreInto(b.id, target, { passphrase: 'fake-pass-1234' });
  const rd = DB.open(path.join(target, 'studio.db'));
  const ver = rd.prepare("SELECT v FROM meta WHERE k='schemaVersion'").get().v;
  const tables = rd.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  const n = rd.prepare("SELECT COUNT(*) AS n FROM items").get().n;
  rd.close(); db.close();
  note('backup-verified-and-test-restore', v.ok === true && t.ok === true && t.integrity === 'ok', `id=${b.id} integrity=${t.integrity} countsMatch=${t.countsMatch}`);
  note('backup-omits-plaintext-secrets', !names.includes('secret.key') && !names.includes('app-token') && names.includes('secret.key.enc'), names.join(','));
  note('schema-rollback-restores-snapshot', ver === '1' && !tables.includes('migrated') && n === 1, `restored schema=${ver} tables=${tables.join(',')} items=${n}`);
  const occupied = tmp('mk-uc-occupied-');
  fs.writeFileSync(path.join(occupied, 'existing.txt'), 'x');
  let refuse = '';
  try { mgr.restoreInto(b.id, occupied); refuse = 'overwrote'; } catch (e) { refuse = e.message; }
  note('restore-refuses-nonempty', /не пуста/.test(refuse), refuse);
}

function startServer(port, extra) {
  const dir = tmp('mk-uc-srv-');
  const env = { ...process.env, NODE_PATH: '/workspace/node_modules', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ...extra };
  delete env.DB_PATH;
  const p = spawn(process.execPath, ['server.js'], { cwd: SRC, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  p.stdout.on('data', d => out.push(String(d)));
  p.stderr.on('data', d => out.push(String(d)));
  const stop = () => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill('SIGTERM'); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 2000); });
  return { dir, out, stop, port };
}
async function waitHealth(port) {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return true; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}
async function req(port, method, p, { headers = {}, body } = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, setCookie: r.headers.get('set-cookie') || '' };
}

async function httpAttacks() {
  const off = startServer(18951, {});
  const on = startServer(18952, { STUDIO_OPS_UPDATE: '1', STUDIO_OPS_BACKUP: '1' });
  try {
    const upOff = await waitHealth(18951);
    const upOn = await waitHealth(18952);
    note('servers-started', upOff && upOn, `off=${upOff} on=${upOn} ${(off.out.join('') + on.out.join('')).slice(-300)}`);
    if (!(upOff && upOn)) return;
    const H = { 'content-type': 'application/json', 'x-studio-request': '1' };
    const setup = await req(18952, 'POST', '/api/auth/setup', { headers: H, body: { username: 'igor', password: 'fake-password-123' } });
    const setupOff = await req(18951, 'POST', '/api/auth/setup', { headers: H, body: { username: 'igor', password: 'fake-password-123' } });
    const cookie = setup.setCookie.split(';')[0];
    const auth = { ...H, cookie };
    note('session-cookie-httponly-strict', /HttpOnly/i.test(setup.setCookie) && /SameSite=Strict/i.test(setup.setCookie) && setup.status === 200, setup.setCookie.split(';').slice(1, 4).join(';') + ' status=' + setup.status);
    const offGet = await req(18951, 'GET', '/api/ops/update-center', { headers: { ...H, cookie: setupOff.setCookie.split(';')[0] } });
    const noAuth = await req(18952, 'GET', '/api/ops/update-center');
    const noHdr = await req(18952, 'POST', '/api/ops/update-center/check', { headers: { cookie, 'content-type': 'application/json' }, body: {} });
    const evil = await req(18952, 'POST', '/api/ops/update-center/check', { headers: { ...auth, origin: 'https://evil.example' }, body: {} });
    const cross = await req(18952, 'POST', '/api/ops/update-center/check', { headers: { ...auth, 'sec-fetch-site': 'cross-site' }, body: {} });
    const auto = await req(18952, 'POST', '/api/ops/update-center/v9.9.9/auto-install', { headers: auth, body: { dryRun: false } });
    const rb = await req(18952, 'POST', '/api/ops/update-center/rollback', { headers: auth, body: { dryRun: false } });
    const appr = await req(18952, 'POST', '/api/ops/update-center/v9.9.9/approve', { headers: auth, body: { password: 'wrong-password' } });
    const check = await req(18952, 'POST', '/api/ops/update-center/check', { headers: auth, body: {} });
    const apps = fs.existsSync('/Applications/MOONKATTY AI STUDIO.app');
    note('flag-off-is-404', offGet.status === 404, String(offGet.status));
    note('unauthenticated-is-401', noAuth.status === 401, String(noAuth.status));
    note('csrf-missing-header-403', noHdr.status === 403, noHdr.json && noHdr.json.error);
    note('csrf-evil-origin-403', evil.status === 403, evil.json && evil.json.error);
    note('csrf-cross-site-403', cross.status === 403, cross.json && cross.json.error);
    note('autoinstall-http-disabled', auto.status === 400 && auto.json && auto.json.code === 'AUTO_INSTALL_DISABLED', JSON.stringify(auto.json));
    note('rollback-http-stays-dry-run', rb.status === 200 && rb.json && rb.json.dryRun === true, JSON.stringify(rb.json).slice(0, 240));
    note('approve-wrong-password-403', appr.status === 403, appr.json && appr.json.error);
    note('authed-check-does-not-touch-applications', check.status !== 401 && check.status !== 403 && apps === false, `status=${check.status} applicationsApp=${apps} body=${JSON.stringify(check.json).slice(0, 180)}`);
    const token = fs.readFileSync(path.join(on.dir, 'app-token'), 'utf8').trim();
    const viaApp = await req(18952, 'GET', '/api/ops/update-center', { headers: { 'x-studio-app-token': token } });
    note('loopback-app-token-can-read-update-center', viaApp.status === 200 && viaApp.json && viaApp.json.current === '1.1.2', 'status=' + viaApp.status + ' current=' + (viaApp.json && viaApp.json.current));
  } finally {
    await off.stop();
    await on.stop();
  }
}

let code = 0;
try {
  const head = require('child_process').execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = require('child_process').execFileSync('git', ['-C', SRC, 'status', '--porcelain'], { encoding: 'utf8' });
  note('worktree-commit', head === COMMIT, head);
  note('worktree-clean-before', dirty.trim() === '', dirty.trim() || 'clean');
  await libraryAttacks();
  await backupRollback();
  await httpAttacks();
  const dirtyAfter = require('child_process').execFileSync('git', ['-C', SRC, 'status', '--porcelain'], { encoding: 'utf8' });
  note('worktree-clean-after', dirtyAfter.trim() === '', dirtyAfter.trim() || 'clean');
} catch (e) {
  note('harness-exception', false, e.stack || e.message);
  code = 1;
} finally {
  for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
}
const failed = rows.filter(r => !r.ok).map(r => r.id);
const out = { commit: COMMIT, src: SRC, controls: rows.length, failed, node: process.version, rows };
fs.mkdirSync(path.join(HERE, 'logs'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'logs', 'attack.json'), JSON.stringify(out, null, 2));
fs.writeFileSync(path.join(HERE, 'logs', 'attack.log'), rows.map(r => `${r.ok ? 'OK' : 'FAIL'}\t${r.id}\t${r.detail}`).join('\n') + '\n');
console.log(JSON.stringify({ commit: COMMIT, controls: rows.length, failed }));
process.exit(failed.length || code ? 1 : 0);
