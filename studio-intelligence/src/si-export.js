'use strict';

/** Тот же список, что public/core.js COLLECTIONS. server.js отсюда не подключается. */
const PANEL_COLLECTIONS = Object.freeze([
  'workspaces', 'queue', 'utm', 'comments', 'agents', 'chat', 'campaigns', 'files',
  'tasks', 'projects', 'episodes', 'channels', 'posts', 'logs', 'reports', 'integrations'
]);

function siTableNames(db) {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name LIKE 'si_%' AND sql IS NOT NULL AND sql NOT LIKE 'CREATE VIRTUAL%'
    ORDER BY name
  `).all().map(row => row.name).filter(name => /^si_[a-z0-9_]+$/.test(name));
}

function plainRow(row) {
  const out = {};
  for (const key of Object.keys(row)) {
    if (!/^[a-z0-9_]+$/.test(key)) continue;
    out[key] = row[key];
  }
  return out;
}

/** JSON таблиц si_*. Панельный dump() коллекций items сюда не входит и server.js не меняется. */
function exportSi(db) {
  const tables = {};
  for (const name of siTableNames(db)) {
    tables[name] = db.prepare(`SELECT * FROM "${name}"`).all().map(plainRow);
  }
  return { kind: 'moonkatty-si-export', version: 1, tables };
}

/** Кладёт строки si_* в уже мигрированную базу. items и meta не трогает. */
function importSi(db, payload) {
  if (!payload || payload.kind !== 'moonkatty-si-export' || payload.version !== 1 || !payload.tables || typeof payload.tables !== 'object') {
    throw new Error('Неверный si-export');
  }
  const known = new Set(siTableNames(db));
  const names = Object.keys(payload.tables);
  for (const name of names) {
    if (!known.has(name)) throw new Error('Неизвестная таблица ' + name);
    if (!Array.isArray(payload.tables[name])) throw new Error('Строки ' + name);
  }
  db.exec('BEGIN');
  try {
    for (const name of names) {
      db.exec(`DELETE FROM "${name}"`);
      for (const raw of payload.tables[name]) {
        const row = plainRow(raw);
        const keys = Object.keys(row);
        if (!keys.length) continue;
        const cols = keys.map(key => `"${key}"`).join(', ');
        const marks = keys.map(() => '?').join(', ');
        db.prepare(`INSERT INTO "${name}" (${cols}) VALUES (${marks})`).run(...keys.map(key => row[key]));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* уже откатили */ }
    throw err;
  }
  return { imported: names };
}

/**
 * Повтор логики dump() из server.js: только core.COLLECTIONS из items.
 * Таблицы si_* в этот объект не попадают.
 */
function panelCollectionDump(db) {
  const data = {};
  for (const col of PANEL_COLLECTIONS) data[col] = [];
  const present = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'").get();
  if (!present) return { app: 'moonkatty-ai-studio', version: 1, data };
  for (const row of db.prepare('SELECT col, data FROM items').all()) {
    if (!Object.prototype.hasOwnProperty.call(data, row.col)) continue;
    data[row.col].push(JSON.parse(row.data));
  }
  return { app: 'moonkatty-ai-studio', version: 1, data };
}

/** Повтор POST /api/restore: переписывает только коллекции items. si_* не читает. */
function panelCollectionRestore(db, dump) {
  const data = dump && dump.data;
  if (!data || typeof data !== 'object') throw new Error('Неверный файл резервной копии');
  db.exec('CREATE TABLE IF NOT EXISTS items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id))');
  const del = db.prepare('DELETE FROM items WHERE col = ?');
  const put = db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const col of PANEL_COLLECTIONS) {
      if (!Array.isArray(data[col])) continue;
      del.run(col);
      for (const item of data[col]) {
        if (item && item.id) put.run(col, item.id, JSON.stringify(item));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* уже откатили */ }
    throw err;
  }
  return { restored: PANEL_COLLECTIONS.filter(col => Array.isArray(data[col])) };
}

module.exports = {
  PANEL_COLLECTIONS, exportSi, importSi, panelCollectionDump, panelCollectionRestore, siTableNames
};
