'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const M = require('../../lib/ops/memory.js');
const FX = p => fs.readFileSync(path.join(__dirname, '..', 'fixtures', p), 'utf8'); const GiB = 1024 ** 3;
test('macOS stats match Activity Monitor (Igor: 24 GB, Used 16.19, App 12.32, Cached 7.57, Compressed 747.7 MB, Swap 29.3 MB)', async () => {
  const exec = async (cmd, args) => { if (cmd === '/usr/bin/vm_stat') return FX('vm_stat-igor-24gb.txt');
    if (args.includes('hw.memsize')) return String(24 * GiB); if (args.includes('vm.swapusage')) return FX('swapusage-igor.txt'); if (args.includes('kern.memorystatus_vm_pressure_level')) return '1'; throw new Error(cmd); };
  const s = await M.memoryStats({ platform: 'darwin', exec });
  const near = (v, want, tol = 0.02) => assert.ok(Math.abs(v / GiB - want) <= tol, `${(v / GiB).toFixed(3)} ≈ ${want}`);
  near(s.total, 24); near(s.used, 16.19); near(s.app, 12.32); near(s.cached, 7.57); near(s.compressed, 747.7 / 1024);
  assert.ok(Math.abs(s.swapUsed / 1024 ** 2 - 29.25) < 0.1); assert.equal(s.pressure, 'green'); assert.ok(Math.abs(s.usedPct - 67.5) < 0.3, String(s.usedPct));
  const freeOnly = 1 - M.parseVmStat(FX('vm_stat-igor-24gb.txt')).free * 16384 / (24 * GiB); assert.ok(freeOnly > 0.95, 'old os.freemem()-style calc showed ~99% — the bug');
});
test('pressure levels and swap parsing', () => {
  assert.equal(M.PRESSURE[2], 'yellow'); assert.equal(M.PRESSURE[4], 'red');
  assert.deepEqual(M.parseSwap('total = 2048.00M  used = 1.50G  free = 512.00M  (encrypted)'), { total: 2048 * 1024 ** 2, used: 1.5 * GiB, free: 512 * 1024 ** 2 });
});
test('Linux fallback: MemAvailable + PSI', async () => {
  const meminfo = 'MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:    9000000 kB\nBuffers:          100000 kB\nCached:          5000000 kB\nSwapTotal:       2000000 kB\nSwapFree:        1500000 kB\nAnonPages:       6000000 kB\n';
  const s = await M.memoryStats({ platform: 'linux', readFile: f => f.endsWith('meminfo') ? meminfo : 'some avg10=45.00 avg60=1 avg300=1 total=1' });
  assert.equal(s.used, 7000000 * 1024); assert.equal(s.swapUsed, 500000 * 1024); assert.equal(s.pressure, 'red');
});
test('sampler tracks swap growth window', async () => {
  let t = 0, sw = 0; const s = M.createMemorySampler({ stats: async () => ({ swapUsed: sw }), now: () => t });
  await s.sample(); t = 1000; sw = 500; await s.sample(); assert.equal(s.swapGrowth(), 500); t = 10 * 60000; await s.sample(); assert.equal(s.swapGrowth(), 0);
});
