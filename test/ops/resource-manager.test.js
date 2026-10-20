'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createResourceManager, classOf, validateCalibration } = require('../../lib/ops/resource-manager.js');
const GB = 1024 ** 3, MB = 1024 ** 2;
const T = (id, o = {}) => ({ id, title: id, status: 'queued', priority: 'normal', agentId: 'social', ...o });
const off = async () => { throw new Error('off'); };
const mem = (o = {}) => { const st = { available: 10 * GB, total: 24 * GB, pressure: 'green', swapUsed: 30 * MB, ...o }; return { st, fn: async () => ({ ...st }) }; };
const CAL = { measuredAt: '2026-10-21', machine: 'mac', classes: { 'llm-large': { peakGB: 6, limitGB: 7.2 }, render: { peakGB: 5, limitGB: 6 }, video: { peakGB: 2, limitGB: 2.4 } } };
test('resource classes', () => {
  assert.equal(classOf(T('a')), 'light'); assert.equal(classOf(T('a', { agentId: 'design3d' })), 'render'); assert.equal(classOf(T('a', { agentId: 'video' })), 'video');
  assert.equal(classOf(T('a', { resourceClass: 'llm-large' })), 'llm-large'); assert.equal(classOf(T('a', { resourceClass: 'bogus' })), 'light');
});
test('uncalibrated: footprints "unmeasured", max ONE heavy task at a time (no arbitrary GB limits)', async () => {
  const m = mem(); const rm = createResourceManager({ fetchFn: off, memInfo: m.fn }); await rm.refresh();
  assert.deepEqual(rm.status().footprints, { 'llm-large': 'unmeasured', render: 'unmeasured', video: 'unmeasured' }); assert.match(rm.status().mode, /uncalibrated/);
  const d = rm.admit(T('r', { resourceClass: 'render' })); assert.ok(d.ok); assert.equal(d.footprint, 'unmeasured');
  const v = rm.admit(T('v', { resourceClass: 'video' })); assert.equal(v.ok, false); assert.match(v.reason, /не более 1 тяжёлой/);
  assert.ok(rm.admit(T('l')).ok, 'light still allowed'); rm.release('r'); assert.ok(rm.admit(T('v', { resourceClass: 'video' })).ok);
});
test('heavy tasks never start unless pressure is green; swap growth blocks', async () => {
  const m = mem({ pressure: 'yellow' }); let t = 0; const rm = createResourceManager({ fetchFn: off, memInfo: m.fn, now: () => t }); await rm.refresh();
  let d = rm.admit(T('o', { resourceClass: 'llm-large' })); assert.equal(d.ok, false); assert.match(d.reason, /давление памяти: yellow/); assert.ok(rm.admit(T('l')).ok);
  m.st.pressure = 'green'; t = 1000; await rm.refresh(); m.st.swapUsed = 600 * MB; t = 2000; await rm.refresh();
  d = rm.admit(T('o', { resourceClass: 'llm-large' })); assert.equal(d.ok, false); assert.match(d.reason, /swap растёт/);
  t = 10 * 60000; await rm.refresh(); await rm.refresh(); assert.ok(rm.admit(T('o', { resourceClass: 'llm-large' })).ok, 'after window swap stable → allowed');
});
test('calibrated: admission by real available memory with measured limits (peak × 1.2)', async () => {
  const m = mem({ available: 12 * GB }); let t = 0; const rm = createResourceManager({ fetchFn: off, memInfo: m.fn, now: () => t }); rm.setCalibration(CAL); await rm.refresh();
  assert.equal(rm.status().mode, 'calibrated'); assert.ok(rm.admit(T('o', { resourceClass: 'llm-large' })).ok);
  const r = rm.admit(T('r', { resourceClass: 'render' })); assert.equal(r.ok, false, '12 - 7.2 pending - 6 < 2'); assert.match(r.reason, /мало памяти/);
  assert.ok(rm.admit(T('v', { resourceClass: 'video' })).ok, '12 - 7.2 - 2.4 = 2.4 ≥ 2');
  assert.equal(rm.admit(T('o2', { resourceClass: 'llm-large' })).ok, false, 'one per class');
});
test('Ollama unload only with explicit opt-in (never by default)', async () => {
  let models = [{ name: 'qwen3:14b', size_vram: 9 * GB }]; const calls = [];
  const fetchFn = async (url, o) => { calls.push(url); if (url.endsWith('/api/ps')) return { ok: true, json: async () => ({ models }) }; if (url.endsWith('/api/generate')) { models = []; return { ok: true, status: 200 }; } throw new Error(url); };
  const m = mem({ available: 4 * GB }); let rm = createResourceManager({ fetchFn, memInfo: m.fn }); rm.setCalibration(CAL); await rm.refresh();
  let d = rm.admit(T('r', { resourceClass: 'render' })); assert.equal(d.ok, false); assert.ok(d.needUnload); await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.filter(u => u.endsWith('/api/generate')).length, 0);
  rm = createResourceManager({ fetchFn, memInfo: m.fn, unloadOllama: true }); rm.setCalibration(CAL); await rm.refresh(); rm.admit(T('r', { resourceClass: 'render' })); await new Promise(r => setTimeout(r, 20));
  assert.equal(calls.filter(u => u.endsWith('/api/generate')).length, 1);
});
test('calibration file validation and loading', () => {
  assert.throws(() => validateCalibration({})); assert.throws(() => validateCalibration({ classes: { render: { peakGB: 5, limitGB: 4 } } }));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cal-')); const f = path.join(d, 'calibration.json'); fs.writeFileSync(f, JSON.stringify(CAL));
  const rm = createResourceManager({ fetchFn: off, calibrationFile: f }); assert.equal(rm.status().footprints.render.limitGB, 6);
});
test('light concurrency + urgent extra slots; render queue order', () => {
  const rm = createResourceManager({ fetchFn: off }); for (let i = 0; i < 4; i++) assert.ok(rm.admit(T('l' + i)).ok); assert.equal(rm.admit(T('l9')).ok, false); assert.ok(rm.admit(T('u', { priority: 'urgent' })).ok);
  const q = rm.renderQueue([T('a', { agentId: 'video', createdAt: '1' }), T('b', { agentId: 'design3d', priority: 'urgent', createdAt: '3' }), T('c', { agentId: 'video', priority: 'high', createdAt: '2' }), T('d', { createdAt: '0' })]);
  assert.deepEqual(q.map(t => t.id), ['b', 'c', 'a']);
});
test('temp cleanup touches only own marked dirs inside tmpRoot (quota + TTL)', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-')); const root = path.join(base, 'tmp'); let t = 1e12;
  const outside = path.join(base, 'user-data'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'keep.txt'), 'x');
  const rm = createResourceManager({ tmpRoot: root, now: () => t, fetchFn: off });
  const a = rm.tempDir('old'); fs.writeFileSync(path.join(a, 'f'), Buffer.alloc(1000)); t += 49 * 3600000;
  const b = rm.tempDir('../../escape'); assert.ok(b.startsWith(root + path.sep));
  const c = rm.tempDir('active'); const foreign = path.join(root, 'foreign'); fs.mkdirSync(foreign); fs.writeFileSync(path.join(foreign, 'x'), 'x'); fs.symlinkSync(outside, path.join(root, 'link'));
  assert.deepEqual(rm.cleanupTemp({ quotaGB: 20, ttlHours: 48, active: ['active'] }).removed, ['old']);
  assert.deepEqual(rm.cleanupTemp({ quotaGB: 0, ttlHours: 48, active: ['active'] }).removed, [path.basename(b)]);
  assert.ok(fs.existsSync(c) && fs.existsSync(foreign) && fs.existsSync(path.join(outside, 'keep.txt')));
});
