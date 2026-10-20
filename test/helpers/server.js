'use strict';
// Starts a real server process on a fresh TEMP data dir (never the user's data). Refuses Application Support paths.
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
function assertSafeDir(d) { const r = path.resolve(d); if (!r.startsWith(fs.realpathSync(os.tmpdir())) && !r.startsWith('/tmp/') || /Application Support/.test(r)) throw new Error('test data dir must be in tmp: ' + r); return r; }
async function startServer({ port, env = {}, cwd = ROOT, dir, setup = true } = {}) {
  const UD = assertSafeDir(dir || fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'mk-test-')));
  const B = `http://127.0.0.1:${port}`; const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
  const e = { ...process.env, STUDIO_DATA_DIR: UD, PORT: String(port), HOST: '127.0.0.1', ...env }; delete e.DB_PATH;
  const out = []; const p = spawn(process.execPath, ['server.js'], { cwd, env: e, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', d => out.push(String(d))); p.stderr.on('data', d => out.push(String(d)));
  let up = false; for (let i = 0; i < 75 && !up; i++) { try { up = (await fetch(B + '/api/health')).ok; } catch {} if (!up) await new Promise(r => setTimeout(r, 200)); }
  if (!up) { p.kill('SIGKILL'); throw new Error('server did not start: ' + out.join('').slice(-500)); }
  let A = R, cookie = '';
  if (setup) { const r = await fetch(B + '/api/auth/setup', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) });
    if (r.ok) cookie = (r.headers.get('set-cookie') || '').split(';')[0]; else { const l = await fetch(B + '/api/auth/login', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) }); cookie = (l.headers.get('set-cookie') || '').split(';')[0]; }
    A = { ...R, cookie }; }
  const j = async (m, pth, h = A, b) => { const r = await fetch(B + pth, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) }); let body = null; const t = await r.text(); try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body, headers: r.headers }; };
  const stop = (sig = 'SIGTERM') => new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); p.kill(sig); });
  return { B, R, A, UD, j, proc: p, out, stop, cleanup: async () => { await stop(); fs.rmSync(UD, { recursive: true, force: true }); } };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
module.exports = { startServer, sleep, assertSafeDir, ROOT };
