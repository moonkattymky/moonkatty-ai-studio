// v1.3.2-test candidate: POST /api/jobs design3d must be refused (403 feature_disabled) — 3D studio not approved by the owner.
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd3dd-')); const PORT = 18000 + Math.floor(Math.random() * 1000), B = `http://127.0.0.1:${PORT}`, PW = 'test-only-' + Math.random().toString(36).slice(2);
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(PORT), STUDIO_ADMIN_PASSWORD: PW }, stdio: 'ignore' });
let fails = 0; const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 200)); }
  const H = { 'content-type': 'application/json', 'x-studio-request': '1', origin: B };
  const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ username: 'igor', password: PW }) }); const ck = (lr.headers.get('set-cookie') || '').split(';')[0];
  for (const body of [{ type: 'design3d', input: { prompt: 'cat' } }, { kind: 'design3d', payload: { task: 'x' } }, { type: 'design3d' }]) {
    const r = await fetch(B + '/api/jobs', { method: 'POST', headers: { ...H, cookie: ck }, body: JSON.stringify(body) }); const j = await r.json();
    t('design3d ' + Object.keys(body)[0] + ' → 403 feature_disabled', r.status === 403 && j.code === 'feature_disabled' && j.feature === 'design3d' && j.error === 'design3d недоступен в этой тестовой сборке (3D-студия не одобрена)');
  }
  const app = fs.readFileSync(path.join(dir, 'app-token'), 'utf8').trim();
  const r2 = await fetch(B + '/api/jobs', { method: 'POST', headers: { ...H, 'x-studio-app-token': app }, body: JSON.stringify({ type: 'design3d' }) }); t('design3d via app token → 403', r2.status === 403);
  const jl = await (await fetch(B + '/api/jobs', { headers: { cookie: ck } })).json(); t('no design3d job created', !jl.some(j => j.kind === 'design3d' || j.kind === '3d'));
  const oc = await fetch(B + '/api/jobs', { method: 'POST', headers: { ...H, cookie: ck }, body: JSON.stringify({ type: 'opencode_task' }) }); t('opencode_task gate still 403', oc.status === 403);
  const bt = await fetch(B + '/api/jobs', { method: 'POST', headers: { ...H, cookie: ck }, body: JSON.stringify({ type: 'no_such_type' }) }); t('other types not caught by gate (400 unknown type)', bt.status === 400);
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
