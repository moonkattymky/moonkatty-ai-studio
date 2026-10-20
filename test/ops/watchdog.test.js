'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createWatchdog, config } = require('../../lib/ops/watchdog.js');
const { stateFile } = require('../../lib/ops/state.js');
const GB = 1024 ** 3;
function harness({ env = {}, server = 'ok', ollama = true, procs = '', execFail = false } = {}) {
  let t = Date.parse('2026-10-21T10:00:00Z'); const execCalls = []; const notes = []; const kills = [];
  const fetchFn = async url => {
    if (url.endsWith('/api/health')) { if (server === 'down') throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
      return { ok: true, status: 200, json: async () => ({ version: '1.1.2', lastTick: new Date(t - (server === 'stale' ? 200000 : 10000)).toISOString() }) }; }
    if (url.endsWith('/api/tags')) { if (!ollama) throw new Error('refused'); return { ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen3:8b' }] }) }; }
    if (url.endsWith('/global/health')) return { ok: false, status: 401, json: async () => ({}) };
    if (url.endsWith('/api/mobile/summary')) return { ok: true, status: 200, json: async () => ({ tasks: { stuck: [{ id: 'x', minutes: 120 }] }, errors: { last10min: 3 } }) };
    throw new Error('unexpected ' + url);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-')); const store = stateFile(path.join(dir, 'st.json'));
  const cfg = config({ OPS_DATA_DIR: dir, OPS_OPENCODE_URL: 'http://127.0.0.1:4096', ...env });
  const mk = () => createWatchdog({ cfg, store, fetchFn, now: () => t, uid: () => 501,
    exec: async (cmd, args) => { execCalls.push([cmd, ...args]); if (execFail) throw new Error('kickstart failed'); return ''; },
    memInfo: async () => ({ total: 24 * GB, available: 8 * GB }), diskInfo: () => ({ total: 500 * GB, free: 100 * GB }),
    processes: async () => require('../../lib/ops/probes.js').parsePs('H\n' + procs), kill: (pid, sig) => kills.push([pid, sig]),
    notifier: { notify: async m => { notes.push(m); return { ok: true }; } } });
  return { mk, advance: ms => { t += ms; }, execCalls, notes, kills, store };
}
test('healthy cycle; OpenCode 401 counts as alive; state persisted', async () => {
  const h = harness(); const out = await h.mk().cycle();
  for (const k of ['server', 'ollama', 'opencode', 'memory', 'disk', 'processes']) assert.equal(out[k].ok, true, k);
  assert.equal(out.queue.skipped, true); assert.equal(h.store.load().cycles, 1);
});
test('stale scheduler tick (>90s) detected; alert only after failAfter consecutive failures', async () => {
  const h = harness({ server: 'stale' }); const wd = h.mk();
  let o = await wd.cycle(); assert.equal(o.server.ok, false); assert.match(o.server.detail, /tick/); assert.equal(h.notes.length, 0);
  o = await wd.cycle(); assert.equal(h.notes.length, 1); await wd.cycle(); assert.equal(h.notes.length, 1, 'no alert spam');
  assert.equal(h.execCalls.length, 0, 'restart disabled by default');
});
test('restart: bounded by backoff and circuit breaker (no infinite restarts)', async () => {
  const h = harness({ server: 'down', execFail: true, env: { OPS_WATCHDOG_RESTART: '1' } }); const wd = h.mk();
  for (let i = 0; i < 20; i++) { await wd.cycle(); h.advance(60000); }
  const kick = h.execCalls.filter(c => c[1] === 'kickstart');
  assert.ok(kick.length >= 1 && kick.length <= 3, 'attempts: ' + kick.length);
  assert.deepEqual(kick[0], ['/bin/launchctl', 'kickstart', '-k', 'gui/501/com.moonkatty.aistudio.server']);
  assert.equal(h.store.load().breakers['restart:server'].state, 'open');
  assert.ok(h.notes.some(n => /остановлено/.test(n.title)));
  for (let i = 0; i < 200; i++) { await wd.cycle(); h.advance(10 * 60000); }
  const total = h.execCalls.filter(c => c[1] === 'kickstart').length; assert.ok(total <= 5, 'threshold 3 + 2 half-open trials max, got ' + total);
  assert.equal(h.store.load().breakers['restart:server'].locked, true, 'locked → manual reset required');
});
test('hung process detection; kill only when enabled, SIGTERM, own user only', async () => {
  const me = os.userInfo().username;
  const procs = `101 ${me} 05:00:00 0.0 900000 /Applications/Blender.app/Contents/MacOS/Blender\n102 root 05:00:00 0.0 1 /usr/bin/ffmpeg\n103 ${me} 00:05 50 1 ffmpeg`;
  let h = harness({ procs }); let o = await h.mk().cycle();
  assert.equal(o.processes.ok, false); assert.equal(o.processes.hung.length, 1); assert.equal(o.processes.blender, 1); assert.equal(h.kills.length, 0);
  h = harness({ procs, env: { OPS_WATCHDOG_KILL_HUNG: '1' } }); await h.mk().cycle(); assert.deepEqual(h.kills, [[101, 'SIGTERM']]);
});
test('queue/error-rate check via scoped token; RAM/disk thresholds', async () => {
  const h = harness({ env: { OPS_WATCHDOG_TOKEN: 'mkm_x', OPS_MIN_FREE_RAM_GB: '10', OPS_MIN_FREE_DISK_GB: '200' } }); const o = await h.mk().cycle();
  assert.equal(o.queue.ok, false); assert.equal(o.queue.stuck.length, 1); assert.equal(o.memory.ok, false); assert.equal(o.disk.ok, false);
});
test('ollama down → alert, restart only if launchd label configured', async () => {
  const h = harness({ ollama: false, env: { OPS_WATCHDOG_RESTART: '1' } }); const wd = h.mk(); await wd.cycle(); await wd.cycle();
  assert.equal(h.execCalls.length, 0); assert.ok(h.notes.some(n => /ollama/.test(n.title)));
});
