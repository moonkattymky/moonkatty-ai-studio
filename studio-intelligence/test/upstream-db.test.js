'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { openStudioIntelligence } = require('../src');

const ROOT = path.join(__dirname, '..', '..');
const V12 = 'origin/feat/v1.2.0';

function scratchDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function show(spec) {
  return execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8' });
}

function panelSql(spec) {
  const server = show(spec);
  const match = server.match(/db\.exec\(`([\s\S]*?)`\);/);
  if (!match || !match[1].includes('CREATE TABLE IF NOT EXISTS items')) throw new Error('SQL панели не найден: ' + spec);
  return match[1];
}

function writeTree(commit, files) {
  const dir = scratchDir('si-upstream-');
  for (const file of files) {
    const dest = path.join(dir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, show(commit + ':' + file));
  }
  return dir;
}

function snapshot(db) {
  return {
    items: db.prepare('SELECT col, id, data FROM items ORDER BY col, id').all(),
    meta: db.prepare('SELECT k, v FROM meta ORDER BY k').all()
  };
}

test('миграция сохраняет базу, созданную SQL main', () => {
  const { DatabaseSync } = require('node:sqlite');
  const dir = scratchDir('si-main-db-');
  const dbPath = path.join(dir, 'studio.db');
  const raw = new DatabaseSync(dbPath);
  raw.exec(panelSql('origin/main:server.js'));
  raw.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run(
    'tasks', 't-main', JSON.stringify({ id: 't-main', title: 'задача с main', project: 'news' })
  );
  raw.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('seeded', '1');
  raw.close();
  const si = openStudioIntelligence({ dbPath });
  const before = { title: 'задача с main', seeded: '1' };
  const shot = snapshot(si.db);
  assert.equal(JSON.parse(shot.items[0].data).title, before.title);
  assert.equal(shot.meta.find(row => row.k === 'seeded').v, before.seeded);
  assert.equal(si.db.prepare("SELECT name FROM sqlite_master WHERE name = 'si_projects'").get().name, 'si_projects');
  assert.equal(si.projects.resolveProject('moonkatty_news:episodes').known, true);
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1);
  assert.equal(si.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'jobs'").get().n, 0);
  si.close();
});

test('миграция сохраняет базу, созданную lib/db.js и lib/jobs.js ветки feat/v1.2.0', () => {
  const tree = writeTree(V12, ['lib/db.js', 'lib/jobs.js']);
  const { open } = require(path.join(tree, 'lib/db.js'));
  const createJobs = require(path.join(tree, 'lib/jobs.js'));
  const dir = scratchDir('si-v12-db-');
  const dbPath = path.join(dir, 'studio.db');
  const db = open(dbPath);
  db.exec(panelSql(V12 + ':server.js'));
  db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run(
    'tasks', 't-v12', JSON.stringify({ id: 't-v12', title: 'задача 1.2.0', project: 'main' })
  );
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('version', '1.2.0');
  const jobs = createJobs(db);
  const job = jobs.create('task-v12', 'blender', 'detect');
  jobs.event(job.id, 'info', 'detect', 'проверка', 'rule-1');
  const jobCount = db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n;
  const eventCount = db.prepare('SELECT COUNT(*) AS n FROM job_events').get().n;
  const status = db.prepare('SELECT status, task_id FROM jobs WHERE id = ?').get(job.id);
  db.close();
  const si = openStudioIntelligence({ dbPath });
  assert.equal(JSON.parse(si.db.prepare("SELECT data FROM items WHERE id = 't-v12'").get().data).title, 'задача 1.2.0');
  assert.equal(si.db.prepare("SELECT v FROM meta WHERE k = 'version'").get().v, '1.2.0');
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, jobCount);
  assert.equal(si.db.prepare('SELECT COUNT(*) AS n FROM job_events').get().n, eventCount);
  const again = si.db.prepare('SELECT status, task_id, kind FROM jobs WHERE id = ?').get(job.id);
  assert.equal(again.status, status.status);
  assert.equal(again.task_id, 'task-v12');
  assert.equal(again.kind, 'blender');
  assert.equal(si.db.prepare('SELECT msg FROM job_events WHERE job_id = ?').get(job.id).msg, 'проверка');
  assert.ok(si.db.prepare("SELECT 1 AS n FROM sqlite_master WHERE name = 'si_records'").get());
  si.close();
});
