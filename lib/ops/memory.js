// Memory statistics computed like macOS Activity Monitor (os.freemem() on macOS reports only "Pages free",
// which ignores reclaimable cache — that is why the panel showed ~95% while Activity Monitor showed ~67%).
//   App        = anonymous (internal) pages − purgeable
//   Wired      = wired pages
//   Compressed = pages occupied by compressor
//   Used       = App + Wired + Compressed
//   Cached     = file-backed (external) pages + purgeable
// Total: sysctl hw.memsize. Swap: sysctl vm.swapusage. Pressure: sysctl kern.memorystatus_vm_pressure_level (1/2/4).
// Linux fallback: /proc/meminfo MemAvailable + PSI /proc/pressure/memory.
'use strict';
const fs = require('fs'), os = require('os');
const { run } = require('./probes.js');
const MB = 1024 ** 2;
function parseVmStat(txt) {
  const ps = +(/page size of (\d+) bytes/.exec(txt) || [0, 16384])[1];
  const g = k => { const m = new RegExp('^' + k.replace(/[()]/g, '\\$&') + ':\\s+(\\d+)', 'm').exec(txt); return m ? +m[1] : 0; };
  return { pageSize: ps, free: g('Pages free'), active: g('Pages active'), inactive: g('Pages inactive'), speculative: g('Pages speculative'), wired: g('Pages wired down'),
    purgeable: g('Pages purgeable'), anonymous: g('Anonymous pages'), fileBacked: g('File-backed pages'), compressor: g('Pages occupied by compressor') };
}
function parseSwap(txt) { // "total = 1024.00M  used = 29.25M  free = 994.75M  (encrypted)"
  const m = k => { const r = new RegExp(k + '\\s*=\\s*([\\d.]+)([KMG])').exec(txt); return r ? +r[1] * { K: 1024, M: MB, G: 1024 * MB }[r[2]] : 0; };
  return { total: m('total'), used: m('used'), free: m('free') };
}
const PRESSURE = { 1: 'green', 2: 'yellow', 4: 'red' };
function macStats({ vmstat, memsize, swapusage, pressureLevel }) {
  const v = parseVmStat(vmstat); const p = n => n * v.pageSize; const total = +memsize;
  const app = p(Math.max(0, v.anonymous - v.purgeable)), wired = p(v.wired), compressed = p(v.compressor);
  const used = app + wired + compressed, cached = p(v.fileBacked + v.purgeable);
  const sw = parseSwap(swapusage || '');
  return { source: 'darwin', total, used, app, wired, compressed, cached, free: p(v.free), available: Math.max(0, total - used),
    swapUsed: sw.used, swapTotal: sw.total, pressure: PRESSURE[+pressureLevel] || 'unknown', pressureLevel: +pressureLevel || null, usedPct: Math.round(used / total * 1000) / 10 };
}
function linuxStats({ meminfo, psi }) {
  const k = n => { const m = new RegExp('^' + n + ':\\s+(\\d+) kB', 'm').exec(meminfo); return m ? +m[1] * 1024 : 0; };
  const total = k('MemTotal'), available = k('MemAvailable') || k('MemFree'), used = total - available;
  const avg10 = psi ? +((/some avg10=([\d.]+)/.exec(psi) || [0, 0])[1]) : null;
  return { source: 'linux', total, used, app: k('AnonPages'), wired: k('Unevictable'), compressed: 0, cached: k('Cached') + k('Buffers'), free: k('MemFree'), available,
    swapUsed: k('SwapTotal') - k('SwapFree'), swapTotal: k('SwapTotal'), pressure: avg10 == null ? 'unknown' : avg10 < 10 ? 'green' : avg10 < 40 ? 'yellow' : 'red', pressureLevel: null, usedPct: Math.round(used / total * 1000) / 10 };
}
async function memoryStats({ platform = process.platform, exec = run, readFile = f => fs.readFileSync(f, 'utf8') } = {}) {
  if (platform === 'darwin') {
    const [vmstat, memsize, swapusage, pressureLevel] = await Promise.all([exec('/usr/bin/vm_stat', []), exec('/usr/sbin/sysctl', ['-n', 'hw.memsize']),
      exec('/usr/sbin/sysctl', ['-n', 'vm.swapusage']).catch(() => ''), exec('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']).catch(() => '')]);
    return macStats({ vmstat, memsize: String(memsize).trim(), swapusage, pressureLevel: String(pressureLevel).trim() });
  }
  try { let psi = null; try { psi = readFile('/proc/pressure/memory'); } catch {} return linuxStats({ meminfo: readFile('/proc/meminfo'), psi }); }
  catch { const total = os.totalmem(), free = os.freemem(); return { source: 'os', total, used: total - free, available: free, free, app: null, wired: null, compressed: null, cached: null, swapUsed: null, pressure: 'unknown', usedPct: Math.round((total - free) / total * 1000) / 10 }; }
}
// Sampler with cache + swap-growth tracking (for admission control).
function createMemorySampler({ stats = () => memoryStats(), windowMs = 5 * 60000, now = Date.now } = {}) {
  let last = null; const hist = [];
  async function sample() { try { last = { ...(await stats()), at: new Date(now()).toISOString() }; hist.push({ t: now(), swap: last.swapUsed || 0 }); while (hist.length && now() - hist[0].t > windowMs) hist.shift(); } catch (e) { last = last || { error: e.message }; } return last; }
  const swapGrowth = () => hist.length < 2 ? 0 : Math.max(0, hist[hist.length - 1].swap - Math.min(...hist.map(h => h.swap)));
  return { sample, get last() { return last; }, swapGrowth };
}
module.exports = { parseVmStat, parseSwap, macStats, linuxStats, memoryStats, createMemorySampler, PRESSURE };
