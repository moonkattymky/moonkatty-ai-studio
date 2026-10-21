// E2E of the v1.2.2-test safe scenario on Linux, in TEST flavor (isolated names/ports/Keychain service/data dir):
//   user types in the 3D Studio panel «Создай тестовую 3D-сцену, сохрани проект Blender и сделай PNG-рендер»
//   → Director → 3D DESIGN agent → REAL `opencode serve` (port 4097, Basic Auth; password from the TEST Keychain service
//   via the fake `security` fixture) → vetted Blender template → REAL headless Blender → .blend + PNG with SHA-256 → panel.
// The LLM behind OpenCode is the deterministic mock (scripts/test-fixtures/mock-llm.mjs). Screenshot: /workspace/test-build-e2e.png
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { chromium } from 'playwright-core';
const OC_BIN = process.env.OPENCODE_BIN || '/workspace/tools/oc/node_modules/.bin/opencode';
const BL_BIN = process.env.STUDIO_BLENDER_BIN || '/workspace/tools/blender-5.2.2-linux-x64/blender';
const SHOT = process.env.E2E_SHOT || '/workspace/test-build-e2e.png';
const T = '/tmp/mk-e2e-testbuild', HOME = T + '/home', UD = HOME + '/Library/Application Support/MOONKATTY AI STUDIO TEST', KC = T + '/kc';
const P = 8687, OC = 4097, LLM = 11620, PW = 'e2e-fake-test-pw-' + crypto.randomBytes(4).toString('hex');
const PHRASE = 'Создай тестовую 3D-сцену, сохрани проект Blender и сделай PNG-рендер';
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(KC, { recursive: true }); fs.mkdirSync(UD, { recursive: true }); fs.mkdirSync(T + '/ochome');
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 400) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms)); const kids = []; const logs = [];
const sp = (cmd, args, env, tag) => { const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', d => logs.push(tag + d)); p.stderr.on('data', d => logs.push(tag + d)); kids.push(p); return p; };
const done = code => { for (const k of kids) try { k.kill('SIGTERM'); } catch {} if (code) fs.writeFileSync(T + '/logs.txt', logs.join('')); setTimeout(() => process.exit(code), 500); };
for (const [b, n] of [[OC_BIN, 'opencode'], [BL_BIN, 'blender']]) if (!fs.existsSync(b)) { console.log(`SKIP: ${n} not found at ${b}`); process.exit(2); }
sp(process.execPath, ['scripts/test-fixtures/mock-llm.mjs', String(LLM)], process.env, '[llm] ');
const studioCfg = JSON.parse(fs.readFileSync('opencode/opencode-studio.json', 'utf8'));
fs.writeFileSync(T + '/oc.json', JSON.stringify({ ...studioCfg, provider: { mock: { npm: '@ai-sdk/openai-compatible', name: 'Mock', options: { baseURL: `http://127.0.0.1:${LLM}/v1` }, models: { 'mock-coder': { name: 'mock-coder', tool_call: true } } } }, model: 'mock/mock-coder', small_model: 'mock/mock-coder' }));
sp(OC_BIN, ['serve', '--hostname', '127.0.0.1', '--port', String(OC)], { PATH: process.env.PATH, HOME: T + '/ochome', OPENCODE_CONFIG: T + '/oc.json', OPENCODE_SERVER_PASSWORD: PW, OPENCODE_DISABLE_AUTOUPDATE: '1' }, '[oc] ');
sp(process.execPath, ['server.js'], { ...process.env, HOME, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, STUDIO_BLENDER_BIN: BL_BIN,
  STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log', STUDIO_3D_AGENT_TIMEOUT_MS: '90000' }, '[studio] ');
const waitHttp = async u => { for (let i = 0; i < 120; i++) { try { const r = await fetch(u, { signal: AbortSignal.timeout(3000) }); if (r.status < 500) return r.status; } catch {} await sleep(500); } return 0; };
await waitHttp(`http://127.0.0.1:${P}/api/health`); await waitHttp(`http://127.0.0.1:${OC}/global/health`);
const h = await (await fetch(`http://127.0.0.1:${P}/api/health`)).json();
ok('studio runs as TEST flavor on 8687 with schema 6', h.flavor === 'test' && h.product === 'MOONKATTY AI STUDIO TEST' && h.schemaVersion === 6);
const TOK = fs.readFileSync(UD + '/app-token', 'utf8').trim(); const H = { 'x-studio-app-token': TOK, 'content-type': 'application/json', 'x-studio-request': '1' };
const api = async (m, p, b) => { const r = await fetch(`http://127.0.0.1:${P}${p}`, { method: m, headers: H, body: b === undefined ? undefined : JSON.stringify(b) }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };
await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' });
await api('PUT', '/api/integrations/ollama', { url: 'http://127.0.0.1:11999', model: 'qwen3:8b' }); // no Ollama → rule params (honest)
// The owner adds the OpenCode password to the TEST Keychain item (on the Mac: `security add-generic-password … -w` prompt). Here: via the panel → fake Keychain.
let r = await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}`, username: 'opencode', password: PW });
const kc = JSON.parse(fs.readFileSync(KC + '/kc.json', 'utf8'));
ok('OpenCode password stored ONLY in TEST Keychain service "MOONKATTY AI STUDIO.test"', kc['MOONKATTY AI STUDIO.test|opencode-server-password'] === PW && !Object.keys(kc).some(k => k.startsWith('MOONKATTY AI STUDIO|')), r.s);
ok('OpenCode (port 4097) check with Basic Auth from TEST Keychain', (await api('POST', '/api/opencode/test')).j.ok === true);
await api('PUT', '/api/studio3d/settings', { opencodeModel: 'mock/mock-coder' });
// UI: type the phrase in the 3D Studio panel
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU', extraHTTPHeaders: { 'X-Studio-App-Token': TOK } });
const pg = await ctx.newPage(); await pg.goto(`http://127.0.0.1:${P}/#studio3d`); await pg.waitForSelector('#s3text', { timeout: 30000 });
await sleep(3000); // let the panel finish its first refresh/render before typing
for (let i = 0; i < 3; i++) { await pg.fill('#s3text', PHRASE); await pg.click('#s3run'); await sleep(2000); if ((await api('GET', '/api/tasks')).j.some(t => t.kind === '3d' && t.title === PHRASE)) break; }
ok('panel input created a 3D task with the exact phrase', (await api('GET', '/api/tasks')).j.some(t => t.kind === '3d' && t.title === PHRASE));
let job = null; const t0 = Date.now();
while (Date.now() - t0 < 300000) { const l = (await api('GET', '/api/jobs?limit=20')).j; job = Array.isArray(l) && l.find(j => j.kind === '3d'); if (job && ['waiting_approval', 'failed', 'blocked', 'cancelled', 'done'].includes(job.status)) break; await sleep(1500); }
job = job && (await api('GET', '/api/jobs/' + job.id)).j; const ev = (job?.events || []).map(e => `[${e.stage}] ${e.msg}`).join('\n');
ok('job from panel phrase reaches waiting_approval (all stages)', job?.status === 'waiting_approval' && ['preflight', 'params', 'agent', 'validate', 'build', 'render', 'verify'].every(s => ev.includes('[' + s + ']')), job?.status + ' ' + (job?.error || '') + '\n' + ev.slice(-1500));
ok('agent step done by REAL OpenCode (session, JSON answer, params written by the studio — no agent tools)', /Сессия OpenCode/.test(ev) && /записаны студией/.test(ev) && !/пытался вызвать/.test(ev));
const cp = job?.checkpoint || {}; const vdir = path.join(UD, 'projects3d', cp.projectId || 'x', cp.version || 'x');
const blend = path.join(vdir, 'scene.blend'), png = path.join(vdir, 'renders', 'preview.png');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
ok('.blend saved inside TEST data dir (BLENDER magic)', fs.existsSync(blend) && fs.readFileSync(blend).subarray(0, 7).toString() === 'BLENDER', blend);
ok('PNG render saved (PNG magic)', fs.existsSync(png) && fs.readFileSync(png).subarray(1, 4).toString() === 'PNG', png);
const arts = job?.artifacts || []; const ab = arts.find(a => /scene\.blend$/.test(a.path || a.name || '')), ap = arts.find(a => /preview\.png$/.test(a.path || a.name || ''));
ok('artifacts carry SHA-256 equal to the files', ab && ap && ab.sha256 === sha(blend) && ap.sha256 === sha(png), JSON.stringify(arts).slice(0, 300));
await pg.goto(`http://127.0.0.1:${P}/#studio3d`); await sleep(4000);
const img = await pg.$('img[src*="preview.png"]'); ok('PNG displayed in the 3D Studio panel', !!img && await img.evaluate(i => i.complete && i.naturalWidth > 0));
await pg.screenshot({ path: SHOT, fullPage: false }); ok('screenshot saved ' + SHOT, fs.existsSync(SHOT));
console.log(JSON.stringify({ blend, blendSha256: fs.existsSync(blend) ? sha(blend) : null, png, pngSha256: fs.existsSync(png) ? sha(png) : null, jobId: job?.id }));
await browser.close();
const fails = res.filter(x => !x[1]).map(x => x[0]); console.log(JSON.stringify({ passed: res.length - fails.length, failed: fails })); done(fails.length ? 1 : 0);
