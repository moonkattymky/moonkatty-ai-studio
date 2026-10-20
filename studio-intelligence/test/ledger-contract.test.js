'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { createLedgerStub } = require('../src/ledger-stub');
const { validate } = require('../src/validate');

function row(extra) {
  return Object.assign({
    id: 'row1', kind: 'actual', direction: 'expense', amount: 2, currency: 'USD',
    date: '2026-10-20T08:00:00.000Z', source: 'manual', proof: null, projectId: 'moonkatty_project:games'
  }, extra);
}

test('resolveProject знает согласованные id и не теряет неизвестные', () => {
  const { si } = setup();
  const games = si.projects.resolveProject('moonkatty_project:games');
  assert.equal(games.known, true);
  assert.equal(games.namespace, 'moonkatty_project');
  assert.equal(games.slug, 'games');
  assert.equal(games.dropped, false);
  assert.deepEqual(validate('project-resolution', games), []);
  const shared = si.projects.resolveProject('moonkatty_shared');
  assert.equal(shared.known, true);
  assert.equal(shared.namespace, 'moonkatty_shared');
  const unknown = si.projects.resolveProject('moonkatty_project:nope');
  assert.equal(unknown.projectId, 'unassigned');
  assert.equal(unknown.rawProjectId, 'moonkatty_project:nope');
  assert.equal(unknown.known, false);
  assert.equal(unknown.dropped, false);
  assert.deepEqual(validate('project-resolution', unknown), []);
  assert.equal(si.projects.resolveProject(null).projectId, 'unassigned');
  const ids = si.projects.list().map(item => item.projectId);
  for (const id of ['moonkatty_project:games', 'moonkatty_project:mkty', 'moonkatty_project:youtube', 'moonkatty_project:ads', 'moonkatty_news:episodes', 'moonkatty_shared']) {
    assert.ok(ids.includes(id), id);
  }
  si.close();
});

test('адаптер читает listEntries и не смешивает факт с прогнозом', () => {
  const stub = createLedgerStub([
    row({ id: 'a1', kind: 'actual', direction: 'expense', amount: 2, projectId: 'moonkatty_project:games' }),
    row({ id: 'a2', kind: 'actual', direction: 'income', amount: 5, projectId: 'moonkatty_news:episodes' }),
    row({ id: 'e1', kind: 'estimate', direction: 'expense', amount: 1, projectId: 'moonkatty_project:ads' }),
    row({ id: 'f1', kind: 'forecast', direction: 'income', amount: 20, projectId: 'not-a-project' }),
    row({ id: 'x1', kind: 'actual', direction: 'expense', amount: 3, currency: 'EUR', projectId: 'moonkatty_project:youtube' }),
    row({ id: 'old', kind: 'actual', direction: 'expense', amount: 100, date: '2026-09-01T00:00:00.000Z' })
  ]);
  assert.equal(stub.listEntries({ kind: 'forecast' }).length, 1);
  assert.equal(stub.listEntries({ direction: 'income', projectId: 'moonkatty_news:episodes' }).length, 1);
  const { si, owner, agent } = setup({ ledger: stub });
  const query = si.ledger.toQuery({ kind: 'actual', from: '2026-10-20T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' });
  assert.deepEqual(query, { kind: 'actual', from: '2026-10-20T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' });
  const read = si.ledger.read({ from: '2026-10-20T00:00:00.000Z', to: '2026-10-21T00:00:00.000Z' });
  assert.equal(read.length, 5);
  const lost = read.find(item => item.id === 'f1');
  assert.equal(lost.project.projectId, 'unassigned');
  assert.equal(lost.project.rawProjectId, 'not-a-project');
  assert.equal(lost.project.dropped, false);
  const report = si.reports.daily({
    principal: owner,
    from: '2026-10-20T00:00:00.000Z',
    to: '2026-10-21T00:00:00.000Z'
  });
  assert.equal(report.ledger.actual.expenseUsd, 2);
  assert.equal(report.ledger.actual.incomeUsd, 5);
  assert.equal(report.ledger.estimate.expenseUsd, 1);
  assert.equal(report.ledger.forecast.incomeUsd, 20);
  assert.equal(report.ledger.forecast.expenseUsd, 0);
  assert.equal(report.costs.totalUsd, 2);
  assert.equal(report.costs.scope, 'actual');
  assert.equal(report.ledger.unassignedEntries, 1);
  assert.equal(report.ledger.otherCurrencies.length, 1);
  assert.equal(report.ledger.otherCurrencies[0].currency, 'EUR');
  const games = si.reports.daily({
    principal: agent('games'),
    from: '2026-10-20T00:00:00.000Z',
    to: '2026-10-21T00:00:00.000Z'
  });
  assert.equal(games.ledger.actual.incomeUsd, 0);
  assert.equal(games.ledger.forecast.incomeUsd, 0);
  assert.equal(games.costs.totalUsd, 2);
  si.db.prepare(`INSERT INTO si_cost_entries (
      id, namespace, at, component, amount_usd, note, actor_id, idempotency_key
    ) VALUES ('legacy2', 'moonkatty_project', '2026-10-20T12:00:00.000Z', 'x', 50, NULL, 'igor', 'legacy2')`).run();
  const again = si.reports.daily({
    principal: owner,
    from: '2026-10-20T00:00:00.000Z',
    to: '2026-10-21T00:00:00.000Z'
  });
  assert.equal(again.costs.totalUsd, 2);
  si.close();
});
