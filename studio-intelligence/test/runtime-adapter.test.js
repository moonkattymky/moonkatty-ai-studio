'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

function handoff(extra = {}) {
  return Object.assign({
    id: 'tasknews1',
    idempotencyKey: 'handoff/news/1',
    namespace: 'moonkatty_news',
    agentId: 'news',
    title: 'Собрать сюжеты',
    description: 'Только проверяемые источники.',
    priority: 'high',
    dependsOn: [],
    executor: 'runtime',
    requiresOwnerApproval: false,
    files: []
  }, extra);
}

function walkApproved(value, found = []) {
  if (value && typeof value === 'object') {
    if (value.codeApproved === true) found.push(value);
    for (const item of Object.values(value)) walkApproved(item, found);
  }
  return found;
}

test('адаптер ставит задачу в форму runtime и не одобряет OpenCode', () => {
  const { si, owner, agent } = setup();
  const task = si.runtime.handoff({ principal: agent('news'), task: handoff() });
  assert.equal(task.status, 'queued');
  assert.equal(task.project, 'news');
  assert.equal(task.agentId, 'news');
  assert.equal(task.source, 'studio-intelligence');
  assert.equal(task.kind, undefined);
  assert.deepEqual(walkApproved(task), []);

  const code = si.runtime.handoff({
    principal: owner,
    task: handoff({
      id: 'gamefix1', namespace: 'moonkatty_project', agentId: 'games', executor: 'opencode',
      requiresOwnerApproval: true, idempotencyKey: 'handoff/games/fix'
    })
  });
  assert.equal(code.kind, 'code');
  assert.equal(code.codeApproved, false);
  assert.equal(code.status, 'blocked');
  assert.match(code.blockedReason, /approve-code/);
  assert.equal(code.project, 'main');
  assert.throws(
    () => si.runtime.handoff({ principal: agent('games'), task: handoff({ namespace: 'moonkatty_project', agentId: 'games', executor: 'opencode', requiresOwnerApproval: true }) }),
    err => err.code === 'PERMISSION_DENIED'
  );
  assert.throws(
    () => si.runtime.handoff({ principal: agent('news'), task: handoff({ agentId: 'video' }) }),
    err => err.code === 'PERMISSION_DENIED'
  );
  si.close();
});

test('зависимости блокируют queued и отпускают после done, OpenCode не отпускается', () => {
  const { si, owner } = setup();
  const first = si.runtime.toRuntimeTask(handoff({ id: 'a', dependsOn: [] }));
  const second = si.runtime.toRuntimeTask(handoff({ id: 'b', dependsOn: ['a'], idempotencyKey: 'handoff/news/b' }));
  assert.equal(second.status, 'blocked');
  let patches = si.runtime.reconcileDependencies([first, second]);
  assert.equal(patches.length, 0);
  first.status = 'done';
  patches = si.runtime.reconcileDependencies([first, second]);
  assert.equal(patches[0].changes.status, 'queued');
  const code = si.runtime.handoff({
    principal: owner,
    task: handoff({ id: 'c', executor: 'opencode', requiresOwnerApproval: true, agentId: 'news' })
  });
  code.dependsOn = ['a'];
  assert.equal(si.runtime.reconcileDependencies([Object.assign({}, first, { status: 'done' }), code]).length, 0);
  const gate = si.runtime.toRuntimeTask(handoff({ id: 'd', requiresOwnerApproval: true, executor: 'human', idempotencyKey: 'handoff/news/d' }));
  assert.equal(gate.status, 'waiting_approval');
  si.close();
});

test('отмена in_progress просит остановить runtime, done отменить нельзя', () => {
  const { si } = setup();
  const request = {
    taskId: 'tasknews1', namespace: 'moonkatty_news', requestedBy: 'igor',
    at: '2026-10-20T12:00:00.000Z', reason: 'Ошибочный сюжет'
  };
  const running = { id: 'tasknews1', namespace: 'moonkatty_news', agentId: 'news', status: 'in_progress' };
  const plan = si.runtime.cancellationPlan(running, request);
  assert.equal(plan.action, 'runtime.stop');
  assert.equal(plan.then.status, 'cancelled');
  const queued = si.runtime.cancellationPlan({ id: 'tasknews1', namespace: 'moonkatty_news', status: 'queued' }, request);
  assert.equal(queued.action, 'patch');
  assert.equal(queued.changes.status, 'cancelled');
  assert.equal(si.runtime.cancellationPlan({ id: 'tasknews1', namespace: 'moonkatty_news', status: 'cancelled' }, request).action, 'noop');
  assert.throws(
    () => si.runtime.cancellationPlan({ id: 'tasknews1', namespace: 'moonkatty_news', status: 'done' }, request),
    err => err.code === 'INVALID_STATE'
  );
  si.close();
});

test('результат и файлы остаются черновиками', () => {
  const { si, owner, agent } = setup();
  const records = si.runtime.fileResultToRecords({
    taskId: 'tasknews1',
    namespace: 'moonkatty_news',
    idempotencyKey: 'result/news/1',
    files: [{ path: 'out/episode.mp4', role: 'output', version: 3, mediaType: 'video/mp4' }],
    result: { summary: 'Черновик монтажа без публикации.', status: 'waiting_approval' }
  });
  assert.ok(records.every(item => item.status === 'draft'));
  const stored = records.map(record => si.memory.put({ principal: agent('video'), record }));
  assert.ok(stored.every(item => item.status === 'draft'));
  const file = stored.find(item => item.kind === 'file');
  assert.equal(file.sourcePath, 'out/episode.mp4');
  assert.equal(file.payload.version, 3);
  assert.equal(file.sourceRecordId, 'tasknews1');
  const replay = si.memory.put({ principal: agent('video'), record: records[0] });
  assert.equal(replay.id, file.id);
  assert.equal(si.memory.list({ principal: owner, namespace: 'moonkatty_news', status: 'approved' }).length, 0);
  si.close();
});
