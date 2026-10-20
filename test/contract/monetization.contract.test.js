'use strict';
// Contract: Studio 5 (feat/studio-intelligence) reads money ONLY via our stable read API. docs/ops/MONETIZATION_CONTRACT.md
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'), os = require('os'), path = require('path');
const { createLedger, NAMESPACES } = require('../../lib/ops/ledger.js');
const ENTRY_FIELDS = ['id', 'kind', 'direction', 'amount', 'amountMinor', 'currency', 'date', 'category', 'source', 'proof', 'basis', 'projectId', 'project', 'voided', 'idempotencyKey'];
test('namespaces match Studio 5 constants (moonkatty_news, moonkatty_project, moonkatty_shared)', () => assert.deepEqual(NAMESPACES, ['moonkatty_news', 'moonkatty_project', 'moonkatty_shared']));
test('listEntries({kind,direction,projectId,from,to}) shape is stable', () => {
  const l = createLedger({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'mc-')) });
  for (const pid of ['moonkatty_project:games', 'moonkatty_project:mkty', 'moonkatty_project:youtube', 'moonkatty_project:ads', 'moonkatty_news:episodes']) l.add({ kind: 'estimate', direction: 'expense', amount: '1', currency: 'USD', date: '2026-10-01', category: 'api_cost', basis: 'contract test', projectId: pid });
  const e = l.listEntries({ kind: 'estimate', direction: 'expense', projectId: 'moonkatty_news:episodes', from: '2026-10-01', to: '2026-10-31' }); assert.equal(e.length, 1);
  for (const f of ENTRY_FIELDS) assert.ok(f in e[0], f); assert.equal(e[0].project.namespace, 'moonkatty_news'); assert.equal(e[0].project.slug, 'episodes'); assert.equal(typeof e[0].amount, 'string');
  assert.ok(['actual', 'estimate', 'forecast'].includes(e[0].kind));
});
test('si_cost_entries mapping: amountUsd = amount (USD only), component=category, idempotencyKey preserved', () => {
  const l = createLedger({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'mc-')) }); l.add({ kind: 'actual', direction: 'expense', amount: '2.50', currency: 'USD', date: '2026-10-02', category: 'api_cost', proof: { type: 'invoice', ref: 'INV-1' }, projectId: 'moonkatty_project:games', idempotencyKey: 'moonkatty_project:games/inv-1' });
  const e = l.listEntries({ direction: 'expense' })[0]; const si = { namespace: e.project.namespace, component: e.category, amountUsd: +e.amount, idempotencyKey: e.idempotencyKey, at: e.date + 'T00:00:00Z' };
  assert.deepEqual(si, { namespace: 'moonkatty_project', component: 'api_cost', amountUsd: 2.5, idempotencyKey: 'moonkatty_project:games/inv-1', at: '2026-10-02T00:00:00Z' }); assert.match(si.idempotencyKey, /^[A-Za-z0-9:._/-]{1,400}$/);
});
