'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

/** Версии сценариев и роликов. Новая версия не публикует предыдущую. */
function createVersions(db, { now, permissions, transaction }) {
  const latest = db.prepare(`SELECT * FROM si_content_versions
    WHERE namespace = ? AND content_type = ? AND content_key = ? ORDER BY version DESC LIMIT 1`);
  const listStmt = db.prepare(`SELECT * FROM si_content_versions
    WHERE namespace = ? AND content_type = ? AND content_key = ? ORDER BY version`);
  const getStmt = db.prepare('SELECT * FROM si_content_versions WHERE id = ?');
  const insert = db.prepare(`INSERT INTO si_content_versions (
      id, namespace, content_type, content_key, version, title, body, storage_path, checksum, status, supersedes, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const approveStmt = db.prepare(`UPDATE si_content_versions SET status = 'approved' WHERE id = ? AND status = 'draft'`);
  const supersedeStmt = db.prepare(`UPDATE si_content_versions SET status = 'superseded' WHERE id = ? AND status = 'approved'`);

  function map(row) {
    return {
      id: row.id, namespace: row.namespace, contentType: row.content_type, contentKey: row.content_key,
      version: row.version, title: row.title, body: row.body, storagePath: row.storage_path,
      checksum: row.checksum, status: row.status, supersedes: row.supersedes,
      createdBy: row.created_by, createdAt: row.created_at
    };
  }

  function commit({ principal, version }) {
    const actor = permissions.normalize(principal);
    const input = {
      namespace: version.namespace,
      contentType: version.contentType,
      contentKey: version.contentKey,
      title: version.title,
      body: version.body || '',
      storagePath: version.storagePath ?? null,
      checksum: version.checksum ?? null,
      status: 'draft'
    };
    const errors = validate('content-version', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В версию нельзя записывать секреты', { retryable: false });
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: input.namespace, agentId: actor.agentId });
    return transaction(() => {
      const prev = latest.get(input.namespace, input.contentType, input.contentKey);
      const next = prev ? prev.version + 1 : 1;
      const rowId = crypto.randomBytes(12).toString('hex');
      const who = actor.role === 'agent' ? actor.agentId : actor.id;
      insert.run(rowId, input.namespace, input.contentType, input.contentKey, next, input.title, input.body, input.storagePath, input.checksum, 'draft', prev ? prev.id : null, who, now());
      return Object.assign(map(getStmt.get(rowId)), { executed: false });
    });
  }

  function approve({ principal, id }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Версию утверждает только владелец', { retryable: false });
    const row = getStmt.get(id);
    if (!row) throw new StudioError('NOT_FOUND', 'Версия не найдена', { retryable: false });
    permissions.assertPermission(actor, 'approve', { namespace: row.namespace });
    return transaction(() => {
      const current = getStmt.get(id);
      if (current.status === 'approved') return { version: map(current), executed: false };
      if (current.supersedes) supersedeStmt.run(current.supersedes);
      const result = approveStmt.run(id);
      if (!result.changes) throw new StudioError('INVALID_STATE', 'Версия уже не черновик', { retryable: false });
      return { version: map(getStmt.get(id)), executed: false };
    });
  }

  function history({ principal, namespace, contentType, contentKey }) {
    permissions.assertPermission(principal, 'read', { namespace });
    return listStmt.all(namespace, contentType, contentKey).map(map);
  }

  return { commit, approve, history };
}

module.exports = { createVersions };
