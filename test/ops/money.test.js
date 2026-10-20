'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'), os = require('os'), path = require('path');
const { createLedger } = require('../../lib/ops/ledger.js'); const { createDeals } = require('../../lib/ops/deals.js'); const M = require('../../lib/ops/monetization-adapters.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'money-')); const NOW = Date.parse('2026-10-21T12:00:00Z');
const mk = (o = {}) => { const alerts = []; const l = createLedger({ dir: tmp(), now: () => NOW, notify: async a => alerts.push(a), ...o }); return { l, alerts }; };
const A = (o = {}) => ({ kind: 'actual', direction: 'income', amount: '100.00', currency: 'USD', date: '2026-10-20', category: 'sponsor', proof: { type: 'bank_statement', ref: 'выписка 2026-10 стр.2' }, ...o });
test('empty state: no data → empty, no totals (no invented numbers)', () => { const { l } = mk(); const s = l.summary(); assert.equal(s.empty, true); assert.deepEqual(s.totals, {}); assert.deepEqual(l.listEntries(), []); });
test('actual requires proof; estimate/forecast require basis; future-dated actual refused; amounts validated', () => {
  const { l } = mk(); assert.throws(() => l.add(A({ proof: null })), /подтверждение/); assert.throws(() => l.add({ ...A(), kind: 'estimate', proof: null }), /basis/);
  assert.throws(() => l.add(A({ date: '2027-01-01' })), /forecast/); assert.throws(() => l.add(A({ amount: '-5' }))); assert.throws(() => l.add(A({ amount: '1.234' }))); assert.throws(() => l.add(A({ currency: 'usd$' })));
  assert.throws(() => l.add(A({ proof: { type: 'selfie', ref: 'x' } })), /proof.type/); assert.ok(l.add(A()).entry.id);
});
test('kinds never mixed in totals; currencies not converted; void excluded; idempotent', () => {
  const { l } = mk(); l.add(A()); l.add(A({ amount: '50', currency: 'EUR' })); l.add({ ...A(), kind: 'estimate', proof: null, basis: 'YouTube estimatedRevenue', amount: '999.99' }); l.add({ ...A(), kind: 'forecast', proof: null, basis: 'план Q4', amount: '5000', date: '2026-12-31' });
  const x = l.add(A({ direction: 'expense', category: 'software', amount: '20', idempotencyKey: 'inv-1' })); assert.equal(l.add(A({ direction: 'expense', category: 'software', amount: '20', idempotencyKey: 'inv-1' })).duplicate, true);
  const t = l.totals(); assert.deepEqual(t.actual, { income: { USD: '100.00', EUR: '50.00' }, expense: { USD: '20.00' } }); assert.deepEqual(t.estimate, { income: { USD: '999.99' } }); assert.deepEqual(t.forecast, { income: { USD: '5000.00' } });
  l.voidEntry(x.entry.id, 'ошибочная запись'); assert.equal(l.totals().actual.expense, undefined); assert.throws(() => l.voidEntry(x.entry.id, 'again'), /уже/); assert.equal(l.listEntries({ includeVoided: true }).length, 5);
});
test('projectId: Studio 5 format, pluggable resolver, unknown → unassigned (never dropped)', () => {
  const { l } = mk(); l.add(A({ projectId: 'moonkatty_project:games' })); l.add(A({ projectId: 'weird:thing', amount: '1' })); l.add(A({ amount: '2' }));
  const s = l.summary(); assert.ok(s.byProject['moonkatty_project:games']); assert.equal(s.byProject.unassigned.actual.income.USD, '3.00'); assert.equal(l.listEntries({ projectId: 'unassigned' }).length, 2);
  l.setResolver(pid => pid === 'weird:thing' ? { projectId: 'moonkatty_shared:misc', title: 'resolved' } : null); assert.equal(l.resolve('weird:thing').bucket, 'moonkatty_shared:misc'); assert.equal(l.resolve('moonkatty_news:episodes').namespace, 'moonkatty_news');
  l.setResolver(() => { throw new Error('si down'); }); assert.equal(l.resolve('moonkatty_project:mkty').bucket, 'unassigned', 'resolver failure → unassigned, entry kept');
});
test('CSV import: validation per row, dry-run, idempotent re-import, proof columns', () => {
  const { l } = mk(); const csv = 'kind,direction,amount,currency,date,category,proof_type,proof_ref,projectId,basis\nactual,income,10.50,USD,2026-10-01,sponsor,invoice,INV-7,moonkatty_project:ads,\nactual,income,5,USD,2026-10-02,sponsor,,,,\nestimate,income,"1,25",USD,2026-10-03,ad_revenue,,,moonkatty_project:youtube,YouTube Studio export\n';
  const d = l.importCsv(csv, { dryRun: true }); assert.equal(d.imported, 2); assert.equal(d.errors.length, 1); assert.equal(l.listEntries().length, 0);
  const r = l.importCsv(csv); assert.equal(r.imported, 2); assert.equal(r.errors[0].line, 3); assert.equal(l.importCsv(csv).duplicates, 2); assert.equal(l.totals().estimate.income.USD, '1.25');
});
test('hash chain: tampering detected → writes stopped + critical alert', () => {
  const { l, alerts } = mk(); l.add(A()); l.add(A({ amount: '7' })); const f = l.file; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"amountMinor":700', '"amountMinor":70000'));
  assert.equal(l.verify().ok, false); assert.throws(() => l.add(A()), /Целостность/); assert.ok(alerts.some(a => /повреждён/.test(a.title)));
});
test('budget overrun alert uses ACTUAL expenses only', () => {
  const { l, alerts } = mk(); l.setBudgets({ software: { monthly: 30, currency: 'USD' } }); l.add({ ...A(), kind: 'forecast', proof: null, basis: 'plan', direction: 'expense', category: 'software', amount: '500', date: '2026-10-25' });
  assert.equal(alerts.length, 0, 'forecast does not trigger'); l.add(A({ direction: 'expense', category: 'software', amount: '31' })); assert.ok(alerts.some(a => /Превышен бюджет/.test(a.title)));
});
test('Cost Controller rows shown read-only as estimates (no duplication)', () => {
  const costs = { entries: () => [{ at: '2026-10-20T10:00:00Z', service: 'tts', usd: 1.5 }] }; const { l } = mk({ costs }); const e = l.listEntries(); assert.equal(e.length, 1); assert.equal(e[0].kind, 'estimate'); assert.equal(e[0].readOnly, true); assert.equal(l.totals().actual, undefined);
});
test('deals: agreed amount is not income; received = linked actual entries; no secrets in contact', () => {
  const { l } = mk(); const d = createDeals({ dir: tmp(), ledger: l }); const s = d.create({ type: 'sponsor', name: 'Brand X', agreed: { amount: '300', currency: 'USD' }, placements: [{ platform: 'youtube', deliverable: 'интеграция 30 с', date: '2026-11-01' }], projectId: 'moonkatty_project:youtube' });
  assert.deepEqual(s.receivedActual, {}); assert.equal(l.summary().empty, true); assert.throws(() => d.create({ type: 'client', name: 'c', contact: 'password: 123' })); assert.throws(() => d.create({ type: 'partner', name: 'c' }));
  l.add(A({ dealId: s.id, amount: '150' })); assert.deepEqual(d.get(s.id).receivedActual, { USD: '150.00' }); assert.equal(d.update(s.id, { status: 'paid' }).status, 'paid');
});
test('monetization adapters: not connected by default; mocks return only fixtures as estimates; sync never creates actual', async () => {
  const reg = M.registry(); assert.deepEqual(Object.keys(reg).sort(), ['instagram', 'telegram', 'tiktok', 'x', 'youtube']); for (const a of Object.values(reg)) { assert.equal(a.status().connected, false); await assert.rejects(a.fetchRevenue(), /не подключено/); }
  assert.deepEqual(await new M.MockRevenueAdapter('youtube', []).fetchRevenue({}), []);
  const yt = new M.MockRevenueAdapter('youtube', [{ periodFrom: '2026-09-01', periodTo: '2026-09-30', amount: '12.34', currency: 'USD', projectId: 'moonkatty_project:youtube' }]); const est = await yt.fetchRevenue({ from: '2026-09-01' });
  assert.equal(est[0].kind, 'estimate'); const { l } = mk(); assert.deepEqual(M.syncToLedger(l, est), { added: 1, duplicates: 0 }); assert.deepEqual(M.syncToLedger(l, est), { added: 0, duplicates: 1 });
  assert.equal(l.totals().actual, undefined); assert.throws(() => M.syncToLedger(l, [{ ...est[0], kind: 'actual' }]));
});
