// Host checks. macOS commands and Linux equivalents. Parsers are pure; the
// live path runs the allowlisted command or reads /proc and /sys.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net');
const exec = require('../exec');
const { LISTEN_PORTS } = require('../registry');
const { redact } = require('../redact');

const PROTECTED_PORTS = new Set(['8787', '8687', '4096']);
const PROC_ALLOW = new Set(['ollama', 'blender', 'opencode', 'Tailscale', 'node']);

function row(id, status, summary, data) {
  return { id, status, summary, data: data || {} };
}

function parseDf(text) {
  const lines = String(text || '').trim().split(/\n/).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  const parts = last.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const blocks = +parts[1], used = +parts[2], avail = +parts[3];
  if (!Number.isFinite(blocks) || blocks <= 0) return null;
  return { filesystem: parts[0], blocks, used, avail, capacity: parts[4], mount: parts[5], freeBytes: avail * 1024, totalBytes: blocks * 1024 };
}

function parseMeminfo(text) {
  const num = name => { const m = new RegExp('^' + name + ':\\s+(\\d+)', 'm').exec(String(text || '')); return m ? +m[1] * 1024 : null; };
  return { total: num('MemTotal'), available: num('MemAvailable'), swapTotal: num('SwapTotal'), swapFree: num('SwapFree') };
}

function parsePs(text) {
  const out = [];
  for (const line of String(text || '').split(/\n/)) {
    const t = line.trim(); if (!t) continue;
    const m = /^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/.exec(t);
    if (!m) continue;
    const comm = m[6].trim();
    const base = path.basename(comm).split(':')[0];
    out.push({ pid: +m[1], ppid: +m[2], rssKb: +m[3], cpu: +m[4], etime: m[5], comm: base, raw: comm });
  }
  return out;
}

function parseLoadavg(text) {
  const p = String(text || '').trim().split(/\s+/);
  if (p.length < 3) return null;
  const a = p.slice(0, 3).map(Number);
  if (a.some(n => !Number.isFinite(n))) return null;
  return a;
}

function assessDisk({ totalBytes, freeBytes, quotaBytes, usedBytes }) {
  if (quotaBytes != null) {
    const used = usedBytes || 0;
    const free = quotaBytes - used;
    const status = free <= 0 ? 'FAIL' : free < quotaBytes * 0.1 ? 'WARN' : 'OK';
    return { status, totalBytes: quotaBytes, freeBytes: Math.max(0, free), usedBytes: used, quota: true };
  }
  if (!totalBytes) return { status: 'BLOCKED', totalBytes: null, freeBytes: null };
  const pct = freeBytes / totalBytes;
  const status = pct < 0.05 ? 'FAIL' : pct < 0.10 ? 'WARN' : 'OK';
  return { status, totalBytes, freeBytes, usedPct: Math.round((1 - pct) * 1000) / 10 };
}

function dirSize(dir) {
  let n = 0;
  const walk = d => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else n += st.size;
    }
  };
  walk(dir);
  return n;
}

function readThermal() {
  const root = '/sys/class/thermal';
  if (process.platform !== 'linux') return null;
  if (!fs.existsSync(root)) return null;
  const zones = [];
  for (const name of fs.readdirSync(root)) {
    if (!/^thermal_zone\d+$/.test(name)) continue;
    try {
      const raw = fs.readFileSync(path.join(root, name, 'temp'), 'utf8').trim();
      const milli = +raw;
      if (!Number.isFinite(milli)) continue;
      let label = name;
      try { label = fs.readFileSync(path.join(root, name, 'type'), 'utf8').trim() || name; } catch { /* type is optional */ }
      zones.push({ zone: name, type: label, celsius: Math.round(milli / 100) / 10 });
    } catch { /* zone unreadable */ }
  }
  return zones;
}

function tcpOpen(port, host = '127.0.0.1', timeoutMs = 250) {
  return new Promise(resolve => {
    const s = net.connect({ port: +port, host });
    let done = false;
    const fin = v => { if (done) return; done = true; try { s.destroy(); } catch { /* closed */ } resolve(v); };
    s.setTimeout(timeoutMs);
    s.on('connect', () => fin(true));
    s.on('timeout', () => fin(false));
    s.on('error', () => fin(false));
  });
}

async function cpu(ctx) {
  const load = os.loadavg();
  const logical = os.cpus().length;
  if (process.platform === 'darwin') {
    const n = await exec.run('cpu.ncpu', ctx);
    const brand = await exec.run('cpu.brand', ctx);
    if (n.status === 'BLOCKED') return row('cpu', 'BLOCKED', 'sysctl недоступен в этой среде', { load, logical });
    const cores = parseInt(String(n.stdout).trim(), 10);
    const hot = load[0] > (cores || logical) * 2;
    return row('cpu', hot ? 'WARN' : 'OK', (brand.stdout || '').trim().slice(0, 120) || (cores + ' CPU'), { cores, brand: (brand.stdout || '').trim(), load, logical });
  }
  const n = await exec.run('cpu.nproc', ctx);
  if (n.status === 'BLOCKED') return row('cpu', 'BLOCKED', 'nproc недоступен', { load, logical });
  const cores = parseInt(String(n.stdout).trim(), 10) || logical;
  let model = '';
  try {
    const info = fs.readFileSync('/proc/cpuinfo', 'utf8');
    const m = /^model name\s*:\s*(.+)$/m.exec(info);
    model = m ? m[1].trim() : '';
  } catch { /* no cpuinfo */ }
  const hot = load[0] > cores * 2;
  return row('cpu', hot ? 'WARN' : 'OK', model ? `${cores} × ${model}` : `${cores} CPU`, { cores, model, load, logical });
}

async function memory(ctx) {
  if (process.platform === 'darwin') {
    const vm = await exec.run('mem.vmstat', ctx);
    if (vm.status === 'BLOCKED') return row('ram', 'BLOCKED', 'vm_stat недоступен на этой машине', {});
    let pressure = null;
    try { const p = await exec.run('mem.pressure', ctx); const m = /System-wide memory free percentage:\s+(\d+)/.exec(p.stdout || ''); pressure = m ? +m[1] : null; } catch { pressure = null; }
    const host = ctx.hostMem ? await ctx.hostMem.snapshot({ platform: 'darwin', exec: async (cmd, args) => (await exec.run(cmd.endsWith('vm_stat') ? 'mem.vmstat' : 'mem.pressure', ctx)).stdout }).catch(() => null) : null;
    return row('ram', 'OK', 'vm_stat прочитан', { preview: (vm.stdout || '').split('\n').slice(0, 4).join(' | ').slice(0, 300), pressure, host });
  }
  let text = '';
  try { text = fs.readFileSync('/proc/meminfo', 'utf8'); } catch { return row('ram', 'BLOCKED', '/proc/meminfo недоступен', {}); }
  const parsed = parseMeminfo(text);
  if (parsed.available == null || !parsed.total) return row('ram', 'FAIL', 'MemAvailable не прочитан', parsed);
  const pct = parsed.available / parsed.total;
  const status = pct < 0.05 ? 'FAIL' : pct < 0.10 ? 'WARN' : 'OK';
  return row('ram', status, `доступно ${Math.round(pct * 100)}%`, parsed);
}

async function swap(ctx) {
  if (process.platform === 'darwin') {
    const r = await exec.run('mem.swap', ctx);
    if (r.status === 'BLOCKED') return row('swap', 'BLOCKED', 'vm.swapusage недоступен', {});
    return row('swap', 'OK', (r.stdout || '').trim().slice(0, 200) || 'swap прочитан', { raw: (r.stdout || '').trim().slice(0, 300) });
  }
  let text = '';
  try { text = fs.readFileSync('/proc/meminfo', 'utf8'); } catch { return row('swap', 'BLOCKED', '/proc/meminfo недоступен', {}); }
  const parsed = parseMeminfo(text);
  if (!parsed.swapTotal) return row('swap', 'OK', 'swap не настроен', { swapTotal: 0, swapFree: 0 });
  const used = parsed.swapTotal - (parsed.swapFree || 0);
  const pct = used / parsed.swapTotal;
  return row('swap', pct > 0.5 ? 'WARN' : 'OK', `занято ${Math.round(pct * 100)}%`, { swapTotal: parsed.swapTotal, swapFree: parsed.swapFree, used });
}

async function disk(ctx) {
  if (ctx.quotaBytes != null && ctx.quotaDir) {
    const used = dirSize(ctx.quotaDir);
    const a = assessDisk({ quotaBytes: ctx.quotaBytes, usedBytes: used });
    return row('disk', a.status, a.freeBytes <= 0 ? 'Квота временного диска исчерпана' : 'Квота временного диска', a);
  }
  let stat = null;
  const target = ctx.diskPath || '/';
  try { const st = fs.statfsSync(target); stat = { totalBytes: st.blocks * st.bsize, freeBytes: st.bavail * st.bsize }; } catch { stat = null; }
  const df = await exec.run('disk.df', ctx);
  const parsed = df.status === 'OK' || df.stdout ? parseDf(df.stdout) : null;
  const base = stat || (parsed ? { totalBytes: parsed.totalBytes, freeBytes: parsed.freeBytes } : null);
  if (!base) return row('disk', 'BLOCKED', 'Не удалось прочитать диск', { df: df.status });
  const a = assessDisk(base);
  return row('disk', a.status, `свободно ${Math.round((base.freeBytes / base.totalBytes) * 100)}%`, { ...a, df: parsed, mount: target });
}

async function temperature() {
  if (process.platform === 'darwin') {
    const r = await exec.run('temp.therm', {});
    if (r.status === 'BLOCKED') return row('temp', 'BLOCKED', 'pmset недоступен (нужен Mac)', {});
    return row('temp', 'OK', (r.stdout || '').trim().split('\n')[0].slice(0, 160) || 'pmset therm', { raw: (r.stdout || '').slice(0, 500) });
  }
  const zones = readThermal();
  if (!zones || !zones.length) return row('temp', 'BLOCKED', 'Датчик температуры недоступен (/sys/class/thermal пуст)', { zones: zones || [] });
  const hot = zones.some(z => z.celsius >= 90);
  return row('temp', hot ? 'WARN' : 'OK', zones.map(z => `${z.type} ${z.celsius}°C`).join(', ').slice(0, 180), { zones });
}

async function processes(ctx) {
  const r = await exec.run('proc.ps', ctx);
  if (r.status === 'BLOCKED') return row('proc', 'BLOCKED', 'ps недоступен', {});
  const all = parsePs(r.stdout);
  const interesting = all.filter(p => PROC_ALLOW.has(p.comm));
  return row('proc', 'OK', `процессов в списке ${interesting.length}`, { processes: interesting.slice(0, 40), scanned: all.length });
}

async function ports(ctx) {
  const list = await Promise.all(LISTEN_PORTS.map(async port => {
    const r = await exec.run('port.lsof', { ...ctx, params: { port } });
    let listening = false;
    if (r.status === 'BLOCKED') listening = await tcpOpen(port);
    else listening = r.code === 0 && /\bLISTEN\b/.test(r.stdout || '');
    const httpForbidden = port === '4096';
    return { port: +port, listening, http: httpForbidden ? 'forbidden' : 'allowed' };
  }));
  return row('ports', 'OK', list.map(p => `${p.port}:${p.listening ? 'занят' : 'свободен'}`).join(' '), { ports: list });
}

async function pidsOnPort(port, ctx) {
  const r = await exec.run('port.lsof', { ...ctx, params: { port: String(port) } });
  if (!r.stdout) return [];
  const pids = new Set();
  for (const line of r.stdout.split(/\n/).slice(1)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length > 1 && /^\d+$/.test(parts[1])) pids.add(+parts[1]);
  }
  return [...pids];
}

async function logs(ctx) {
  let lines = [];
  if (typeof ctx.listLogs === 'function') {
    try { lines = ctx.listLogs() || []; } catch { lines = []; }
  }
  if (!lines.length && ctx.logFile && fs.existsSync(ctx.logFile)) {
    const text = fs.readFileSync(ctx.logFile, 'utf8').split(/\n/).slice(-80);
    lines = text.map(message => ({ level: 'info', source: 'file', message }));
  }
  const last = lines.slice(-80).map(l => ({
    at: l.at || null,
    level: l.level || 'info',
    source: l.source || '',
    message: redact(String(l.message || ''), ctx.sec).slice(0, 500)
  }));
  return row('logs', 'OK', `строк ${last.length}`, { lines: last });
}

async function quick(ctx) {
  const [c, ram, sw, dk, pr] = await Promise.all([cpu(ctx), memory(ctx), swap(ctx), disk(ctx), ports(ctx)]);
  let health = row('health', 'OK', 'SELECT 1', {});
  try {
    if (ctx.db) ctx.db.prepare('SELECT 1 AS ok').get();
    else health = row('health', 'BLOCKED', 'База не передана', {});
  } catch (e) { health = row('health', 'FAIL', e.message, {}); }
  return [c, ram, sw, dk, pr, health];
}

module.exports = {
  cpu, memory, swap, disk, temperature, processes, ports, logs, quick,
  parseDf, parseMeminfo, parsePs, parseLoadavg, assessDisk, dirSize, readThermal,
  PROC_ALLOW, PROTECTED_PORTS, pidsOnPort, tcpOpen
};
