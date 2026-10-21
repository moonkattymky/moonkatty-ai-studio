// Independent Update Center re-audit against origin/feat/update-center @ aef14c4.
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
const SRC = process.env.UC_SRC || '/tmp/mk-uc2';
const UC = require(path.join(SRC, 'lib/ops/update-center.js'));
const UM = require(path.join(SRC, 'lib/ops/update.js'));
const AI = require(path.join(SRC, 'lib/ops/app-identity.js'));
const { createUpdateCenter, assertUrl, safeFetch, verifySig, inspectZip, gate, compatCheck, loadKeyring, keyIdOf, safeHealthUrl, DEFAULT_REPOS } = UC;

const COMMIT = 'aef14c465322e3c969b41d4866c3557b7b555367';
const REPO = DEFAULT_REPOS[0];
const NOW = Date.parse('2026-10-21T12:00:00Z');
const RECENT = '2026-10-01T00:00:00Z';
const rows = [];
const temps = [];
const note = (id, ok, detail) => {
  const rec = { id, ok: !!ok, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
  rows.push(rec);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${id}: ${rec.detail}`);
};
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); temps.push(d); return d; };
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pair = () => crypto.generateKeyPairSync('ed25519');
const testKp = pair(), prodKp = pair(), otherKp = pair(), revokedKp = pair(), stubKp = pair(), retiredKp = pair(), nextKp = pair();
const kid = (pub) => keyIdOf(pub);
const sign = (buf, priv, pub) => JSON.stringify({ v: 1, alg: 'ed25519', keyId: kid(pub), sig: crypto.sign(null, buf, priv).toString('base64') });
const pem = (pub) => pub.export({ type: 'spki', format: 'pem' });
function entry(pub, set, status, stub = false) {
  return [kid(pub), { publicKeyPem: pem(pub), set, status, stub }];
}
const ringObj = {
  version: 1,
  keys: Object.fromEntries([
    entry(testKp.publicKey, 'test', 'active'),
    entry(prodKp.publicKey, 'prod', 'active'),
    entry(revokedKp.publicKey, 'prod', 'active'),
    entry(stubKp.publicKey, 'prod', 'active', true),
    entry(retiredKp.publicKey, 'prod', 'retired'),
    entry(nextKp.publicKey, 'test', 'next')
  ]),
  revoked: [kid(revokedKp.publicKey)]
};
const keyring = loadKeyring({ ring: ringObj, dir: os.tmpdir() });
const prodId = { ...AI.PROFILES.prod, known: true, working: true, appPath: AI.appPathOf(AI.PROFILES.prod), problems: [], source: 'harness' };
const testId = { ...AI.PROFILES.test, known: true, working: true, appPath: AI.appPathOf(AI.PROFILES.test), problems: [], source: 'harness' };

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
const goodZip = (payload = 'payload-v1', appName = prodId.appName) => zipStore([{ name: `${appName}.app/Contents/Info.plist`, data: payload, mode: 0o100644 }]);
function manifestObj(over = {}) {
  const p = AI.PROFILES.prod;
  return {
    manifestVersion: 1, version: '1.3.0', channel: 'stable', sourceCommit: 'abcdef1234567890', branch: 'main',
    arch: 'arm64', platform: 'darwin', bundleId: p.bundleId, appName: p.appName,
    dataDirName: p.dataDirName, launchdLabel: p.launchdLabel, keychainServicePrefix: p.keychainServicePrefix,
    defaultPort: p.defaultPort, dbSchemaVersion: 1, minUpgradeFrom: '1.0.0', isolated: false, isolatedFrom: [],
    signing: 'adhoc', notarized: false, assets: [], ...over
  };
}
function testManifest(over = {}) {
  const t = AI.PROFILES.test;
  return manifestObj({
    channel: 'test', version: '1.3.0-test', bundleId: t.bundleId, appName: t.appName, dataDirName: t.dataDirName,
    launchdLabel: t.launchdLabel, keychainServicePrefix: t.keychainServicePrefix, defaultPort: t.defaultPort,
    isolated: true, isolatedFrom: [AI.PROFILES.prod.bundleId], ...over
  });
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
      tag_name: tag, name: tag, draft: false, prerelease: it.prerelease !== undefined ? it.prerelease : it.obj.channel !== 'stable',
      published_at: it.publishedAt === undefined ? RECENT : it.publishedAt,
      html_url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`, body: it.body || 'changelog',
      assets: [
        { name: 'release-manifest.json', browser_download_url: manUrl, size: it.raw.length },
        { name: 'release-manifest.json.sig', browser_download_url: sigUrl, size: Buffer.byteLength(it.sig) },
        { name: it.zipName, browser_download_url: zipUrl, size: it.zip.length }
      ]
    };
  });
  files.set(`https://api.github.com/repos/${REPO}/releases?per_page=20`, Buffer.from(JSON.stringify(list)));
  return files;
}
function fetchOf(files) {
  return async (url) => {
    const u = String(url);
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
  const dir = tmp('mk-uc2-');
  const uc = createUpdateCenter({
    dir, current: opts.current || '1.2.0', fetchImpl: opts.fetchImpl, keyring: opts.keyring || keyring,
    identity: opts.identity || prodId, update: opts.update || update,
    backups: opts.backups === undefined ? backups : opts.backups,
    db: opts.db || fakeDb({ version: 1 }), env: opts.env || {}, platform: opts.platform || 'linux',
    exec: opts.exec, healthUrl: opts.healthUrl, now: () => opts.now || NOW
  });
  return { dir, uc };
}
function pack(over, zip, { tag = 'v1.3.0', zipName, key = prodKp.privateKey, pub = prodKp.publicKey, publishedAt, prerelease, rawOverride } = {}) {
  const obj = withZip(manifestObj(over), zip, zipName || `MOONKATTY-AI-STUDIO-${String(over.version || '1.3.0').replace(/[^0-9A-Za-z.-]/g, '')}-arm64-mac.zip`);
  const raw = rawOverride || Buffer.from(JSON.stringify(obj));
  return { tag, zipName: obj.assets[0].name, zip, raw, sig: sign(raw, key, pub), obj, publishedAt, prerelease };
}
async function readyReplace(uc, tag) {
  await uc.preBackup();
  uc.approve(tag, { user: 'owner' });
}
function writeZip(name, buf) {
  const d = tmp('mk-uc2-zip-');
  const f = path.join(d, name);
  fs.writeFileSync(f, buf);
  return f;
}
const reasons = (rel) => (rel && rel.gate ? rel.gate.reasons : []).join(' | ');

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
  const rawSig = crypto.sign(null, good.raw, prodKp.privateKey).toString('base64');
  const legacy = verifySig(good.raw, rawSig, keyring, 'stable');
  const flipped = Buffer.from(JSON.parse(good.sig).sig, 'base64'); flipped[0] ^= 0xff;
  const badSig = verifySig(good.raw, JSON.stringify({ ...JSON.parse(good.sig), sig: flipped.toString('base64') }), keyring, 'stable');
  const goodSig = verifySig(good.raw, good.sig, keyring, 'stable');
  const otherSig = verifySig(good.raw, sign(good.raw, otherKp.privateKey, otherKp.publicKey), keyring, 'stable');
  const testOnStable = verifySig(good.raw, sign(good.raw, testKp.privateKey, testKp.publicKey), keyring, 'stable');
  const prodOnTest = verifySig(good.raw, good.sig, keyring, 'test');
  const revoked = verifySig(good.raw, sign(good.raw, revokedKp.privateKey, revokedKp.publicKey), keyring, 'stable');
  const retired = verifySig(good.raw, sign(good.raw, retiredKp.privateKey, retiredKp.publicKey), keyring, 'stable');
  const nextOnTest = verifySig(Buffer.from('x'), sign(Buffer.from('x'), nextKp.privateKey, nextKp.publicKey), keyring, 'test');
  const tampered = Buffer.from(good.raw); tampered[tampered.indexOf('abcdef')] ^= 1;
  const tamperedSig = verifySig(tampered, good.sig, keyring, 'stable');
  note('sig-prod-key-accepts-stable', goodSig.ok === true && goodSig.set === 'prod' && goodSig.keyId === kid(prodKp.publicKey), JSON.stringify(goodSig));
  note('sig-raw-base64-rejected', legacy.ok === false && /keyId/.test(legacy.reason), legacy.reason);
  note('sig-flipped-rejected', badSig.ok === false, badSig.reason);
  note('sig-tampered-manifest-rejected', tamperedSig.ok === false, tamperedSig.reason);
  note('sig-unknown-key-rejected', otherSig.ok === false, otherSig.reason);
  note('sig-test-key-rejected-for-stable', testOnStable.ok === false && /prod/.test(testOnStable.reason), testOnStable.reason);
  note('sig-prod-key-rejected-for-test', prodOnTest.ok === false && /test/.test(prodOnTest.reason), prodOnTest.reason);
  note('sig-revoked-key-rejected', revoked.ok === false && /отозван/.test(revoked.reason), revoked.reason);
  note('sig-retired-key-rejected', retired.ok === false, retired.reason);
  note('sig-next-test-key-accepts', nextOnTest.ok === true && nextOnTest.set === 'test', JSON.stringify(nextOnTest));
  note('stub-prod-key-dropped', !keyring.prod.has(kid(stubKp.publicKey)) && keyring.problems.some(p => /заглушка/.test(p) && p.includes(kid(stubKp.publicKey))), keyring.problems.join(' | '));
  note('revoked-and-retired-not-loaded', !keyring.prod.has(kid(revokedKp.publicKey)) && !keyring.prod.has(kid(retiredKp.publicKey)) && keyring.revoked.has(kid(revokedKp.publicKey)), `prod=${[...keyring.prod.keys()].join(',')} revoked=${[...keyring.revoked].join(',')}`);

  const keyDir = path.join(SRC, 'lib/ops/update-keys');
  const names = fs.readdirSync(keyDir);
  const priv = names.filter(n => /private|\.key$/i.test(n) && !n.endsWith('.pub.pem'));
  const committed = loadKeyring({ dir: keyDir });
  const pemText = names.filter(n => n.endsWith('.pem')).map(n => fs.readFileSync(path.join(keyDir, n), 'utf8')).join('\n');
  note('committed-ring-prod-empty', committed.prod.size === 0 && committed.test.size === 1 && committed.stubOnly.test === true && committed.stubOnly.prod === true, JSON.stringify({ prod: committed.prod.size, test: committed.test.size, stubOnly: committed.stubOnly, problems: committed.problems, files: names }));
  note('no-private-key-in-tree', priv.length === 0 && !pemText.includes('PRIVATE'), priv.join(',') || names.join(','));

  const oldZip = goodZip('old');
  const old = pack({ version: '1.1.9' }, oldZip, { tag: 'v1.1.9', zipName: 'MOONKATTY-AI-STUDIO-1.1.9-arm64-mac.zip' });
  const staleNewer = pack({ version: '1.2.5' }, goodZip('stale'), { tag: 'v1.2.5', zipName: 'MOONKATTY-AI-STUDIO-1.2.5-arm64-mac.zip', publishedAt: '2020-06-01T00:00:00Z' });
  const same = pack({ version: '1.2.0' }, goodZip('same'), { tag: 'v1.2.0', zipName: 'MOONKATTY-AI-STUDIO-1.2.0-arm64-mac.zip' });
  const fresh = pack({}, zip, { zipName, publishedAt: null });
  const files = releaseSet([good, old, staleNewer, same, fresh]);
  const c1 = makeCenter({ fetchImpl: fetchOf(files) });
  const st = await c1.uc.check();
  const by = Object.fromEntries(st.releases.map(r => [r.tag, r]));
  note('fresh-release-verified', by['v1.3.0'] && by['v1.3.0'].verified === true && by['v1.3.0'].gate.allowed === false && /согласия владельца/.test(reasons(by['v1.3.0'])), reasons(by['v1.3.0']) || 'missing');
  note('downgrade-blocked', by['v1.1.9'].verified === true && by['v1.1.9'].gate.allowed === false && /не новее/.test(reasons(by['v1.1.9'])), reasons(by['v1.1.9']));
  note('same-version-blocked', by['v1.2.0'].gate.allowed === false && /не новее/.test(reasons(by['v1.2.0'])), reasons(by['v1.2.0']));
  note('older-than-365-days-blocked', by['v1.2.5'].verified === true && by['v1.2.5'].gate.allowed === false && /365/.test(reasons(by['v1.2.5'])), reasons(by['v1.2.5']));
  const again = await c1.uc.check();
  note('same-bytes-second-check-still-verified', again.releases.filter(r => r.tag === 'v1.3.0')[0].verified === true, 'second check of the same bytes still verified');
  const noDate = by['v1.3.0'] && fresh.tag === 'v1.3.0';
  const undated = st.releases.find(r => r.publishedAt == null);
  note('missing-publishedAt-skips-age', !!undated && undated.verified === true && undated.gate.reasons.every(r => !/365|replay|дн\./.test(r)), undated ? `tag=${undated.tag} publishedAt=${undated.publishedAt} reasons=${undated.gate.reasons.join(' | ')}` : 'no undated release (fresh collided)');
  void noDate;

  const republishFiles = releaseSet([pack({ version: '1.2.5' }, goodZip('repub'), { tag: 'v1.2.5', zipName: 'MOONKATTY-AI-STUDIO-1.2.5-arm64-mac.zip', publishedAt: RECENT })]);
  const cRep = makeCenter({ fetchImpl: fetchOf(republishFiles) });
  const rep = (await cRep.uc.check()).releases[0];
  note('republish-resets-age', rep.verified === true && rep.version === '1.2.5' && rep.gate.reasons.every(r => !/365/.test(r)) && rep.gate.reasons.some(r => /согласия/.test(r)), `publishedAt=${rep.publishedAt} reasons=${rep.gate.reasons.join(' | ')}`);

  const badTag = (await makeCenter({ fetchImpl: fetchOf(releaseSet([pack({}, goodZip('tag'), { tag: 'v1.3.0-test', zipName })])) }).uc.check()).releases[0];
  const previewOk = (await makeCenter({ fetchImpl: fetchOf(releaseSet([pack({ channel: 'preview', version: '1.3.1' }, goodZip('pre'), { tag: 'v1.3.1-mac-preview', zipName: 'MOONKATTY-AI-STUDIO-1.3.1-arm64-mac.zip' })])) }).uc.check()).releases[0];
  const previewWrong = (await makeCenter({ fetchImpl: fetchOf(releaseSet([pack({ channel: 'stable', version: '1.3.1' }, goodZip('pre2'), { tag: 'v1.3.1-mac-preview', zipName: 'MOONKATTY-AI-STUDIO-1.3.1-arm64-mac.zip' })])) }).uc.check()).releases[0];
  note('strict-tag-rejects-suffix', badTag.verified === false && badTag.problems.some(p => /тег/.test(p)), badTag.problems.join(' | '));
  note('preview-tag-allowed', previewOk.verified === true && previewOk.manifest.channel === 'preview', previewOk.problems.join(' | ') || 'verified');
  note('preview-tag-rejected-on-stable', previewWrong.verified === false && previewWrong.problems.some(p => /тег/.test(p)), previewWrong.problems.join(' | '));

  const channelMismatch = pack({ channel: 'test', version: '1.3.0' }, goodZip('noch'), { tag: 'v1.3.0', zipName, key: testKp.privateKey, pub: testKp.publicKey });
  const cCh = makeCenter({ fetchImpl: fetchOf(releaseSet([channelMismatch])) });
  const chRel = (await cCh.uc.check()).releases[0];
  note('version-without-test-prerelease-blocked', chRel.gate.allowed === false && /каналу/.test(reasons(chRel) + chRel.problems.join(' ')), reasons(chRel) + ' | ' + chRel.problems.join(' | '));

  const prodIdsZip = goodZip('chan');
  const testChannelProd = pack({ channel: 'test', version: '1.3.0-test', isolated: true, isolatedFrom: [prodId.bundleId] }, prodIdsZip, { tag: 'v1.3.0-test', zipName: 'MOONKATTY-AI-STUDIO-1.3.0-test-arm64-mac.zip', key: testKp.privateKey, pub: testKp.publicKey });
  const cSwap = makeCenter({ fetchImpl: fetchOf(releaseSet([testChannelProd])), platform: 'darwin', env: ARMED, exec: async () => { throw new Error('exec'); } });
  await cSwap.uc.check();
  const dSwap = await cSwap.uc.download('v1.3.0-test');
  await cSwap.uc.preBackup();
  cSwap.uc.approve('v1.3.0-test', { user: 'owner' });
  const planSwap = cSwap.uc.installPlan('v1.3.0-test');
  let autoSwap = '';
  try { await cSwap.uc.autoInstall('v1.3.0-test', { dryRun: true }); autoSwap = 'ran'; } catch (e) { autoSwap = e.code; }
  const swapText = [...planSwap.steps, ...planSwap.rollback].join('\n');
  note('test-manifest-prod-ids-blocked', dSwap.status === 'verified' && planSwap.allowed === false && planSwap.mode === 'blocked' && /test-manifest с prod-идентификаторами|профилю канала/.test(planSwap.reasons.join(' ')) && !/mv "\/Applications\/MOONKATTY AI STUDIO\.app"/.test(swapText) && autoSwap === 'BLOCKED', planSwap.reasons.join(' | ') + ' auto=' + autoSwap);

  const isoZip = goodZip('iso', testId.appName);
  const isolated = pack(testManifest({ version: '1.3.2-test' }), isoZip, { tag: 'v1.3.2-test', zipName: 'MOONKATTY-AI-STUDIO-1.3.2-test-arm64-mac.zip', key: testKp.privateKey, pub: testKp.publicKey });
  const cSide = makeCenter({ fetchImpl: fetchOf(releaseSet([isolated])), identity: prodId });
  const side = (await cSide.uc.check()).releases[0];
  note('channel-switch-is-side-by-side', side.verified === true && side.gate.allowed === true && side.gate.mode === 'side-by-side' && side.gate.target === testId.appPath && side.approved === false, `mode=${side.gate.mode} target=${side.gate.target} reasons=${reasons(side)}`);

  const prodOverTest = pack({ version: '9.0.0', channel: 'stable', isolated: false }, goodZip('over'), { tag: 'v9.0.0', zipName: 'MOONKATTY-AI-STUDIO-9.0.0-arm64-mac.zip' });
  const cOver = makeCenter({ fetchImpl: fetchOf(releaseSet([prodOverTest])), identity: testId });
  const over = (await cOver.uc.check()).releases[0];
  note('prod-manifest-cannot-replace-test-app', over.verified === true && over.gate.allowed === false && over.gate.mode === 'blocked', reasons(over));

  const testZip = goodZip('test-app', testId.appName);
  const testRel = pack(testManifest({ version: '1.4.0-test' }), testZip, { tag: 'v1.4.0-test', zipName: 'MOONKATTY-AI-STUDIO-1.4.0-test-arm64-mac.zip', key: testKp.privateKey, pub: testKp.publicKey });
  const cTest = makeCenter({ fetchImpl: fetchOf(releaseSet([testRel])), identity: testId, platform: 'darwin', env: ARMED, exec: async () => { throw new Error('no exec'); } });
  await cTest.uc.check();
  await cTest.uc.download('v1.4.0-test');
  await readyReplace(cTest.uc, 'v1.4.0-test');
  const testPlan = cTest.uc.installPlan('v1.4.0-test');
  note('test-profile-replaces-test-app-only', testPlan.allowed === true && testPlan.mode === 'replace' && testPlan.target === '/Applications/MOONKATTY AI STUDIO TEST.app', `mode=${testPlan.mode} target=${testPlan.target} reasons=${testPlan.reasons.join(' | ')}`);

  const resolvedProd = AI.resolveIdentity({ env: {}, pkg: { build: { appId: 'com.moonkatty.aistudio' } }, startDirs: ['/tmp'], readFile: () => { throw new Error('no'); } });
  const resolvedTest = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio.test', STUDIO_FLAVOR: 'test' }, startDirs: ['/tmp'], readFile: () => { throw new Error('no'); } });
  const resolvedClash = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.moonkatty.aistudio.test', STUDIO_FLAVOR: 'prod' }, startDirs: ['/tmp'], readFile: () => { throw new Error('no'); } });
  const unknown = AI.resolveIdentity({ env: { STUDIO_APP_BUNDLE_ID: 'com.evil.app' }, startDirs: ['/tmp'], readFile: () => { throw new Error('no'); } });
  note('runtime-identity-prod-and-test', resolvedProd.known === true && resolvedProd.flavor === 'prod' && resolvedProd.appPath.endsWith('MOONKATTY AI STUDIO.app') && resolvedTest.known === true && resolvedTest.flavor === 'test' && resolvedTest.appPath.endsWith('MOONKATTY AI STUDIO TEST.app'), JSON.stringify({ prod: resolvedProd.flavor, test: resolvedTest.flavor, testPath: resolvedTest.appPath }));
  note('flavor-contradiction-blocks', resolvedClash.known === false && unknown.known === false, resolvedClash.problems.join('; ') + ' || ' + unknown.problems.join('; '));
  const unknownGate = gate({ manifest: manifestObj(), verified: true, current: '1.2.0', installed: unknown, compat: { ok: true }, backup: { verified: true }, approval: { manifestSha256: 'abc' }, manifestSha256: 'abc', tag: 'v1.3.0', publishedAt: RECENT, now: NOW });
  note('unknown-identity-blocks-install', unknownGate.allowed === false && /не определена/.test(unknownGate.reasons.join(' ')), unknownGate.reasons.join(' | '));

  const z1 = goodZip('zip-one');
  const z2 = goodZip('zip-two-replaced');
  const first = pack({}, z1, { zipName, signing: 'developer-id', notarized: true });
  let phase = first;
  const cTo = makeCenter({
    fetchImpl: (url) => fetchOf(releaseSet([phase]))(url),
    platform: 'darwin', env: ARMED, identity: prodId,
    exec: async () => { throw new Error('exec should not run'); }
  });
  await cTo.uc.check();
  const d1 = await cTo.uc.download('v1.3.0');
  const before = sha256(fs.readFileSync(d1.file));
  fs.writeFileSync(d1.file, z2);
  await readyReplace(cTo.uc, 'v1.3.0');
  const planTo = cTo.uc.installPlan('v1.3.0');
  let autoTo = '';
  try { await cTo.uc.autoInstall('v1.3.0', { dryRun: true }); autoTo = 'ran'; } catch (e) { autoTo = e.code; }
  const dlState = cTo.uc.status().releases.find(r => r.tag === 'v1.3.0').download;
  note('toctou-replaced-zip-blocks-plan', before === first.obj.assets[0].sha256 && before !== sha256(z2) && planTo.allowed === false && /SHA-256 архива изменился/.test(planTo.reasons.join(' ')) && autoTo === 'BLOCKED' && dlState.status === 'tampered', `plan=${planTo.reasons.join(' | ')} auto=${autoTo} status=${dlState.status}`);

  phase = pack({}, z2, { zipName, signing: 'developer-id', notarized: true });
  const resigned = await cTo.uc.check();
  const resignedRel = resigned.releases.find(r => r.tag === 'v1.3.0');
  note('consent-cleared-when-manifest-changes', resignedRel.approved === false && resignedRel.problems.some(p => /аннулировано/.test(p)) && resignedRel.manifest.assets[0].sha256 === sha256(z2), resignedRel.problems.join(' | '));
  const oldApproval = { manifestSha256: sha256(first.raw), by: 'owner' };
  const rebound = gate({ manifest: phase.obj, verified: true, current: '1.2.0', installed: prodId, compat: { ok: true }, backup: { verified: true }, approval: oldApproval, manifestSha256: sha256(phase.raw), tag: 'v1.3.0', publishedAt: RECENT, now: NOW });
  note('consent-bound-to-manifest-sha256', rebound.allowed === false && /подписанный manifest/.test(rebound.reasons.join(' ')), rebound.reasons.join(' | '));

  const slipZip = zipStore([{ name: `${prodId.appName}.app/Contents/Info.plist`, data: 'x', mode: 0o100644 }, { name: '../outside.txt', data: 'pwned', mode: 0o100644 }]);
  const absZip = zipStore([{ name: `${prodId.appName}.app/Contents/Info.plist`, data: 'x', mode: 0o100644 }, { name: '/tmp/abs.txt', data: 'pwned', mode: 0o100644 }]);
  const slashZip = zipStore([{ name: `${prodId.appName}.app/Contents/Info.plist`, data: 'x', mode: 0o100644 }, { name: '..\\outside.txt', data: 'pwned', mode: 0o100644 }]);
  const linkZip = zipStore([
    { name: `${prodId.appName}.app/Contents/Info.plist`, data: 'plist', mode: 0o100644 },
    { name: `${prodId.appName}.app/Contents/MacOS/escape`, data: '/etc/passwd', mode: 0o120777 }
  ]);
  const relLink = zipStore([
    { name: `${prodId.appName}.app/Contents/Info.plist`, data: 'plist', mode: 0o100644 },
    { name: `${prodId.appName}.app/Contents/MacOS/escape`, data: '../Info.plist', mode: 0o120777 }
  ]);
  const outLink = zipStore([
    { name: `${prodId.appName}.app/Contents/Info.plist`, data: 'plist', mode: 0o100644 },
    { name: `${prodId.appName}.app/Contents/MacOS/escape`, data: '../../../../../../etc/passwd', mode: 0o120777 }
  ]);
  note('zip-slip-rejected', inspectZip(writeZip('slip.zip', slipZip)).ok === false, inspectZip(writeZip('slip2.zip', slipZip)).problems.join(' | '));
  note('absolute-path-rejected', inspectZip(writeZip('abs.zip', absZip)).ok === false, inspectZip(writeZip('abs2.zip', absZip)).problems.join(' | '));
  note('backslash-rejected', inspectZip(writeZip('bsl.zip', slashZip)).ok === false, inspectZip(writeZip('bsl2.zip', slashZip)).problems.join(' | '));
  const linkInfo = inspectZip(writeZip('link.zip', linkZip));
  const relInfo = inspectZip(writeZip('rel.zip', relLink));
  const outInfo = inspectZip(writeZip('out.zip', outLink));
  note('symlink-absolute-rejected', linkInfo.ok === false && linkInfo.symlinks === 1 && linkInfo.problems.some(p => /симлинк/.test(p)), linkInfo.problems.join(' | '));
  note('symlink-escape-rejected', outInfo.ok === false && outInfo.problems.some(p => /симлинк/.test(p)), outInfo.problems.join(' | '));
  note('symlink-inside-app-allowed', relInfo.ok === true && relInfo.symlinks === 1, `ok=${relInfo.ok} problems=${relInfo.problems.join('|')}`);

  const slipPack = pack({}, slipZip, { zipName });
  const linkPack = pack({}, linkZip, { zipName });
  const cSlip = makeCenter({ fetchImpl: fetchOf(releaseSet([slipPack])) });
  await cSlip.uc.check();
  let slipDl = '';
  try { await cSlip.uc.download('v1.3.0'); slipDl = 'downloaded'; } catch (e) { slipDl = e.code; }
  const left = fs.existsSync(path.join(cSlip.dir, 'downloads', 'v1.3.0', zipName)) || fs.existsSync(path.join(cSlip.dir, 'downloads', 'v1.3.0', zipName + '.partial'));
  note('zip-slip-download-deleted', slipDl === 'BAD_ARCHIVE' && left === false, slipDl + ' leftover=' + left);
  const cLink = makeCenter({ fetchImpl: fetchOf(releaseSet([linkPack])), platform: 'darwin', env: ARMED, exec: async () => { throw new Error('exec'); } });
  await cLink.uc.check();
  let linkDl = '';
  try { await cLink.uc.download('v1.3.0'); linkDl = 'downloaded'; } catch (e) { linkDl = e.code; }
  note('symlink-download-refused', linkDl === 'BAD_ARCHIVE', linkDl);

  const bare = makeCenter({});
  let flagErr = '';
  try { await bare.uc.autoInstall('v1.3.0', { dryRun: false }); flagErr = 'ran'; } catch (e) { flagErr = e.code; }
  note('autoinstall-off-without-flags', flagErr === 'AUTO_INSTALL_DISABLED', flagErr);
  const armedZip = goodZip('arm');
  const armedPack = pack({ signing: 'developer-id', notarized: true }, armedZip, { zipName });
  const seen = [];
  const armed = makeCenter({
    fetchImpl: fetchOf(releaseSet([armedPack])),
    env: ARMED, platform: 'darwin', identity: prodId,
    exec: async (cmd, args) => { seen.push([cmd, args]); if (String(cmd).endsWith('spctl')) throw new Error('spctl rejected'); return 'Authority=Developer ID Application: Example'; }
  });
  await armed.uc.check(); await armed.uc.download('v1.3.0'); await readyReplace(armed.uc, 'v1.3.0');
  const dry = await armed.uc.autoInstall('v1.3.0', { dryRun: true });
  const dryText = dry.commands.join('\n');
  note('autoinstall-dry-run-spctl-on-staging', dry.dryRun === true && /\/usr\/bin\/ditto -x -k /.test(dryText) && /spctl --assess --type execute /.test(dryText) && /staging/.test(dryText) && !/xattr|quarantine|rm -rf/.test(dryText) && seen.length === 0, dryText);
  const adhoc = pack({ signing: 'adhoc', notarized: false }, goodZip('adhoc'), { zipName });
  const cAd = makeCenter({ fetchImpl: fetchOf(releaseSet([adhoc])), env: ARMED, platform: 'darwin', exec: async () => { throw new Error('exec'); } });
  await cAd.uc.check(); await cAd.uc.download('v1.3.0'); await readyReplace(cAd.uc, 'v1.3.0');
  let nota = '';
  try { await cAd.uc.autoInstall('v1.3.0', { dryRun: false }); nota = 'ran'; } catch (e) { nota = e.code; }
  note('autoinstall-requires-developer-id', nota === 'NOT_NOTARIZED', nota);
  let linuxErr = '';
  try { await armed.uc.autoInstall('v1.3.0', { dryRun: false }); linuxErr = 'ran'; } catch (e) { linuxErr = e.code; }
  const linuxCenter = makeCenter({ fetchImpl: fetchOf(releaseSet([armedPack])), env: ARMED, platform: 'linux', exec: async () => { throw new Error('must not exec'); } });
  await linuxCenter.uc.check(); await linuxCenter.uc.download('v1.3.0'); await readyReplace(linuxCenter.uc, 'v1.3.0');
  let linuxCode = '';
  try { await linuxCenter.uc.autoInstall('v1.3.0', { dryRun: false }); linuxCode = 'ran'; } catch (e) { linuxCode = e.code; }
  note('autoinstall-refuses-non-mac', linuxCode === 'NOT_MAC' && linuxErr !== 'ran', `linux=${linuxCode} armedDarwinAttempt=${linuxErr}`);
  const rb = makeCenter({ platform: 'linux', identity: prodId, exec: async () => { throw new Error('rb'); } });
  const rbDry = await rb.uc.rollback({ dryRun: true });
  let rbErr = '';
  try { await rb.uc.rollback({ dryRun: false }); rbErr = 'ran'; } catch (e) { rbErr = e.code; }
  note('rollback-is-mv-and-http-dry', rbDry.dryRun === true && rbDry.commands.every(c => c.includes('/bin/mv') || c.includes('launchctl')) && !rbDry.commands.some(c => /rm -rf|xattr/.test(c)) && rbErr === 'NOT_MAC', rbErr + ' ' + rbDry.commands.join(' || '));
  const legacyPlan = update.plan({ report: [{ ok: true }], backupId: 'X' });
  note('legacy-plan-has-no-rm-rf', !JSON.stringify(legacyPlan).includes('rm -rf'), JSON.stringify(legacyPlan.rollback));

  const sc1 = update.schemaCheck(fakeDb({ version: 1 }));
  const sc3 = update.schemaCheck(fakeDb({ version: null, infer: 3 }));
  const sc4 = update.schemaCheck(fakeDb({ version: 4 }));
  const sc99 = update.schemaCheck(fakeDb({ version: 99 }));
  const m3 = manifestObj({ dbSchemaVersion: 3, version: '1.3.0' });
  const cc3 = compatCheck(m3, sc3, prodId);
  const g3 = gate({ manifest: m3, verified: true, current: '1.2.0', installed: prodId, compat: cc3, backup: { verified: true }, approval: { manifestSha256: 'aa' }, manifestSha256: 'aa', tag: 'v1.3.0', publishedAt: RECENT, now: NOW });
  const cc99 = compatCheck(manifestObj({ dbSchemaVersion: 99 }), sc1, prodId);
  const g99 = gate({ manifest: manifestObj({ dbSchemaVersion: 99 }), verified: true, current: '1.2.0', installed: prodId, compat: cc99, backup: { verified: true }, approval: { manifestSha256: 'aa' }, manifestSha256: 'aa', tag: 'v1.3.0', publishedAt: RECENT, now: NOW });
  const cc4 = compatCheck(manifestObj({ dbSchemaVersion: 4 }), sc4, prodId);
  note('schema-3-blocks-gate', sc3.ok === false && sc3.schemaVersion === 3 && cc3.ok === false && g3.allowed === false, `schema=${sc3.ok}/${sc3.schemaVersion} compat=${cc3.detail} gate=${g3.reasons.join(' | ')}`);
  note('schema-99-blocks-gate', cc99.ok === false && g99.allowed === false && /неизвестная версия схемы 99/.test(cc99.detail), cc99.detail);
  note('schema-4-fail-closed', sc1.ok === true && sc4.ok === false && sc4.supported === 1 && cc4.ok === false, `v1=${sc1.ok} v4=${sc4.ok} supported=${sc4.supported} ${cc4.detail}`);
  note('schema-99-db-fail-closed', sc99.ok === false && compatCheck(manifestObj(), sc99, prodId).ok === false, compatCheck(manifestObj(), sc99, prodId).detail);

  const nonDarwin = await UM.createUpdateManager({ platform: 'linux' }).verifySignature({ appPath: prodId.appPath });
  note('non-darwin-codesign-not-ok', nonDarwin.ok === false && nonDarwin.checks.some(c => c.id === 'codesign' && c.ok === false), nonDarwin.checks.map(c => c.id + ':' + c.ok).join(','));
  const gk = await UM.createUpdateManager({
    platform: 'darwin',
    exec: async (cmd) => { if (String(cmd).includes('spctl')) throw new Error('rejected'); return ''; }
  }).verifySignature({ appPath: prodId.appPath });
  note('gatekeeper-rejection-not-ok', gk.ok === false && gk.checks.some(c => c.id === 'gatekeeper' && c.ok === false), gk.checks.map(c => c.id + ':' + c.ok).join(','));

  let badHealth = '';
  try { safeHealthUrl('http://169.254.169.254/latest/meta-data/', prodId); badHealth = 'allowed'; } catch (e) { badHealth = e.code; }
  let httpsHealth = '';
  try { safeHealthUrl('https://127.0.0.1:8787/api/health', prodId); httpsHealth = 'allowed'; } catch (e) { httpsHealth = e.code; }
  let queryHealth = '';
  try { safeHealthUrl('http://127.0.0.1:8787/api/health?x=1', prodId); queryHealth = 'allowed'; } catch (e) { queryHealth = e.code; }
  const okHealth = safeHealthUrl('http://127.0.0.1:8787/api/health', prodId);
  let ctor = '';
  try { makeCenter({ healthUrl: 'http://169.254.169.254/latest/meta-data/' }); ctor = 'allowed'; } catch (e) { ctor = e.code; }
  note('health-url-loopback-only', badHealth === 'BAD_HEALTH_URL' && httpsHealth === 'BAD_HEALTH_URL' && queryHealth === 'BAD_HEALTH_URL' && okHealth.startsWith('http://127.0.0.1:8787/api/health') && ctor === 'BAD_HEALTH_URL', `${badHealth} ${httpsHealth} ${queryHealth} ${okHealth} ctor=${ctor}`);

  const srcUC = fs.readFileSync(path.join(SRC, 'lib/ops/update-center.js'), 'utf8');
  const srcDesk = fs.readFileSync(path.join(SRC, 'desktop/main.js'), 'utf8');
  const srcUi = fs.readFileSync(path.join(SRC, 'public/update-ui.js'), 'utf8');
  const srcIdx = fs.readFileSync(path.join(SRC, 'lib/ops/index.js'), 'utf8');
  const srcOps = fs.readdirSync(path.join(SRC, 'lib/ops')).filter(n => n.endsWith('.js')).map(n => fs.readFileSync(path.join(SRC, 'lib/ops', n), 'utf8')).join('\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'));
  note('update-center-has-no-interval', !/setInterval\(/.test(srcUC), 'no setInterval in update-center.js');
  note('index-health-is-loopback', /healthUrl: `http:\/\/127\.0\.0\.1:/.test(srcIdx) && !/OPS_UPDATE_HEALTH_URL/.test(srcIdx), 'index builds 127.0.0.1 health URL');
  note('ops-sources-have-no-rm-rf', !/rm -rf/.test(srcOps), 'lib/ops has no rm -rf');
  note('ui-check-is-a-button', /id="ucCheck"/.test(srcUi) && /ucCheck[\s\S]{0,400}update-center\/check/.test(srcUi), 'POST /check is the button handler');
  note('electron-autocheck-off', /checkUpdates:\s*false/.test(srcDesk) && /if \(!manual\) return/.test(srcDesk) && !/setTimeout\(\(\) => checkUpdates\(false\)/.test(srcDesk), 'DEF.checkUpdates false; manual only');
  note('electron-check-does-not-install', /Never downloads or installs/.test(srcDesk) && !/autoUpdater|electron-updater/.test(srcDesk) && !pkg.dependencies?.['electron-updater'], 'no electron-updater');
  note('builder-still-adhoc', pkg.build?.mac?.identity === null && pkg.build?.mac?.gatekeeperAssess === false && pkg.build?.mac?.hardenedRuntime === false, JSON.stringify(pkg.build && pkg.build.mac));
}

function startServer(port, extra) {
  const dir = tmp('mk-uc2-srv-');
  const env = { ...process.env, NODE_PATH: '/workspace/node_modules', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', ...extra };
  delete env.DB_PATH;
  delete env.STUDIO_FLAVOR;
  delete env.STUDIO_APP_BUNDLE_ID;
  delete env.STUDIO_OPS_UPDATE;
  delete env.STUDIO_OPS_BACKUP;
  Object.assign(env, extra);
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
  const off = startServer(18961, {});
  const on = startServer(18962, { STUDIO_OPS_UPDATE: '1', STUDIO_OPS_BACKUP: '1' });
  try {
    const upOff = await waitHealth(18961);
    const upOn = await waitHealth(18962);
    note('servers-started', upOff && upOn, `off=${upOff} on=${upOn} ${(off.out.join('') + on.out.join('')).slice(-400)}`);
    if (!(upOff && upOn)) return;
    const H = { 'content-type': 'application/json', 'x-studio-request': '1' };
    const setup = await req(18962, 'POST', '/api/auth/setup', { headers: H, body: { username: 'igor', password: 'fake-password-123' } });
    const setupOff = await req(18961, 'POST', '/api/auth/setup', { headers: H, body: { username: 'igor', password: 'fake-password-123' } });
    const cookie = setup.setCookie.split(';')[0];
    const auth = { ...H, cookie };
    const offGet = await req(18961, 'GET', '/api/ops/update-center', { headers: { ...H, cookie: setupOff.setCookie.split(';')[0] } });
    const noAuth = await req(18962, 'GET', '/api/ops/update-center');
    const noHdr = await req(18962, 'POST', '/api/ops/update-center/check', { headers: { cookie, 'content-type': 'application/json' }, body: {} });
    const evil = await req(18962, 'POST', '/api/ops/update-center/check', { headers: { ...auth, origin: 'https://evil.example' }, body: {} });
    const cross = await req(18962, 'POST', '/api/ops/update-center/check', { headers: { ...auth, 'sec-fetch-site': 'cross-site' }, body: {} });
    const auto = await req(18962, 'POST', '/api/ops/update-center/v9.9.9/auto-install', { headers: auth, body: { dryRun: false } });
    const rb = await req(18962, 'POST', '/api/ops/update-center/rollback', { headers: auth, body: { dryRun: false } });
    const appr = await req(18962, 'POST', '/api/ops/update-center/v9.9.9/approve', { headers: auth, body: { password: 'wrong-password' } });
    const check = await req(18962, 'POST', '/api/ops/update-center/check', { headers: auth, body: {} });
    const apps = fs.existsSync('/Applications/MOONKATTY AI STUDIO.app');
    const bind = (on.out.join('').match(/http:\/\/[^\s]+/) || [])[0] || '';
    note('flag-off-is-404', offGet.status === 404, String(offGet.status));
    note('unauthenticated-is-401', noAuth.status === 401, String(noAuth.status));
    note('csrf-missing-header-403', noHdr.status === 403, noHdr.json && noHdr.json.error);
    note('csrf-evil-origin-403', evil.status === 403, evil.json && evil.json.error);
    note('csrf-cross-site-403', cross.status === 403, cross.json && cross.json.error);
    note('autoinstall-http-disabled', auto.status === 400 && auto.json && auto.json.code === 'AUTO_INSTALL_DISABLED', JSON.stringify(auto.json));
    note('rollback-http-stays-dry-run', rb.status === 200 && rb.json && rb.json.dryRun === true && !(rb.json.commands || []).some(c => /rm -rf/.test(c)), JSON.stringify(rb.json).slice(0, 300));
    note('approve-wrong-password-403', appr.status === 403, appr.json && appr.json.error);
    note('check-does-not-touch-applications', check.status !== 401 && check.status !== 403 && apps === false, `status=${check.status} applicationsApp=${apps} bind=${bind}`);
    note('server-bind-is-loopback', bind.startsWith('http://127.0.0.1:'), bind);
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
