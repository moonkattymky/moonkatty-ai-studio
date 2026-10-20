// OS probes (macOS-first, Linux fallback). All external commands go through execFile (no shell) and are injectable for tests.
'use strict';
const os = require('os'), fs = require('fs');
const { execFile } = require('child_process');
const run = (cmd, args, timeout = 5000) => new Promise((res, rej) => execFile(cmd, args, { timeout, maxBuffer: 4 << 20 }, (e, out) => e ? rej(e) : res(String(out))));
// macOS: os.freemem() ignores reclaimable cache, so "available" = free + inactive + speculative + purgeable pages.
function parseVmStat(txt) {
  const ps = +(/page size of (\d+) bytes/.exec(txt) || [0, 16384])[1]; const g = k => +((new RegExp(k + ':\\s+(\\d+)').exec(txt)) || [0, 0])[1];
  return (g('Pages free') + g('Pages inactive') + g('Pages speculative') + g('Pages purgeable')) * ps;
}
async function memInfo({ platform = process.platform, exec = run } = {}) {
  const total = os.totalmem(); let available = os.freemem();
  if (platform === 'darwin') { try { available = parseVmStat(await exec('/usr/bin/vm_stat', [])); } catch {} }
  else { try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) available = +m[1] * 1024; } catch {} }
  return { total, available };
}
function diskInfo(dir) { const st = fs.statfsSync(dir); return { total: st.blocks * st.bsize, free: st.bavail * st.bsize }; }
// "[[dd-]hh:]mm:ss" → seconds
function etimeToSec(s) { const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(String(s).trim()); if (!m) return 0; return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+m[3]) * 60 + (+m[4]); }
function parsePs(txt) {
  return String(txt).split('\n').slice(1).map(l => l.trim()).filter(Boolean).map(l => { const p = l.split(/\s+/);
    return { pid: +p[0], user: p[1], etimeSec: etimeToSec(p[2]), cpu: +p[3], rssKb: +p[4], comm: p.slice(5).join(' ') }; });
}
async function processes({ exec = run } = {}) { return parsePs('HEADER\n' + await exec('/bin/ps', ['-axo', 'pid=,user=,etime=,pcpu=,rss=,comm='])); }
module.exports = { run, parseVmStat, memInfo, diskInfo, etimeToSec, parsePs, processes };
