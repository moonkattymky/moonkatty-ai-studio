'use strict';
// With feature flags OFF the server behaves exactly as before: no /api/mobile, no token admin, runner without admission.
const test = require('node:test'); const assert = require('node:assert/strict');
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const PORT = 8812, B = `http://127.0.0.1:${PORT}`, UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-off-')); let srv, A;
const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
test.before(async () => {
  const env = { ...process.env, STUDIO_DATA_DIR: UD, PORT: String(PORT) }; delete env.STUDIO_OPS_MOBILE; delete env.STUDIO_OPS_RESOURCES;
  srv = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..', '..'), env, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  const r = await fetch(B + '/api/auth/setup', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) }); A = { ...R, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
});
test.after(() => { srv.kill('SIGTERM'); fs.rmSync(UD, { recursive: true, force: true }); });
test('flags off: mobile API absent, ops status reports flags off', async () => {
  assert.equal((await fetch(B + '/api/mobile/summary')).status, 401);
  assert.equal((await fetch(B + '/api/mobile/summary', { headers: A })).status, 404);
  assert.equal((await fetch(B + '/api/ops/mobile-tokens', { method: 'POST', headers: A, body: '{}' })).status, 404);
  const s = await (await fetch(B + '/api/ops/status', { headers: A })).json(); assert.deepEqual(s.flags, { resources: false, mobile: false }); assert.equal(s.resources, null);
});
