import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
const ROOT = process.argv[2] || '/workspace/n5audit-e2bb', PORT = 8961, B = 'http://127.0.0.1:' + PORT, PW = 'g3-probe-pw-7';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g3p-'));
const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: dir, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(PORT), STUDIO_ADMIN_PASSWORD: PW }, stdio: ['ignore', fs.openSync(dir + '/srv.log', 'a'), fs.openSync(dir + '/srv.log', 'a')] });
process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} }); const sleep = ms => new Promise(r => setTimeout(r, ms)); const out = [];
for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(250); }
const h = await (await fetch(B + '/api/health')).json();
const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ username: 'igor', password: PW }) });
const ck = (lr.headers.get('set-cookie') || '').split(';')[0]; const app = fs.readFileSync(dir + '/app-token', 'utf8').trim();
const H = { sess: { cookie: ck }, app: { 'x-studio-app-token': app } };
async function call(who, m, p, b) { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-studio-request': '1', ...H[who] }, body: b ? JSON.stringify(b) : undefined }); let j; try { j = await r.json(); } catch {} return { s: r.status, code: j?.code, where: j?.where, j }; }
const rec = (n, r, want403 = true) => { const ok = want403 ? r.s === 403 && r.code === 'feature_disabled' : true; out.push({ n, s: r.s, code: r.code, ok }); console.log((want403 ? (ok ? 'PASS ' : 'MISS ') : 'INFO ') + n + ' => ' + r.s + ' ' + (r.code || '') + ' ' + (r.where || '') + (r.extra ? ' ' + r.extra : '')); };
console.log('LOGIN', lr.status, ck.slice(0,12)); const dbg = await call('sess','POST','/api/jobs',{type:'design3d'}); console.log('DBG', JSON.stringify(dbg.j)); const proj = await call('sess', 'POST', '/api/projects3d', { title: 'p' }); const pid = proj.j?.id || 'p_x';
const E = [
  ['POST', '/api/jobs', { type: 'design3d' }], ['POST', '/api/jobs', { kind: 'design3d' }], ['POST', '/api/jobs', { type: 'blender_template' }], ['POST', '/api/jobs', { kind: 'blender_template' }], ['POST', '/api/jobs', { type: '3d' }],
  ['POST', '/api/studio3d/run', { text: 'кот' }], ['POST', '/api/studio3d/run/', { text: 'кот' }], ['POST', '/API/Studio3d/run', { text: 'кот' }], ['PUT', '/api/studio3d/settings', { blenderPath: '/bin/true' }],
  ['POST', `/api/projects3d/${pid}/v1/rerender`, {}], ['POST', `/api/projects3d/${pid}/v1/run`, {}], ['POST', `/api/projects3d/${pid}/v1/rerender/`, {}], ['POST', `/API/projects3d/${pid}/v1/rerender`, {}],
  ['POST', '/api/jobs/x/confirm', { approve: true }], ['POST', '/api/jobs/x/review', { action: 'rework' }], ['POST', '/api/jobs/x/confirm/', { approve: true }], ['POST', '/API/jobs/x/confirm', { approve: true }], ['POST', '/api/jobs/x/Review', { action: 'rework' }],
  ['POST', '/api/director/chat', { text: 'сделай 3d модель кота в blender' }],
];
for (const who of ['sess', 'app']) for (const [m, p, b] of E) rec(`${who} ${m} ${p} ${JSON.stringify(b)}`, await call(who, m, p, b));
// task-based paths (fail-closed at runner, not 403 at API)
const t1 = await call('sess', 'POST', '/api/tasks', { title: 'gen', agentId: 'design3d', kind: '3d', status: 'queued', schedule: { type: 'none' }, priority: 'normal', project: 'main' });
rec('POST /api/tasks agentId=design3d', t1, true);
const pl = await call('sess', 'POST', '/api/world/plan', { goal: 'сделать 3d сцену в blender' });
const d3 = (pl.j?.created || pl.j?.tasks || []).filter(t => t.agentId === 'design3d'); pl.extra = 'design3d tasks created: ' + d3.length; rec('POST /api/world/plan goal=3d', pl, true);
const st = await call('sess', 'POST', '/api/agents/design3d/start'); rec('POST /api/agents/design3d/start', st, true);
await sleep(3000);
const tq = (await call('sess', 'GET', '/api/tasks')).j; const tasks = Array.isArray(tq) ? tq : (tq?.items || tq?.tasks || []); const t3 = tasks.filter(t => t.agentId === 'design3d');
console.log('INFO design3d tasks after runner:', JSON.stringify(t3.map(t => ({ s: t.status, code: t.errorCode, src: t.source || 'api' }))));
const jobsL = (await call('sess', 'GET', '/api/jobs?limit=200')).j || []; console.log('INFO 3D jobs in DB:', jobsL.filter(j => ['design3d', 'blender_template', '3d'].includes(j.kind || j.type)).length);
const stat = await call('sess', 'GET', '/api/studio3d/status'); console.log('INFO studio3d status design3d:', JSON.stringify(stat.j?.design3d), 'blender:', JSON.stringify(stat.j?.blender)?.slice(0, 150));
const rt = await call('sess', 'GET', '/api/runtime'); console.log('INFO runtime blender:', JSON.stringify(rt.j?.blender)?.slice(0, 150));
console.log('INFO health version', h.version, 'blender procs:', fs.readFileSync('/dev/null') && '');
console.log('SUMMARY', JSON.stringify({ total: out.filter(o => o.n).length, pass: out.filter(o => o.ok).length, miss: out.filter(o => !o.ok).map(o => o.n + ' ' + o.s) }));

