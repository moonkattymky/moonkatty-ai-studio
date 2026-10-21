// Read-only against the v1.2.4 tree. Real opencode 1.19.3, real Blender, fake passwords.
// Phase A uses the product mock LLM, which turns the studio prompt into a write tool call.
// Phase B replaces that mock with a chat-only model so the missing scene_params.json path is observed.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.SCENE_SRC || '/tmp/mk-scene';
const OC_BIN = process.env.OPENCODE_BIN || '/tmp/oc-install/node_modules/.bin/opencode';
const BL_BIN = process.env.STUDIO_BLENDER_BIN || '/tmp/blender-4.2.9/blender';
const ROOT = process.env.SCENE_RUN || '/tmp/mk-scene-run';
const LLM = 11621, OC = 14221, P = 8831;
const PW = 'test-fake-pw-123';
const logs = path.join(here, 'logs');
fs.mkdirSync(logs, { recursive: true });
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT + '/ochome', { recursive: true });
const kids = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function noWriteMock() {
  const srv = http.createServer((q, r) => {
    let b = ''; q.on('data', d => b += d); q.on('end', () => {
      if (q.url.endsWith('/models')) { r.setHeader('content-type', 'application/json'); return r.end(JSON.stringify({ data: [{ id: 'mock-coder' }] })); }
      r.setHeader('content-type', 'text/event-stream');
      const send = o => r.write('data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'mock-coder', ...o }) + '\n\n');
      send({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Вот параметры в чате, файл не пишу.' }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
      r.write('data: [DONE]\n\n'); r.end();
    });
  });
  return new Promise(res => srv.listen(LLM, '127.0.0.1', () => res(srv)));
}

function sp(cmd, args, env, tag) {
  const p = spawn(cmd, args, { cwd: SRC, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const f = fs.createWriteStream(path.join(logs, tag + '.log'), { flags: 'a' });
  p.stdout.on('data', d => f.write(d)); p.stderr.on('data', d => f.write(d));
  p.on('exit', () => f.end());
  kids.push(p); return p;
}

const studioCfg = JSON.parse(fs.readFileSync(path.join(SRC, 'opencode/opencode-studio.json'), 'utf8'));
const ocJson = {
  ...studioCfg,
  provider: { mock: { npm: '@ai-sdk/openai-compatible', name: 'Mock', options: { baseURL: `http://127.0.0.1:${LLM}/v1` }, models: { 'mock-coder': { name: 'mock-coder', tool_call: true } } } },
  model: 'mock/mock-coder', small_model: 'mock/mock-coder', permission: studioCfg.permission,
};
fs.writeFileSync(ROOT + '/oc.json', JSON.stringify(ocJson));
let mock = sp(process.execPath, [path.join(SRC, 'scripts/test-fixtures/mock-llm.mjs'), String(LLM)], process.env, 'llm');
sp(OC_BIN, ['serve', '--hostname', '127.0.0.1', '--port', String(OC)], {
  PATH: process.env.PATH, HOME: ROOT + '/ochome', OPENCODE_CONFIG: ROOT + '/oc.json',
  OPENCODE_SERVER_PASSWORD: PW, OPENCODE_DISABLE_AUTOUPDATE: '1',
}, 'oc');
const UD = ROOT + '/data', KC = ROOT + '/kc';
fs.mkdirSync(KC, { recursive: true });
sp(process.execPath, ['server.js'], {
  ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(P),
  NODE_PATH: process.env.NODE_PATH || '/workspace/node_modules', STUDIO_BLENDER_BIN: BL_BIN,
  STUDIO_TEST_SECURITY_BIN: path.join(SRC, 'scripts/test-fixtures/fake-security.mjs'),
  FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log',
  STUDIO_3D_AGENT_TIMEOUT_MS: '90000',
}, 'studio');

async function waitHttp(u, h) {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(3000) }); if (r.status < 500) return r.status; } catch {}
    await sleep(500);
  }
  return 0;
}
const basic = { authorization: 'Basic ' + Buffer.from('opencode:' + PW).toString('base64') };
const ocStatus = await waitHttp(`http://127.0.0.1:${OC}/global/health`);
log('opencode no-auth', ocStatus);
const hv = await (await fetch(`http://127.0.0.1:${OC}/global/health`, { headers: basic })).json();
log('opencode health', JSON.stringify(hv));
await waitHttp(`http://127.0.0.1:${P}/api/health`);
const H = () => ({ 'x-studio-app-token': fs.readFileSync(UD + '/app-token', 'utf8').trim(), 'content-type': 'application/json', 'x-studio-request': '1' });
const api = async (m, p, b) => {
  const r = await fetch(`http://127.0.0.1:${P}${p}`, { method: m, headers: H(), body: b === undefined ? undefined : JSON.stringify(b) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { status: r.status, j, t };
};
log('setup', (await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' })).status);
log('ollama', (await api('PUT', '/api/integrations/ollama', { url: 'http://127.0.0.1:11999', model: 'qwen3:8b' })).status);
log('oc-auth', (await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}`, username: 'opencode', password: PW })).status);
log('oc-test', JSON.stringify((await api('POST', '/api/opencode/test')).j));
log('model', (await api('PUT', '/api/studio3d/settings', { opencodeModel: 'mock/mock-coder' })).status);
const st = (await api('GET', '/api/studio3d/status?refresh=1')).j;
log('blender', JSON.stringify({ ok: st.blender?.ok, version: st.blender?.version, engines: st.blender?.engines, error: st.blender?.error }));

const terminal = j => j && ['waiting_approval', 'failed', 'blocked', 'cancelled', 'done'].includes(j.status);
async function waitJob(taskId, ms = 420000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const l = (await api('GET', '/api/jobs?limit=100')).j;
    const row = Array.isArray(l) && l.find(x => x.taskId === taskId);
    if (row && terminal(row)) return (await api('GET', '/api/jobs/' + row.id)).j;
    await sleep(800);
  }
  return null;
}
function inspect(j) {
  const vdir = j?.checkpoint?.vdir;
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  const blend = vdir && path.join(vdir, 'scene.blend');
  const png = vdir && path.join(vdir, 'renders/preview.png');
  const params = vdir && path.join(vdir, 'scene_params.json');
  const blendBuf = blend && fs.existsSync(blend) ? fs.readFileSync(blend) : null;
  const pngBuf = png && fs.existsSync(png) ? fs.readFileSync(png) : null;
  return {
    status: j?.status || null, stage: j?.stage || null, error: j?.error || null, paramsBy: j?.checkpoint?.paramsBy || null,
    sceneParams: !!(params && fs.existsSync(params)),
    blend: blendBuf ? { bytes: blendBuf.length, magic: blendBuf.subarray(0, 7).toString() } : null,
    png: pngBuf && pngBuf.length >= 24 ? { bytes: pngBuf.length, magic: pngBuf.readUInt32BE(0).toString(16), w: pngBuf.readUInt32BE(16), h: pngBuf.readUInt32BE(20) } : null,
    build: vdir && read(path.join(vdir, 'logs/build-result.json')),
    render: vdir && read(path.join(vdir, 'logs/render-result.json')),
    events: (j?.events || []).map(e => `[${e.stage}] ${e.msg}`).slice(-12),
  };
}

const a = await api('POST', '/api/studio3d/run', { text: 'Создай фиолетового кота MOONKATTY в студийном свете' });
log('task A', a.status, a.j.id || a.t.slice(0, 200));
const ja = await waitJob(a.j.id);
const ra = inspect(ja);
if (ra.png) {
  const src = path.join(ja.checkpoint.vdir, 'renders/preview.png');
  fs.copyFileSync(src, path.join(logs, 'preview.png'));
}
log('PHASE_A', JSON.stringify(ra, null, 2));

mock.kill('SIGTERM');
await sleep(400);
const nw = await noWriteMock();
const b = await api('POST', '/api/studio3d/run', { text: 'Кот без инструмента записи' });
log('task B', b.status, b.j.id || b.t.slice(0, 200));
const jb = await waitJob(b.j.id, 120000);
const rb = inspect(jb);
log('PHASE_B', JSON.stringify(rb, null, 2));
fs.writeFileSync(path.join(logs, 'result.json'), JSON.stringify({
  commit: '6cf7c08a3e0447c0871ba01597d5ad150e99e47f', opencode: hv, blender: st.blender, phaseA: ra, phaseB: rb,
}, null, 2));
nw.close();
for (const k of kids) { try { k.kill('SIGTERM'); } catch {} }
await sleep(400);
const passA = ra.status === 'waiting_approval' && ra.sceneParams && ra.blend?.magic === 'BLENDER' && ra.png?.magic === '89504e47';
const passB = rb.status === 'failed' && /scene_params\.json/.test(rb.error || '') && !rb.blend;
log(passA && passB ? 'HARNESS_OK' : 'HARNESS_FAIL');
process.exit(passA && passB ? 0 : 1);
