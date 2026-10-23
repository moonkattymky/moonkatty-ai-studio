// Fixed command registry. Callers pass an id and enum parameters only.
// Nothing from an LLM, a request body, or a log line is concatenated into argv.
'use strict';
const fs = require('fs');
const { doctorError } = require('./paths');

const BANNED_BIN = /^(sudo|su|osascript|security|spctl|xattr|rm|launchctl|curl|wget|ssh|scp|dd|bash|sh|zsh)$/i;
const BANNED_ARG = /\b(sudo|osascript|spctl|launchctl|xattr)\b|(?:^|\s)rm(?:\s|$)|tailscale\s+(up|down|set|serve|funnel)\b/i;
const LISTEN_PORTS = Object.freeze(['8787', '8687', '4097', '4096']);
const HTTP_PORTS = Object.freeze(['8787', '8687', '4097']); // 4096 is never an HTTP target

function firstExisting(bins) {
  for (const b of bins) if (typeof b === 'string' && b.startsWith('/') && fs.existsSync(b)) return b;
  return null;
}

function assertCommand(spec) {
  if (!spec || typeof spec.id !== 'string' || !spec.id) throw doctorError('FORBIDDEN', 'Пустая команда');
  const bins = spec.bins || (spec.bin ? [spec.bin] : []);
  if (!bins.length) throw doctorError('FORBIDDEN', 'Нет бинарника: ' + spec.id);
  for (const b of bins) {
    if (typeof b !== 'string' || !b.startsWith('/')) throw doctorError('FORBIDDEN', 'Бинарник должен быть абсолютным путём: ' + spec.id);
    const base = b.split('/').pop();
    if (BANNED_BIN.test(base)) throw doctorError('FORBIDDEN', 'Запрещённый бинарник: ' + base);
    if (/sudo/i.test(b)) throw doctorError('FORBIDDEN', 'sudo запрещён');
  }
  const args = spec.args || [];
  const joined = args.join(' ');
  if (BANNED_ARG.test(joined)) throw doctorError('FORBIDDEN', 'Запрещённые аргументы: ' + spec.id);
  if (spec.http && /4096/.test(joined)) throw doctorError('FORBIDDEN', 'HTTP к порту 4096 запрещён');
  if (spec.tailscale) {
    const ok = (args.length === 2 && args[0] === 'status' && args[1] === '--json') || (args.length === 1 && args[0] === 'version');
    if (!ok) throw doctorError('FORBIDDEN', 'Tailscale: разрешены только status --json и version');
  }
  if (spec.params) {
    for (const [name, allowed] of Object.entries(spec.params)) {
      if (name === 'path') continue;
      if (!Array.isArray(allowed) || !allowed.length) throw doctorError('FORBIDDEN', 'Параметр без enum: ' + name);
      if (allowed.some(v => typeof v !== 'string' || /[\s;&|$`<>]/.test(v))) throw doctorError('FORBIDDEN', 'Плохой enum: ' + name);
    }
  }
  return true;
}

const TS_BINS = ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'];
const LSOF_BINS = ['/usr/bin/lsof', '/usr/sbin/lsof'];

const COMMON = [
  { id: 'disk.df', bins: ['/usr/bin/df', '/bin/df'], args: ['-kP', '/'], maxTimeoutMs: 10000 },
  { id: 'port.lsof', bins: LSOF_BINS, args: ['-nP', '-sTCP:LISTEN'], params: { port: LISTEN_PORTS }, listenOnly: true, maxTimeoutMs: 8000,
    build(params) { return ['-nP', '-iTCP:' + params.port, '-sTCP:LISTEN']; } },
  { id: 'ts.status', bins: TS_BINS, args: ['status', '--json'], tailscale: true, maxTimeoutMs: 8000 },
  { id: 'ts.version', bins: TS_BINS, args: ['version'], tailscale: true, maxTimeoutMs: 8000 },
  // Fixed probes used by the engine tests. Not exposed over HTTP.
  { id: 'engine.sleep', bins: ['/bin/sleep'], args: ['1'], params: { seconds: ['1'] }, maxTimeoutMs: 5000,
    build(params) { return [params.seconds]; } },
  { id: 'engine.hang', bins: ['/bin/sleep'], args: ['30'], maxTimeoutMs: 15000 },
  { id: 'engine.seq', bins: ['/usr/bin/seq', '/bin/seq'], args: ['1', '200000'], maxTimeoutMs: 10000 },
  { id: 'engine.cat', bins: ['/bin/cat', '/usr/bin/cat'], args: [], params: { path: true }, maxTimeoutMs: 5000,
    build(params) { return [params.path]; } }
];

const LINUX = [
  ...COMMON,
  { id: 'cpu.nproc', bins: ['/usr/bin/nproc', '/bin/nproc'], args: [], maxTimeoutMs: 5000 },
  { id: 'proc.ps', bins: ['/usr/bin/ps', '/bin/ps'], args: ['-eo', 'pid=,ppid=,rss=,%cpu=,etime=,comm='], maxTimeoutMs: 8000 },
  { id: 'cpu.uname', bins: ['/usr/bin/uname', '/bin/uname'], args: ['-s'], maxTimeoutMs: 5000 }
];

const DARWIN = [
  ...COMMON,
  { id: 'cpu.ncpu', bins: ['/usr/sbin/sysctl'], args: ['-n', 'hw.ncpu'], maxTimeoutMs: 5000 },
  { id: 'cpu.brand', bins: ['/usr/sbin/sysctl'], args: ['-n', 'machdep.cpu.brand_string'], maxTimeoutMs: 5000 },
  { id: 'mem.vmstat', bins: ['/usr/bin/vm_stat'], args: [], maxTimeoutMs: 8000 },
  { id: 'mem.swap', bins: ['/usr/sbin/sysctl'], args: ['-n', 'vm.swapusage'], maxTimeoutMs: 5000 },
  { id: 'mem.pressure', bins: ['/usr/bin/memory_pressure'], args: ['-Q'], maxTimeoutMs: 8000 },
  { id: 'temp.therm', bins: ['/usr/bin/pmset'], args: ['-g', 'therm'], maxTimeoutMs: 8000 },
  { id: 'proc.ps', bins: ['/bin/ps'], args: ['-axo', 'pid=,ppid=,rss=,%cpu=,etime=,comm='], maxTimeoutMs: 8000 },
  // Read-only signature check. Never --sign, never spctl, never xattr -d.
  { id: 'sign.verify', bins: ['/usr/bin/codesign'], args: ['--verify', '--deep', '--strict'], params: { path: true }, maxTimeoutMs: 60000,
    build(params) { return ['--verify', '--deep', '--strict', params.path]; } },
  { id: 'ollama.pull', bins: ['/opt/homebrew/bin/ollama', '/usr/local/bin/ollama', '/usr/bin/ollama'], args: ['pull', 'qwen3:8b'], maxTimeoutMs: 300000 },
  { id: 'ollama.restart', bins: ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'], args: ['services', 'restart', 'ollama'], maxTimeoutMs: 60000 }
];

const BY_PLATFORM = { linux: LINUX, darwin: DARWIN };

function lintAll() {
  for (const list of Object.values(BY_PLATFORM)) for (const spec of list) assertCommand(spec);
  return { ok: true, platforms: Object.keys(BY_PLATFORM), commands: Object.values(BY_PLATFORM).reduce((n, l) => n + l.length, 0) };
}

function table(platform = process.platform) {
  return BY_PLATFORM[platform] || LINUX;
}

function get(id, platform = process.platform) {
  return table(platform).find(c => c.id === id) || null;
}

module.exports = {
  BANNED_BIN, LISTEN_PORTS, HTTP_PORTS, assertCommand, lintAll, table, get, firstExisting, BY_PLATFORM
};
