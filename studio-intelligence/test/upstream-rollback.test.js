'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { openStudioIntelligence } = require('../src');
const { openDatabase } = require('../src/sqlite');
const { backupDatabase, rollbackDatabase } = require('../src/db-backup');

const ROOT = path.join(__dirname, '..', '..');
const V12 = 'a3fd83a7606330b6b5cd58ccd9f3574ffe467294';

function show(spec) {
  return execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8' });
}

function panelSql(spec) {
  const server = show(spec);
  const match = server.match(/db\.exec\(`([\s\S]*?)`\);/);
  if (!match || !match[1].includes('CREATE TABLE IF NOT EXISTS items')) throw new Error('SQL панели не найден: ' + spec);
  return match[1];
}

function fresh(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir);
  fs.writeFileSync(path.join(backupDir, 'backup-old.json'), '{"data":{}}');
  return { dir, backupDir, dbPath: path.join(dir, 'studio.db') };
}

function titles(dbPath) {
  const db = openDatabase(dbPath);
  const row = db.prepare("SELECT data FROM items WHERE col = 'tasks'").get();
  const meta = db.prepare('SELECT k, v FROM meta ORDER BY k').all();
  const jobs = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get();
  const si = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'si_projects'").get();
  const job = jobs ? db.prepare('SELECT id, status, task_id FROM jobs').get() : null;
  const event = jobs ? db.prepare('SELECT msg FROM job_events').get() : null;
  db.close();
  return { title: JSON.parse(row.data).title, meta, job, event: event && event.msg, si: !!si };
}

test('откат файла возвращает базу main до миграции и не трогает JSON-копию', () => {
  const { dir, backupDir, dbPath } = fresh('si-roll-main-');
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(dbPath);
  raw.exec(panelSql('origin/main:server.js'));
  raw.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run(
    'tasks', 't-main', JSON.stringify({ id: 't-main', title: 'задача с main', project: 'news' })
  );
  raw.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('seeded', '1');
  raw.close();

  const saved = backupDatabase({ dbPath, backupDir, apply: true, now: () => '2026-10-20T11:00:00.000Z' });
  const si = openStudioIntelligence({ dbPath });
  assert.equal(JSON.parse(si.db.prepare("SELECT data FROM items WHERE id = 't-main'").get().data).title, 'задача с main');
  assert.equal(si.db.prepare("SELECT v FROM meta WHERE k = 'seeded'").get().v, '1');
  assert.ok(si.tableNames().includes('si_projects'));
  si.close();

  const spoiled = openDatabase(dbPath);
  spoiled.prepare('UPDATE items SET data = ? WHERE id = ?').run(JSON.stringify({ id: 't-main', title: 'испорчено' }), 't-main');
  spoiled.close();
  const preview = rollbackDatabase({ dbPath, from: saved.dest, apply: false });
  assert.equal(preview.restored, false);
  assert.equal(titles(dbPath).title, 'испорчено');
  rollbackDatabase({ dbPath, from: saved.dest, apply: true });
  const back = titles(dbPath);
  assert.equal(back.title, 'задача с main');
  assert.equal(back.meta.length, 1);
  assert.equal(back.meta[0].k, 'seeded');
  assert.equal(back.meta[0].v, '1');
  assert.equal(back.si, false);
  assert.equal(fs.readFileSync(path.join(backupDir, 'backup-old.json'), 'utf8'), '{"data":{}}');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('откат файла возвращает базу a3fd83a вместе с jobs и video_render', () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'si-v12-src-'));
  for (const file of ['lib/db.js', 'lib/jobs.js']) {
    const dest = path.join(tree, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, show(V12 + ':' + file));
  }
  const { open } = require(path.join(tree, 'lib/db.js'));
  const createJobs = require(path.join(tree, 'lib/jobs.js'));
  const { dir, backupDir, dbPath } = fresh('si-roll-v12-');
  const db = open(dbPath);
  db.exec(panelSql(V12 + ':server.js'));
  db.prepare('INSERT INTO items (col, id, data) VALUES (?, ?, ?)').run(
    'tasks', 't-v12', JSON.stringify({ id: 't-v12', title: 'задача 1.2.1', project: 'main' })
  );
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('version', '1.2.1');
  const jobs = createJobs(db);
  const job = jobs.create('task-v12', 'blender', 'detect');
  jobs.event(job.id, 'info', 'detect', 'проверка', null);
  const render = jobs.create('task-video', 'video_render', 'video_render');
  jobs.update(render.id, {
    input: { runId: 'run1', preset: 'shorts', episodeRef: 's01/e03' },
    idempotencyKey: 'run1:shorts',
    resourceClass: 'gpu_heavy',
    requiresNode: 'mac-mini',
    safeToRetry: true
  });
  jobs.event(render.id, 'info', 'video_render', 'строка рендера', null);
  db.close();

  const saved = backupDatabase({ dbPath, backupDir, apply: true, now: () => '2026-10-20T11:00:00.000Z' });
  const si = openStudioIntelligence({ dbPath });
  assert.equal(JSON.parse(si.db.prepare("SELECT data FROM items WHERE id = 't-v12'").get().data).title, 'задача 1.2.1');
  assert.equal(si.db.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id).status, 'queued');
  assert.equal(si.db.prepare('SELECT kind, idempotency_key FROM jobs WHERE id = ?').get(render.id).kind, 'video_render');
  assert.equal(si.db.prepare('SELECT msg FROM job_events WHERE job_id = ?').get(job.id).msg, 'проверка');
  si.close();

  const spoiled = openDatabase(dbPath);
  spoiled.prepare('UPDATE items SET data = ? WHERE id = ?').run(JSON.stringify({ id: 't-v12', title: 'испорчено' }), 't-v12');
  spoiled.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?").run(job.id);
  spoiled.prepare("UPDATE jobs SET input = '{}', idempotency_key = NULL WHERE id = ?").run(render.id);
  spoiled.prepare('DELETE FROM job_events').run();
  spoiled.close();
  assert.equal(rollbackDatabase({ dbPath, from: saved.dest, apply: false }).restored, false);
  assert.equal(titles(dbPath).title, 'испорчено');
  const check = openDatabase(dbPath);
  assert.equal(check.prepare('SELECT status FROM jobs WHERE id = ?').get(job.id).status, 'failed');
  check.close();
  rollbackDatabase({ dbPath, from: saved.dest, apply: true });
  const back = openDatabase(dbPath);
  assert.equal(JSON.parse(back.prepare("SELECT data FROM items WHERE id = 't-v12'").get().data).title, 'задача 1.2.1');
  const blender = back.prepare('SELECT id, status, task_id FROM jobs WHERE id = ?').get(job.id);
  assert.equal(blender.status, 'queued');
  assert.equal(blender.task_id, 'task-v12');
  const video = back.prepare('SELECT kind, status, idempotency_key, input FROM jobs WHERE id = ?').get(render.id);
  assert.equal(video.kind, 'video_render');
  assert.equal(video.status, 'queued');
  assert.equal(video.idempotency_key, 'run1:shorts');
  assert.equal(JSON.parse(video.input).preset, 'shorts');
  assert.equal(back.prepare('SELECT msg FROM job_events WHERE job_id = ?').get(job.id).msg, 'проверка');
  assert.equal(back.prepare('SELECT msg FROM job_events WHERE job_id = ?').get(render.id).msg, 'строка рендера');
  assert.equal(back.prepare("SELECT v FROM meta WHERE k = 'version'").get().v, '1.2.1');
  assert.equal(back.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'si_projects'").get().n, 0);
  back.close();
  assert.equal(fs.readFileSync(path.join(backupDir, 'backup-old.json'), 'utf8'), '{"data":{}}');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(tree, { recursive: true, force: true });
});
