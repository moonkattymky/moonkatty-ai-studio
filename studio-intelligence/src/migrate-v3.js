'use strict';

/**
 * Переход со схемы 2 на 3: три пространства, мягкое удаление актива,
 * статусы рекомендации и доработки. Строки копируются. items и meta не трогаются.
 * Откат — подменой файла базы из резервной копии, не обратным SQL.
 */

function tableSql(db, name) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return (row && row.sql) || '';
}

function rebuildTable(db, name, createSql, needsRebuild) {
  const sql = tableSql(db, name);
  if (!sql || !needsRebuild(sql)) return false;
  const old = name + '_v2';
  db.exec(`ALTER TABLE ${name} RENAME TO ${old}`);
  db.exec(createSql);
  db.exec(`INSERT INTO ${name} SELECT * FROM ${old}`);
  db.exec(`DROP TABLE ${old}`);
  return true;
}

const RECORDS_SQL = `
  CREATE TABLE si_records (
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
  )`;

const ASSETS_SQL = `
  CREATE TABLE si_assets (
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
  )`;

const APPROVALS_SQL = `
  CREATE TABLE si_approvals (
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
  )`;

const APPROVAL_EVENTS_SQL = `
  CREATE TABLE si_approval_events (
    id TEXT PRIMARY KEY,
    approval_id TEXT NOT NULL,
    at TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('requested','recommended','rework','resubmitted','approved','rejected')),
    actor_id TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    comment TEXT,
    prev_status TEXT NOT NULL,
    next_status TEXT NOT NULL
  )`;

function recreateRecordsFts(db) {
  db.exec(`
    DROP TRIGGER IF EXISTS si_records_ai;
    DROP TRIGGER IF EXISTS si_records_ad;
    DROP TRIGGER IF EXISTS si_records_au;
    DROP TABLE IF EXISTS si_records_fts;
  `);
}

function createRecordsFts(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS si_records_ns ON si_records(namespace, status, kind);
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
    INSERT INTO si_records_fts(si_records_fts) VALUES('rebuild');
  `);
}

function upgradeToV3(db) {
  const recordsSql = tableSql(db, 'si_records');
  if (recordsSql && !recordsSql.includes('moonkatty_shared')) {
    recreateRecordsFts(db);
    rebuildTable(db, 'si_records', RECORDS_SQL, () => true);
    createRecordsFts(db);
  }
  if (rebuildTable(db, 'si_assets', ASSETS_SQL, sql => !sql.includes('moonkatty_shared') || !sql.includes("'deleted'"))) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS si_assets_dedup ON si_assets(namespace, dedup_key);
      CREATE INDEX IF NOT EXISTS si_assets_hash ON si_assets(namespace, content_hash);
    `);
  }
  rebuildTable(db, 'si_approvals', APPROVALS_SQL, sql => !sql.includes("'recommended'"));
  if (rebuildTable(db, 'si_approval_events', APPROVAL_EVENTS_SQL, sql => !sql.includes("'recommended'"))) {
    db.exec('CREATE INDEX IF NOT EXISTS si_approval_events_approval ON si_approval_events(approval_id, at)');
  }
}

module.exports = { upgradeToV3 };
