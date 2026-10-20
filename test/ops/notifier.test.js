'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { makeNotifier } = require('../../lib/ops/notifier.js');
test('disabled by default — no network', async () => {
  let called = 0; const n = makeNotifier({}, { fetchFn: async () => { called++; } });
  assert.equal(n.enabled, false); assert.equal((await n.notify({ title: 't' })).skipped, 'disabled'); assert.equal(called, 0);
});
test('ntfy: https only, dedupe, redaction', async () => {
  const calls = []; let t = 0;
  const n = makeNotifier({ OPS_NOTIFY: 'ntfy', OPS_NTFY_URL: 'https://ntfy.example/topic' }, { now: () => t, fetchFn: async (u, o) => { calls.push({ u, o }); return { ok: true, status: 200 }; } });
  await n.notify({ key: 'a', title: 'down', body: 'token=supersecretvalue1234' }); await n.notify({ key: 'a', title: 'down' });
  assert.equal(calls.length, 1); assert.doesNotMatch(calls[0].o.body, /supersecret/);
  t = 31 * 60000; await n.notify({ key: 'a', title: 'down' }); assert.equal(calls.length, 2);
  const bad = makeNotifier({ OPS_NOTIFY: 'ntfy', OPS_NTFY_URL: 'http://x' }, { fetchFn: async () => { throw new Error('must not call'); } });
  assert.equal((await bad.notify({ title: 'x' })).ok, false);
});
test('telegram requires config; unknown kind throws', async () => {
  assert.equal((await makeNotifier({ OPS_NOTIFY: 'telegram' }).notify({ title: 'x' })).ok, false);
  assert.throws(() => makeNotifier({ OPS_NOTIFY: 'sms' }));
});
