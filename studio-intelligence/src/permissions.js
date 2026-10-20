'use strict';
const { NAMESPACES, OWNER_ONLY_KINDS, AGENT_WRITE_KINDS } = require('./constants');
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { normalizePrincipal } = require('./auth');

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректная проверка прав', { retryable: false, details: { errors } });
}

function createPermissions(db) {
  const grantStmt = db.prepare('SELECT 1 AS ok FROM si_grants WHERE agent_id = ? AND namespace = ? AND action = ?');

  function hasGrant(agentId, namespace, action) {
    return !!grantStmt.get(agentId, namespace, action);
  }

  function canReadNamespace(principal, namespace) {
    if (!NAMESPACES.includes(namespace)) return false;
    if (principal.role === 'owner') return true;
    return hasGrant(principal.agentId, namespace, 'read');
  }

  function checkPermission(principal, action, resource) {
    const actor = normalizePrincipal(principal);
    const request = { principal: publicPrincipal(actor), action, resource };
    const errors = validate('permission-check', request);
    if (errors.length) validation(errors);
    const decision = decide(actor, action, resource);
    const shape = validate('permission-decision', decision);
    if (shape.length) validation(shape);
    return decision;
  }

  function decide(principal, action, resource) {
    const namespace = resource.namespace;
    if (!NAMESPACES.includes(namespace)) return { allowed: false, reason: 'Неизвестное пространство имён' };
    if (action === 'approve' || action === 'index') {
      if (principal.role !== 'owner') return { allowed: false, reason: 'Действие доступно только владельцу' };
      return { allowed: true, reason: 'Разрешено владельцу' };
    }
    if (action === 'read') {
      if (canReadNamespace(principal, namespace)) return { allowed: true, reason: 'Чтение разрешено' };
      return { allowed: false, reason: 'Нет права чтения в этом пространстве' };
    }
    if (action === 'write' || action === 'handoff') {
      if (principal.role === 'owner') return { allowed: true, reason: 'Запись владельца разрешена' };
      if (!hasGrant(principal.agentId, namespace, 'write')) return { allowed: false, reason: 'Нет права записи в этом пространстве' };
      if (resource.agentId && resource.agentId !== principal.agentId) {
        return { allowed: false, reason: 'Агент не может действовать от имени другого агента' };
      }
      return { allowed: true, reason: 'Запись черновика разрешена' };
    }
    if (action === 'cancel') {
      if (principal.role === 'owner') return { allowed: true, reason: 'Отмена владельцем разрешена' };
      if (!hasGrant(principal.agentId, namespace, 'write')) return { allowed: false, reason: 'Нет права отменять задачи в этом пространстве' };
      if (resource.agentId && resource.agentId !== principal.agentId) {
        return { allowed: false, reason: 'Агент не может отменить чужую задачу' };
      }
      return { allowed: true, reason: 'Отмена своей задачи разрешена' };
    }
    return { allowed: false, reason: 'Действие не поддерживается' };
  }

  function assertPermission(principal, action, resource) {
    const decision = checkPermission(principal, action, resource);
    if (!decision.allowed) throw new StudioError('PERMISSION_DENIED', decision.reason, { retryable: false });
    return decision;
  }

  function assertWriteRecord(principal, input) {
    const actor = normalizePrincipal(principal);
    if (input.status === 'approved' || input.status === 'rejected' || input.status === 'superseded') {
      if (actor.role !== 'owner') {
        throw new StudioError('PERMISSION_DENIED', 'Менять статус утверждения может только владелец', { retryable: false });
      }
    }
    if (OWNER_ONLY_KINDS.includes(input.kind) && actor.role !== 'owner') {
      throw new StudioError('PERMISSION_DENIED', 'Этот вид записи доступен только владельцу', { retryable: false });
    }
    if (actor.role === 'owner') return;
    assertPermission(actor, 'write', { namespace: input.namespace, kind: input.kind });
    if (!AGENT_WRITE_KINDS.includes(input.kind) || input.status !== 'draft') {
      throw new StudioError('PERMISSION_DENIED', 'Агент может записывать только черновики задач, результатов и файлов', { retryable: false });
    }
  }

  return { hasGrant, canReadNamespace, checkPermission, assertPermission, assertWriteRecord, normalize: normalizePrincipal };
}

function publicPrincipal(principal) {
  const out = { id: principal.id, role: principal.role };
  if (principal.agentId) out.agentId = principal.agentId;
  if (principal.user) out.user = principal.user;
  return out;
}

module.exports = { createPermissions, publicPrincipal };
