'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { backoffDelay, retry, CircuitBreaker } = require('../../lib/ops/backoff.js');
test('exponential backoff is capped', () => {
  assert.equal(backoffDelay(0, { baseMs: 100 }), 100); assert.equal(backoffDelay(3, { baseMs: 100 }), 800);
  assert.equal(backoffDelay(30, { baseMs: 100, maxMs: 5000 }), 5000);
});
test('retry: bounded attempts with backoff sleeps', async () => {
  const sleeps = []; let n = 0;
  await assert.rejects(retry(async () => { n++; throw new Error('x'); }, { retries: 3, baseMs: 10, sleepFn: async ms => sleeps.push(ms) }), /x/);
  assert.equal(n, 4); assert.deepEqual(sleeps, [10, 20, 40]);
  n = 0; assert.equal(await retry(async () => { if (++n < 2) throw new Error('y'); return 'ok'; }, { sleepFn: async () => {} }), 'ok');
});
test('circuit breaker: opens, half-opens after cooldown, locks after maxTrips', () => {
  let t = 0; const b = new CircuitBreaker('x', { threshold: 2, cooldownMs: 100, maxTrips: 2, now: () => t });
  assert.ok(b.canAttempt()); assert.equal(b.failure(), false); assert.equal(b.failure(), true); assert.equal(b.state, 'open'); assert.ok(!b.canAttempt());
  t = 150; assert.equal(b.state, 'half-open'); b.success(); assert.equal(b.state, 'closed');
  b.failure(); b.failure(); assert.equal(b.toJSON().trips, 2); assert.equal(b.toJSON().locked, true);
  t = 1e9; assert.equal(b.state, 'open', 'locked breaker never half-opens → no infinite restarts');
  b.reset(); assert.equal(b.state, 'closed');
});
test('circuit breaker restores persisted state', () => {
  const b = new CircuitBreaker('x', { state: { state: 'open', openedAt: 0, trips: 3, locked: true, failures: [] }, now: () => 1e12 });
  assert.ok(!b.canAttempt());
});
