'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const { startServer } = require('../helpers/server.js');
test('GET /api/ops/ledger (stable read API): owner only, empty state, separation; flag off → 404', { timeout: 60000 }, async () => {
  const s = await startServer({ port: 18950 + (process.pid % 40), env: { STUDIO_OPS_MONEY: '1', STUDIO_OPS_MOBILE: '1' } });
  try {
    assert.equal((await s.j('GET', '/api/ops/ledger', s.R)).status, 401);
    let r = await s.j('GET', '/api/ops/ledger', s.A); assert.equal(r.status, 200); assert.deepEqual([r.body.empty, r.body.entries.length, r.body.apiVersion], [true, 0, 1]); assert.deepEqual(r.body.totals, {});
    assert.equal((await s.j('POST', '/api/ops/ledger', s.A, { kind: 'actual', direction: 'income', amount: '10', currency: 'USD', date: '2026-10-01', category: 'client' })).status, 400, 'no proof');
    assert.equal((await s.j('POST', '/api/ops/ledger', s.A, { kind: 'actual', direction: 'income', amount: '10', currency: 'USD', date: '2026-10-01', category: 'client', proof: { type: 'invoice', ref: 'INV-1' }, projectId: 'moonkatty_project:mkty' })).status, 200);
    await s.j('POST', '/api/ops/ledger', s.A, { kind: 'forecast', direction: 'income', amount: '99', currency: 'USD', date: '2026-12-01', category: 'client', basis: 'план' });
    r = await s.j('GET', '/api/ops/ledger?kind=actual&projectId=moonkatty_project:mkty', s.A); assert.equal(r.body.entries.length, 1); assert.deepEqual(r.body.totals, { actual: { income: { USD: '10.00' } } });
    const tok = (await s.j('POST', '/api/ops/mobile-tokens', s.A, { label: 't', ttlDays: 1 })).body.token; assert.equal((await s.j('GET', '/api/ops/ledger', { ...s.R, authorization: 'Bearer ' + tok })).status, 401, 'mobile token has no money access');
    assert.equal((await s.j('GET', '/api/ops/monetization/adapters', s.A)).body.every(a => a.connected === false), true);
  } finally { await s.cleanup(); }
  const s2 = await startServer({ port: 18995 }); try { assert.notEqual((await s2.j('GET', '/api/ops/ledger', s2.A)).status, 200); } finally { await s2.cleanup(); }
});
