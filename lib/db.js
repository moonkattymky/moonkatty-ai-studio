// SQLite adapter: same file format, two drivers.
// node:sqlite (built into Node 22.5+/Electron 33+) is used in the desktop app — no native module to cross-compile.
// better-sqlite3 is used when available on plain Node (server/Docker), unless STUDIO_SQLITE=node.
'use strict';
function open(file) {
  let driver = process.env.STUDIO_SQLITE || (process.versions.electron ? 'node' : 'better');
  if (driver === 'better') { try { const B = require('better-sqlite3'); const db = new B(file); db.driver = 'better-sqlite3'; return db; } catch (e) { driver = 'node'; } }
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(file);
  let depth = 0;
  return {
    driver: 'node:sqlite',
    exec: s => raw.exec(s),
    prepare: s => raw.prepare(s),
    pragma: s => raw.exec('PRAGMA ' + s),
    close: () => raw.close(),
    transaction: fn => (...a) => {
      const sp = 'sp' + depth; raw.exec(depth ? `SAVEPOINT ${sp}` : 'BEGIN'); depth++;
      try { const r = fn(...a); depth--; raw.exec(depth ? `RELEASE ${sp}` : 'COMMIT'); return r; }
      catch (e) { depth--; raw.exec(depth ? `ROLLBACK TO ${sp}` : 'ROLLBACK'); throw e; }
    }
  };
}
module.exports = { open };
