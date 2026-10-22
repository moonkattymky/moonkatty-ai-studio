// v1.3.0-test adapter: minimal pre-update backup for Update Center (no ops backup.js stack). Uses lib/db-backup.js snapshot
// (VACUUM INTO + .sha256 sidecar), verifies the checksum and test-restores the copy into a TEMP dir (opened read-only:
// PRAGMA integrity_check + items/meta present). Never touches the live DB beyond the read for VACUUM INTO.
// E2E-UC: + settings and user files: every regular file of the data dir except the live DB (+wal/shm), Update Center downloads/
// staging/backups and other backup folders is copied next to the DB snapshot with a per-file SHA-256 manifest; verifyFiles re-hashes.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const DBB = require('../db-backup.js');
const MAX_FILES_BYTES = 4 * 1024 ** 3;
function createUpdateBackups({ db, openDb, dir, dataDir = null, dbFile = null, maxBytes = MAX_FILES_BYTES }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fileOf = id => { if (!/^pre-update-[0-9A-Za-z-]+\.db$/.test(String(id))) throw Object.assign(new Error('bad backup id'), { status: 400 }); return path.join(dir, id); };
  function create() { const s = DBB.snapshot(db, dir, 'pre-update'); return { id: path.basename(s.file), sha256: s.sha256, size: s.size }; }
  function verify(id) { const f = fileOf(id); const problems = []; if (!fs.existsSync(f)) return { ok: false, problems: ['нет файла бэкапа'] };
    const want = (fs.readFileSync(f + '.sha256', 'utf8').trim().split(/\s+/)[0] || ''); const got = DBB.sha256File(f); if (want !== got) problems.push('SHA-256 бэкапа не совпадает');
    return { ok: !problems.length, sha256: got, problems }; }
  function testRestore(id) { const f = fileOf(id); const t = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-uc-restore-')); const c = path.join(t, 'restore.db');
    try { fs.copyFileSync(f, c); const x = openDb(c); try { const integrity = String(Object.values(x.prepare('PRAGMA integrity_check').get() || {})[0]);
        const tables = x.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        const ok = integrity === 'ok' && tables.includes('items') && tables.includes('meta'); return { ok, integrity, error: ok ? null : 'тест-восстановление: БД повреждена или нет items/meta' }; }
      finally { try { x.close(); } catch {} } } catch (e) { return { ok: false, error: e.message }; } finally { fs.rmSync(t, { recursive: true, force: true }); } }
  const hashFile = f => DBB.sha256File(f);
  const filesDir = id => fileOf(id).replace(/\.db$/, '.files');
  function walk(root) { const out = []; const skip = new Set([path.resolve(dir), ...(dbFile ? [] : [])]); const db0 = dbFile ? path.resolve(dbFile) : null;
    (function rec(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.resolve(d, e.name); const rel = path.relative(root, p).split(path.sep).join('/');
      if (skip.has(p) || /^ops\/update-center(\/|$)/.test(rel) || /(^|\/)backups?(\/|$)/.test(rel) || /\.(partial)$/.test(e.name)) continue;
      if (db0 && (p === db0 || p === db0 + '-wal' || p === db0 + '-shm' || p === db0 + '-journal')) continue;
      if (e.isDirectory()) rec(p); else if (e.isFile()) out.push(rel); } })(root); return out; }
  function createFiles(id) { if (!dataDir) throw Object.assign(new Error('папка данных не задана — бэкап настроек/файлов невозможен'), { code: 'NO_DATA_DIR' });
    const root = path.resolve(dataDir), out = filesDir(id); fs.mkdirSync(out, { recursive: true, mode: 0o700 }); const list = walk(root); let bytes = 0; const files = {};
    for (const rel of list) { const src = path.join(root, rel); const st = fs.statSync(src); bytes += st.size; if (bytes > maxBytes) throw Object.assign(new Error(`файлы пользователя > ${Math.round(maxBytes / 1e9)} ГБ — бэкап отклонён`), { code: 'TOO_LARGE' });
      const dst = path.join(out, rel); fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 }); fs.copyFileSync(src, dst); files[rel] = { sha256: hashFile(dst), size: st.size }; }
    fs.writeFileSync(path.join(out, 'MANIFEST.json'), JSON.stringify({ v: 1, id, dataDir: root, createdAt: new Date().toISOString(), files }, null, 1), { mode: 0o600 }); return { count: list.length, bytes, dir: out }; }
  function verifyFiles(id) { const out = filesDir(id); const problems = []; let m; try { m = JSON.parse(fs.readFileSync(path.join(out, 'MANIFEST.json'), 'utf8')); } catch (e) { return { ok: false, problems: ['нет MANIFEST.json бэкапа файлов'] }; }
    for (const [rel, f] of Object.entries(m.files || {})) { const p = path.join(out, rel); if (!fs.existsSync(p)) problems.push('нет файла ' + rel); else if (hashFile(p) !== f.sha256) problems.push('SHA-256 не совпадает: ' + rel); }
    return { ok: !problems.length, count: Object.keys(m.files || {}).length, problems }; }
  return { create, verify, testRestore, ...(dataDir ? { createFiles, verifyFiles } : {}), filesDir };
}
module.exports = { createUpdateBackups };
