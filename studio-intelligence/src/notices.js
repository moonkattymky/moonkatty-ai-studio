'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

/**
 * Журнал поправок и опровержений. Процедуру проверки ведёт студия 4.
 * Запись здесь ничего не публикует.
 */
function createNotices(db, { now, permissions }) {
  const insert = db.prepare(`INSERT INTO si_publication_notices (
      id, namespace, kind, publication_id, publication_version, text, status, created_by, created_at, approved_by, approved_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, NULL, NULL)`);
  const getStmt = db.prepare('SELECT * FROM si_publication_notices WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM si_publication_notices WHERE namespace = ? AND publication_id = ? ORDER BY created_at, id');
  const approveStmt = db.prepare(`UPDATE si_publication_notices SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ? AND status = 'draft'`);

  function map(row) {
    return {
      id: row.id, namespace: row.namespace, kind: row.kind, publicationId: row.publication_id,
      publicationVersion: row.publication_version, text: row.text, status: row.status,
      createdBy: row.created_by, createdAt: row.created_at, approvedBy: row.approved_by, approvedAt: row.approved_at,
      executed: false
    };
  }

  function record({ principal, notice }) {
    const actor = permissions.normalize(principal);
    const input = {
      namespace: notice.namespace,
      kind: notice.kind,
      publicationId: notice.publicationId,
      publicationVersion: notice.publicationVersion ?? null,
      text: notice.text,
      status: 'draft'
    };
    const errors = validate('publication-notice', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В поправку нельзя записывать секреты', { retryable: false });
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: input.namespace, agentId: actor.agentId });
    const rowId = crypto.randomBytes(12).toString('hex');
    const who = actor.role === 'agent' ? actor.agentId : actor.id;
    insert.run(rowId, input.namespace, input.kind, input.publicationId, input.publicationVersion, input.text, who, now());
    return map(getStmt.get(rowId));
  }

  function approve({ principal, id }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Поправку в журнале подтверждает только владелец', { retryable: false });
    const row = getStmt.get(id);
    if (!row) throw new StudioError('NOT_FOUND', 'Запись не найдена', { retryable: false });
    permissions.assertPermission(actor, 'approve', { namespace: row.namespace });
    if (row.status === 'approved') return map(row);
    const result = approveStmt.run(actor.id, now(), id);
    if (!result.changes) throw new StudioError('INVALID_STATE', 'Запись уже подтверждена', { retryable: false });
    return map(getStmt.get(id));
  }

  function history({ principal, namespace, publicationId }) {
    permissions.assertPermission(principal, 'read', { namespace });
    return listStmt.all(namespace, publicationId).map(map);
  }

  return { record, approve, history };
}

module.exports = { createNotices };
