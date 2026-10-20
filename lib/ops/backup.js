// Backup & Recovery (STUDIO_OPS_BACKUP=1). Online SQLite snapshot (VACUUM INTO — works with better-sqlite3 and node:sqlite),
// project files, settings, SHA-256 manifest, verify, test-restore into a temp dir, retention.
// Secrets: secret.key and app-token are NEVER copied in plaintext. secret.key is either excluded or encrypted with a user
// passphrase (scrypt + AES-256-GCM). Sessions are removed from the snapshot. Encrypted Meta tokens stay encrypted.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const APP = 'moonkatty-ai-studio';
const sha256File = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function copyTree(src, dst, files = [], rel = '') {
  if (!fs.existsSync(src)) return files; fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isSymbolicLink() || e.name.startsWith('.')) continue; const s = path.join(src, e.name), d = path.join(dst, e.name), r = path.posix.join(rel, e.name);
    if (e.isDirectory()) copyTree(s, d, files, r); else if (e.isFile()) { fs.copyFileSync(s, d); files.push(r); }
  }
  return files;
}
function encryptWithPassphrase(buf, pass) {
  if (!pass || String(pass).length < 10) throw new Error('Пароль для шифрования ключа: минимум 10 символов');
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12); const key = crypto.scryptSync(String(pass), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv); const e = Buffer.concat([c.update(buf), c.final()]);
  return JSON.stringify({ v: 1, kdf: 'scrypt', N: 1 << 15, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: e.toString('base64') });
}
function decryptWithPassphrase(json, pass) {
  const o = JSON.parse(json); const key = crypto.scryptSync(String(pass), Buffer.from(o.salt, 'base64'), 32, { N: o.N, r: 8, p: 1, maxmem: 64 << 20 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64')); d.setAuthTag(Buffer.from(o.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]);
}
function createBackupManager({ db, openDb, dataDir, filesDir, extraDirs = [], version = '0', schemaVersion = 1, root, keep = 7, now = Date.now, log = () => {} }) {
  root = root || path.join(dataDir, 'ops', 'backups'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const idOk = id => /^\d{8}T\d{6}Z(-\d+)?$/.test(String(id));
  const dirOf = id => { if (!idOk(id)) throw Object.assign(new Error('bad id'), { status: 400 }); return path.join(root, id); };
  function create({ passphrase, note = '' } = {}) {
    let id = new Date(now()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); let n = 0; while (fs.existsSync(path.join(root, id + (n ? '-' + n : '')))) n++; if (n) id += '-' + n;
    const dir = path.join(root, id), tmp = dir + '.partial'; fs.mkdirSync(tmp, { recursive: true, mode: 0o700 });
    try {
      const dbFile = path.join(tmp, 'studio.db'); if (/['\0]/.test(dbFile)) throw new Error('unsafe path');
      db.exec(`VACUUM INTO '${dbFile}'`);
      const snap = openDb(dbFile); const counts = {};
      try { snap.prepare("DELETE FROM meta WHERE k IN ('sessions','appTokenDisabled')").run();
        for (const r of snap.prepare('SELECT col, COUNT(*) AS n FROM items GROUP BY col').all()) counts[r.col] = r.n; snap.exec('VACUUM'); } finally { snap.close(); }
      const files = ['studio.db'];
      copyTree(filesDir, path.join(tmp, 'files'), []).forEach(f => files.push('files/' + f));
      for (const x of extraDirs) { const name = path.basename(x); copyTree(x, path.join(tmp, 'extra', name), []).forEach(f => files.push(`extra/${name}/${f}`)); }
      const dj = path.join(dataDir, 'desktop.json'); if (fs.existsSync(dj)) { fs.copyFileSync(dj, path.join(tmp, 'desktop.json')); files.push('desktop.json'); }
      let secretKey = 'excluded'; const sk = path.join(dataDir, 'secret.key');
      if (passphrase && fs.existsSync(sk)) { fs.writeFileSync(path.join(tmp, 'secret.key.enc'), encryptWithPassphrase(fs.readFileSync(sk), passphrase), { mode: 0o600 }); files.push('secret.key.enc'); secretKey = 'encrypted'; }
      const manifest = { app: APP, kind: 'ops-backup', version, schemaVersion, createdAt: new Date(now()).toISOString(), note: String(note).slice(0, 200), secretKey, counts,
        files: files.map(f => ({ path: f, size: fs.statSync(path.join(tmp, f)).size, sha256: sha256File(path.join(tmp, f)) })) };
      fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 1), { mode: 0o600 });
      fs.writeFileSync(path.join(tmp, 'MANIFEST.sha256'), sha256File(path.join(tmp, 'manifest.json')) + '  manifest.json\n');
      fs.renameSync(tmp, dir);
    } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
    log('info', 'backup', `Ops-бэкап ${id} создан`); const pruned = retention(); return { id, ...summary(id), pruned };
  }
  const readManifest = id => JSON.parse(fs.readFileSync(path.join(dirOf(id), 'manifest.json'), 'utf8'));
  const summary = id => { const m = readManifest(id); return { id, createdAt: m.createdAt, version: m.version, schemaVersion: m.schemaVersion, secretKey: m.secretKey, files: m.files.length, bytes: m.files.reduce((a, f) => a + f.size, 0), counts: m.counts }; };
  function list() { return fs.readdirSync(root).filter(idOk).filter(id => { try { return readManifest(id).app === APP; } catch { return false; } }).sort().reverse().map(summary); }
  function verify(id, dir = dirOf(id)) {
    const problems = []; let m;
    try { const want = fs.readFileSync(path.join(dir, 'MANIFEST.sha256'), 'utf8').split(/\s+/)[0]; if (want !== sha256File(path.join(dir, 'manifest.json'))) problems.push('manifest.json изменён'); m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
    catch (e) { return { ok: false, problems: ['нет/повреждён manifest: ' + e.message] }; }
    for (const f of m.files) { const p = path.join(dir, f.path); if (!path.resolve(p).startsWith(path.resolve(dir) + path.sep)) { problems.push('путь вне бэкапа: ' + f.path); continue; }
      if (!fs.existsSync(p)) problems.push('нет файла ' + f.path); else if (sha256File(p) !== f.sha256) problems.push('SHA-256 не совпадает: ' + f.path); }
    for (const bad of ['secret.key', 'app-token']) if (fs.existsSync(path.join(dir, bad))) problems.push('в бэкапе открытый секрет: ' + bad);
    return { ok: !problems.length, problems, files: m.files.length };
  }
  // Restores into a NEW temp dir, checks integrity and counts. Never touches live data.
  function testRestore(id, { passphrase, keepDir = false } = {}) {
    const v = verify(id); if (!v.ok) return { ok: false, stage: 'verify', ...v };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-restore-test-')); const res = { ok: false, dir: keepDir ? tmp : undefined };
    try {
      restoreInto(id, path.join(tmp, 'data'), { passphrase });
      const d = openDb(path.join(tmp, 'data', 'studio.db'));
      try { const ic = d.prepare('PRAGMA integrity_check').get(); res.integrity = Object.values(ic)[0];
        const counts = {}; for (const r of d.prepare('SELECT col, COUNT(*) AS n FROM items GROUP BY col').all()) counts[r.col] = r.n;
        const m = readManifest(id); res.countsMatch = JSON.stringify(counts) === JSON.stringify(m.counts); res.counts = counts;
        res.tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).sort(); } finally { d.close(); }
      res.secretKey = fs.existsSync(path.join(tmp, 'data', 'secret.key')) ? 'restored' : 'absent';
      res.ok = res.integrity === 'ok' && res.countsMatch && res.tables.includes('items') && res.tables.includes('meta');
    } catch (e) { res.error = e.message; } finally { if (!keepDir) fs.rmSync(tmp, { recursive: true, force: true }); }
    return res;
  }
  // Manual restore into an EMPTY directory (e.g. a fresh data dir); refuses to overwrite anything.
  function restoreInto(id, target, { passphrase } = {}) {
    const dir = dirOf(id); const v = verify(id); if (!v.ok) throw new Error('Бэкап не прошёл проверку: ' + v.problems.join('; '));
    if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error('Целевая папка не пуста — восстановление только в пустую папку');
    fs.mkdirSync(target, { recursive: true, mode: 0o700 }); const m = readManifest(id);
    for (const f of m.files) { if (f.path === 'secret.key.enc') continue; const d = path.join(target, f.path); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(dir, f.path), d); }
    if (m.secretKey === 'encrypted' && passphrase) fs.writeFileSync(path.join(target, 'secret.key'), decryptWithPassphrase(fs.readFileSync(path.join(dir, 'secret.key.enc'), 'utf8'), passphrase), { mode: 0o600 });
    return { ok: true, target, secretKey: m.secretKey === 'encrypted' ? (passphrase ? 'restored' : 'needs-passphrase') : 'excluded' };
  }
  function retention() { const all = list(); const drop = all.slice(keep); for (const b of drop) fs.rmSync(path.join(root, b.id), { recursive: true, force: true }); return drop.map(b => b.id); }
  return { create, list, verify, testRestore, restoreInto, retention, root, readManifest };
}
module.exports = { createBackupManager, encryptWithPassphrase, decryptWithPassphrase, sha256File };
