'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/sqlite');
const { openStudioIntelligence } = require('../src');

test('переход сохраняет items, meta и старые строки si_', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-mig-'));
  const dbPath = path.join(dir, 'studio.db');
  const db = openDatabase(dbPath);
  db.exec(`
    CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE si_records (
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
    CREATE TABLE si_assets (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL CHECK (namespace IN ('moonkatty_news', 'moonkatty_project')),
      kind TEXT NOT NULL CHECK (kind IN ('image','video','audio','music','model','texture','animation','logo','subtitle','other')),
      brand_role TEXT,
      title TEXT NOT NULL,
      source_name TEXT,
      source_url TEXT,
      storage_path TEXT,
      content_hash TEXT,
      dedup_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','approved','rejected','superseded')),
      version INTEGER NOT NULL CHECK (version >= 1),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE si_approvals (
      id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      subject_id TEXT NOT NULL,
      required_role TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
      auto_execute INTEGER NOT NULL DEFAULT 0 CHECK (auto_execute = 0),
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      decided_by TEXT,
      decided_at TEXT,
      comment TEXT
    );
    CREATE TABLE si_approval_events (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      at TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('requested','approved','rejected')),
      actor_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      comment TEXT,
      prev_status TEXT NOT NULL,
      next_status TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run('tasks', 't1', JSON.stringify({ id: 't1', title: 'старая задача' }));
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('seeded', '1');
  db.prepare(`INSERT INTO si_records (
      id, namespace, kind, title, body, version, status, created_by, idempotency_key, payload_json, created_at, updated_at
    ) VALUES ('r1', 'moonkatty_news', 'task', 'Старый черновик', '', 1, 'draft', 'igor', 'old/1', '{}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO si_assets (
      id, namespace, kind, title, dedup_key, status, version, created_by, created_at, updated_at
    ) VALUES ('as1', 'moonkatty_project', 'image', 'Старый кадр', 'key:old', 'draft', 1, 'igor', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`).run();
  db.prepare(`INSERT INTO si_approvals (
      id, namespace, subject_type, subject_id, required_role, status, auto_execute, requested_by, requested_at
    ) VALUES ('ap1', 'moonkatty_news', 'publication', 'ep', 'owner', 'pending', 0, 'news', '2026-10-01T00:00:00.000Z')`).run();
  db.close();

  const si = openStudioIntelligence({ dbPath, now: () => '2026-10-20T12:00:00.000Z' });
  assert.equal(si.schemaVersion, 4);
  assert.match(si.db.prepare('SELECT data FROM items WHERE id = ?').get('t1').data, /старая задача/);
  assert.equal(si.db.prepare('SELECT v FROM meta WHERE k = ?').get('seeded').v, '1');
  assert.equal(si.db.prepare('SELECT title FROM si_records WHERE id = ?').get('r1').title, 'Старый черновик');
  assert.equal(si.db.prepare('SELECT title FROM si_assets WHERE id = ?').get('as1').title, 'Старый кадр');
  assert.equal(si.db.prepare('SELECT status FROM si_approvals WHERE id = ?').get('ap1').status, 'pending');
  si.memory.put({
    principal: { id: 'igor', role: 'owner', user: 'igor' },
    record: {
      namespace: 'moonkatty_shared', kind: 'document', title: 'Общий стандарт', body: 'После перехода.',
      status: 'approved', idempotencyKey: 'doc/shared/1', payload: {}
    }
  });
  assert.equal(si.projects.resolveProject('moonkatty_news:episodes').known, true);
  assert.ok(si.tableNames().includes('si_character_versions'));
  assert.ok(si.tableNames().includes('si_projects'));
  si.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
