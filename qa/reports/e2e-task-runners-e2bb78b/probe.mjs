import { spawn, execSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os';
const ROOT = '/workspace/n5audit-e2bb', PORT = 8931, BASE = 'http://127.0.0.1:' + PORT, PW = 'probe-owner-pw-9';
const W = fs.mkdtempSync('/tmp/n5p-'), UD = path.join(W, 'data'), BIN = path.join(W, 'bin'), FH = path.join(W, 'fakehome'), OUT = path.join(W, 'outside');
for (const d of [UD, BIN, FH, OUT]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(FH, 'secret.txt'), 'home-secret'); fs.writeFileSync(path.join(OUT, 'out.wav'), 'x');
const NODE = process.execPath;
fs.writeFileSync(path.join(BIN, 'opencode'), `#!/bin/sh
L=./probe.txt
echo "ARGC:$#" >> $L; for a in "$@"; do echo "ARG:[$a]" >> $L; done
echo "ENV:$(env | cut -d= -f1 | sort | tr '\\n' ' ')" >> $L
echo "PID1:$(tr '\\0' ' ' < /proc/1/cmdline)" >> $L
test -r "${FH}/secret.txt" && echo READ_REALHOME:yes >> $L || echo READ_REALHOME:no >> $L
test -r "/home/box/.config/gh/hosts.yml" && echo READ_GH_CFG:yes >> $L || echo READ_GH_CFG:no >> $L
ls "${UD}" >/dev/null 2>&1 && echo "LS_DATA:$(ls ${UD} | tr '\\n' ' ')" >> $L
test -r "${UD}/app-token" && echo READ_APPTOKEN:yes >> $L || echo READ_APPTOKEN:no >> $L
( echo x > ${W}/w-outside ) 2>/dev/null && echo WRITE_OUTSIDE:yes >> $L || echo WRITE_OUTSIDE:no >> $L
( echo x > /tmp/n5-w-$$ ) 2>/dev/null && echo WRITE_TMP:yes >> $L || echo WRITE_TMP:no >> $L
${NODE} -e "fetch('${BASE}/api/health').then(r=>console.log('NET_LOOPBACK:'+r.status)).catch(e=>console.log('NET_LOOPBACK:err '+e.cause?.code))" >> $L 2>&1
echo "IFACES:$(ls /sys/class/net | tr '\\n' ' ')" >> $L
case "$*" in *LOOP*) setsid sh -c 'while :; do date +%s%N >> ./gc.txt; sleep 0.2; done' & 
  while :; do date +%s%N >> ./alive.txt; sleep 0.2; done;; esac
exit 0
`, { mode: 0o755 });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const R = []; const rec = (k, v) => { R.push([k, v]); console.log(k, '=>', typeof v === 'string' ? v : JSON.stringify(v)); };
let srv; const SECRETS = { STUDIO_SECRET_KEY: 'dummy-sk', STUDIO_ADMIN_PASSWORD: PW, STUDIO_ADMIN_USER: 'igor', ADMIN_USER: 'dummy', ADMIN_TOKEN: 'dummy', GITHUB_TOKEN: 'dummy', GH_TOKEN: 'dummy', OPENCODE_SERVER_PASSWORD: 'dummy', OPENCODE_PASSWORD: 'dummy', OPENAI_API_KEY: 'dummy', TELEGRAM_BOT_TOKEN: 'dummy', NODE_OPTIONS: '', MK_TEST_REAL_RUNNERS: '1' };
async function start(extra = {}) { srv = spawn(NODE, ['server.js'], { cwd: ROOT, stdio: ['ignore', fs.openSync(path.join(W, 'server.log'), 'a'), fs.openSync(path.join(W, 'server.log'), 'a')], env: { ...process.env, ...SECRETS, HOME: FH, PATH: BIN + ':' + process.env.PATH, OPENCODE_BIN: '', NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '127.0.0.1', ...extra } });
  let up = false; for (let i = 0; i < 75 && !up; i++) { try { up = (await fetch(BASE + '/api/health')).ok; } catch {} if (!up) await sleep(200); } if (!up) throw new Error('no boot'); }
const stop = async () => { srv.kill('SIGTERM'); await new Promise(r => srv.once('exit', r)); };
await start(); const tok = fs.readFileSync(path.join(UD, 'app-token'), 'utf8').trim(); let cookie = '';
const call = async (who, m, p, b) => { const h = { 'content-type': 'application/json', 'x-studio-request': '1' }; if (who === 'app') h['x-studio-app-token'] = tok; else h.cookie = cookie;
  const r = await fetch(BASE + p, { method: m, headers: h, body: b == null ? undefined : JSON.stringify(b) }); const sc = r.headers.get('set-cookie'); if (sc && /mk_session=/.test(sc)) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
await call('app', 'POST', '/api/auth/setup', { username: 'igor', password: PW }); await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const approve = id => call('sess', 'POST', '/api/world/approvals/' + id, { decision: 'approve', password: PW });
const job = id => call('sess', 'GET', '/api/jobs/' + id).then(r => r.j);
async function waitJob(id, n = 60) { let j; for (let i = 0; i < n; i++) { await sleep(200); j = await job(id); if (j && !['queued', 'running'].includes(j.status)) break; } return j; }
const wd = id => path.join(UD, 'media', 'opencode-tasks', String(id));
// 1. prompt injection + env + sandbox
for (const p of ['--version', '-x', ' --help', 'hello --version --model evil', 'a\n--dangerously-skip']) { const r = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: p } }); rec('prompt ' + JSON.stringify(p), { s: r.s, code: r.j?.code, err: r.j?.error?.slice(0, 80) }); }
const c1 = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'hello --version --model evil' } });
const a1 = await approve(c1.j.approvalId); rec('approve c1', { s: a1.s, ex: a1.j?.executed, job: a1.j?.result?.jobId });
const j1 = await waitJob(a1.j.result.jobId); rec('job1', { status: j1.status, err: j1.error, art: j1.artifacts });
rec('probe1', fs.existsSync(wd(j1.jobId || a1.j.result.jobId) + '/probe.txt') ? fs.readFileSync(wd(a1.j.result.jobId) + '/probe.txt', 'utf8') : 'NO PROBE FILE');
// replay + other payload
rec('replay approve c1', (await approve(c1.j.approvalId)).s);
rec('reject-after-approve', (await call('sess', 'POST', '/api/world/approvals/' + c1.j.approvalId, { decision: 'reject' })).s);
// self approval: session requests, session approves
const cs = await call('sess', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'self req' } });
rec('self-approval session->session (with pw)', await approve(cs.j.approvalId).then(r => ({ s: r.s, code: r.j?.code, ex: r.j?.executed })));
const ca = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'app req' } });
rec('approve without password', (await call('sess', 'POST', '/api/world/approvals/' + ca.j.approvalId, { decision: 'approve' })).s);
rec('approve wrong password', (await call('sess', 'POST', '/api/world/approvals/' + ca.j.approvalId, { decision: 'approve', password: 'nope' })).s);
// world/action generic path with owner action
const wa = await call('app', 'POST', '/api/world/action', { action: 'agent_code_execution', detail: 'x' }); rec('world/action agent_code_execution', { s: wa.s, code: wa.j?.code });
await sleep(1600);
if (wa.j?.approvalId) { const w2 = await approve(wa.j.approvalId); rec('approve world/action approval', { s: w2.s, ex: w2.j?.executed, st: w2.j?.execStatus }); }
// direct approvalId smuggling
const sm = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', approvalId: c1.j.approvalId, input: { prompt: 'smuggle' } }); rec('POST /api/jobs with consumed approvalId', { s: sm.s, code: sm.j?.code });
// 2. cancel tree + heavy lock
await sleep(1600);
const cl = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'LOOP cancel' } }); const al = await approve(cl.j.approvalId); const LJ = al.j.result.jobId;
let grew = false; for (let i = 0; i < 50 && !grew; i++) { await sleep(200); grew = fs.existsSync(wd(LJ) + '/gc.txt'); }
rec('loop child + setsid grandchild started', grew);
fs.mkdirSync(path.join(UD, 'media'), { recursive: true }); fs.writeFileSync(path.join(UD, 'media', 'a.wav'), 'x');
await sleep(1600);
const rs = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, aspect: '1:1' } }); const rsa = await approve(rs.j.approvalId); const RJ = rsa.j.result?.jobId;
await sleep(2500); rec('render_segment while opencode holds heavy lock', (await job(RJ))?.status);
rec('heavy status', (await call('sess', 'GET', '/api/health')).j?.heavy ?? 'n/a');
await call('sess', 'POST', '/api/jobs/' + LJ + '/cancel'); await sleep(1500);
const sz = f => fs.existsSync(f) ? fs.statSync(f).size : -1; const a0 = sz(wd(LJ) + '/alive.txt'), g0 = sz(wd(LJ) + '/gc.txt'); await sleep(1500);
rec('after cancel: child alive.txt grows?', sz(wd(LJ) + '/alive.txt') !== a0); rec('after cancel: setsid grandchild gc.txt grows?', sz(wd(LJ) + '/gc.txt') !== g0);
rec('ps leftover', execSync(`ps -eo pid,args | grep -F "${wd(LJ)}" | grep -v grep || true; ps -eo args | grep -c "[d]ate +%s%N >> ./gc.txt" || true`).toString().trim());
const rj = await waitJob(RJ, 100); rec('render after lock released', { status: rj?.status, err: rj?.error?.slice(0, 100) });
// 3. timeout
await sleep(1600);
const ct = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', timeoutSec: 2, input: { prompt: 'LOOP timeout' } }); const at = await approve(ct.j.approvalId); const TJ = at.j.result.jobId;
const tj = await waitJob(TJ, 80); rec('timeout job', { status: tj?.status, err: tj?.error }); await sleep(4000);
const t0 = sz(wd(TJ) + '/gc.txt'); await sleep(1200); rec('after timeout grandchild grows?', sz(wd(TJ) + '/gc.txt') !== t0);
// 4. audioPath
const M = path.join(UD, 'media'); fs.symlinkSync(path.join(OUT, 'out.wav'), path.join(M, 'link-out.wav')); fs.symlinkSync('/etc/passwd', path.join(M, 'link-passwd')); fs.mkdirSync(path.join(M, 'sub'), { recursive: true });
fs.symlinkSync(OUT, path.join(M, 'dirlink'));
const cases = { valid: 'a.wav', abs_valid: path.join(M, 'a.wav'), abs_outside: '/etc/passwd', missing_outside: '/etc/nope-zz', missing_inside: 'nope.wav', dotdot: '../app-token', dotdot_missing: '../nope', symlink_out: 'link-out.wav', symlink_passwd: 'link-passwd', dir: 'sub', dirlink: 'dirlink/out.wav', nul: 'a.wav\u0000x', num: 5 };
const errs = {}; for (const [k, v] of Object.entries(cases)) { const r = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: v } }); errs[k] = r.s + ' ' + (r.j?.code || r.j?.error); }
rec('audioPath matrix', errs);
// TOCTOU between request and approval: swap a.wav -> symlink outside
const tq = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: 'b.wav' } }); rec('b.wav missing', tq.s);
fs.writeFileSync(path.join(M, 'c.wav'), 'x'); const tq2 = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: 'c.wav' } });
fs.rmSync(path.join(M, 'c.wav')); fs.symlinkSync(path.join(OUT, 'out.wav'), path.join(M, 'c.wav')); await sleep(1600);
const tq2a = await approve(tq2.j.approvalId); rec('swap to symlink between request and approval', { s: tq2a.s, ex: tq2a.j?.executed, st: tq2a.j?.execStatus, err: JSON.stringify(tq2a.j?.result)?.slice(0, 160) });
// 5. retry of an approved+cancelled render job, then restart -> resume without new approval?
const ffl = path.join(W, 'ff.log'); fs.writeFileSync(path.join(BIN, 'ffmpeg'), `#!/bin/sh\necho "FF $(date +%s) $*" >> ${ffl}\nfor a; do o=$a; done; echo x > "$o"\nexit 0\n`, { mode: 0o755 });
await stop(); await start({ FFMPEG_BIN: path.join(BIN, 'ffmpeg') }); cookie = ''; await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const rr = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1 } }); const rra = await approve(rr.j.approvalId); const RR = rra.j.result.jobId;
const rrj = await waitJob(RR); rec('fake-ffmpeg render', rrj?.status); const ffBefore = fs.readFileSync(ffl, 'utf8').split('\n').filter(Boolean).length;
// make it failed-able: cancel isn't possible after done; use a failed one: request with audio that is later removed
fs.writeFileSync(path.join(M, 'd.wav'), 'x'); const rf = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: 'd.wav' } });
await sleep(1600); const rfa = await approve(rf.j.approvalId); const RF = rfa.j.result?.jobId; await sleep(300);
await call('sess', 'POST', '/api/jobs/' + RF + '/cancel'); const rfj = await waitJob(RF); rec('cancelled render', rfj?.status);
const rt = await call('app', 'POST', '/api/jobs/' + RF + '/retry'); rec('retry approved render by app token', { s: rt.s, st: rt.j?.status }); await sleep(2000);
const ffMid = fs.readFileSync(ffl, 'utf8').split('\n').filter(Boolean).length; rec('ffmpeg runs after retry (no restart)', ffMid - ffBefore);
await stop(); await start({ FFMPEG_BIN: path.join(BIN, 'ffmpeg') }); await sleep(3000);
const ffAfter = fs.readFileSync(ffl, 'utf8').split('\n').filter(Boolean).length; rec('ffmpeg runs after restart (resume) without new approval', ffAfter - ffMid);
cookie = ''; await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW }); rec('retried job final', (await job(RF))?.status);
// 6. flavor gate: no MK_TEST_REAL_RUNNERS
await stop(); await start({ MK_TEST_REAL_RUNNERS: '' }); cookie = ''; await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const cg = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'gate' } }); const ag = await approve(cg.j.approvalId); const gj = await waitJob(ag.j.result.jobId);
rec('TEST gate opencode', { status: gj?.status, err: gj?.error, spawned: fs.existsSync(wd(ag.j.result.jobId) + '/probe.txt') });
await sleep(1600); const rg = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1 } }); const rga = await approve(rg.j.approvalId); const rgj = await waitJob(rga.j.result.jobId);
rec('TEST gate render', { status: rgj?.status, err: rgj?.error });
await stop();
// 7. no sandbox: PATH without bwrap -> in-process check via module
const TR = await import(ROOT + '/lib/task-runners.js');
fs.writeFileSync(path.join(W, 'R.json'), JSON.stringify(R, null, 1)); console.log('W=', W);
