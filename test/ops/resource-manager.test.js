'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createResourceManager, classOf } = require('../../lib/ops/resource-manager.js');
const GB = 1024 ** 3;
const T = (id, o = {}) => ({ id, title: id, status: 'queued', priority: 'normal', agentId: 'social', ...o });
test('resource classes', () => {
  assert.equal(classOf(T('a')), 'light'); assert.equal(classOf(T('a', { agentId: 'design3d' })), 'render'); assert.equal(classOf(T('a', { agentId: 'video' })), 'video');
  assert.equal(classOf(T('a', { resourceClass: 'llm-large' })), 'llm-large'); assert.equal(classOf(T('a', { resourceClass: 'bogus' })), 'light');
});
test('concurrency limits + release; urgent light gets extra slots', () => {
  const rm = createResourceManager({ fetchFn: async () => { throw new Error('off'); } });
  assert.ok(rm.admit(T('r1', { resourceClass: 'render' })).ok); assert.equal(rm.admit(T('r2', { resourceClass: 'render' })).ok, false);
  rm.release('r1'); assert.ok(rm.admit(T('r2', { resourceClass: 'render' })).ok);
  for (let i = 0; i < 4; i++) assert.ok(rm.admit(T('l' + i)).ok); assert.equal(rm.admit(T('l9')).ok, false);
  assert.ok(rm.admit(T('u1', { priority: 'urgent' })).ok);
});
test('llm-large and render are mutually exclusive; RAM budget 18 GB', () => {
  const rm = createResourceManager({ fetchFn: async () => { throw new Error('off'); } });
  assert.ok(rm.admit(T('l', { resourceClass: 'llm-large' })).ok); const d = rm.admit(T('r', { resourceClass: 'render' }));
  assert.equal(d.ok, false); assert.match(d.reason, /несовместим/);
  assert.ok(rm.admit(T('v', { resourceClass: 'video' })).ok, '10+6 ≤ 18');
  rm.release('v'); rm.release('l'); assert.ok(rm.admit(T('r', { resourceClass: 'render' })).ok); assert.ok(rm.admit(T('v', { resourceClass: 'video' })).ok);
  assert.equal(rm.admit(T('l2', { resourceClass: 'llm-large' })).ok, false);
});
test('low real available RAM blocks heavy tasks', async () => {
  const rm = createResourceManager({ fetchFn: async () => ({ ok: true, json: async () => ({ models: [] }) }), memInfo: async () => ({ available: 5 * GB }) });
  await rm.refresh(); const d = rm.admit(T('r', { resourceClass: 'render' })); assert.equal(d.ok, false); assert.match(d.reason, /мало свободной RAM/);
  assert.ok(rm.admit(T('x')).ok, 'light still allowed');
});
test('Ollama /api/ps counted; unload via keep_alive:0 only when enabled', async () => {
  let models = [{ name: 'qwen3:32b', size_vram: 14 * GB }]; const calls = [];
  const fetchFn = async (url, o) => { calls.push([url, o && o.body]);
    if (url.endsWith('/api/ps')) return { ok: true, json: async () => ({ models }) };
    if (url.endsWith('/api/generate')) { models = []; return { ok: true, status: 200 }; } throw new Error(url); };
  let rm = createResourceManager({ fetchFn }); await rm.refresh(); assert.equal(rm.status().ollama.totalGB, 14);
  let d = rm.admit(T('r', { resourceClass: 'render' })); assert.equal(d.ok, false); assert.ok(d.needUnload);
  assert.equal(calls.filter(c => c[0].endsWith('/api/generate')).length, 0, 'disabled: no unload');
  rm = createResourceManager({ fetchFn, unloadOllama: true }); await rm.refresh(); rm.admit(T('r', { resourceClass: 'render' }));
  await new Promise(r => setTimeout(r, 20)); const g = calls.filter(c => c[0].endsWith('/api/generate'));
  assert.equal(g.length, 1); assert.deepEqual(JSON.parse(g[0][1]), { model: 'qwen3:32b', keep_alive: 0 });
  assert.ok(rm.admit(T('r', { resourceClass: 'render' })).ok, 'admitted after unload');
});
test('render queue: urgent first, then priority, then FIFO; light excluded', () => {
  const rm = createResourceManager({}); const q = rm.renderQueue([T('a', { agentId: 'video', createdAt: '1' }), T('b', { agentId: 'design3d', priority: 'urgent', createdAt: '3' }),
    T('c', { agentId: 'video', priority: 'high', createdAt: '2' }), T('d', { createdAt: '0' }), T('e', { agentId: 'video', status: 'done' })]);
  assert.deepEqual(q.map(t => t.id), ['b', 'c', 'a']);
});
test('temp cleanup touches only own marked dirs inside tmpRoot (quota + TTL)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-')); const root = path.join(base, 'tmp'); let t = 1e12;
  const outside = path.join(base, 'user-data'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'x');
  const rm = createResourceManager({ tmpRoot: root, now: () => t });
  const a = rm.tempDir('old'); fs.writeFileSync(path.join(a, 'f'), Buffer.alloc(1000)); t += 49 * 3600000;
  const b = rm.tempDir('../../escape'); assert.ok(b.startsWith(root + path.sep));
  const c = rm.tempDir('active'); const foreign = path.join(root, 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'x'), 'x');
  fs.symlinkSync(outside, path.join(root, 'link'));
  const r = rm.cleanupTemp({ quotaGB: 20, ttlHours: 48, active: ['active'] });
  assert.deepEqual(r.removed, ['old']); assert.ok(fs.existsSync(b) && fs.existsSync(c) && fs.existsSync(foreign) && fs.existsSync(path.join(outside, 'keep.txt')));
  const r2 = rm.cleanupTemp({ quotaGB: 0, ttlHours: 48, active: ['active'] }); assert.deepEqual(r2.removed, [path.basename(b)]);
  assert.ok(fs.existsSync(c) && fs.existsSync(foreign) && fs.existsSync(path.join(outside, 'keep.txt')));
});
