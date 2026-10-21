'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStudioIntelligence } = require('../src');

test('таблицы si_ добавляются в уже существующий файл studio.db и не трогают items', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-db-'));
  const dbPath = path.join(dir, 'studio.db');
  const { openDatabase } = require('../src/sqlite');
  const db = openDatabase(dbPath);
  db.exec('CREATE TABLE items (col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (col, id)); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT);');
  db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run('tasks', 't1', JSON.stringify({ id: 't1', title: 'старая задача' }));
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('seeded', '1');
  db.close();

  const si = openStudioIntelligence({ dbPath, now: () => '2026-10-20T12:00:00.000Z' });
  si.memory.put({
    principal: { id: 'igor', role: 'owner', user: 'igor' },
    record: {
      namespace: 'moonkatty_news', kind: 'decision', title: 'Решение выпуска', body: 'Факты сверены.',
      status: 'approved', idempotencyKey: 'decision/news/1', payload: {}
    }
  });
  const names = si.tableNames();
  assert.ok(names.includes('items'));
  assert.ok(names.includes('meta'));
  assert.ok(names.includes('si_records'));
  assert.ok(names.every(name => name === 'items' || name === 'meta' || name.startsWith('si_')));
  const task = si.db.prepare('SELECT data FROM items WHERE id = ?').get('t1');
  assert.match(task.data, /старая задача/);
  assert.equal(si.db.prepare('SELECT v FROM meta WHERE k = ?').get('seeded').v, '1');
  assert.equal(si.db.prepare("SELECT COUNT(*) AS n FROM items").get().n, 1);
  si.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
