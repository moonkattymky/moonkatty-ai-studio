'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'); const { EventEmitter } = require('events');
const { createLoadTest, importCalibration, descendants, parsePsTree } = require('../../lib/ops/loadtest.js');
const GB = 1024 ** 3, MB = 1024 ** 2;
function sim({ pressureAt = null, swapJumpAt = null, durTicks = { blender: 3, ffmpeg: 2, ollama: 2 } } = {}) {
  let tick = 0, nextPid = 5000; const procs = new Map(); const killed = []; const spawned = [];
  const spawn = (cmd, args) => { const e = new EventEmitter(); e.pid = nextPid++; const name = /Blender/.test(cmd) ? 'blender' : 'ffmpeg';
    procs.set(e.pid, { pid: e.pid, ppid: 1, rssKb: (name === 'blender' ? 3 : 1) * 1024 * 1024, cpu: 300, comm: cmd, name, left: durTicks[name], e });
    const child = nextPid++; procs.set(child, { pid: child, ppid: e.pid, rssKb: 512 * 1024, cpu: 50, comm: 'helper', name: 'child' }); spawned.push({ cmd, args, pid: e.pid }); return e; };
  procs.set(42, { pid: 42, ppid: 1, rssKb: 6 * 1024 * 1024, cpu: 0, comm: '/Applications/Ollama.app/ollama', name: 'ollama-server' });
  procs.set(77, { pid: 77, ppid: 1, rssKb: 2 * 1024 * 1024, cpu: 0, comm: '/Applications/Safari.app/Safari', name: 'user' });
  let ollamaLeft = 0, ollamaResolve = null;
  const fetchFn = async (url, o) => { if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'qwen3:8b' }] }) };
    if (url.endsWith('/api/generate')) { ollamaLeft = durTicks.ollama; return new Promise((res, rej) => { ollamaResolve = () => res({ ok: true, json: async () => ({}) }); o.signal.addEventListener('abort', () => rej(new Error('aborted'))); }); } throw new Error(url); };
  const sleep = async () => { tick++;
    for (const p of [...procs.values()]) if (p.left != null) { p.left--; if (p.left <= 0) { procs.delete(p.pid); for (const c of [...procs.values()]) if (c.ppid === p.pid) procs.delete(c.pid); p.e.emit('exit', 0, null); } }
    if (ollamaResolve && --ollamaLeft <= 0) { const r = ollamaResolve; ollamaResolve = null; r(); } };
  const heavy = () => [...procs.values()].filter(p => p.name !== 'user' && p.name !== 'ollama-server').reduce((a, p) => a + p.rssKb * 1024, 0);
  const memStats = async () => ({ used: 8 * GB + heavy() + (ollamaResolve ? 1 * GB : 0), compressed: 0.5 * GB, swapUsed: (swapJumpAt != null && tick >= swapJumpAt ? 2000 : 30) * MB,
    pressure: pressureAt != null && tick >= pressureAt ? 'red' : 'green', total: 24 * GB });
  const processes = async () => [...procs.values()].map(({ pid, ppid, rssKb, cpu, comm }) => ({ pid, ppid, rssKb, cpu, comm }));
  const kill = (pid, sig) => { killed.push(pid); const p = procs.get(pid); if (p && p.e) { procs.delete(pid); p.e.emit('exit', null, sig); } else procs.delete(pid); };
  return { spawn, fetchFn, sleep, memStats, processes, kill, killed, spawned, exists: () => true, procs };
}
const out = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lt-'));
test('dry-run: spawns nothing, writes report into its own temp dir', async () => {
  const s = sim(); const dir = out(); const lt = createLoadTest({ ...s, outDir: dir, dryRun: true, cooldownMs: 0, log: () => {} });
  const r = await lt.run(); assert.equal(s.spawned.length, 0); assert.ok(r.report.results.every(x => x.skipped === 'dry-run')); assert.ok(fs.existsSync(path.join(dir, 'loadtest-report.md')));
  assert.throws(() => importCalibration(r.json, out()), /Dry-run/);
});
test('full run: solo + combos, peak RSS / pressure / swap / CPU sampled, calibration = peak × 1.2, import', async () => {
  const s = sim(); const dir = out(); const lt = createLoadTest({ ...s, outDir: dir, cooldownMs: 0, log: () => {} });
  const { report, json, md } = await lt.run();
  assert.deepEqual(report.results.map(r => r.scenario), ['ollama', 'blender', 'ffmpeg', 'ollama+ffmpeg', 'ollama+blender', 'blender+ffmpeg', 'ollama+blender+ffmpeg']);
  const bl = report.results[1]; assert.equal(bl.components.blender.state, 'done'); assert.equal(bl.components.blender.peakRssGB, 3.5, 'process + child tree');
  assert.ok(bl.peakCpuPct >= 350); assert.equal(bl.maxPressure, 'green'); assert.ok(report.results.every(r => r.safe));
  assert.equal(report.calibration.classes.render.limitGB, Math.ceil(3.5 * 1.2 * 10) / 10); assert.equal(report.calibration.classes['llm-large'].component, 'ollama');
  assert.ok(report.calibration.combos['ollama+blender+ffmpeg'].safe); assert.match(fs.readFileSync(md, 'utf8'), /Калибровка/);
  assert.ok(s.spawned.find(x => x.args.includes('testsrc2=size=3840x2160:rate=30')), 'ffmpeg testsrc encode'); assert.ok(s.spawned.find(x => x.args.includes('--factory-startup')));
  assert.equal(s.killed.length, 0, 'nothing killed on normal run'); assert.ok(s.procs.has(42) && s.procs.has(77), 'Ollama server and user processes untouched');
  const data = out(); const imp = importCalibration(json, data); assert.equal(fs.statSync(imp.file).mode & 0o777, 0o600);
  const { createResourceManager } = require('../../lib/ops/resource-manager.js'); const rm = createResourceManager({ calibrationFile: imp.file, fetchFn: async () => { throw 0; } });
  assert.equal(rm.status().mode, 'calibrated');
});
test('auto-abort on red pressure: kills only its own spawned tree, stops remaining scenarios', async () => {
  const s = sim({ pressureAt: 2, durTicks: { blender: 50, ffmpeg: 50, ollama: 50 } }); const lt = createLoadTest({ ...s, outDir: out(), cooldownMs: 0, only: ['blender'], log: () => {} });
  const { report } = await lt.run(); const r = report.results[0]; assert.match(r.aborted, /red/); assert.equal(r.components.blender.state, 'aborted'); assert.equal(r.safe, false);
  assert.ok(s.killed.length >= 1); assert.ok(s.killed.every(pid => pid >= 5000), 'never kills foreign pids: ' + s.killed); assert.ok(!s.killed.includes(42) && !s.killed.includes(77));
});
test('auto-abort on swap growth; Ollama request aborted (not killed)', async () => {
  const s = sim({ swapJumpAt: 2, durTicks: { blender: 50, ffmpeg: 50, ollama: 50 } }); const lt = createLoadTest({ ...s, outDir: out(), cooldownMs: 0, only: ['ollama'], swapAbortMB: 1024, log: () => {} });
  const { report } = await lt.run(); assert.match(report.results[0].aborted, /swap/); assert.equal(s.killed.length, 0); assert.ok(s.procs.has(42));
});
test('ps tree helpers', () => { const l = parsePsTree('1 0 10 0 launchd\n10 1 5 1 a\n11 10 5 1 b\n12 11 5 1 c\n13 1 5 1 d'); assert.deepEqual([...descendants(l, 10)].sort(), [10, 11, 12]); });
