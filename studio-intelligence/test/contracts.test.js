'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, schemaNames } = require('../src/validate');
const { StudioError } = require('../src/errors');

test('все контрактные схемы загружаются', () => {
  const names = schemaNames();
  for (const name of [
    'task-handoff', 'file-result-handoff', 'task-dependency', 'progress-event',
    'idempotency-record', 'error', 'cancellation', 'permission-check', 'permission-decision',
    'memory-record-input', 'memory-record', 'retrieval-result', 'workflow-pipeline',
    'brand-asset', 'brand-check', 'approval-request', 'approval-event', 'event-envelope'
  ]) assert.ok(names.includes(name), name);
});

test('передача задачи отклоняет лишнее поле и чужое пространство', () => {
  const base = {
    id: 'task_1', idempotencyKey: 'news/task/1', namespace: 'moonkatty_news', agentId: 'news',
    title: 'Найти сюжет', description: '', priority: 'high', dependsOn: [],
    executor: 'runtime', requiresOwnerApproval: false, files: []
  };
  assert.deepEqual(validate('task-handoff', base), []);
  assert.ok(validate('task-handoff', Object.assign({}, base, { codeApproved: true })).length);
  assert.ok(validate('task-handoff', Object.assign({}, base, { namespace: 'shared' })).length);
});

test('ошибка модуля совпадает со схемой', () => {
  const err = new StudioError('PERMISSION_DENIED', 'Нет права', { details: { scope: 'news' } });
  assert.deepEqual(validate('error', err.toJSON()), []);
  assert.equal(err.retryable, false);
});

test('событие прогресса и отмена валидны только в своих полях', () => {
  const progress = {
    id: 'p1', taskId: 'task_1', namespace: 'moonkatty_news', at: '2026-10-20T12:00:00.000Z',
    kind: 'progress', message: 'Собран черновик', actorId: 'news', pct: 40
  };
  assert.deepEqual(validate('progress-event', progress), []);
  const cancel = {
    taskId: 'task_1', namespace: 'moonkatty_news', requestedBy: 'igor',
    at: '2026-10-20T12:00:00.000Z', reason: 'Больше не нужно'
  };
  assert.deepEqual(validate('cancellation', cancel), []);
  assert.ok(validate('cancellation', Object.assign({}, cancel, { reason: '' })).length);
});
