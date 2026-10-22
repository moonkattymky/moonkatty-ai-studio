import { spawn, execSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os';
const ROOT = '/tmp/n5pkg/Resources/app.asar.unpacked', PORT = 8944, BASE = 'http://127.0.0.1:' + PORT, PW = 'probe-owner-pw-9';
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
async function start(extra = {}) { srv = spawn(NODE, ['server.js'], { cwd: ROOT, stdio: ['ignore', fs.openSync(path.join(W, 'server.log'), 'a'), fs.openSync(path.join(W, 'server.log'), 'a')], env: { ...process.env, ...SECRETS, HOME: FH, PATH: BIN + ':' + process.env.PATH, OPENCODE_BIN: '', MK_TEST_LLM_STUB: '1', NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '127.0.0.1', ...extra } });
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

rec('health', (await call('sess','GET','/api/health')).j);
const c = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'packaged' } }); const J = (await approve(c.j.approvalId)).j.result?.jobId; const j = await waitJob(J);
rec('packaged TEST + MK_TEST_REAL_RUNNERS=1', { s: j?.status, e: j?.error, art: j?.artifacts?.[0]?.sandbox, spawned: fs.existsSync(wd(J) + '/probe.txt') });
await stop(); await start({ MK_TEST_REAL_RUNNERS: '' }); cookie=''; await call('sess', 'POST', '/api/auth/login', { username: 'igor', password: PW });
const c2 = await call('app', 'POST', '/api/jobs', { type: 'opencode_task', input: { prompt: 'packaged2' } }); const J2 = (await approve(c2.j.approvalId)).j.result?.jobId; const j2 = await waitJob(J2);
rec('packaged TEST default', { s: j2?.status, e: j2?.error });
await stop(); console.log(fs.readFileSync(path.join(W,'server.log'),'utf8').split('\n').filter(l=>/MOONKATTY|flavor|Error/i.test(l)).slice(0,6).join('\n'));
