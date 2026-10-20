'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const p = require('../../lib/ops/probes.js');
test('vm_stat parsing (macOS, mocked)', async () => {
  const txt = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:                               1000.\nPages active:  5.\nPages inactive:                           2000.\nPages speculative:                         500.\nPages purgeable: 100.\n';
  assert.equal(p.parseVmStat(txt), 3600 * 16384);
  const m = await p.memInfo({ platform: 'darwin', exec: async cmd => { assert.equal(cmd, '/usr/bin/vm_stat'); return txt; } });
  assert.equal(m.available, 3600 * 16384);
});
test('etime and ps parsing', () => {
  assert.equal(p.etimeToSec('05:03'), 303); assert.equal(p.etimeToSec('02:00:01'), 7201); assert.equal(p.etimeToSec('1-00:00:00'), 86400);
  const l = p.parsePs('H\n  12 igor 1-02:00:00  0.0 512000 /Applications/Blender.app/Contents/MacOS/Blender\n 13 root 00:10 1.0 100 launchd');
  assert.equal(l.length, 2); assert.equal(l[0].pid, 12); assert.equal(l[0].etimeSec, 93600); assert.match(l[0].comm, /Blender$/);
});
