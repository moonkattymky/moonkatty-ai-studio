'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

/** История источников и редакционных решений. Публикацию не выпускает. */
function createEditorial(db, { now, permissions, transaction }) {
  const insertSource = db.prepare(`INSERT INTO si_source_history (
      id, namespace, source_url, source_name, action, note, actor_id, at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const sourceByKey = db.prepare('SELECT * FROM si_source_history WHERE namespace = ? AND idempotency_key = ?');
  const sources = db.prepare('SELECT * FROM si_source_history WHERE namespace = ? ORDER BY at, id');
  const insertDecision = db.prepare(`INSERT INTO si_editorial_decisions (
      id, namespace, subject_type, subject_id, action, summary, status, actor_id, at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const decisions = db.prepare('SELECT * FROM si_editorial_decisions WHERE namespace = ? AND subject_id = ? ORDER BY at, id');

  function actorId(actor) {
    return actor.role === 'agent' ? actor.agentId : actor.id;
  }

  function mapSource(row) {
    return {
      id: row.id, namespace: row.namespace, sourceUrl: row.source_url, sourceName: row.source_name,
      action: row.action, note: row.note, actorId: row.actor_id, at: row.at, idempotencyKey: row.idempotency_key
    };
  }

  function mapDecision(row) {
    return {
      id: row.id, namespace: row.namespace, subjectType: row.subject_type, subjectId: row.subject_id,
      action: row.action, summary: row.summary, status: row.status, actorId: row.actor_id, at: row.at
    };
  }

  function recordSource({ principal, entry }) {
    const actor = permissions.normalize(principal);
    const input = {
      namespace: entry.namespace,
      sourceUrl: entry.sourceUrl ?? null,
      sourceName: entry.sourceName ?? null,
      action: entry.action,
      note: entry.note ?? null,
      idempotencyKey: entry.idempotencyKey
    };
    const errors = validate('source-history-entry', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В историю источника нельзя записывать секреты', { retryable: false });
    if (actor.role !== 'owner') permissions.assertPermission(actor, 'write', { namespace: input.namespace, agentId: actor.agentId });
    return transaction(() => {
      const prev = sourceByKey.get(input.namespace, input.idempotencyKey);
      if (prev) return mapSource(prev);
      const rowId = crypto.randomBytes(12).toString('hex');
      insertSource.run(rowId, input.namespace, input.sourceUrl, input.sourceName, input.action, input.note, actorId(actor), now(), input.idempotencyKey);
      return mapSource(sourceByKey.get(input.namespace, input.idempotencyKey));
    });
  }

  function recordDecision({ principal, decision }) {
    const actor = permissions.normalize(principal);
    const input = {
      namespace: decision.namespace,
      subjectType: decision.subjectType,
      subjectId: decision.subjectId,
      action: decision.action,
      summary: decision.summary,
      status: decision.status || 'draft'
    };
    const errors = validate('editorial-decision', input);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    if (containsSecret(input)) throw new StudioError('SECRET_REJECTED', 'В редакционное решение нельзя записывать секреты', { retryable: false });
    if (input.status === 'approved' || input.action === 'approved' || input.action === 'rejected') {
      if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Итог редакционного решения ставит только владелец', { retryable: false });
      permissions.assertPermission(actor, 'approve', { namespace: input.namespace });
    } else if (actor.role !== 'owner') {
      permissions.assertPermission(actor, 'write', { namespace: input.namespace, agentId: actor.agentId });
    }
    const rowId = crypto.randomBytes(12).toString('hex');
    insertDecision.run(rowId, input.namespace, input.subjectType, input.subjectId, input.action, input.summary, input.status === 'approved' ? 'approved' : 'draft', actorId(actor), now());
    return Object.assign(mapDecision(db.prepare('SELECT * FROM si_editorial_decisions WHERE id = ?').get(rowId)), { executed: false });
  }

  function history({ principal, namespace, subjectId = null }) {
    permissions.assertPermission(principal, 'read', { namespace });
    return {
      sources: sources.all(namespace).map(mapSource),
      decisions: subjectId ? decisions.all(namespace, subjectId).map(mapDecision) : []
    };
  }

  return { recordSource, recordDecision, history };
}

module.exports = { createEditorial };
