'use strict';
const crypto = require('crypto');
const { StudioError } = require('./errors');
const { validate } = require('./validate');

/**
 * Журнал утверждений пишется, но ничего не запускает.
 * auto_execute в базе всегда 0: решение владельца не публикует и не подменяет файлы.
 */
function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректное утверждение', { retryable: false, details: { errors } });
}

function validateRequest(request) {
  const errors = validate('approval-request', request);
  if (errors.length) validation(errors);
  if (request.autoExecute !== false || request.requiredRole !== 'owner' || request.status !== 'pending') {
    validation(['Запрос утверждения не может исполняться сам и не может быть уже решён']);
  }
  return request;
}

function validateEvent(event) {
  const errors = validate('approval-event', event);
  if (errors.length) validation(errors);
  if (event.action === 'approved' && event.actorRole !== 'owner') {
    validation(['Утвердить может только владелец']);
  }
  return event;
}

function mapApproval(row) {
  return {
    id: row.id,
    namespace: row.namespace,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    requiredRole: row.required_role,
    status: row.status,
    autoExecute: false,
    requestedBy: row.requested_by,
    requestedAt: row.requested_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    comment: row.comment
  };
}

function mapEvent(row) {
  const event = {
    id: row.id,
    approvalId: row.approval_id,
    at: row.at,
    action: row.action,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    prevStatus: row.prev_status,
    nextStatus: row.next_status
  };
  if (row.comment) event.comment = row.comment;
  return event;
}

function createApproval(db, { now, permissions, transaction }) {
  const getStmt = db.prepare('SELECT * FROM si_approvals WHERE id = ?');
  const insertStmt = db.prepare(`INSERT INTO si_approvals (
      id, namespace, subject_type, subject_id, required_role, status, auto_execute,
      requested_by, requested_at, decided_by, decided_at, comment
    ) VALUES (?, ?, ?, ?, 'owner', ?, 0, ?, ?, ?, ?, ?)`);
  const decideStmt = db.prepare(`UPDATE si_approvals
      SET status = ?, decided_by = ?, decided_at = ?, comment = ?
      WHERE id = ? AND status = 'pending' AND auto_execute = 0`);
  const insertEvent = db.prepare(`INSERT INTO si_approval_events (
      id, approval_id, at, action, actor_id, actor_role, comment, prev_status, next_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const eventsStmt = db.prepare('SELECT * FROM si_approval_events WHERE approval_id = ? ORDER BY at, id');

  function writeEvent(approvalId, action, actor, prevStatus, nextStatus, comment) {
    const event = {
      id: crypto.randomBytes(12).toString('hex'),
      approvalId,
      at: now(),
      action,
      actorId: actor.id,
      actorRole: actor.role,
      prevStatus,
      nextStatus
    };
    if (comment) event.comment = comment;
    validateEvent(event);
    insertEvent.run(event.id, event.approvalId, event.at, event.action, event.actorId, event.actorRole, event.comment || null, event.prevStatus, event.nextStatus);
    return event;
  }

  function request({ principal, request }) {
    const clean = validateRequest(request);
    const actor = permissions.normalize(principal);
    if (clean.requestedBy !== actor.id) {
      throw new StudioError('PERMISSION_DENIED', 'requestedBy должен совпадать с участником', { retryable: false });
    }
    if (actor.role === 'owner') permissions.assertPermission(actor, 'approve', { namespace: clean.namespace });
    else permissions.assertPermission(actor, 'write', { namespace: clean.namespace, agentId: actor.agentId });
    return transaction(() => {
      const existing = getStmt.get(clean.id);
      if (existing) {
        if (existing.subject_id === clean.subjectId && existing.namespace === clean.namespace && existing.auto_execute === 0) {
          return mapApproval(existing);
        }
        throw new StudioError('IDEMPOTENCY_CONFLICT', 'Идентификатор утверждения уже занят', { retryable: false });
      }
      insertStmt.run(clean.id, clean.namespace, clean.subjectType, clean.subjectId, 'pending', clean.requestedBy, clean.requestedAt, null, null, clean.comment || null);
      writeEvent(clean.id, 'requested', actor, 'none', 'pending', clean.comment);
      const saved = mapApproval(getStmt.get(clean.id));
      if (saved.autoExecute !== false) throw new StudioError('INVALID_STATE', 'Утверждение не может исполняться само', { retryable: false });
      return saved;
    });
  }

  function decide({ principal, approvalId, action, comment }) {
    const actor = permissions.normalize(principal);
    if (action !== 'approved' && action !== 'rejected') {
      throw new StudioError('VALIDATION', 'Решение: approved или rejected', { retryable: false });
    }
    const row = getStmt.get(approvalId);
    if (!row) throw new StudioError('NOT_FOUND', 'Утверждение не найдено', { retryable: false });
    permissions.assertPermission(actor, 'approve', { namespace: row.namespace });
    if (actor.role !== 'owner') {
      throw new StudioError('PERMISSION_DENIED', 'Решение принимает только владелец', { retryable: false });
    }
    return transaction(() => {
      const current = getStmt.get(approvalId);
      if (current.status === action) {
        const events = eventsStmt.all(approvalId).map(mapEvent);
        return { approval: mapApproval(current), event: events[events.length - 1], executed: false };
      }
      if (current.status !== 'pending') {
        throw new StudioError('INVALID_STATE', 'Утверждение уже решено', { retryable: false });
      }
      const at = now();
      const result = decideStmt.run(action, actor.id, at, comment || current.comment, approvalId);
      if (!result.changes) throw new StudioError('INVALID_STATE', 'Утверждение уже решено', { retryable: false });
      const event = writeEvent(approvalId, action, actor, 'pending', action, comment);
      return { approval: mapApproval(getStmt.get(approvalId)), event, executed: false };
    });
  }

  /** Уже принятое владельцем решение (регистрация бренда, актива). Ничего не запускает. */
  function recordGranted({ principal, namespace, subjectType, subjectId, comment }) {
    const actor = permissions.normalize(principal);
    permissions.assertPermission(actor, 'approve', { namespace });
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Записать утверждение может только владелец', { retryable: false });
    const id = crypto.randomBytes(12).toString('hex');
    const at = now();
    insertStmt.run(id, namespace, subjectType, subjectId, 'approved', actor.id, at, actor.id, at, comment || null);
    const event = writeEvent(id, 'approved', actor, 'none', 'approved', comment);
    return { approval: mapApproval(getStmt.get(id)), event, executed: false };
  }

  function history({ principal, approvalId }) {
    const row = getStmt.get(approvalId);
    if (!row) throw new StudioError('NOT_FOUND', 'Утверждение не найдено', { retryable: false });
    permissions.assertPermission(principal, 'read', { namespace: row.namespace });
    return eventsStmt.all(approvalId).map(mapEvent);
  }

  return { validateRequest, validateEvent, request, decide, recordGranted, history, mapApproval };
}

module.exports = { createApproval, validateRequest, validateEvent };
