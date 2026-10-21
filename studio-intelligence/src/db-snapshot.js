'use strict';
const fs = require('fs');

/**
 * Согласованный снимок открытой базы. VACUUM INTO пишет цельный файл, хвост WAL в копию не попадает.
 * Файл назначения не должен существовать. Внутри транзакции SQLite эту команду не принимает.
 */
function snapshotDatabase({ db, dest } = {}) {
  if (!db || !dest) throw new Error('Нужны db и dest');
  if (fs.existsSync(dest)) throw new Error('Файл снимка уже есть');
  const quoted = String(dest).replace(/'/g, "''");
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* снимок всё равно согласован */ }
  db.exec(`VACUUM INTO '${quoted}'`);
  return { dest, method: 'VACUUM INTO', copied: true };
}

module.exports = { snapshotDatabase };
