'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректное событие прогресса', { retryable: false, details: { errors } });
}

function sameEvent(row, event) {
  return row.task_id === event.taskId && row.namespace === event.namespace && row.kind === event.kind
    && row.message === event.message && row.actor_id === event.actorId && row.pct === (event.pct ?? null);
}

function createProgress(db, { now, permissions }) {
  const insert = db.prepare(`INSERT INTO si_progress (id, task_id, namespace, at, kind, message, actor_id, pct, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const getStmt = db.prepare('SELECT * FROM si_progress WHERE id = ?');
  const listStmt = db.prepare('SELECT * FROM si_progress WHERE namespace = ? AND task_id = ? ORDER BY at, id');

  function map(row) {
    const event = {
      id: row.id,
      taskId: row.task_id,
      namespace: row.namespace,
      at: row.at,
      kind: row.kind,
      message: row.message,
      actorId: row.actor_id
    };
    if (row.pct != null) event.pct = row.pct;
    return event;
  }

  function append({ principal, event }) {
    const actor = permissions.normalize(principal);
    const input = Object.assign({}, event, {
      id: event && event.id ? event.id : crypto.randomBytes(12).toString('hex'),
      at: event && event.at ? event.at : now()
    });
    const errors = validate('progress-event', input);
    if (errors.length) validation(errors);
    const expectedActor = actor.role === 'agent' ? actor.agentId : actor.id;
    if (input.actorId !== expectedActor) {
      throw new StudioError('PERMISSION_DENIED', 'actorId должен совпадать с участником', { retryable: false });
    }
    const resource = { namespace: input.namespace };
    if (actor.role === 'agent') resource.agentId = actor.agentId;
    permissions.assertPermission(actor, 'write', resource);
    const existing = getStmt.get(input.id);
    if (existing) {
      if (sameEvent(existing, input)) return map(existing);
      throw new StudioError('IDEMPOTENCY_CONFLICT', 'Событие с таким id уже записано с другим содержимым', { retryable: false });
    }
    insert.run(input.id, input.taskId, input.namespace, input.at, input.kind, input.message, input.actorId, input.pct ?? null, '{}');
    return map(getStmt.get(input.id));
  }

  function list({ principal, namespace, taskId }) {
    permissions.assertPermission(principal, 'read', { namespace });
    return listStmt.all(namespace, taskId).map(map);
  }

  return { append, list };
}

module.exports = { createProgress };
