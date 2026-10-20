'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_GRANTS, SCHEMA_VERSION } = require('./constants');

function applyPragmas(db) {
  const statements = ['PRAGMA journal_mode = WAL', 'PRAGMA busy_timeout = 5000', 'PRAGMA foreign_keys = ON'];
  for (const sql of statements) {
    if (typeof db.pragma === 'function' && sql.startsWith('PRAGMA ')) {
      try { db.pragma(sql.slice('PRAGMA '.length)); continue; } catch { /* node:sqlite без pragma() */ }
    }
    db.exec(sql);
  }
}

/**
 * Тот же файл SQLite, что и у панели (data/studio.db).
 * Если в дереве уже есть адаптер dev #1 (lib/db.js), открываем через него.
 * Иначе — better-sqlite3 с main, иначе встроенный node:sqlite (десктоп Node 22+).
 * Свой файл базы по умолчанию не выбирается.
 */
function openDatabase(file) {
  const adapterPath = path.join(__dirname, '..', '..', 'lib', 'db.js');
  if (fs.existsSync(adapterPath)) {
    const db = require(adapterPath).open(file);
    applyPragmas(db);
    return db;
  }
  try {
    const Database = require('better-sqlite3');
    const db = new Database(file);
    db.driver = db.driver || 'better-sqlite3';
    applyPragmas(db);
    return db;
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file);
  db.driver = 'node:sqlite';
  applyPragmas(db);
  return db;
}

const txDepth = new WeakMap();

function transaction(db, fn) {
  if (typeof db.transaction === 'function') return db.transaction(fn)();
  const level = txDepth.get(db) || 0;
  const save = 'si_sp_' + level;
  db.exec(level ? `SAVEPOINT ${save}` : 'BEGIN IMMEDIATE');
  txDepth.set(db, level + 1);
  try {
    const result = fn();
    const next = level;
    txDepth.set(db, next);
    db.exec(next ? `RELEASE ${save}` : 'COMMIT');
    return result;
  } catch (err) {
    txDepth.set(db, level);
    try { db.exec(level ? `ROLLBACK TO ${save}` : 'ROLLBACK'); } catch { /* уже откатили */ }
    if (level) { try { db.exec(`RELEASE ${save}`); } catch { /* savepoint снят */ } }
    throw err;
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS si_meta (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS si_records (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL CHECK (namespace IN ('moonkatty_news', 'moonkatty_project')),
      kind TEXT NOT NULL CHECK (kind IN ('decision','task','result','file','model_version','publication_version','document')),
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL CHECK (version >= 1),
      status TEXT NOT NULL CHECK (status IN ('draft','approved','superseded','rejected')),
      source_path TEXT,
      source_record_id TEXT,
      created_by TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      idempotency_key TEXT NOT NULL,
      supersedes TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS si_records_ns ON si_records(namespace, status, kind);
    CREATE TABLE IF NOT EXISTS si_idempotency (
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      record_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (namespace, key)
    );
    CREATE TABLE IF NOT EXISTS si_grants (
      agent_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('read', 'write')),
      PRIMARY KEY (agent_id, namespace, action)
    );
    CREATE TABLE IF NOT EXISTS si_progress (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      pct INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS si_progress_task ON si_progress(namespace, task_id, at);
    CREATE VIRTUAL TABLE IF NOT EXISTS si_records_fts USING fts5(
      title, body, source_path,
      content='si_records',
      content_rowid='rowid',
      tokenize="unicode61 remove_diacritics 0"
    );
    CREATE TRIGGER IF NOT EXISTS si_records_ai AFTER INSERT ON si_records BEGIN
      INSERT INTO si_records_fts(rowid, title, body, source_path)
      VALUES (new.rowid, new.title, new.body, coalesce(new.source_path, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS si_records_ad AFTER DELETE ON si_records BEGIN
      INSERT INTO si_records_fts(si_records_fts, rowid, title, body, source_path)
      VALUES ('delete', old.rowid, old.title, old.body, coalesce(old.source_path, ''));
    END;
    CREATE TRIGGER IF NOT EXISTS si_records_au AFTER UPDATE ON si_records BEGIN
      INSERT INTO si_records_fts(si_records_fts, rowid, title, body, source_path)
      VALUES ('delete', old.rowid, old.title, old.body, coalesce(old.source_path, ''));
      INSERT INTO si_records_fts(rowid, title, body, source_path)
      VALUES (new.rowid, new.title, new.body, coalesce(new.source_path, ''));
    END;
  `);
  const insertGrant = db.prepare('INSERT OR IGNORE INTO si_grants (agent_id, namespace, action) VALUES (?, ?, ?)');
  const setMeta = db.prepare('INSERT INTO si_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  transaction(db, () => {
    for (const row of DEFAULT_GRANTS) insertGrant.run(row[0], row[1], row[2]);
    setMeta.run('schema_version', String(SCHEMA_VERSION));
  });
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").all().map(row => row.name);
}

module.exports = { openDatabase, transaction, migrate, tableNames, applyPragmas };
