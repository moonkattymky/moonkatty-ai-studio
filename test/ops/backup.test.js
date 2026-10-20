'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../../lib/db.js'); const { createBackupManager } = require('../../lib/ops/backup.js');
function fixture() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')); const db = open(path.join(d, 'studio.db'));
  db.exec('CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);');
  const ins = db.prepare('INSERT INTO items VALUES (?,?,?)'); for (let i = 0; i < 5; i++) ins.run('tasks', 't' + i, '{}'); ins.run('queue', 'q1', '{"title":"post"}'); ins.run('templates', 'tp', '{}');
  db.prepare('INSERT INTO meta VALUES (?,?)').run('sessions', '[["h:abc",{}]]'); db.prepare('INSERT INTO meta VALUES (?,?)').run('secret:pagetoken:1', 'iv.tag.ENCRYPTED');
  fs.writeFileSync(path.join(d, 'secret.key'), 'a'.repeat(64), { mode: 0o600 }); fs.writeFileSync(path.join(d, 'app-token'), 'b'.repeat(64), { mode: 0o600 });
  fs.mkdirSync(path.join(d, 'files', 'models'), { recursive: true }); fs.writeFileSync(path.join(d, 'files', 'models', 'cat.glb'), Buffer.alloc(2048, 7)); fs.writeFileSync(path.join(d, 'files', 'ep1.mp4'), 'video');
  fs.writeFileSync(path.join(d, 'desktop.json'), '{"port":8787}');
  const anim = path.join(d, 'animations'); fs.mkdirSync(anim); fs.writeFileSync(path.join(anim, 'walk.blend'), 'blend');
  let t = Date.parse('2026-10-21T10:00:00Z');
  const bm = createBackupManager({ db, openDb: open, dataDir: d, filesDir: path.join(d, 'files'), extraDirs: [anim], version: '1.2.0', keep: 2, now: () => (t += 1000) });
  return { d, db, bm };
}
test('online snapshot: files, settings, manifest; NO plaintext secrets, sessions stripped', () => {
  const { d, bm } = fixture(); const b = bm.create(); const dir = path.join(bm.root, b.id);
  assert.ok(!fs.existsSync(path.join(dir, 'secret.key')) && !fs.existsSync(path.join(dir, 'app-token'))); assert.equal(b.secretKey, 'excluded');
  const m = bm.readManifest(b.id); const paths = m.files.map(f => f.path);
  for (const p of ['studio.db', 'files/models/cat.glb', 'files/ep1.mp4', 'desktop.json', 'extra/animations/walk.blend']) assert.ok(paths.includes(p), p);
  assert.deepEqual(m.counts, { queue: 1, tasks: 5, templates: 1 }); assert.ok(m.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
  const snap = open(path.join(dir, 'studio.db')); assert.equal(snap.prepare("SELECT v FROM meta WHERE k='sessions'").get(), undefined);
  assert.equal(snap.prepare("SELECT v FROM meta WHERE k='secret:pagetoken:1'").get().v, 'iv.tag.ENCRYPTED', 'stays encrypted'); snap.close();
  const all = fs.readdirSync(dir, { recursive: true }).map(String).join('\n'); assert.doesNotMatch(all, /secret\.key$|app-token/m);
  assert.ok(fs.existsSync(path.join(d, 'secret.key')), 'live data untouched');
});
test('verify detects tampering; test-restore in temp dir checks integrity + counts', () => {
  const { bm } = fixture(); const b = bm.create(); assert.ok(bm.verify(b.id).ok);
  const tr = bm.testRestore(b.id); assert.ok(tr.ok, JSON.stringify(tr)); assert.equal(tr.integrity, 'ok'); assert.equal(tr.secretKey, 'absent');
  fs.appendFileSync(path.join(bm.root, b.id, 'files', 'ep1.mp4'), 'x'); const v = bm.verify(b.id); assert.equal(v.ok, false); assert.match(v.problems.join(), /ep1\.mp4/);
  assert.equal(bm.testRestore(b.id).ok, false);
  const b2 = bm.create(); fs.writeFileSync(path.join(bm.root, b2.id, 'manifest.json'), fs.readFileSync(path.join(bm.root, b2.id, 'manifest.json'), 'utf8').replace('"tasks": 5', '"tasks": 6'));
  assert.equal(bm.verify(b2.id).ok, false, 'manifest checksum');
});
test('secret.key encrypted with passphrase; restore only into empty dir; wrong passphrase fails', () => {
  const { d, bm } = fixture(); assert.throws(() => bm.create({ passphrase: 'short' }));
  const b = bm.create({ passphrase: 'correct horse battery' }); assert.equal(b.secretKey, 'encrypted');
  const enc = fs.readFileSync(path.join(bm.root, b.id, 'secret.key.enc'), 'utf8'); assert.ok(!enc.includes('a'.repeat(16)));
  const tgt = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-')); const r = bm.restoreInto(b.id, path.join(tgt, 'new'), { passphrase: 'correct horse battery' });
  assert.equal(r.secretKey, 'restored'); assert.equal(fs.readFileSync(path.join(tgt, 'new', 'secret.key'), 'utf8'), 'a'.repeat(64)); assert.equal(fs.statSync(path.join(tgt, 'new', 'secret.key')).mode & 0o777, 0o600);
  assert.throws(() => bm.restoreInto(b.id, path.join(tgt, 'new'), {}), /не пуста/); assert.throws(() => bm.restoreInto(b.id, d), /не пуста/);
  assert.throws(() => bm.restoreInto(b.id, path.join(tgt, 'w'), { passphrase: 'wrong passphrase!!' }));
  assert.ok(bm.testRestore(b.id, { passphrase: 'correct horse battery' }).ok);
});
test('retention keeps N newest; ignores foreign dirs; rejects bad ids', () => {
  const { bm } = fixture(); fs.mkdirSync(path.join(bm.root, 'user-folder')); const ids = [bm.create().id, bm.create().id, bm.create().id];
  assert.deepEqual(bm.list().map(b => b.id), [ids[2], ids[1]]); assert.ok(fs.existsSync(path.join(bm.root, 'user-folder')));
  for (const bad of ['../x', '..', 'a/b', '']) assert.throws(() => bm.verify(bad));
});
