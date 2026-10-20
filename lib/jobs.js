// Job engine for long-running agent work (3D DESIGN pipeline). Real SQLite tables (not the generic KV store):
//   jobs        — one row per task execution: status, stage, attempt counters, checkpoint, artifacts, error, heartbeat
//   job_events  — append-only action log (stage, level, message, policy rule id)
// Recovery: a job that was 'running' when the app stopped is resumed from its last completed stage (checkpoint).
'use strict';
const crypto = require('crypto');
const STATUSES = ['queued', 'running', 'waiting_confirmation', 'waiting_approval', 'done', 'failed', 'cancelled', 'blocked'];
module.exports = function createJobs(db, { redact = s => s } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, stage TEXT,
             attempt INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 2, retries INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3,
             checkpoint TEXT NOT NULL DEFAULT '{}', artifacts TEXT NOT NULL DEFAULT '[]', error TEXT, pending TEXT, heartbeat TEXT, pid INTEGER,
             created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
           CREATE INDEX IF NOT EXISTS jobs_task ON jobs(task_id);
           CREATE TABLE IF NOT EXISTS job_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, at TEXT NOT NULL, level TEXT NOT NULL, stage TEXT, msg TEXT NOT NULL, rule TEXT);
           CREATE INDEX IF NOT EXISTS job_events_job ON job_events(job_id, seq);`);
  // v1.2.0 optional fields shared with feat/studio-operations (added in place; old DBs migrated by ALTER TABLE)
  const cols = db.prepare('PRAGMA table_info(jobs)').all().map(c => c.name);
  for (const [c, d] of [['resource_class', 'TEXT'], ['requires_node', 'TEXT'], ['idempotency_key', 'TEXT'], ['safe_to_retry', 'INTEGER NOT NULL DEFAULT 1'], ['input', "TEXT NOT NULL DEFAULT '{}'"]]) if (!cols.includes(c)) db.exec(`ALTER TABLE jobs ADD COLUMN ${c} ${d}`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS jobs_idem ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL');
  const now = () => new Date().toISOString();
  const row = r => r && { id: r.id, taskId: r.task_id, kind: r.kind, status: r.status, stage: r.stage, attempt: r.attempt, maxAttempts: r.max_attempts, retries: r.retries, maxRetries: r.max_retries,
    checkpoint: JSON.parse(r.checkpoint || '{}'), artifacts: JSON.parse(r.artifacts || '[]'), error: r.error, pending: r.pending ? JSON.parse(r.pending) : null, resourceClass: r.resource_class || null, requiresNode: r.requires_node || null, idempotencyKey: r.idempotency_key || null, safeToRetry: r.safe_to_retry !== 0, input: JSON.parse(r.input || '{}'), heartbeat: r.heartbeat, pid: r.pid, createdAt: r.created_at, updatedAt: r.updated_at };
  const Q = {
    ins: db.prepare('INSERT INTO jobs (id, task_id, kind, status, stage, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM jobs WHERE id = ?'),
    byTask: db.prepare('SELECT * FROM jobs WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1'),
    all: db.prepare('SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?'),
    running: db.prepare("SELECT * FROM jobs WHERE status = 'running'"),
    ev: db.prepare('INSERT INTO job_events (job_id, at, level, stage, msg, rule) VALUES (?, ?, ?, ?, ?, ?)'),
    evs: db.prepare('SELECT * FROM job_events WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?')
  };
  const FIELDS = { status: 'status', stage: 'stage', attempt: 'attempt', retries: 'retries', maxAttempts: 'max_attempts', maxRetries: 'max_retries', checkpoint: 'checkpoint', artifacts: 'artifacts', error: 'error', pending: 'pending', heartbeat: 'heartbeat', pid: 'pid', resourceClass: 'resource_class', requiresNode: 'requires_node', idempotencyKey: 'idempotency_key', safeToRetry: 'safe_to_retry', input: 'input' };
  function update(id, patch) {
    const sets = [], vals = [];
    for (const [k, v] of Object.entries(patch)) { const c = FIELDS[k]; if (!c) throw new Error('bad job field ' + k);
      if (k === 'status' && !STATUSES.includes(v)) throw new Error('bad status ' + v);
      sets.push(c + ' = ?'); vals.push(k === 'safeToRetry' ? (v ? 1 : 0) : ['checkpoint', 'artifacts', 'input'].includes(k) ? JSON.stringify(v) : k === 'pending' ? (v ? JSON.stringify(v) : null) : k === 'error' && v ? redact(String(v)).slice(0, 4000) : v ?? null); }
    sets.push('updated_at = ?'); vals.push(now()); vals.push(id);
    db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals); return get(id);
  }
  const get = id => row(Q.get.get(id));
  return {
    STATUSES,
    create(taskId, kind, stage) { const id = 'job_' + crypto.randomBytes(8).toString('hex'); const t = now(); Q.ins.run(id, taskId, kind, 'queued', stage || null, t, t); return get(id); },
    get, update, byKey: k => row(db.prepare('SELECT * FROM jobs WHERE idempotency_key = ?').get(k)), byTask: tid => row(Q.byTask.get(tid)), list: (n = 50) => Q.all.all(n).map(row),
    event(id, level, stage, msg, rule) { Q.ev.run(id, now(), level, stage || null, redact(String(msg)).slice(0, 2000), rule || null); },
    events: (id, after = 0, limit = 500) => Q.evs.all(id, after, limit).map(e => ({ seq: e.seq, at: e.at, level: e.level, stage: e.stage, msg: e.msg, rule: e.rule })),
    heartbeat: id => db.prepare('UPDATE jobs SET heartbeat = ? WHERE id = ?').run(now(), id),
    // After a restart: running jobs → queued (resume from checkpoint). Orphaned child processes are killed.
    recover() { const out = []; for (const r of Q.running.all()) { const j = row(r);
        if (j.pid) { try { process.kill(j.pid, 'SIGKILL'); } catch {} }
        update(j.id, { status: 'queued', pid: null }); this.event(j.id, 'warn', j.stage, 'Приложение перезапущено — задание будет продолжено с этапа «' + (j.stage || 'начало') + '»'); out.push(j.id); }
      return out; }
  };
};
