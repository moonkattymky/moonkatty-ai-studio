// Thin adapter over Studio 5 memory (studio-intelligence/src/index.js, PR #1, unmerged).
// When that module is not on disk, a local world_mem table speaks the same put/get/list shape.
// Mission and goal are stored as SI kind "document" with payload.recordKind, because the
// 3a903ab schema enum has no mission/goal kinds. Callers still ask for kind mission or goal.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveProject(projectId) {
  const seeds = {
    'moonkatty_project:games': ['moonkatty_project', 'games'],
    'moonkatty_project:mkty': ['moonkatty_project', 'mkty'],
    'moonkatty_project:youtube': ['moonkatty_project', 'youtube'],
    'moonkatty_project:ads': ['moonkatty_project', 'ads'],
    'moonkatty_news:episodes': ['moonkatty_news', 'episodes'],
    'moonkatty_shared': ['moonkatty_shared', '']
  };
  const raw = projectId == null || projectId === '' ? null : String(projectId).slice(0, 140);
  if (!raw || !seeds[raw]) return { projectId: 'unassigned', rawProjectId: raw, known: raw === 'unassigned', namespace: null, slug: null, dropped: false };
  const pair = seeds[raw];
  return { projectId: raw, rawProjectId: raw, known: true, namespace: pair[0], slug: pair[1] || null, dropped: false };
}
function hashOf(record) {
  return crypto.createHash('sha256').update(JSON.stringify({
    namespace: record.namespace, kind: record.kind, title: record.title, body: record.body, status: record.status, payload: record.payload || {}
  })).digest('hex');
}
function logical(rec) {
  if (rec && rec.payload && (rec.payload.recordKind === 'mission' || rec.payload.recordKind === 'goal')) return Object.assign({}, rec, { kind: rec.payload.recordKind });
  return rec;
}
function toStored(record) {
  if (record.kind !== 'mission' && record.kind !== 'goal') return record;
  return Object.assign({}, record, { kind: 'document', payload: Object.assign({}, record.payload, { recordKind: record.kind }) });
}
function fallback(db, log, now) {
  const getRow = db.prepare('SELECT * FROM world_mem WHERE id = ?');
  const current = db.prepare('SELECT * FROM world_mem WHERE namespace = ? AND idempotency_key = ? AND superseded = 0');
  const insert = db.prepare(`INSERT INTO world_mem (
      id, namespace, kind, title, body, version, status, source_path, source_record_id, idempotency_key, payload_json, request_hash, superseded, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`);
  const supersede = db.prepare('UPDATE world_mem SET superseded = 1, updated_at = ? WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM world_mem WHERE namespace = ? AND superseded = 0 ORDER BY created_at LIMIT ?');
  function map(row) {
    if (!row) return null;
    return { id: row.id, namespace: row.namespace, kind: row.kind, title: row.title, body: row.body, version: row.version, status: row.status, sourcePath: row.source_path, sourceRecordId: row.source_record_id, idempotencyKey: row.idempotency_key, payload: JSON.parse(row.payload_json || '{}'), createdAt: row.created_at, updatedAt: row.updated_at };
  }
  const memory = {
    put({ record, versionPolicy = 'replay' }) {
      const input = toStored(record);
      const hash = hashOf(input);
      const prev = current.get(input.namespace, input.idempotencyKey);
      if (prev && prev.request_hash === hash) return map(prev);
      if (prev && versionPolicy !== 'bump') { const e = new Error('Ключ идемпотентности уже использован'); e.code = 'IDEMPOTENCY_CONFLICT'; throw e; }
      const id = crypto.randomBytes(12).toString('hex');
      const at = now();
      const version = prev ? prev.version + 1 : 1;
      if (prev) supersede.run(at, prev.id);
      insert.run(id, input.namespace, input.kind, input.title, input.body || '', version, input.status || 'draft', input.sourcePath || null, input.sourceRecordId || null, input.idempotencyKey, JSON.stringify(input.payload || {}), hash, at, at);
      return map(getRow.get(id));
    },
    get({ id }) { const row = getRow.get(id); if (!row) { const e = new Error('Запись не найдена'); e.code = 'NOT_FOUND'; throw e; } return map(row); },
    list({ namespace, kind = null, limit = 50 }) {
      return listStmt.all(namespace, Math.min(200, limit)).map(map).filter(rec => !kind || rec.kind === kind || (rec.payload && rec.payload.recordKind === kind));
    }
  };
  const audit = { feed(entry) { const line = { level: entry.level || 'info', source: entry.source || 'world', message: String(entry.message || '').slice(0, 2000), user: entry.user || null }; if (typeof log === 'function') log(line.level, line.source, line.message, line.user); return line; } };
  return { memory, audit };
}
function openMemory({ db, log, now }) {
  const root = process.env.STUDIO_INTELLIGENCE_ROOT || path.join(__dirname, '..', '..', 'studio-intelligence');
  const entry = path.join(root, 'src', 'index.js');
  if (fs.existsSync(entry)) {
    const mod = require(entry);
    const si = mod.openStudioIntelligence({ db, auditLog: log, now });
    return { path: 'studio-intelligence', memory: si.memory, audit: si.audit, approval: si.approval, resolveProject: mod.resolveProject || resolveProject };
  }
  const local = fallback(db, log, now);
  return { path: 'fallback', memory: local.memory, audit: local.audit, approval: null, resolveProject };
}
function putRecord(mem, opts) {
  const saved = mem.memory.put({ principal: opts.principal, record: toStored(opts.record), versionPolicy: opts.versionPolicy || 'replay' });
  return logical(saved);
}
function listRecords(mem, opts) {
  const kind = opts.kind;
  const queryKind = kind === 'mission' || kind === 'goal' ? 'document' : kind;
  const rows = mem.memory.list(Object.assign({}, opts, { kind: queryKind }));
  return rows.map(logical).filter(rec => !kind || rec.kind === kind);
}
module.exports = { openMemory, putRecord, listRecords, resolveProject };
