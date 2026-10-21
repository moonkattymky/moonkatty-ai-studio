// Regression: test-only OpenCode launcher (127.0.0.1:4097, password required, never 4096),
// Keychain service/account the test build reads and writes, and the scene_params.json fallback
// when OpenCode is down, returns 401, or never produces valid JSON.
// Fake Blender (named exactly "blender") writes a .blend and a PNG. No real secret is printed.
import http from 'http'; import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const CFG = require('../lib/studio-config.js');
const { createOpencodeServe } = require('../lib/opencode-serve.js');
const PW = 'oc-serve-test-pw';
const T = '/tmp/mk-ocserve-test', UD = T + '/data', KC = T + '/kc';
const P = 8847, PPROD = 8848, UNAUTH = 14098, BAD = 14099;
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(KC, { recursive: true }); fs.mkdirSync(T + '/bin', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const ok = (n, c, x = '') => { const safe = String(x).split(PW).join('[secret]'); res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (safe ? ' — ' + safe.slice(0, 500) : '')); };
const sh = (file, args, env) => new Promise(resolve => { const p = spawn('bash', [file, ...args], { env: { PATH: '/usr/bin:/bin', HOME: T, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); const t = setTimeout(() => { p.kill('SIGKILL'); resolve({ code: 'timeout', o }); }, 4000); p.on('exit', c => { clearTimeout(t); resolve({ code: c, o }); }); });

const testSh = fs.readFileSync('opencode/serve-test.sh', 'utf8');
const prodSh = fs.readFileSync('opencode/serve.sh', 'utf8');
ok('serve-test.sh: service, account and port 4097 match studio-config TEST', testSh.includes(`KC_SERVICE='${CFG.TEST.keychainService}'`) && testSh.includes(`KC_ACCOUNT='${CFG.TEST.kcAccountOpencode}'`) && testSh.includes("PORT='4097'") && testSh.includes('OPENCODE_SERVER_PASSWORD'));
ok('serve-test.sh refuses anything that mentions the production port', /4096/.test(testSh) && testSh.includes('Отказ'));
ok('serve.sh: test flavor delegates, production path refuses port 4097 and still requires a password', prodSh.includes('serve-test.sh') && prodSh.includes('4097') && prodSh.includes('OPENCODE_SERVER_PASSWORD') && prodSh.includes(CFG.PROD.keychainService));
{ const r = await sh('opencode/serve-test.sh', [], { OPENCODE_PORT: '4096', OPENCODE_BIN: '/bin/sleep', PATH: '/usr/bin:/bin' });
  ok('serve-test.sh exits without starting when the caller asks for port 4096', r.code === 1 && /Отказ/.test(r.o) && !/OPENCODE_SERVER_PASSWORD=/.test(r.o), r.o); }
{ const r = await sh('opencode/serve.sh', [], { MK_FLAVOR: 'prod', OPENCODE_PORT: '4097', PATH: '/usr/bin:/bin' });
  ok('serve.sh (production flavor) refuses port 4097', r.code === 1 && /4097/.test(r.o), r.o); }
{ const r = await sh('opencode/serve-test.sh', [], { OPENCODE_BIN: '/bin/sleep', PATH: '/usr/bin:/bin', HOME: T });
  ok('serve-test.sh does not start without a Keychain password', r.code === 1 && r.o.includes(CFG.TEST.keychainService) && r.o.includes(CFG.TEST.kcAccountOpencode) && !/OPENCODE_SERVER_PASSWORD=/.test(r.o), r.o); }

const spawned = [];
const noPw = createOpencodeServe({ getPassword: async () => '', spawnFn: () => { spawned.push('no'); return null; }, bin: '/bin/sleep' });
const denied = await noPw.start({ url: CFG.TEST.opencodeUrl });
ok('launcher refuses to start without a password (409) and does not spawn', denied.status === 409 && !spawned.length, denied.detail);
const forbid = createOpencodeServe({ getPassword: async () => PW, spawnFn: () => { spawned.push('forbid'); return null; }, bin: '/bin/sleep' });
const badPort = await forbid.start({ url: CFG.PROD.opencodeUrl });
ok('launcher refuses the production OpenCode URL and does not spawn', badPort.status === 400 && spawned.length === 0 && !String(badPort.detail).includes(PW), badPort.detail);

const marker = T + '/spawn.json';
fs.writeFileSync(T + '/bin/fake-oc', `#!/usr/bin/env node
const fs = require('fs');
const pw = process.env.OPENCODE_SERVER_PASSWORD || '';
const argv = process.argv.slice(2);
const leaked = !!(pw && (argv.some(a => a.includes(pw)) || Object.keys(process.env).filter(k => k !== 'OPENCODE_SERVER_PASSWORD').some(k => String(process.env[k]).includes(pw))));
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: leaked ? [] : argv, pwSet: pw.length > 0, leaked, user: process.env.OPENCODE_SERVER_USERNAME || '' }));
setTimeout(() => {}, 60000);
`, { mode: 0o755 });
let held = '';
const unit = createOpencodeServe({ getPassword: async () => PW, bin: T + '/bin/fake-oc', readyMs: 800, log: m => { held += m; } });
const started = await unit.start({ url: 'http://127.0.0.1:4097', username: 'opencode' });
const mark = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : {};
ok('launcher spawns opencode serve on 127.0.0.1:4097 with the password only in the environment', started.ok === true && started.port === 4097 && mark.pwSet === true && mark.leaked === false && mark.user === 'opencode' && mark.argv?.join(' ') === 'serve --hostname 127.0.0.1 --port 4097' && !held.includes(PW), JSON.stringify({ started: started.ok, argv: mark.argv, pwSet: mark.pwSet, leaked: mark.leaked }));
unit.stop(); fs.rmSync(marker, { force: true });

function serve(port, onReq) { const s = http.createServer(onReq); return new Promise(resolve => s.listen(port, '127.0.0.1', () => resolve(s))); }
const unauth = await serve(UNAUTH, (q, r) => { r.writeHead(401); r.end(); });
const bare = await fetch(`http://127.0.0.1:${UNAUTH}/global/health`).then(r => r.status).catch(e => e.message);
const authed = await fetch(`http://127.0.0.1:${UNAUTH}/global/health`, { headers: { authorization: 'Basic ' + Buffer.from('opencode:' + PW).toString('base64') } }).then(r => r.status);
ok('HTTP without Basic credentials is rejected with 401', bare === 401 && authed === 401, String(bare));

const prompts = [];
const DEF = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny', external_directory: 'deny' };
const sessions = new Map(); let nid = 0;
const bad = await serve(BAD, (q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  const J = (o, st = 200) => { r.writeHead(st, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.headers.authorization !== 'Basic ' + Buffer.from('opencode:' + PW).toString('base64')) { r.writeHead(401); return r.end(); }
  const u = new URL(q.url, 'http://x'); let body = {}; try { body = JSON.parse(b || '{}'); } catch {}
  if (u.pathname === '/global/health') return J({ healthy: true, version: '1.19.3' });
  if (u.pathname === '/config') return J({ permission: DEF });
  if (u.pathname === '/session' && q.method === 'POST') { const id = 'ses' + (++nid); sessions.set(id, { id, msgs: [], busyUntil: 0 }); return J({ id }); }
  const m = /^\/session\/([^/]+)\/prompt_async$/.exec(u.pathname);
  if (m) { const s = sessions.get(m[1]); prompts.push(s.id); s.busyUntil = Date.now() + 600; s.msgs.push({ info: { role: 'user' }, parts: body.parts || [] });
    setTimeout(() => { s.msgs.push({ info: { role: 'assistant', time: { completed: Date.now() }, finish: 'stop' }, parts: [{ type: 'text', text: 'не json' }] }); s.busyUntil = 0; }, 400);
    r.writeHead(204); return r.end(); }
  if (/^\/session\/([^/]+)\/message$/.test(u.pathname)) { const id = u.pathname.split('/')[2]; return J(sessions.get(id)?.msgs || []); }
  if (u.pathname === '/session/status') { const o = {}; for (const s of sessions.values()) o[s.id] = { type: Date.now() < s.busyUntil ? 'busy' : 'idle' }; return J(o); }
  if (u.pathname === '/permission') return J([]);
  if (/\/abort$/.test(u.pathname) || /\/reply$/.test(u.pathname)) return J(true);
  r.writeHead(404); r.end(); }); });
const noAuth = await fetch(`http://127.0.0.1:${BAD}/global/health`).then(r => r.status);
const yesAuth = await fetch(`http://127.0.0.1:${BAD}/global/health`, { headers: { authorization: 'Basic ' + Buffer.from('opencode:' + PW).toString('base64') } }).then(r => r.json());
ok('OpenCode-shaped server: 401 without a password, healthy with Basic opencode:password', noAuth === 401 && yesAuth.healthy === true);

fs.writeFileSync(T + '/bin/blender', `#!/usr/bin/python3
import json, os, struct, sys
args = sys.argv[1:]; joined = " ".join(args)
if "--version" in args:
    print("Blender 5.2.2"); raise SystemExit(0)
if "probe.py" in joined:
    print('MKPROBE {"version":"5.2.2","python":"3.11","engines":["CYCLES"],"gltf":true,"fbx":true}'); raise SystemExit(0)
dd = args.index("--"); mode, params_file, vdir = args[dd+1], args[dd+2], args[dd+3]
params = json.load(open(params_file, encoding="utf-8"))
os.makedirs(vdir + "/logs", exist_ok=True); os.makedirs(vdir + "/renders", exist_ok=True)
if mode == "build":
    open(vdir + "/scene.blend", "wb").write(b"BLENDER")
    json.dump({"ok": True, "objects": ["Cube"], "materials": ["Mat"], "blend": "scene.blend"}, open(vdir + "/logs/build-result.json", "w"))
    raise SystemExit(0)
if mode == "render":
    png = bytearray(128); struct.pack_into(">I", png, 0, 0x89504E47); struct.pack_into(">I", png, 4, 0x0D0A1A0A)
    struct.pack_into(">I", png, 16, params["render"]["width"]); struct.pack_into(">I", png, 20, params["render"]["height"])
    open(vdir + "/renders/preview.png", "wb").write(png)
    json.dump({"ok": True, "engine": params["render"]["engine"], "objects": ["Cube"], "files": ["renders/preview.png"]}, open(vdir + "/logs/render-result.json", "w"))
    raise SystemExit(0)
raise SystemExit(3)
`, { mode: 0o755 });

const outLog = [];
const studio = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: UD, PORT: String(P), STUDIO_BLENDER_BIN: T + '/bin/blender', OPENCODE_BIN: T + '/bin/fake-oc',
  STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log', STUDIO_3D_AGENT_TIMEOUT_MS: '8000' }, stdio: ['ignore', 'pipe', 'pipe'] });
studio.stdout.on('data', d => outLog.push(String(d))); studio.stderr.on('data', d => outLog.push(String(d)));
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${P}/api/health`)).ok) break; } catch {} await sleep(200); }
const H = () => ({ 'x-studio-app-token': fs.readFileSync(UD + '/app-token', 'utf8').trim(), 'content-type': 'application/json', 'x-studio-request': '1' });
const api = async (m, p, b) => { const r = await fetch(`http://127.0.0.1:${P}${p}`, { method: m, headers: H(), body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' });
await api('PUT', '/api/integrations/ollama', { url: 'http://127.0.0.1:1', model: 'qwen3:8b' });
const view = await api('GET', '/api/opencode/auth');
ok('test build reports the same Keychain service and account it writes', view.j.keychain?.service === CFG.TEST.keychainService && view.j.keychain?.account === CFG.TEST.kcAccountOpencode && view.j.keychain?.label === CFG.TEST.keychainService + ' — OpenCode' && view.j.serve?.allowed === true && view.j.modelEffective === 'ollama/qwen3:8b', JSON.stringify(view.j.keychain));
const empty = await api('POST', '/api/opencode/serve');
ok('POST /api/opencode/serve without a saved password is 409', empty.status === 409 && /Keychain/.test(empty.j.error || '') && !fs.existsSync(marker), empty.j.error);
await api('PUT', '/api/opencode/auth', { url: CFG.PROD.opencodeUrl, username: 'opencode', password: PW });
fs.rmSync(marker, { force: true });
const prodUrl = await api('POST', '/api/opencode/serve');
ok('test app refuses to launch OpenCode on the production URL', prodUrl.status === 400 && !fs.existsSync(marker), prodUrl.j.error);
await api('PUT', '/api/opencode/auth', { url: CFG.TEST.opencodeUrl });
const up = await api('POST', '/api/opencode/serve');
const mark2 = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, 'utf8')) : {};
ok('test app starts OpenCode on 4097 and does not log the password', up.j.ok === true && up.j.url === 'http://127.0.0.1:4097' && mark2.argv?.join(' ') === 'serve --hostname 127.0.0.1 --port 4097' && mark2.pwSet === true && mark2.leaked === false && !outLog.join('').includes(PW), JSON.stringify(mark2));
const kc = JSON.parse(fs.readFileSync(KC + '/kc.json', 'utf8'));
ok('password item key is service|account of the TEST build', kc[CFG.TEST.keychainService + '|' + CFG.TEST.kcAccountOpencode] === PW && !Object.keys(kc).some(k => k.startsWith(CFG.PROD.keychainService + '|')));

await api('PUT', '/api/studio3d/settings', { blenderPath: T + '/bin/blender', opencodeModel: '' });
const terminal = j => ['waiting_approval', 'failed', 'blocked', 'cancelled', 'done'].includes(j.status);
const waitJob = async (taskId) => { const t0 = Date.now(); let j; while (Date.now() - t0 < 90000) { const l = (await api('GET', '/api/jobs?limit=20')).j; j = Array.isArray(l) && l.find(x => x.taskId === taskId); if (j && terminal(j)) return (await api('GET', '/api/jobs/' + j.id)).j; await sleep(400); } return j; };
const ev = j => (j?.events || []).map(e => e.msg).join('\n');
const jRef = await waitJob((await api('POST', '/api/studio3d/run', { text: 'Кот соединение отклонено' })).j.id);
const sp = jRef?.checkpoint?.vdir && JSON.parse(fs.readFileSync(path.join(jRef.checkpoint.vdir, 'scene_params.json'), 'utf8'));
const blend = jRef?.checkpoint?.vdir && fs.readFileSync(path.join(jRef.checkpoint.vdir, 'scene.blend'));
const png = jRef?.checkpoint?.vdir && fs.readFileSync(path.join(jRef.checkpoint.vdir, 'renders', 'preview.png'));
ok('OpenCode down → fallback writes valid scene_params.json, .blend and PNG', jRef?.status === 'waiting_approval' && /\+fallback$/.test(jRef.checkpoint?.paramsBy || '') && /не записал scene_params\.json/.test(ev(jRef)) && sp && sp.subject !== 'import os' && blend?.slice(0, 7).toString() === 'BLENDER' && png?.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === sp.render.width && jRef.outputs?.blendReady && jRef.outputs?.previewReady && jRef.outputs.blend.endsWith('/scene.blend') && jRef.outputs.preview.endsWith('/renders/preview.png'), (jRef?.error || '') + ' ' + jRef?.status);

await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${UNAUTH}` });
const j401 = await waitJob((await api('POST', '/api/studio3d/run', { text: 'Кот неверный пароль' })).j.id);
ok('HTTP 401 stays blocked and does not write a fallback scene', j401?.status === 'blocked' && /401/.test(j401.error || '') && !(j401.checkpoint?.vdir && fs.existsSync(path.join(j401.checkpoint.vdir, 'scene.blend'))), j401?.error);

await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${BAD}` });
const before = prompts.length;
const jBad = await waitJob((await api('POST', '/api/studio3d/run', { text: 'Кот плохой json' })).j.id);
ok('bad JSON twice → fallback, exactly 2 prompts, files ready', jBad?.status === 'waiting_approval' && prompts.length - before === 2 && /не записал scene_params\.json/.test(ev(jBad)) && jBad.outputs?.sceneParamsReady && jBad.outputs?.blendReady, (jBad?.error || '') + ' prompts=' + (prompts.length - before));
ok('studio log never contains the OpenCode password', !outLog.join('').includes(PW));

const prod = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'prod', STUDIO_DATA_DIR: T + '/prod-data', PORT: String(PPROD), STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: T + '/prod-kc.json' }, stdio: ['ignore', 'pipe', 'pipe'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PPROD}/api/health`)).ok) break; } catch {} await sleep(200); }
const tok = fs.readFileSync(T + '/prod-data/app-token', 'utf8').trim();
const PH = { 'x-studio-app-token': tok, 'x-studio-request': '1', 'content-type': 'application/json' };
await fetch(`http://127.0.0.1:${PPROD}/api/auth/setup`, { method: 'POST', headers: PH, body: JSON.stringify({ username: 'igor', password: 'fake-admin-pw-1' }) });
const pr = await fetch(`http://127.0.0.1:${PPROD}/api/opencode/serve`, { method: 'POST', headers: PH, body: '{}' });
const prText = await pr.text();
ok('production flavor refuses the in-app launcher (403)', pr.status === 403 && /тестовой сборке/.test(prText), pr.status + ' ' + prText.slice(0, 200));
prod.kill('SIGTERM'); studio.kill('SIGTERM'); unauth.close(); bad.close();
await sleep(300);
console.log(`\n${res.filter(r => r[1]).length}/${res.length} passed`);
process.exit(res.every(r => r[1]) ? 0 : 1);
