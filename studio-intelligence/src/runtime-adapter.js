'use strict';
const crypto = require('crypto');
const { AGENTS, RUNTIME_PROJECT } = require('./constants');
const { StudioError } = require('./errors');
const { validate } = require('./validate');

const DEPENDENCY_REASON = 'Зависимости не выполнены';
const OPENCODE_REASON = 'Ожидается явное подтверждение OpenCode (POST /api/tasks/:id/approve-code)';

function validation(name, value) {
  const errors = validate(name, value);
  if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
}

function fileKey(idempotencyKey, role, filePath) {
  const digest = crypto.createHash('sha256').update(String(filePath)).digest('hex').slice(0, 16);
  return `${idempotencyKey}:file:${role}:${digest}`;
}

/**
 * Адаптер к Agent Runtime (runner.js, ветка dev #1).
 * Не запускает агентов, не вызывает Ollama и OpenCode, не ставит codeApproved=true.
 * Хост сам кладёт задачу в коллекцию tasks и вызывает runner.tick().
 */
function createRuntimeAdapter({ permissions }) {
  function toRuntimeTask(handoff) {
    validation('task-handoff', handoff);
    if (!AGENTS.includes(handoff.agentId)) {
      throw new StudioError('VALIDATION', 'Неизвестный агент', { retryable: false });
    }
    if (!RUNTIME_PROJECT[handoff.namespace]) {
      throw new StudioError('VALIDATION', 'Пространство SHARED не ставится в очередь панели. Общие активы читаются по правам, задачи панели остаются в news или main.', { retryable: false });
    }
    const task = {
      id: handoff.id,
      title: handoff.title,
      description: handoff.description,
      agentId: handoff.agentId,
      priority: handoff.priority,
      status: 'queued',
      project: RUNTIME_PROJECT[handoff.namespace],
      namespace: handoff.namespace,
      schedule: { type: 'none' },
      source: 'studio-intelligence',
      dependsOn: handoff.dependsOn.slice(),
      idempotencyKey: handoff.idempotencyKey,
      requiresOwnerApproval: handoff.requiresOwnerApproval,
      files: handoff.files
    };
    if (handoff.dependsOn.length) {
      task.status = 'blocked';
      task.blockedReason = `${DEPENDENCY_REASON}: ${handoff.dependsOn.join(', ')}`;
    }
    if (handoff.requiresOwnerApproval || handoff.executor === 'human') {
      task.status = 'waiting_approval';
      task.blockedReason = null;
    }
    if (handoff.executor === 'opencode') {
      task.kind = 'code';
      task.codeApproved = false;
      task.status = 'blocked';
      task.blockedReason = OPENCODE_REASON;
    }
    if (task.codeApproved === true) {
      throw new StudioError('INVALID_STATE', 'Адаптер не имеет права одобрять OpenCode', { retryable: false });
    }
    return task;
  }

  function handoff({ principal, task }) {
    validation('task-handoff', task);
    const actor = permissions.normalize(principal);
    const resource = { namespace: task.namespace };
    if (actor.role === 'agent') resource.agentId = actor.agentId;
    permissions.assertPermission(actor, 'handoff', resource);
    if (actor.role === 'agent' && task.agentId !== actor.agentId) {
      throw new StudioError('PERMISSION_DENIED', 'Агент не может передать задачу другому агенту', { retryable: false });
    }
    if (task.executor === 'opencode' && actor.role !== 'owner') {
      throw new StudioError('PERMISSION_DENIED', 'Задачу OpenCode ставит только владелец', { retryable: false });
    }
    return toRuntimeTask(task);
  }

  /**
   * Чистая функция, как core.schedulerTick: возвращает патчи, сама базу не пишет.
   * Снимает блокировку зависимости, когда все dependsOn в статусе done.
   * Блокировку OpenCode и waiting_approval не трогает.
   */
  function reconcileDependencies(tasks) {
    const byId = new Map(tasks.map(item => [item.id, item]));
    const patches = [];
    for (const task of tasks) {
      const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
      if (!deps.length) continue;
      const unmet = deps.filter(id => !byId.get(id) || byId.get(id).status !== 'done');
      const dependencyHold = typeof task.blockedReason === 'string' && task.blockedReason.startsWith(DEPENDENCY_REASON);
      if (unmet.length && task.status === 'queued') {
        patches.push({
          id: task.id,
          changes: { status: 'blocked', blockedReason: `${DEPENDENCY_REASON}: ${unmet.join(', ')}` }
        });
      } else if (!unmet.length && task.status === 'blocked' && dependencyHold) {
        patches.push({ id: task.id, changes: { status: 'queued', blockedReason: null } });
      }
    }
    return patches;
  }

  function cancellationPlan(task, request) {
    validation('cancellation', request);
    if (!task || task.id !== request.taskId) {
      throw new StudioError('VALIDATION', 'Отмена не совпадает с задачей', { retryable: false });
    }
    if (task.namespace && task.namespace !== request.namespace) {
      throw new StudioError('VALIDATION', 'Пространство отмены не совпадает с задачей', { retryable: false });
    }
    if (task.status === 'cancelled') return { action: 'noop', taskId: task.id };
    if (task.status === 'done' || task.status === 'failed') {
      throw new StudioError('INVALID_STATE', 'Завершённую задачу отменить нельзя', { retryable: false });
    }
    const changes = { status: 'cancelled', cancelledAt: request.at, cancelReason: request.reason };
    if (task.status === 'in_progress') {
      return { action: 'runtime.stop', agentId: task.agentId, taskId: task.id, then: changes };
    }
    return { action: 'patch', taskId: task.id, changes };
  }

  function fileResultToRecords(handoff) {
    validation('file-result-handoff', handoff);
    const records = handoff.files.map(file => ({
      namespace: handoff.namespace,
      kind: 'file',
      title: String(file.path).split('/').pop().slice(0, 300) || 'file',
      body: file.path,
      status: 'draft',
      sourcePath: file.path,
      sourceRecordId: handoff.taskId,
      idempotencyKey: fileKey(handoff.idempotencyKey, file.role, file.path),
      payload: {
        role: file.role,
        version: file.version,
        mediaType: file.mediaType || null,
        sha256: file.sha256 || null,
        taskId: handoff.taskId
      }
    }));
    records.push({
      namespace: handoff.namespace,
      kind: 'result',
      title: `Результат ${handoff.taskId}`.slice(0, 300),
      body: handoff.result.summary,
      status: 'draft',
      sourcePath: null,
      sourceRecordId: handoff.taskId,
      idempotencyKey: `${handoff.idempotencyKey}:result`,
      payload: { taskStatus: handoff.result.status, taskId: handoff.taskId }
    });
    return records;
  }

  return {
    toRuntimeTask,
    handoff,
    reconcileDependencies,
    cancellationPlan,
    fileResultToRecords,
    DEPENDENCY_REASON,
    OPENCODE_REASON
  };
}

module.exports = { createRuntimeAdapter, DEPENDENCY_REASON, OPENCODE_REASON };
