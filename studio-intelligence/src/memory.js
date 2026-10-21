'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректная запись', { retryable: false, details: { errors } });
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    namespace: row.namespace,
    kind: row.kind,
    title: row.title,
    body: row.body,
    version: row.version,
    status: row.status,
    sourcePath: row.source_path,
    sourceRecordId: row.source_record_id,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    idempotencyKey: row.idempotency_key,
    supersedes: row.supersedes,
    payload: JSON.parse(row.payload_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
    return out;
  }
  return value;
}

function requestHash(input) {
  const canon = JSON.stringify(stable({
    namespace: input.namespace,
    kind: input.kind,
    title: input.title,
    body: input.body,
    status: input.status,
    sourcePath: input.sourcePath,
    sourceRecordId: input.sourceRecordId,
    payload: input.payload
  }));
  return crypto.createHash('sha256').update(canon).digest('hex');
}

function createMemory(db, { now, transaction, permissions }) {
  const getRow = db.prepare('SELECT rowid, * FROM si_records WHERE id = ?');
  const insert = db.prepare(`INSERT INTO si_records (
      id, namespace, kind, title, body, version, status, source_path, source_record_id,
      created_by, approved_by, approved_at, idempotency_key, supersedes, payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const findIdem = db.prepare('SELECT record_id, request_hash, created_at FROM si_idempotency WHERE namespace = ? AND key = ?');
  const upsertIdem = db.prepare(`INSERT INTO si_idempotency (namespace, key, record_id, request_hash, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(namespace, key) DO UPDATE SET record_id = excluded.record_id, request_hash = excluded.request_hash`);
  const markSuperseded = db.prepare(`UPDATE si_records SET status = 'superseded', updated_at = ? WHERE id = ?`);
  const listStmt = db.prepare(`SELECT * FROM si_records
    WHERE namespace = ? AND (? IS NULL OR kind = ?) AND (? IS NULL OR status = ?)
    ORDER BY created_at, id LIMIT ?`);

  function publish(row) {
    const rec = mapRow(row);
    const errors = validate('memory-record', rec);
    if (errors.length) validation(errors);
    return rec;
  }

  function canSee(principal, rec, { history = false, direct = false } = {}) {
    if (!permissions.canReadNamespace(principal, rec.namespace)) return false;
    if (rec.status === 'approved') return true;
    if (principal.role === 'owner') return history || direct;
    return direct && rec.status === 'draft' && rec.createdBy === principal.agentId;
  }

  function put({ principal, record, versionPolicy = 'replay' }) {
    if (versionPolicy !== 'replay' && versionPolicy !== 'bump') {
      throw new StudioError('VALIDATION', 'versionPolicy должен быть replay или bump', { retryable: false });
    }
    const input = {
      namespace: record && record.namespace,
      kind: record && record.kind,
      title: record && record.title,
      body: record && record.body != null ? record.body : '',
      status: record && record.status ? record.status : 'draft',
      sourcePath: record && record.sourcePath != null ? record.sourcePath : null,
      sourceRecordId: record && record.sourceRecordId != null ? record.sourceRecordId : null,
      idempotencyKey: record && record.idempotencyKey,
      payload: record && record.payload ? record.payload : {}
    };
    if (record && record.id) input.id = record.id;
    const errors = validate('memory-record-input', input);
    if (errors.length) validation(errors);
    if (containsSecret(input)) {
      throw new StudioError('SECRET_REJECTED', 'В память нельзя записывать секреты, токены и пароли', { retryable: false });
    }
    permissions.assertWriteRecord(principal, input);
    const actor = principal.role === 'agent' ? principal.agentId : principal.id;
    const hash = requestHash(input);
    return transaction(() => {
      const prev = findIdem.get(input.namespace, input.idempotencyKey);
      if (prev && prev.request_hash === hash) return publish(getRow.get(prev.record_id));
      if (prev && versionPolicy !== 'bump') {
        throw new StudioError('IDEMPOTENCY_CONFLICT', 'Ключ идемпотентности уже использован с другим содержимым', { retryable: false });
      }
      let version = 1;
      let supersedes = null;
      if (prev) {
        const old = getRow.get(prev.record_id);
        version = old.version + 1;
        supersedes = old.id;
        markSuperseded.run(now(), old.id);
      }
      let id = input.id;
      if (!id || (prev && id === prev.record_id)) id = crypto.randomBytes(12).toString('hex');
      if (getRow.get(id)) {
        throw new StudioError('IDEMPOTENCY_CONFLICT', 'Идентификатор записи уже занят', { retryable: false });
      }
      const at = now();
      const approved = input.status === 'approved';
      insert.run(
        id, input.namespace, input.kind, input.title, input.body, version, input.status,
        input.sourcePath, input.sourceRecordId, actor,
        approved ? actor : null, approved ? at : null,
        input.idempotencyKey, supersedes, JSON.stringify(input.payload), at, at
      );
      upsertIdem.run(input.namespace, input.idempotencyKey, id, hash, prev ? prev.created_at : at);
      return publish(getRow.get(id));
    });
  }

  function get({ principal, id }) {
    const actor = permissions.normalize(principal);
    const row = getRow.get(id);
    if (!row) throw new StudioError('NOT_FOUND', 'Запись не найдена', { retryable: false });
    const rec = mapRow(row);
    if (!canSee(actor, rec, { direct: true })) {
      throw new StudioError('NOT_FOUND', 'Запись не найдена', { retryable: false });
    }
    return rec;
  }

  function list({ principal, namespace, kind = null, status = null, history = false, limit = 50 }) {
    permissions.assertPermission(principal, 'read', { namespace });
    const lim = Math.min(200, Math.max(1, limit | 0));
    return listStmt.all(namespace, kind, kind, status, status, lim)
      .map(mapRow)
      .filter(rec => canSee(principal, rec, { history, direct: history }));
  }

  return { put, get, list, canSee, requestHash };
}

module.exports = { createMemory, mapRow, requestHash };
