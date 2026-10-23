'use strict';
// Process-tree cancel, same rule as feat/e2e-task-runners (Studio4 M-2 / N3-1):
// kill the process group, walk ppid descendants, then sweep any setsid grandchild
// that was reparented to init but still carries MK_TASK_MARK or a cwd inside the task dir.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

function descendants(root) {
  let rows;
  try { rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 }); }
  catch { return []; }
  const kids = new Map();
  for (const l of rows.split('\n')) {
    const [a, b] = l.trim().split(/\s+/).map(Number);
    if (a && b >= 0) { if (!kids.has(b)) kids.set(b, []); kids.get(b).push(a); }
  }
  const out = []; const q = [root];
  while (q.length) {
    const x = q.shift();
    for (const c of kids.get(x) || []) if (!out.includes(c)) { out.push(c); q.push(c); }
  }
  return out;
}

function sweep(mark, cwdDir) {
  const out = new Set(); const me = process.pid;
  let root = null;
  if (cwdDir) { try { root = fs.realpathSync(cwdDir); } catch { root = path.resolve(cwdDir); } }
  const inDir = d => root && d && (d === root || d.startsWith(root + path.sep));
  const tag = mark ? 'MK_TASK_MARK=' + mark : null;
  if (process.platform !== 'linux') return [];
  let ents = []; try { ents = fs.readdirSync('/proc'); } catch { return []; }
  for (const e of ents) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e); if (pid === me) continue;
    try { if (tag && fs.readFileSync('/proc/' + e + '/environ', 'latin1').split('\0').includes(tag)) { out.add(pid); continue; } } catch {}
    try { if (inDir(fs.readlinkSync('/proc/' + e + '/cwd'))) out.add(pid); } catch {}
  }
  return [...out];
}

function signalAll(pid, mark, cwd, sig) {
  const known = new Set(sweep(mark, cwd));
  for (const d of descendants(pid)) known.add(d);
  try { process.kill(-pid, sig); } catch {}
  for (const d of known) { try { process.kill(d, sig); } catch {} }
  try { process.kill(pid, sig); } catch {}
  for (const d of sweep(mark, cwd)) { try { process.kill(d, sig); } catch {} }
}

/** Spawn bin with a private mark. Cancel (or timeout) kills the group, descendants and reparented leftovers. */
function runGuarded(bin, args, { cwd, signal, timeoutMs = 120000, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { code: 'cancelled', cancelled: true }));
    const mark = require('crypto').randomUUID();
    const chunks = { out: '', err: '' };
    const p = spawn(bin, args, {
      cwd, detached: process.platform !== 'win32', shell: false,
      env: { ...env, MK_TASK_MARK: mark },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    p.stdout.on('data', d => { chunks.out = (chunks.out + d).slice(-20000); });
    p.stderr.on('data', d => { chunks.err = (chunks.err + d).slice(-8000); });
    let why = null;
    const kill = reason => { if (why) return; why = reason; signalAll(p.pid, mark, cwd, 'SIGTERM'); setTimeout(() => signalAll(p.pid, mark, cwd, 'SIGKILL'), 1500).unref(); };
    const onAbort = () => kill('cancelled');
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const t = setTimeout(() => kill('timeout'), timeoutMs);
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => {
      clearTimeout(t);
      for (let i = 0; i < 3; i++) { const left = sweep(mark, cwd); if (!left.length) break; for (const d of left) { try { process.kill(d, 'SIGKILL'); } catch {} } }
      if (signal) signal.removeEventListener('abort', onAbort);
      const info = { code, stdout: chunks.out, stderr: chunks.err, pid: p.pid };
      if (why === 'cancelled') return reject(Object.assign(new Error('cancelled'), { code: 'cancelled', cancelled: true, ...info }));
      if (why === 'timeout') return reject(Object.assign(new Error('timeout'), { code: 'timeout', ...info }));
      resolve(info);
    });
  });
}

module.exports = { descendants, sweep, signalAll, runGuarded };
