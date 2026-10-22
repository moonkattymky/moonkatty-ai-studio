// Safe command engine. execFile/spawn with shell:false, a fixed registry, enum
// parameters, timeouts, a 256 KiB output cap, and process-group kill on timeout.
'use strict';
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const registry = require('./registry');
const { redact } = require('./redact');
const { doctorError, assertTempPath } = require('./paths');

const MAX_BUFFER = 256 * 1024;
const MAX_PARALLEL = 2;
const SAFE_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'C', LC_ALL: 'C', TMPDIR: os.tmpdir() };

let active = 0;
const waiters = [];
const audit = [];

function slot() {
  return new Promise(resolve => {
    const start = () => {
      active++;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active--;
        const next = waiters.shift();
        if (next) next();
      });
    };
    if (active < MAX_PARALLEL) start();
    else waiters.push(start);
  });
}

function materialize(spec, params) {
  registry.assertCommand(spec);
  const input = params && typeof params === 'object' ? params : {};
  const allowed = spec.params || {};
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(allowed, key)) throw doctorError('BAD_PARAMS', 'Неизвестный параметр ' + key);
  }
  const clean = {};
  for (const [key, rule] of Object.entries(allowed)) {
    if (input[key] == null) {
      if (spec.build || rule === true) throw doctorError('BAD_PARAMS', 'Нужен параметр ' + key);
      continue;
    }
    if (key === 'path' || rule === true) {
      clean.path = assertTempPath(String(input[key]));
      if (!fs.existsSync(clean.path)) throw doctorError('BAD_PARAMS', 'Файл не найден');
      continue;
    }
    const value = String(input[key]);
    if (!rule.includes(value)) throw doctorError('BAD_PARAMS', 'Параметр вне списка: ' + key);
    clean[key] = value;
  }
  const args = spec.build ? spec.build(clean) : (spec.args || []).slice();
  if (spec.build) registry.assertCommand({ ...spec, args });
  for (const a of args) {
    if (typeof a !== 'string') throw doctorError('FORBIDDEN', 'Аргумент не строка');
    if (/[\0\n\r]/.test(a)) throw doctorError('FORBIDDEN', 'Пустой символ в аргументе');
  }
  return args;
}

function killGroup(pid, sig) {
  try { process.kill(-pid, sig); } catch {
    try { process.kill(pid, sig); } catch { /* already gone */ }
  }
}

function spawnRegistered(bin, args, { timeoutMs, cwd }) {
  return new Promise(resolve => {
    const started = Date.now();
    let out = '', err = '', truncated = false, timedOut = false, settled = false;
    let child;
    try {
      child = spawn(bin, args, {
        shell: false,
        detached: true,
        cwd: cwd || os.tmpdir(),
        env: SAFE_ENV,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (e) {
      return resolve({ ok: false, status: 'BLOCKED', code: 'spawn', error: e.message, durationMs: 0, stdout: '', stderr: '' });
    }
    const take = (chunk, which) => {
      const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (which === 'out') {
        if (out.length < MAX_BUFFER) out += s.slice(0, MAX_BUFFER - out.length);
        if (out.length + s.length > MAX_BUFFER) truncated = true;
      } else {
        if (err.length < MAX_BUFFER) err += s.slice(0, MAX_BUFFER - err.length);
        if (err.length + s.length > MAX_BUFFER) truncated = true;
      }
    };
    child.stdout.on('data', d => take(d, 'out'));
    child.stderr.on('data', d => take(d, 'err'));
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid, 'SIGTERM');
      killTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), 3000);
      if (killTimer.unref) killTimer.unref();
    }, timeoutMs);
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: !timedOut && code === 0,
        status: timedOut ? 'TIMEOUT' : (code === 0 ? 'OK' : 'FAIL'),
        code, signal: signal || null, timedOut, truncated,
        durationMs: Date.now() - started,
        stdout: out, stderr: err, pid: child.pid
      });
    };
    child.on('error', e => finish(null, e.code || 'error'));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function run(id, opts = {}) {
  const spec = registry.get(id, opts.platform || process.platform);
  if (!spec) throw doctorError('FORBIDDEN', 'Команда не в списке разрешённых: ' + id);
  const args = materialize(spec, opts.params);
  const bin = registry.firstExisting(spec.bins);
  const argsHash = crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex');
  if (!bin) {
    const row = { id, argsHash, exit: null, durationMs: 0, at: new Date().toISOString(), status: 'BLOCKED' };
    audit.push(row); if (audit.length > 500) audit.shift();
    return { ok: false, status: 'BLOCKED', id, reason: 'Бинарник не найден', argsHash, stdout: '', stderr: '', durationMs: 0, timedOut: false };
  }
  const release = await slot();
  try {
    const timeoutMs = Math.min(spec.maxTimeoutMs || 10000, Math.max(50, opts.timeoutMs || spec.maxTimeoutMs || 10000));
    const raw = await spawnRegistered(bin, args, { timeoutMs, cwd: opts.cwd });
    const sec = opts.sec;
    const stdout = redact(raw.stdout, sec);
    const stderr = redact(raw.stderr, sec);
    const row = { id, argsHash, exit: raw.code, durationMs: raw.durationMs, at: new Date().toISOString(), status: raw.status, timedOut: raw.timedOut };
    audit.push(row); if (audit.length > 500) audit.shift();
    if (opts.log) { try { opts.log('info', 'doctor', redact(`cmd ${id} exit=${raw.code} ${raw.durationMs}ms`, sec)); } catch { /* logging must not break a check */ } }
    return { ...raw, id, bin, argsHash, stdout, stderr, truncated: raw.truncated };
  } finally { release(); }
}

function resetForTests() {
  active = 0; waiters.length = 0; audit.length = 0;
}

module.exports = {
  run, audit: () => audit.slice(), active: () => active, resetForTests,
  MAX_BUFFER, MAX_PARALLEL, materialize, SAFE_ENV
};
