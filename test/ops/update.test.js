'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { createUpdateManager } = require('../../lib/ops/update.js');
const C = 'a'.repeat(40);
const gitMock = (o = {}) => async (cmd, args) => { const a = args.join(' ');
  if (cmd === 'git') { if (a.includes('remote get-url')) return o.remote ?? 'https://github.com/moonkattymky/moonkatty-ai-studio.git';
    if (a.includes('rev-parse')) { if (o.noRef) throw new Error('bad'); return C; } if (a.includes('tag --points-at')) return o.tags ?? 'v1.2.0';
    if (a.includes('branch -r')) return o.branches ?? '  origin/feat/studio-operations'; if (a.includes('status --porcelain')) return o.dirty ?? ''; }
  if (cmd === '/usr/bin/codesign') { if (o.codesignFail) throw new Error('invalid signature'); return ''; }
  if (cmd === '/usr/sbin/spctl') { if (o.spctlReject) throw new Error('rejected'); return 'accepted'; }
  throw new Error('unexpected ' + cmd); };
test('origin verification: remote, ref, on origin, clean tree', async () => {
  assert.ok((await createUpdateManager({ exec: gitMock() }).verifyOrigin({ repoDir: '.', ref: 'v1.2.0' })).ok);
  for (const o of [{ remote: 'https://github.com/evil/fork.git' }, { noRef: true }, { tags: '', branches: '' }, { dirty: ' M server.js' }])
    assert.equal((await createUpdateManager({ exec: gitMock(o) }).verifyOrigin({ repoDir: '.', ref: 'x' })).ok, false, JSON.stringify(o));
});
test('artifact SHA-256 required and must match (direct or SHA256SUMS)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'up-')); const f = path.join(d, 'app.zip'); fs.writeFileSync(f, 'zipdata'); const h = crypto.createHash('sha256').update('zipdata').digest('hex');
  const um = createUpdateManager({ exec: gitMock() });
  assert.ok((await um.verifyArtifact({ file: f, sha256: h })).ok); assert.equal((await um.verifyArtifact({ file: f, sha256: 'b'.repeat(64) })).ok, false);
  assert.equal((await um.verifyArtifact({ file: f })).ok, false, 'no checksum → refuse');
  fs.writeFileSync(path.join(d, 'SHA256SUMS.txt'), `${h}  app.zip\n`); assert.ok((await um.verifyArtifact({ file: f, sumsFile: path.join(d, 'SHA256SUMS.txt') })).ok);
});
test('signature: codesign must pass; Gatekeeper rejection is reported, never bypassed', async () => {
  let r = await createUpdateManager({ exec: gitMock(), platform: 'darwin' }).verifySignature({ appPath: '/x.app' }); assert.ok(r.ok);
  r = await createUpdateManager({ exec: gitMock({ codesignFail: true }), platform: 'darwin' }).verifySignature({ appPath: '/x.app' }); assert.equal(r.ok, false);
  r = await createUpdateManager({ exec: gitMock({ spctlReject: true }), platform: 'darwin' }).verifySignature({ appPath: '/x.app' }); assert.equal(r.gatekeeper, 'rejected'); assert.match(r.checks[1].detail, /НЕ обходите/);
  const src = fs.readFileSync(path.join(__dirname, '../../lib/ops/update.js'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /xattr|master-disable|--add\b/, 'no Gatekeeper bypass in code');
});
test('schema compatibility + plan refuses on failed checks', () => {
  const db = require('../../lib/db.js').open(':memory:'); /* better-sqlite3 or node:sqlite */ db.exec('CREATE TABLE items (col,id,data); CREATE TABLE meta (k PRIMARY KEY, v)');
  const um = createUpdateManager({ exec: gitMock() }); assert.ok(um.schemaCheck(db).ok);
  db.prepare("INSERT INTO meta VALUES ('schemaVersion','2')").run(); assert.equal(um.schemaCheck(db).ok, false);
  assert.equal(um.plan({ report: [{ ok: false }] }).allowed, false); const p = um.plan({ report: [{ ok: true }], backupId: 'X' }); assert.ok(p.allowed); assert.ok(p.rollback.length >= 2);
});
