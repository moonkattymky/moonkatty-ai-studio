// Host RAM for the dashboard. macOS os.freemem() is only "Pages free" and ignores inactive,
// speculative and purgeable pages, so a bar built from total-freemem overstates usage.
// Darwin: vm_stat free+inactive+speculative+purgeable. Linux: MemAvailable. Else os.freemem, labelled as such.
'use strict';
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');

const CACHE_MS = 15000;
const LABELS = {
  vm_stat: 'доступно: vm_stat free+inactive+speculative+purgeable',
  meminfo: 'доступно: MemAvailable',
  'os.freemem': 'os.freemem без кэша ОС, цифра завышает занятость'
};

function parseVmStat(text) {
  const src = String(text || '');
  const page = /page size of (\d+)/.exec(src);
  const pageSize = page ? +page[1] : 0;
  const pages = name => { const m = new RegExp(name + ':\\s+(\\d+)').exec(src); return m ? +m[1] : null; };
  const free = pages('Pages free'), inactive = pages('Pages inactive'), spec = pages('Pages speculative'), purge = pages('Pages purgeable');
  const found = free != null && pageSize > 0;
  const sum = (free || 0) + (inactive || 0) + (spec || 0) + (purge || 0);
  return { found, pageSize, bytes: found ? sum * pageSize : null };
}

function parseMeminfo(text) {
  const src = String(text || '');
  const avail = /MemAvailable:\s+(\d+)\s+kB/i.exec(src);
  const total = /MemTotal:\s+(\d+)\s+kB/i.exec(src);
  return { available: avail ? +avail[1] * 1024 : null, total: total ? +total[1] * 1024 : null };
}

function parsePressure(text) {
  const m = /System-wide memory free percentage:\s+(\d+)\s*%/.exec(String(text || ''));
  return m ? +m[1] : null;
}

function clamp(n, total) {
  if (n == null || !Number.isFinite(n)) return null;
  const v = Math.max(0, Math.round(n));
  return total && v > total ? total : v;
}

function execFileText(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 4000, maxBuffer: 1024 * 1024 }, (err, out) => err ? reject(err) : resolve(String(out)));
  });
}

async function snapshot(opts = {}) {
  const platform = opts.platform || process.platform;
  const exec = opts.exec || execFileText;
  const readFile = opts.readFile || (p => fs.readFileSync(p, 'utf8'));
  const osFree = opts.osFree != null ? opts.osFree : os.freemem();
  const osTotal = opts.osTotal != null ? opts.osTotal : os.totalmem();
  let memAvailable = null, memSource = 'os.freemem', memPressureFreePct = null;
  if (platform === 'darwin') {
    try {
      const parsed = parseVmStat(await exec('/usr/bin/vm_stat', []));
      if (parsed.found) { memAvailable = clamp(parsed.bytes, osTotal); memSource = 'vm_stat'; }
    } catch { /* fall through to os.freemem */ }
    try { memPressureFreePct = parsePressure(await exec('/usr/bin/memory_pressure', [])); } catch { memPressureFreePct = null; }
  } else if (platform === 'linux') {
    try {
      const parsed = parseMeminfo(readFile('/proc/meminfo'));
      if (parsed.available != null) { memAvailable = clamp(parsed.available, osTotal); memSource = 'meminfo'; }
    } catch { /* fall through */ }
  }
  if (memAvailable == null) memAvailable = clamp(osFree, osTotal);
  return { memTotal: osTotal, memAvailable, memOsFree: osFree, memSource, memLabel: LABELS[memSource], memPressureFreePct };
}

let cached = null, cachedAt = 0, pending = null;
function resetCache() { cached = null; cachedAt = 0; pending = null; }

async function liveSnapshot(opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  if (!opts.exec && !opts.readFile && cached && now - cachedAt < CACHE_MS) return cached;
  if (!opts.exec && !opts.readFile && pending) return pending;
  const run = snapshot(opts).then(s => { if (!opts.exec && !opts.readFile) { cached = s; cachedAt = now; } return s; });
  if (!opts.exec && !opts.readFile) pending = run.finally(() => { pending = null; });
  return opts.exec || opts.readFile ? run : pending;
}

module.exports = { snapshot, liveSnapshot, parseVmStat, parseMeminfo, parsePressure, LABELS, CACHE_MS, resetCache };
