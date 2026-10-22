// feat/e2e-task-runners HTTP test: opencode_task only via Approval Center, HTTP cancel aborts the real child,
// TEST-flavor gate. Node >= 22.5. Usage: node scripts/task-runners-http-test.mjs
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os'; import { fileURLToPath } from 'url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); const PORT = 8922, BASE = 'http://127.0.0.1:' + PORT, PW = 'fake-owner-pw-2';
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-trh-')), SH = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-trh-bin-'));
fs.writeFileSync(path.join(SH, 'opencode'), '#!/bin/sh\nwhile true; do date +%s%N >> ./alive.txt; sleep 0.2; done\n', { mode: 0o755 });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fail = 0, srv;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); if (!c) fail++; };
async function start(extra) { srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: SH + ':' + process.env.PATH, OPENCODE_BIN: '', NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '127.0.0.1', ...extra } });
  let up = false; for (let i = 0; i < 75 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch {} if (!up) await sleep(200); } ok('server boots', up); if (!up) process.exit(1); }
const stop = async () => { srv.kill('SIGTERM'); await new Promise(r => srv.once('exit', r)); };
await start({ MK_TEST_REAL_RUNNERS: '1' });
const tok = fs.readFileSync(path.join(UD, 'app-token'), 'utf8').trim(); let cookie = '';
const call = async (who, m, p, b) => { const h = { 'content-type': 'application/json', 'x-studio-request': '1' }; if (who === 'app') h['x-studio-app-token'] = tok; else h.cookie = cookie;
  const r = await fetch(BASE + p, { method: m, headers: h, body: b == null ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc && /mk_session=/.test(sc)) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
await call('app', 'POST', '/api/auth/setup', { username: 'igor', password: PW }); await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const c1 = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'refactor x' } });
ok('POST /api/jobs opencode_task -> 403 needs_owner, no job created', c1.s === 403 && c1.j.code === 'needs_owner' && !!c1.j.approvalId, JSON.stringify(c1.j));
ok('no opencode job exists before approval', !((await call('sess', 'GET', '/api/jobs')).j || []).some(j => j.type === 'opencode_task' || j.kind === 'opencode_task'));
ok('prompt with leading "-" rejected at HTTP', (await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: '-rf' } })).s === 400);
ok('app token cannot approve agent code execution', (await call('app', 'POST', '/api/world/approvals/' + c1.j.approvalId, { decision: 'approve', password: PW })).s === 403);
const ap = await call('sess', 'POST', '/api/world/approvals/' + c1.j.approvalId, { decision: 'approve', password: PW });
ok('owner approval -> executor creates opencode_task job', ap.s === 200 && ap.j.executed === true && !!ap.j.result?.jobId, JSON.stringify(ap.j)); const JID = ap.j.result?.jobId;
const alive = path.join(UD, 'media', 'opencode-tasks', String(JID), 'alive.txt'); let grew = false;
for (let i = 0; i < 50 && !grew; i++) { await sleep(200); grew = fs.existsSync(alive) && fs.readFileSync(alive, 'utf8').split('\n').length > 2; }
ok('sandboxed child really running', grew);
const cn = await call('sess', 'POST', '/api/jobs/' + JID + '/cancel');
await sleep(1500); const n1 = fs.readFileSync(alive, 'utf8').length; await sleep(1500); const n2 = fs.readFileSync(alive, 'utf8').length;
ok('HTTP cancel -> cancelled and child process stopped', cn.s === 200 && n1 === n2, JSON.stringify({ s: cn.s, n1, n2 }));
ok('job status cancelled', ['cancelled'].includes((await call('sess', 'GET', '/api/jobs/' + JID)).j?.status), '');
{ const rt = await call('sess', 'POST', '/api/jobs/' + JID + '/retry'); const after = (await call('sess', 'GET', '/api/jobs/' + JID)).j;
  ok('retry of opencode_task -> 403 needs_owner (new approval), job not re-queued', rt.s === 403 && rt.j.code === 'needs_owner' && !!rt.j.approvalId && after?.status === 'cancelled', JSON.stringify([rt.s, rt.j, after?.status])); }
const r1 = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, aspect: '1:1' } });
ok('POST /api/jobs render_segment -> 403 needs_owner + approvalId', r1.s === 403 && r1.j.code === 'needs_owner' && !!r1.j.approvalId, JSON.stringify(r1.j));
ok('no render_segment job before approval', !((await call('sess', 'GET', '/api/jobs')).j || []).some(j => j.type === 'render_segment' || j.kind === 'render_segment'));
const ra = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: '/etc/passwd' } });
const rb = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: '/etc/nope-xyz' } });
ok('render_segment audioPath outside media -> 400, uniform error, no approval created', ra.s === 400 && rb.s === 400 && ra.j.error === rb.j.error, JSON.stringify([ra.j, rb.j]));
ok('app token cannot approve render_segment', (await call('app', 'POST', '/api/world/approvals/' + r1.j.approvalId, { decision: 'approve', password: PW })).s === 403);
const rap = await call('sess', 'POST', '/api/world/approvals/' + r1.j.approvalId, { decision: 'approve', password: PW });
ok('owner approval -> executor creates render_segment job', rap.s === 200 && rap.j.executed === true && !!rap.j.result?.jobId, JSON.stringify(rap.j));
let rj = null; for (let i = 0; i < 100; i++) { await sleep(200); rj = (await call('sess', 'GET', '/api/jobs/' + rap.j.result?.jobId)).j; if (rj && !['queued', 'running'].includes(rj.status)) break; }
ok('approved render_segment runs (ffmpeg) -> done', ['done', 'succeeded'].includes(rj?.status), JSON.stringify(rj && { s: rj.status, e: rj.error }));
ok('replay of render approval -> 409 consumed', (await call('sess', 'POST', '/api/world/approvals/' + r1.j.approvalId, { decision: 'approve', password: PW })).s === 409);
await stop(); await start({ MK_TEST_REAL_RUNNERS: '' }); cookie = ''; await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const c2 = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'again' } });
const ap2 = await call('sess', 'POST', '/api/world/approvals/' + c2.j.approvalId, { decision: 'approve', password: PW }); let st = null;
for (let i = 0; i < 30; i++) { await sleep(200); st = (await call('sess', 'GET', '/api/jobs/' + ap2.j.result?.jobId)).j; if (st && !['queued', 'running'].includes(st.status)) break; }
ok('TEST flavor without MK_TEST_REAL_RUNNERS -> job failed, nothing spawned', st?.status === 'failed' && /TEST/.test(st.error || ''), JSON.stringify(st && { s: st.status, e: st.error }));
{ const r3 = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1 } }); const a3 = await call('sess', 'POST', '/api/world/approvals/' + r3.j.approvalId, { decision: 'approve', password: PW }); let s3 = null;
  for (let i = 0; i < 30; i++) { await sleep(200); s3 = (await call('sess', 'GET', '/api/jobs/' + a3.j.result?.jobId)).j; if (s3 && !['queued', 'running'].includes(s3.status)) break; }
  const rt = await call('app', 'POST', '/api/jobs/' + a3.j.result?.jobId + '/retry'); const after = (await call('sess', 'GET', '/api/jobs/' + a3.j.result?.jobId)).j;
  ok('retry of render_segment -> 403 needs_owner, not re-queued to generic runner', s3?.status === 'failed' && rt.s === 403 && rt.j.code === 'needs_owner' && after?.status === 'failed', JSON.stringify([s3?.status, rt.s, rt.j, after?.status])); }
await stop(); fs.rmSync(UD, { recursive: true, force: true }); fs.rmSync(SH, { recursive: true, force: true });
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
