// SQLite safety copies (VACUUM INTO → consistent single-file copy, works with node:sqlite and better-sqlite3).
// Every copy gets a sidecar "<file>.sha256" (sha256sum format) so it can be verified before use.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const sha256File = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const sqlStr = s => "'" + String(s).replace(/'/g, "''") + "'";
function snapshot(db, dir, tag) {
  fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, `${tag}-${stamp()}.db`);
  db.exec(`VACUUM INTO ${sqlStr(f)}`); fs.chmodSync(f, 0o600);
  const sha256 = sha256File(f); fs.writeFileSync(f + '.sha256', `${sha256}  ${path.basename(f)}\n`, { mode: 0o600 });
  return { file: f, sha256, size: fs.statSync(f).size };
}
// Real schema version of an existing DB. Before v1.2.2 there was no explicit marker, so it is inferred from the schema:
// 1 = items/meta only (v1.0–v1.1.x, e.g. v1.1.2) · 2 = + jobs/job_events (early v1.2.0) · 3 = + jobs.input… columns (v1.2.0/v1.2.1)
function detectVersion(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  if (!tables.includes('items')) return 0;
  if (tables.includes('meta')) { const r = db.prepare("SELECT v FROM meta WHERE k='schemaVersion'").get(); if (r && /^\d+$/.test(r.v)) return +r.v; }
  if (!tables.includes('jobs')) return 1;
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  return cols.includes('input') ? 3 : 2;
}
function backupBeforeMigration(dbPath, target, openDb) {
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return null;
  const db = openDb(dbPath); try {
    const from = detectVersion(db); if (from === 0 || from >= target) return null;
    return { from, ...snapshot(db, path.join(path.dirname(dbPath), 'backups'), `pre-migration-v${from}-to-v${target}`) };
  } finally { try { db.close(); } catch {} }
}
module.exports = { snapshot, sha256File, detectVersion, backupBeforeMigration };
