'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setup } = require('./helpers');
const { resolveProject } = require('../src/projects');

const LEDGER_COMMIT = 'e9a46bf2695b266f5d031ece192c12ed9747218f';
const ROOT = path.join(__dirname, '..', '..');

function materialize(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-real-ledger-'));
  const text = execFileSync('git', ['show', spec], { cwd: ROOT, encoding: 'utf8' });
  const file = path.join(dir, 'ledger.js');
  fs.writeFileSync(file, text);
  return file;
}

test('адаптер читает настоящий createLedger @e9a46bf и не теряет строки', () => {
  const file = materialize(LEDGER_COMMIT + ':lib/ops/ledger.js');
  const { createLedger } = require(file);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-ledger-data-'));
  const ledger = createLedger({ dir, now: () => Date.parse('2026-10-21T12:00:00.000Z') });
  ledger.setResolver(pid => {
    const resolved = resolveProject(pid);
    return resolved && typeof resolved.then !== 'function'
      ? { projectId: pid, ...resolved, resolvedBy: 'studio-intelligence' }
      : null;
  });
  const proof = { type: 'receipt', ref: 'receipt-1' };
  ledger.add({
    kind: 'actual', direction: 'expense', amount: '12.50', currency: 'USD', date: '2026-10-20',
    category: 'software', source: 'bank', proof, projectId: 'moonkatty_project:games'
  });
  ledger.add({
    kind: 'estimate', direction: 'expense', amount: '1.00', currency: 'USD', date: '2026-10-20',
    category: 'api_cost', basis: 'счётчик', projectId: 'moonkatty_news:episodes'
  });
  ledger.add({
    kind: 'forecast', direction: 'income', amount: '9.00', currency: 'USD', date: '2026-10-20',
    category: 'ad_revenue', basis: 'план', projectId: 'moonkatty_project:ads'
  });
  ledger.add({
    kind: 'actual', direction: 'expense', amount: '3.00', currency: 'EUR', date: '2026-10-20',
    category: 'hosting', source: 'bank', proof: { type: 'invoice', ref: 'inv-1' },
    projectId: 'moonkatty_shared'
  });
  ledger.add({
    kind: 'actual', direction: 'expense', amount: '4.00', currency: 'USD', date: '2026-10-20',
    category: 'other', source: 'bank', proof: { type: 'url', ref: 'https://example.test/r' },
    projectId: 'moonkatty_project:nope'
  });
  ledger.add({
    kind: 'forecast', direction: 'income', amount: '8.00', currency: 'USD', date: '2026-10-21',
    category: 'sponsor', basis: 'следующий день', projectId: 'moonkatty_project:youtube'
  });

  const shared = ledger.listEntries({}).find(row => row.projectId === 'moonkatty_shared');
  assert.equal(shared.project.bucket, 'moonkatty_shared');
  assert.equal(typeof shared.amount, 'string');
  const unknown = ledger.listEntries({}).find(row => row.projectId === 'moonkatty_project:nope');
  assert.equal(unknown.project.bucket, 'unassigned');
  assert.equal(unknown.project.rawProjectId, 'moonkatty_project:nope');

  const { si, owner } = setup({ ledger });
  const from = '2026-10-20T00:00:00.000Z';
  const to = '2026-10-21T00:00:00.000Z';
  assert.deepEqual(si.ledger.toQuery({ from, to }), { from: '2026-10-20', to: '2026-10-20' });
  const read = si.ledger.read({ from, to });
  assert.equal(read.length, 5);
  const games = read.find(row => row.project.projectId === 'moonkatty_project:games');
  assert.equal(games.amount, 12.5);
  assert.equal(games.date, '2026-10-20T00:00:00.000Z');
  assert.equal(games.proof.type, 'receipt');
  assert.equal(games.kind, 'actual');
  const lost = read.find(row => row.project.rawProjectId === 'moonkatty_project:nope');
  assert.equal(lost.project.projectId, 'unassigned');
  assert.equal(lost.project.dropped, false);
  const common = read.find(row => row.project.projectId === 'moonkatty_shared');
  assert.equal(common.project.known, true);
  assert.equal(common.currency, 'EUR');
  const report = si.reports.daily({ principal: owner, from, to });
  assert.equal(report.ledger.actual.expenseUsd, 16.5);
  assert.equal(report.ledger.estimate.expenseUsd, 1);
  assert.equal(report.ledger.forecast.incomeUsd, 9);
  assert.equal(report.ledger.forecast.expenseUsd, 0);
  assert.equal(report.costs.totalUsd, 16.5);
  assert.equal(report.costs.scope, 'actual');
  assert.equal(report.ledger.unassignedEntries, 1);
  assert.equal(report.ledger.otherCurrencies.length, 1);
  assert.equal(report.ledger.otherCurrencies[0].currency, 'EUR');
  si.close();
});
