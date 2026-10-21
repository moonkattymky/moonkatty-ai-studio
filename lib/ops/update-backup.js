// v1.3.0-test adapter: minimal pre-update backup for Update Center (no ops backup.js stack). Uses lib/db-backup.js snapshot
// (VACUUM INTO + .sha256 sidecar), verifies the checksum and test-restores the copy into a TEMP dir (opened read-only:
// PRAGMA integrity_check + items/meta present). Never touches the live DB beyond the read for VACUUM INTO.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const DBB = require('../db-backup.js');
function createUpdateBackups({ db, openDb, dir }) {
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
  return { create, verify, testRestore };
}
module.exports = { createUpdateBackups };
