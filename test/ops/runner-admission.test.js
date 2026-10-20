'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const core = require('../../public/core.js');
const createRunner = require('../../runner.js');
function store() { const d = {}; const col = c => (d[c] = d[c] || new Map());
  return { get: (c, id) => { const o = col(c).get(id); return o ? JSON.parse(JSON.stringify(o)) : null; }, put: (c, o) => { col(c).set(o.id, JSON.parse(JSON.stringify(o))); return o; }, list: c => [...col(c).values()].map(o => JSON.parse(JSON.stringify(o))) }; }
test('runner uses admit(): skips tasks that do not fit, releases after run', async () => {
  const s = store(); const admitted = [], released = [];
  s.put('agents', { id: 'analytics', name: 'A', role: 'r', enabled: true, status: 'working' });
  s.put('tasks', { id: 'big', title: 'big', agentId: 'analytics', status: 'queued', priority: 'urgent' });
  s.put('tasks', { id: 'small', title: 'small', agentId: 'analytics', status: 'queued', priority: 'normal' });
  const r = createRunner({ ...s, log: () => {}, core, meta: { tick: async () => {} }, dataDir: '/tmp', admit: t => { admitted.push(t.id); return { ok: t.id !== 'big' }; }, release: t => released.push(t.id) });
  r.tick(); await new Promise(x => setTimeout(x, 50));
  assert.deepEqual(admitted, ['big', 'small']); assert.equal(s.get('tasks', 'small').status, 'done'); assert.equal(s.get('tasks', 'big').status, 'queued'); assert.deepEqual(released, ['small']);
});
test('runner without admit behaves as before (first by priority)', async () => {
  const s = store(); s.put('agents', { id: 'analytics', name: 'A', role: 'r', enabled: true, status: 'working' });
  s.put('tasks', { id: 'x', title: 'x', agentId: 'analytics', status: 'queued', priority: 'low' }); s.put('tasks', { id: 'y', title: 'y', agentId: 'analytics', status: 'queued', priority: 'urgent' });
  const r = createRunner({ ...s, log: () => {}, core, meta: { tick: async () => {} }, dataDir: '/tmp' }); r.tick(); await new Promise(x => setTimeout(x, 50));
  assert.equal(s.get('tasks', 'y').status, 'done'); assert.equal(s.get('tasks', 'x').status, 'queued');
});
