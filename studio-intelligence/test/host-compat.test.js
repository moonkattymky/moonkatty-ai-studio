'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/sqlite');
const { attach, panelProject, describeRoutes } = require('../src/host-adapter');
const { backupDatabase, rollbackDatabase } = require('../src/db-backup');

test('подключение не меняет items и meta и пишет в существующий журнал', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-host-'));
  const dbPath = path.join(dir, 'studio.db');
  const db = openDatabase(dbPath);
  db.exec(`CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id));
           CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);`);
  db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run('tasks', 't1', JSON.stringify({ id: 't1', title: 'старая задача', project: 'news' }));
  db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run('logs', 'l1', JSON.stringify({ id: 'l1', at: '2026-10-20T12:00:00.000Z', level: 'info', source: 'system', message: 'старая строка', user: null }));
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('seeded', '1');
  const lines = [];
  function log(level, source, message, user) {
    lines.push({ level, source, message, user });
    if (lines.length > 2000) lines.splice(0, lines.length - 2000);
  }
  const si = attach(db, { log, now: () => '2026-10-20T12:00:00.000Z' });
  si.approval.request({
    principal: { id: 'news', role: 'agent', agentId: 'news', user: 'igor' },
    request: {
      id: 'ap-host', namespace: 'moonkatty_news', subjectType: 'publication', subjectId: 'ep1',
      requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'news',
      requestedAt: '2026-10-20T12:00:00.000Z'
    }
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].source, 'approval');
  assert.equal(lines[0].level, 'info');
  assert.match(db.prepare('SELECT data FROM items WHERE col = ? AND id = ?').get('tasks', 't1').data, /старая задача/);
  assert.equal(db.prepare('SELECT v FROM meta WHERE k = ?').get('seeded').v, '1');
  assert.match(db.prepare("SELECT data FROM items WHERE col = 'logs' AND id = 'l1'").get().data, /старая строка/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'logs'").get().n, 0);
  assert.ok(si.tableNames().includes('si_records'));
  assert.equal(panelProject('moonkatty_news'), 'news');
  assert.equal(panelProject('moonkatty_project'), 'main');
  assert.equal(panelProject('moonkatty_shared'), null);
  assert.equal(describeRoutes()[0].path, '/api/ops/ledger');
  assert.equal(fs.existsSync(path.join(__dirname, '..', '..', 'server.js')), true);
  si.close();
  db.close();

  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(backupDir, 'backup-old.json'), '{"data":{}}');
  const dry = backupDatabase({ dbPath, backupDir, apply: false, now: () => '2026-10-20T12:00:00.000Z' });
  assert.equal(dry.copied, false);
  assert.equal(fs.existsSync(dry.dest), false);
  const saved = backupDatabase({ dbPath, backupDir, apply: true, now: () => '2026-10-20T12:00:00.000Z' });
  assert.equal(saved.copied, true);
  assert.equal(fs.readFileSync(path.join(backupDir, 'backup-old.json'), 'utf8'), '{"data":{}}');
  const spoiled = openDatabase(dbPath);
  spoiled.prepare('UPDATE items SET data = ? WHERE id = ?').run(JSON.stringify({ id: 't1', title: 'испорчено' }), 't1');
  spoiled.close();
  const preview = rollbackDatabase({ dbPath, from: saved.dest, apply: false });
  assert.equal(preview.restored, false);
  const still = openDatabase(dbPath);
  assert.match(still.prepare('SELECT data FROM items WHERE id = ?').get('t1').data, /испорчено/);
  still.close();
  rollbackDatabase({ dbPath, from: saved.dest, apply: true });
  const check = openDatabase(dbPath);
  assert.match(check.prepare('SELECT data FROM items WHERE id = ?').get('t1').data, /старая задача/);
  check.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
