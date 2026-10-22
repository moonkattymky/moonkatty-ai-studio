import { spawn, execSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os';
const ROOT = '/workspace/n5audit-e2bb', PORT = 8941, BASE = 'http://127.0.0.1:' + PORT, PW = 'probe-owner-pw-9';
const W = fs.mkdtempSync('/tmp/n5p-'), UD = path.join(W, 'data'), BIN = path.join(W, 'bin'), FH = path.join(W, 'fakehome'), OUT = path.join(W, 'outside');
for (const d of [UD, BIN, FH, OUT]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(FH, 'secret.txt'), 'home-secret'); fs.writeFileSync(path.join(OUT, 'out.wav'), 'x');
const NODE = process.execPath;
const FAKE = `#!/bin/sh
L=./probe.txt
echo "ARGS:$*" >> $L
echo "ENV:$(env | cut -d= -f1 | sort | tr '\\n' ' ')" >> $L
echo "HOMEVAR:$HOME" >> $L
for f in "${FH}/secret.txt" "/home/box/.config/gh/hosts.yml" "${UD}/app-token" "/etc/passwd" "/etc/shadow" "/workspace" ; do test -r "$f" && echo "READ:$f:yes" >> $L || echo "READ:$f:no" >> $L; done
ls / | tr '\\n' ' ' | sed 's/^/ROOTLS:/' >> $L; echo >> $L
ls "${UD}" >/dev/null 2>&1 && echo LS_DATA:yes >> $L || echo LS_DATA:no >> $L
( echo x > ${W}/w-outside ) 2>/dev/null && echo WRITE_OUTSIDE:yes >> $L || echo WRITE_OUTSIDE:no >> $L
( echo x > /tmp/x ) 2>/dev/null && echo WRITE_TMP_tmpfs:yes >> $L || echo WRITE_TMP:no >> $L
echo "NETDEV:$(tail -n +3 /proc/net/dev | cut -d: -f1 | tr -d ' ' | tr '\\n' ' ')" >> $L
bash -c "echo > /dev/tcp/127.0.0.1/${PORT}" 2>/dev/null && echo TCP_STUDIO:yes >> $L || echo TCP_STUDIO:no >> $L
bash -c "echo > /dev/tcp/127.0.0.1/11434" 2>/dev/null && echo TCP_OLLAMA:yes >> $L || echo TCP_OLLAMA:no >> $L
curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:${PORT}/api/health > ./c.txt 2>/dev/null; echo "CURL_STUDIO:$(cat ./c.txt)" >> $L
case "$*" in *LOOP*) setsid sh -c 'while :; do date +%s%N >> ./gc.txt; sleep 0.2; done' & sh -c 'while :; do date +%s%N >> ./gc2.txt; sleep 0.2; done' &
  while :; do date +%s%N >> ./alive.txt; sleep 0.2; done;; esac
exit 0
`; fs.writeFileSync(path.join(BIN, 'opencode'), FAKE, { mode: 0o755 });

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

const runOC = async (prompt, extra = {}) => { const c = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt }, ...extra }); await sleep(1100); const a = await approve(c.j.approvalId); return a.j?.result?.jobId; };
const P = id => fs.existsSync(wd(id) + '/probe.txt') ? fs.readFileSync(wd(id) + '/probe.txt', 'utf8') : 'NO PROBE';
const J1 = await runOC('escape probe'); const j1 = await waitJob(J1); rec('job1', { s: j1.status, e: j1.error, sb: j1.artifacts?.[0]?.sandbox }); rec('probe1', P(J1));
// cancel tree
const LJ = await runOC('LOOP cancel'); let g = false; for (let i = 0; i < 50 && !g; i++) { await sleep(200); g = fs.existsSync(wd(LJ) + '/gc.txt') && fs.existsSync(wd(LJ) + '/gc2.txt'); } rec('loop started', g);
await call('sess', 'POST', '/api/jobs/' + LJ + '/cancel'); await sleep(1500);
const sz = f => fs.existsSync(f) ? fs.statSync(f).size : -1; const s0 = ['alive', 'gc', 'gc2'].map(n => sz(wd(LJ) + '/' + n + '.txt')); await sleep(1500); const s1 = ['alive', 'gc', 'gc2'].map(n => sz(wd(LJ) + '/' + n + '.txt'));
rec('after cancel growing [alive,setsid-gc,gc2]', s0.map((v, i) => v !== s1[i])); rec('ps leftovers', execSync(`ps -eo args | grep -c "[g]c.\\?.txt" || true`).toString().trim());
// timeout
const TJ = await runOC('LOOP timeout', { timeoutSec: 2 }); const tj = await waitJob(TJ, 80); await sleep(4000); const t0 = ['gc', 'gc2'].map(n => sz(wd(TJ) + '/' + n + '.txt')); await sleep(1200);
rec('timeout', { s: tj.status, e: tj.error, growing: ['gc', 'gc2'].map((n, i) => sz(wd(TJ) + '/' + n + '.txt') !== t0[i]) });
// retry
const rt = await call('app', 'POST', '/api/jobs/' + LJ + '/retry'); rec('retry cancelled opencode', { s: rt.s, code: rt.j?.code, appr: !!rt.j?.approvalId });
await sleep(1100); const before = P(LJ).split('ARGS').length;
await sleep(2000); rec('no re-run before approve', P(LJ).split('ARGS').length === before);
const rta = await approve(rt.j.approvalId); rec('approve retry', { s: rta.s, ex: rta.j?.executed, newJob: rta.j?.result?.jobId && rta.j.result.jobId !== LJ });
if (rta.j?.result?.jobId) await call('sess', 'POST', '/api/jobs/' + rta.j.result.jobId + '/cancel');
rec('replay retry approval', (await approve(rt.j.approvalId)).s);
fs.mkdirSync(path.join(UD, 'media'), { recursive: true }); fs.writeFileSync(path.join(UD, 'media', 'a.wav'), 'x');
const rs = await call('app', 'POST', '/api/jobs', { type: 'render_segment', input: { durationSec: 1, audioPath: 'a.wav' } }); await sleep(1100); const RJ = (await approve(rs.j.approvalId)).j.result?.jobId; await sleep(200); await call('sess', 'POST', '/api/jobs/' + RJ + '/cancel'); await waitJob(RJ);
const rr = await call('app', 'POST', '/api/jobs/' + RJ + '/retry'); rec('retry render', { s: rr.s, code: rr.j?.code });
fs.rmSync(path.join(UD, 'media', 'a.wav')); fs.symlinkSync('/etc/passwd', path.join(UD, 'media', 'a.wav'));
const rr2 = await call('app', 'POST', '/api/jobs/' + RJ + '/retry'); rec('retry render after audio swapped to symlink', { s: rr2.s, e: rr2.j?.error });
await stop();
// home-dir install: opencode binary placed directly in $HOME
fs.copyFileSync(path.join(BIN, 'opencode'), path.join(FH, 'opencode')); fs.chmodSync(path.join(FH, 'opencode'), 0o755);
await start({ OPENCODE_BIN: path.join(FH, 'opencode') }); cookie = ''; await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const HJ = await runOC('home install'); await waitJob(HJ); rec('bin in $HOME -> reads', P(HJ).split('\n').filter(l => /READ:|ROOTLS/.test(l)).join(' | '));
await stop(); console.log('W=', W);
