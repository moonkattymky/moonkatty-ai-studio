// v1.2.3-test.1 regression: the 3D DESIGN agent step with a FAKE OpenCode server (Basic Auth, fake password) that never
// calls tools and answers with text, plus a REAL headless Blender for the full pipeline to PNG. Covers: JSON in text
// (studio writes scene_params.json), fenced JSON, permission ask (must be rejected), out-of-folder write ask (rejected,
// nothing written), agent-created file (job stopped), malformed JSON (one bounded retry → success / clear error),
// model error, no answer (timeout), symlink escape of scene_params.json. Usage: node scripts/opencode-json-test.mjs
import http from 'http'; import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PW = 'test-fake-pw-789', BL_BIN = process.env.STUDIO_BLENDER_BIN || '/workspace/tools/blender-5.2.2-linux-x64/blender';
const P = 8830, OC = 14296, T = '/tmp/mk-ocjson-test', UD = T + '/data', KC = T + '/kc';
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(KC, { recursive: true }); const OUTSIDE = T + '/outside-by-agent.txt';
const sleep = ms => new Promise(r => setTimeout(r, ms)); const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 400) : '')); };
if (!fs.existsSync(BL_BIN)) { console.log('SKIP: blender not found at ' + BL_BIN); process.exit(2); }
// ---- unit: strict schema + safe writer
const SP = require('../lib/scene-params.js'); const { writeParamsSafe } = require('../lib/executors/design3d.js');
ok('schema: extra key rejected', !SP.validate({ ...SP.DEFAULTS, path: '/etc/passwd' }).ok);
ok('schema: path-like title rejected', !SP.validate({ ...SP.DEFAULTS, title: '../../etc/passwd' }).ok);
ok('schema: enum/range/type violations rejected', !SP.validate({ ...SP.DEFAULTS, subject: 'import os' }).ok && !SP.validate({ ...SP.DEFAULTS, render: { ...SP.DEFAULTS.render, samples: 1e6 } }).ok && !SP.validate({ ...SP.DEFAULTS, camera: 'x' }).ok && !SP.validate({ ...SP.DEFAULTS, animation: { frames: 1, cmd: 'x' } }).ok);
ok('extractJson: fenced, bare, none, broken', SP.extractJson('x ```json\n{"a":1}\n``` y').value?.a === 1 && SP.extractJson('ok {"a":"}"} end').value?.a === '}' && !SP.extractJson('нет json').ok && !SP.extractJson('{"a": ').ok);
const vd = T + '/unit/v001'; fs.mkdirSync(vd, { recursive: true }); const victim = T + '/unit/victim.json'; fs.writeFileSync(victim, 'ORIG');
fs.symlinkSync(victim, vd + '/scene_params.json'); let thrown = ''; try { writeParamsSafe(vd, SP.DEFAULTS); } catch (e) { thrown = e.message; }
ok('safe writer: symlinked scene_params.json refused, symlink target untouched', /символическая ссылка|вне рабочей папки/.test(thrown) && fs.readFileSync(victim, 'utf8') === 'ORIG', thrown);
fs.rmSync(vd + '/scene_params.json'); fs.symlinkSync(T + '/unit', T + '/unit/link'); thrown = ''; try { writeParamsSafe(T + '/unit/link', SP.DEFAULTS); } catch (e) { thrown = e.message; }
ok('safe writer: symlinked project folder refused', /символическая ссылка/.test(thrown), thrown);
thrown = ''; try { writeParamsSafe(vd, { ...SP.DEFAULTS, subject: 'rm -rf' }); } catch (e) { thrown = e.message; } ok('safe writer: invalid params never written', /строгую проверку/.test(thrown) && !fs.existsSync(vd + '/scene_params.json'));
writeParamsSafe(vd, SP.DEFAULTS); ok('safe writer: valid params written inside folder (0600)', SP.validate(JSON.parse(fs.readFileSync(vd + '/scene_params.json', 'utf8'))).ok && (fs.statSync(vd + '/scene_params.json').mode & 0o777) === 0o600);
// ---- fake OpenCode server
const sessions = new Map(), perms = [], replies = [], prompts = []; let nid = 0;
const DEF = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow', edit: 'deny', bash: 'deny', webfetch: 'deny', websearch: 'deny', external_directory: 'deny' };
const goodJson = () => JSON.stringify({ ...SP.DEFAULTS, title: 'Fake agent cat', subject: 'cat', render: { engine: 'CYCLES', samples: 8, width: 320, height: 240 } });
function answer(s, text, n) { const k = s.task;
  if (/FAKE_SILENT/.test(k)) return null;
  if (/FAKE_ERROR/.test(k)) return { error: { name: 'APIError', data: { message: 'model "qwen-missing" not found' } } };
  if (/FAKE_BADJSON/.test(k)) return { text: n === 1 ? '{"subject": "cat", ' : 'Извините, не могу.' };
  if (/FAKE_FIXRETRY/.test(k)) return { text: n === 1 ? '{"subject": "dragon"}' : goodJson() };
  if (/FAKE_FENCE/.test(k)) return { text: 'Вот параметры:\n```json\n' + goodJson() + '\n```' };
  return { text: goodJson() }; }
const fake = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  const J = (o, st = 200) => { r.writeHead(st, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
  if (q.headers.authorization !== 'Basic ' + Buffer.from('opencode:' + PW).toString('base64')) { r.writeHead(401); return r.end(); }
  const u = new URL(q.url, 'http://x'); const dir = u.searchParams.get('directory'); let body = {}; try { body = JSON.parse(b || '{}'); } catch {}
  let m;
  if (u.pathname === '/global/health') return J({ healthy: true, version: '1.19.3' });
  if (u.pathname === '/config') return J({ permission: DEF });
  if (u.pathname === '/event') { r.writeHead(200, { 'content-type': 'text/event-stream' }); return; }
  if (u.pathname === '/session' && q.method === 'POST') { const id = 'ses_fake' + (++nid); sessions.set(id, { id, dir, msgs: [], busyUntil: 0, n: 0, task: '' }); return J({ id }); }
  if (u.pathname === '/session/status') { const o = {}; for (const s of sessions.values()) o[s.id] = { type: Date.now() < s.busyUntil ? 'busy' : 'idle' }; return J(o); }
  if ((m = /^\/session\/([^/]+)\/prompt_async$/.exec(u.pathname))) { const s = sessions.get(m[1]); const text = body.parts?.[0]?.text || ''; prompts.push({ sid: s.id, dir, tools: body.tools, text });
    if (!s.task) s.task = text; s.n++; s.msgs.push({ info: { role: 'user' }, parts: [{ type: 'text', text }] });
    if (s.n === 1 && /FAKE_ASK/.test(s.task)) perms.push({ id: 'per_' + (++nid), sessionID: s.id, permission: 'edit', patterns: [path.join(dir, 'scene_params.json')], metadata: { filepath: path.join(dir, 'scene_params.json') } });
    if (s.n === 1 && /FAKE_OUTSIDE/.test(s.task)) perms.push({ id: 'per_' + (++nid), sessionID: s.id, permission: 'external_directory', patterns: [OUTSIDE], metadata: { filepath: OUTSIDE } }, { id: 'per_' + (++nid), sessionID: s.id, permission: 'edit', metadata: { filepath: OUTSIDE } });
    if (s.n === 1 && /FAKE_DROPFILE/.test(s.task)) fs.writeFileSync(path.join(dir, 'evil.py'), 'import os');
    s.busyUntil = Date.now() + 1200; const a = answer(s, text, s.n);
    if (a) setTimeout(() => { if (perms.some(p => p.sessionID === s.id)) { const iv = setInterval(() => { if (!perms.some(p => p.sessionID === s.id)) { clearInterval(iv); fin(); } }, 100); } else fin(); }, 1000);
    function fin() { s.msgs.push({ info: { role: 'assistant', time: { completed: Date.now() }, ...(a.error ? { error: a.error } : { finish: 'stop' }) }, parts: a.text ? [{ type: 'text', text: a.text }] : [] }); s.busyUntil = 0; }
    if (!a) s.busyUntil = 0;
    r.writeHead(204); return r.end(); }
  if ((m = /^\/session\/([^/]+)\/message$/.exec(u.pathname))) return J(sessions.get(m[1])?.msgs || []);
  if ((m = /^\/session\/([^/]+)\/abort$/.exec(u.pathname))) return J(true);
  if (u.pathname === '/permission') return J(perms);
  if ((m = /^\/permission\/([^/]+)\/reply$/.exec(u.pathname))) { const i = perms.findIndex(p => p.id === m[1]); if (i >= 0) { replies.push({ ...perms[i], reply: body.reply }); perms.splice(i, 1); } return J(true); }
  r.writeHead(404); r.end(); }); }).listen(OC, '127.0.0.1');
// ---- studio
const outLog = []; const studio = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: process.env.STUDIO_FLAVOR || 'prod', STUDIO_DATA_DIR: UD, PORT: String(P), STUDIO_BLENDER_BIN: BL_BIN,
  STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log', STUDIO_3D_AGENT_TIMEOUT_MS: '6000' }, stdio: ['ignore', 'pipe', 'pipe'] });
studio.stdout.on('data', d => outLog.push(String(d))); studio.stderr.on('data', d => outLog.push(String(d)));
for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${P}/api/health`); break; } catch { await sleep(300); } }
const H = () => ({ 'x-studio-app-token': fs.readFileSync(UD + '/app-token', 'utf8').trim(), 'content-type': 'application/json', 'x-studio-request': '1' });
const api = async (m, p, b) => { const r = await fetch(`http://127.0.0.1:${P}${p}`, { method: m, headers: H(), body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' });
await api('PUT', '/api/integrations/ollama', { url: 'http://127.0.0.1:11998', model: 'qwen3:8b' });
await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}`, username: 'opencode', password: PW });
await api('PUT', '/api/studio3d/settings', { opencodeModel: 'ollama/qwen2.5-coder:7b' });
const terminal = j => ['waiting_approval', 'failed', 'blocked', 'cancelled', 'done'].includes(j.status);
const waitJob = async (taskId, ms = 240000) => { const t0 = Date.now(); let j; while (Date.now() - t0 < ms) { const l = (await api('GET', '/api/jobs?limit=100')).j; j = Array.isArray(l) && l.find(x => x.taskId === taskId); if (j && terminal(j)) return (await api('GET', '/api/jobs/' + j.id)).j; await sleep(700); } return j; };
const evText = j => (j?.events || []).map(e => `[${e.stage}] ${e.msg} ${e.rule || ''}`).join('\n');
const run = async text => waitJob((await api('POST', '/api/studio3d/run', { text })).j.id);
// 1. full pipeline: no tool calls, JSON in text → studio writes params → real Blender → PNG
const j1 = await run('Кот FAKE_JSON фиолетовый');
ok('no-tool-call agent: job reaches waiting_approval (full pipeline)', j1?.status === 'waiting_approval', j1?.status + ' ' + (j1?.error || '') + '\n' + evText(j1));
const v1 = j1?.checkpoint?.vdir; const sp1 = v1 && JSON.parse(fs.readFileSync(v1 + '/scene_params.json', 'utf8'));
ok('scene_params.json written by the studio from the agent JSON text', sp1?.title === 'Fake agent cat' && /записаны студией/.test(evText(j1)) && /\+opencode$/.test(j1.checkpoint.paramsBy));
const png = v1 && fs.existsSync(v1 + '/renders/preview.png') && fs.readFileSync(v1 + '/renders/preview.png');
ok('real Blender PNG rendered (320×240 from agent params)', png && png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 320 && png.readUInt32BE(20) === 240, png && png.length + ' bytes');
if (png) fs.copyFileSync(v1 + '/renders/preview.png', '/workspace/sample-render-ocjson.png');
ok('session created with directory = job version folder; tools disabled in prompt', prompts.some(p => p.dir === v1 && p.tools && p.tools.write === false && p.tools.edit === false && p.tools.bash === false));
// 2. fenced JSON
const j2 = await run('Кот FAKE_FENCE'); ok('fenced ```json answer accepted', j2?.status === 'waiting_approval', j2?.error);
// 3. permission ask inside folder → rejected anyway; params still written by studio
const j3 = await run('Кот FAKE_ASK');
ok('permission ask (edit in-folder) REJECTED by studio, job still succeeds via studio write', j3?.status === 'waiting_approval' && replies.some(x => x.permission === 'edit' && x.reply === 'reject' && x.sessionID === j3.checkpoint.sessionID) && /ОТКЛОНЕНО.*oc\.notools/.test(evText(j3)), (j3?.error || '') + evText(j3));
// 4. out-of-folder write ask → rejected (fs.outside), nothing written outside
const j4 = await run('Кот FAKE_OUTSIDE');
ok('out-of-folder write ask REJECTED (fs.outside), no file outside', replies.filter(x => x.sessionID === j4?.checkpoint?.sessionID).every(x => x.reply === 'reject') && /ОТКЛОНЕНО.*fs\.outside/.test(evText(j4)) && !fs.existsSync(OUTSIDE), evText(j4));
// 5. agent dropped a file in the folder → job stopped
const j5 = await run('Кот FAKE_DROPFILE'); ok('file created by agent → job failed, no Blender run', j5?.status === 'failed' && /создал файлы.*evil\.py/.test(j5.error) && !fs.existsSync(j5.checkpoint.vdir + '/scene.blend'), j5?.error);
// 6. malformed JSON then fixed (one bounded retry)
const j6 = await run('Кот FAKE_FIXRETRY'); ok('invalid JSON → 1 retry → success', j6?.status === 'waiting_approval' && /попытка 1\/2/.test(evText(j6)) && /Повторный запрос/.test(evText(j6)), j6?.error);
// 7. malformed twice → clear Russian error, no more than 2 prompts
const j7 = await run('Кот FAKE_BADJSON'); const n7 = prompts.filter(p => p.sid === j7?.checkpoint?.sessionID).length;
ok('malformed JSON twice → failed with Russian message (OLLAMA_CONTEXT_LENGTH hint), exactly 2 prompts', j7?.status === 'failed' && /не вернул корректный JSON.*OLLAMA_CONTEXT_LENGTH/.test(j7.error) && n7 === 2, j7?.error + ' prompts=' + n7);
// 8. model error
const j8 = await run('Кот FAKE_ERROR'); ok('model error → failed «Ошибка модели в OpenCode»', j8?.status === 'failed' && /Ошибка модели в OpenCode.*not found/.test(j8.error), j8?.error);
// 9. no answer → timeout
const j9 = await run('Кот FAKE_SILENT'); ok('no answer → timeout error in Russian', j9?.status === 'failed' && /не ответил за \d+ с/.test(j9.error), j9?.error);
ok('no password in studio output', !outLog.join('').includes(PW));
console.log(`\n${res.filter(r => r[1]).length}/${res.length} passed`);
studio.kill('SIGTERM'); fake.close(); await sleep(300); process.exit(res.every(r => r[1]) ? 0 : 1);
