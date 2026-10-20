'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_GRANTS, SCHEMA_VERSION, PROJECT_SEEDS } = require('./constants');
const { upgradeToV3 } = require('./migrate-v3');

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
      namespace TEXT NOT NULL CHECK (namespace IN ('moonkatty_news', 'moonkatty_project', 'moonkatty_shared')),
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
    CREATE TABLE IF NOT EXISTS si_assets (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL CHECK (namespace IN ('moonkatty_news', 'moonkatty_project', 'moonkatty_shared')),
      kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','music','model','texture','animation','logo','subtitle','other')),
      brand_role TEXT,
      title TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT,
      storage_path TEXT,
      content_hash TEXT,
      dedup_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','approved','rejected','superseded','deleted')),
      version INTEGER NOT NULL CHECK (version >= 1),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS si_assets_dedup ON si_assets(namespace, dedup_key);
    CREATE INDEX IF NOT EXISTS si_assets_hash ON si_assets(namespace, content_hash);
    CREATE TABLE IF NOT EXISTS si_asset_rights (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      basis TEXT NOT NULL CHECK (basis IN ('own','licensed','generated','cc0','unknown')),
      license TEXT,
      license_url TEXT,
      holder TEXT,
      territory TEXT,
      expires_at TEXT,
      attribution_required INTEGER NOT NULL DEFAULT 0,
      attribution_text TEXT,
      recorded_by TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      superseded INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS si_asset_rights_asset ON si_asset_rights(asset_id, superseded, recorded_at);
    CREATE TABLE IF NOT EXISTS si_asset_usage (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      used_at TEXT NOT NULL,
      where_used TEXT NOT NULL,
      publication_id TEXT,
      publication_version INTEGER,
      context TEXT,
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS si_asset_usage_idem ON si_asset_usage(namespace, idempotency_key);
    CREATE INDEX IF NOT EXISTS si_asset_usage_asset ON si_asset_usage(asset_id, used_at);
    CREATE INDEX IF NOT EXISTS si_asset_usage_pub ON si_asset_usage(namespace, publication_id);
    CREATE TABLE IF NOT EXISTS si_approvals (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      required_role TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','recommended','rework','approved','rejected')),
      auto_execute INTEGER NOT NULL DEFAULT 0 CHECK (auto_execute = 0),
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      comment TEXT
    );
    CREATE TABLE IF NOT EXISTS si_approval_events (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      at TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('requested','recommended','rework','resubmitted','approved','rejected')),
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      comment TEXT,
      prev_status TEXT NOT NULL,
      next_status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS si_approval_events_approval ON si_approval_events(approval_id, at);
    CREATE TABLE IF NOT EXISTS si_cost_entries (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      at TEXT NOT NULL,
      component TEXT NOT NULL,
      amount_usd REAL NOT NULL,
      note TEXT,
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT 'expense' CHECK (direction IN ('expense', 'revenue')),
      project_id TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS si_cost_idem ON si_cost_entries(namespace, idempotency_key);
    CREATE TABLE IF NOT EXISTS si_health_samples (
      id TEXT PRIMARY KEY,
      at TEXT NOT NULL,
      component TEXT NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT,
      actor_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS si_qa_findings (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      publication_id TEXT,
      publication_version INTEGER,
      check_name TEXT NOT NULL,
      ok INTEGER NOT NULL,
      detail TEXT,
      at TEXT NOT NULL,
      actor_id TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS si_asset_events (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      at TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      version INTEGER,
      detail_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS si_asset_events_asset ON si_asset_events(asset_id, at, id);
    CREATE TABLE IF NOT EXISTS si_asset_tasks (
      asset_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      namespace TEXT NOT NULL,
      linked_at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      PRIMARY KEY (asset_id, task_id)
    );
    CREATE TABLE IF NOT EXISTS si_asset_files (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      role TEXT NOT NULL,
      path TEXT NOT NULL,
      checksum TEXT,
      recorded_at TEXT NOT NULL,
      actor_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS si_asset_files_asset ON si_asset_files(asset_id, role);
    CREATE TABLE IF NOT EXISTS si_voice_profiles (
      voice_profile_id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL CHECK (namespace = 'moonkatty_news'),
      label TEXT NOT NULL,
      note TEXT,
      sample_asset_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
      defined_by TEXT NOT NULL,
      defined_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS si_source_history (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      source_url TEXT,
      source_name TEXT,
      action TEXT NOT NULL CHECK (action IN ('added', 'updated', 'retired')),
      note TEXT,
      actor_id TEXT NOT NULL,
      at TEXT NOT NULL,
      idempotency_key TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS si_source_history_idem ON si_source_history(namespace, idempotency_key);
    CREATE TABLE IF NOT EXISTS si_editorial_decisions (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('noted', 'recommended', 'approved', 'rejected')),
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
      actor_id TEXT NOT NULL,
      at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS si_editorial_subject ON si_editorial_decisions(namespace, subject_id, at);
    CREATE TABLE IF NOT EXISTS si_content_versions (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      content_type TEXT NOT NULL CHECK (content_type IN ('script', 'video')),
      content_key TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      storage_path TEXT,
      checksum TEXT,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
      supersedes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS si_content_versions_key ON si_content_versions(namespace, content_type, content_key, version);
    CREATE TABLE IF NOT EXISTS si_publication_notices (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('correction', 'retraction')),
      publication_id TEXT NOT NULL,
      publication_version INTEGER,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS si_projects (
      project_id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      slug TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS si_character_versions (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      file TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'superseded')),
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
      voice_profile_id TEXT,
      source_refs_json TEXT NOT NULL DEFAULT '[]',
      approved_by TEXT,
      approved_at TEXT,
      created_by TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS si_character_versions_num ON si_character_versions(character_id, version);
  `);
  const voiceCols = db.prepare('PRAGMA table_info(si_voice_profiles)').all();
  if (voiceCols.length && !voiceCols.some(col => col.name === 'sample_rate')) {
    db.exec('ALTER TABLE si_voice_profiles ADD COLUMN sample_rate INTEGER');
    db.exec('ALTER TABLE si_voice_profiles ADD COLUMN recognizer TEXT');
    db.exec('ALTER TABLE si_voice_profiles ADD COLUMN gain REAL');
    db.exec('ALTER TABLE si_voice_profiles ADD COLUMN mouth_scale REAL');
  }
  const costCols = db.prepare('PRAGMA table_info(si_cost_entries)').all();
  if (costCols.length && !costCols.some(col => col.name === 'direction')) {
    db.exec("ALTER TABLE si_cost_entries ADD COLUMN direction TEXT NOT NULL DEFAULT 'expense'");
    db.exec('ALTER TABLE si_cost_entries ADD COLUMN project_id TEXT');
  }
  transaction(db, () => upgradeToV3(db));
  const insertGrant = db.prepare('INSERT OR IGNORE INTO si_grants (agent_id, namespace, action) VALUES (?, ?, ?)');
  const setMeta = db.prepare('INSERT INTO si_meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  transaction(db, () => {
    for (const row of DEFAULT_GRANTS) insertGrant.run(row[0], row[1], row[2]);
    const insertProject = db.prepare('INSERT OR IGNORE INTO si_projects (project_id, namespace, slug, title) VALUES (?, ?, ?, ?)');
    for (const row of PROJECT_SEEDS) insertProject.run(row[0], row[1], row[2], row[3]);
    setMeta.run('schema_version', String(SCHEMA_VERSION));
  });
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").all().map(row => row.name);
}

module.exports = { openDatabase, transaction, migrate, tableNames, applyPragmas };
