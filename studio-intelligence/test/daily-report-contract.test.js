'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { createLedgerStub } = require('../src/ledger-stub');

const FROM = '2026-10-20T00:00:00.000Z';
const TO = '2026-10-21T00:00:00.000Z';

function task(namespace, key, title) {
  return {
    namespace,
    kind: 'task',
    title,
    status: 'draft',
    idempotencyKey: key,
    payload: {}
  };
}

test('дневной отчёт считает только записанное и режется для телефона', () => {
  const ledger = createLedgerStub([
    {
      id: 'c1', kind: 'actual', direction: 'expense', amount: 1.5, currency: 'USD',
      date: '2026-10-20T12:00:00.000Z', source: 'manual', proof: null, projectId: 'moonkatty_news:episodes'
    },
    {
      id: 'f1', kind: 'forecast', direction: 'income', amount: 9, currency: 'USD',
      date: '2026-10-20T12:00:00.000Z', source: 'sheet', proof: null, projectId: 'moonkatty_news:episodes'
    }
  ]);
  const { si, owner, agent } = setup({ ledger });
  si.memory.put({ principal: owner, record: task('moonkatty_news', 'task/news/1', 'Смонтировать выпуск') });
  si.memory.put({ principal: owner, record: task('moonkatty_project', 'task/project/1', 'Проверить сборку игры') });
  si.memory.put({
    principal: owner,
    record: {
      namespace: 'moonkatty_news', kind: 'publication_version', title: 'Выпуск 12',
      status: 'approved', idempotencyKey: 'pub/ep12/v1', payload: { publicationId: 'ep12' }
    }
  });
  si.progress.append({
    principal: agent('video'),
    event: { id: 'p1', taskId: 'task_1', namespace: 'moonkatty_news', kind: 'failed', message: 'Рендер оборвался', actorId: 'video' }
  });
  si.progress.append({
    principal: agent('video'),
    event: { id: 'p2', taskId: 'task_1', namespace: 'moonkatty_news', kind: 'started', message: 'Взято в работу', actorId: 'video' }
  });
  const clip = si.assets.register({
    principal: agent('news'),
    asset: {
      namespace: 'moonkatty_news', kind: 'video', title: 'Вставка', idempotencyKey: 'news/clip/report',
      contentHash: 'f'.repeat(64)
    }
  });
  si.assets.recordUsage({
    principal: agent('news'),
    usage: { assetId: clip.asset.id, namespace: 'moonkatty_news', whereUsed: 'publication', publicationId: 'ep12', publicationVersion: 1, idempotencyKey: 'usage/ep12/pub' }
  });
  si.qa.recordFinding({
    principal: agent('video'),
    finding: { namespace: 'moonkatty_news', publicationId: 'ep12', publicationVersion: 1, checkName: 'sound', ok: false, detail: 'тихо' }
  });
  si.qa.recordFinding({
    principal: agent('video'),
    finding: { namespace: 'moonkatty_news', publicationId: 'ep12', publicationVersion: 1, checkName: 'format', ok: true, detail: null }
  });
  si.approval.request({
    principal: agent('news'),
    request: {
      id: 'apnews', namespace: 'moonkatty_news', subjectType: 'publication', subjectId: 'ep12',
      requiredRole: 'owner', status: 'pending', autoExecute: false, requestedBy: 'news',
      requestedAt: '2026-10-20T12:00:00.000Z'
    }
  });
  assert.throws(() => si.reports.recordCost({
    principal: owner,
    entry: { namespace: 'moonkatty_news', component: 'ffmpeg', amountUsd: 1.5, idempotencyKey: 'cost/ffmpeg/1' }
  }), err => err.code === 'NOT_IMPLEMENTED');
  si.db.prepare(`INSERT INTO si_cost_entries (
      id, namespace, at, component, amount_usd, note, actor_id, idempotency_key, direction, project_id
    ) VALUES ('legacy', 'moonkatty_news', '2026-10-20T12:00:00.000Z', 'ffmpeg', 99, NULL, 'igor', 'legacy', 'expense', NULL)`).run();
  si.reports.recordHealth({ principal: owner, sample: { component: 'ollama', ok: true, detail: 'qwen3:8b' } });
  si.reports.recordHealth({ principal: owner, sample: { component: 'ollama', ok: false, detail: 'нет ответа' } });
  for (let i = 0; i < 9; i++) {
    si.reports.recordHealth({ principal: owner, sample: { component: 'svc' + i, ok: false, detail: 'down' } });
  }

  const full = si.reports.daily({ principal: agent('analytics'), from: FROM, to: TO, compact: false });
  assert.deepEqual(full.namespaces, ['moonkatty_news', 'moonkatty_project', 'moonkatty_shared']);
  assert.deepEqual(full.work, { tasks: 2, progressEvents: 2 });
  assert.deepEqual(full.publications, { versions: 1, usages: 1 });
  assert.deepEqual(full.errors, { failedProgress: 1, qaFailed: 1 });
  assert.equal(full.costs.entries, 1);
  assert.equal(full.costs.totalUsd, 1.5);
  assert.equal(full.costs.scope, 'actual');
  assert.equal(full.costs.available, true);
  assert.equal(full.ledger.source, 'studio3');
  assert.equal(full.ledger.actual.expenseUsd, 1.5);
  assert.equal(full.ledger.actual.incomeUsd, 0);
  assert.equal(full.ledger.forecast.incomeUsd, 9);
  assert.equal(full.ledger.forecast.expenseUsd, 0);
  assert.equal(full.health.available, true);
  assert.equal(full.health.components.find(item => item.component === 'ollama').ok, false);
  assert.equal(full.health.components.find(item => item.component === 'ollama').detail, 'нет ответа');
  assert.deepEqual(full.approvals, { pending: 1, approved: 0, rejected: 0 });
  assert.deepEqual(full.qa, { failed: 1, passed: 1 });
  assert.equal(full.attention.length, 13);
  assert.equal(full.views, undefined);

  const phone = si.reports.daily({ principal: agent('analytics'), from: FROM, to: TO, compact: true });
  assert.equal(phone.compact, true);
  assert.equal(phone.attention.length, 8);
  assert.equal(phone.work.tasks, full.work.tasks);
  assert.equal(Object.prototype.hasOwnProperty.call(phone.health.components[0], 'detail'), false);

  const games = si.reports.daily({ principal: agent('games'), from: FROM, to: TO });
  assert.deepEqual(games.namespaces, ['moonkatty_project', 'moonkatty_shared']);
  assert.equal(games.work.tasks, 1);
  assert.equal(games.errors.failedProgress, 0);
  assert.equal(games.publications.versions, 0);
  assert.equal(games.costs.available, false);
  assert.equal(games.costs.totalUsd, 0);

  const empty = si.reports.daily({
    principal: owner,
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-02T00:00:00.000Z'
  });
  assert.equal(empty.costs.available, false);
  assert.equal(empty.health.available, false);
  assert.deepEqual(empty.attention, []);
  assert.equal(empty.work.tasks, 0);
  si.close();
});
