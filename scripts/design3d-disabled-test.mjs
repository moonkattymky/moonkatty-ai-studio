// v1.3.2-test candidate: 3D is NOT approved by the owner → every 3D entry point is refused (403 feature_disabled), nothing created/started:
// POST /api/jobs design3d|blender_template, POST /api/projects3d/:pid/:ver/rerender, POST /api/studio3d/run, Director chat 3D plans, runner tasks of the design3d agent (task failed before execution).
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path';
const MSG = 'design3d недоступен в этой тестовой сборке (3D-студия не одобрена)';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd3dd-')); const PORT = 18000 + Math.floor(Math.random() * 1000), B = `http://127.0.0.1:${PORT}`, PW = 'test-only-' + Math.random().toString(36).slice(2);
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: dir, HOST: '127.0.0.1', PORT: String(PORT), STUDIO_ADMIN_PASSWORD: PW }, stdio: 'ignore' });
let fails = 0; const t = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 0) INVENTORY: every 3D/Blender entry found by grep must go through lib/feature-gate.js ----
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const ROOT = new URL('..', import.meta.url).pathname; const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = d => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === 'test' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : /\.(js|mjs|cjs)$/.test(e.name) ? [path.join(d, e.name)] : []);
const files = ['server.js', 'runner.js', ...walk('lib'), ...walk('media-automation/src'), ...walk('node-agent')];
const found = [];
for (const f of files) { const src = rd(f).split('\n'); src.forEach((l, i) => {
  const at = `${f}:${i + 1}`;
  if (/\bspawn(Sync)?\(|execFile(Sync)?\(/.test(l) && /blender/i.test(src.slice(Math.max(0, i - 40), i + 3).join('\n')) && !/whois|security|piper|kokoro|ffmpeg/i.test(l)) found.push({ kind: 'blender spawn', at, l });
  if (/blender\.(runTemplate|detect)\(/.test(l)) found.push({ kind: 'blender call', at, l });
  if (/design3d\.(run|confirm)\b/.test(l)) found.push({ kind: 'design3d executor', at, l });
  if (/createJob\(\{\s*type:\s*'(design3d|blender_template)'/.test(l)) found.push({ kind: '3d createJob', at, l });
  if (/app\.(post|put|patch|delete)\('\/api\/(studio3d|projects3d\/:pid\/:ver\/(rerender|run))/.test(l)) found.push({ kind: '3d route', at, l });
  if (/app\.post\('\/api\/jobs(\/:id\/(retry|confirm|review))?'/.test(l)) found.push({ kind: 'jobs route', at, l });
  if (/new3dTask\(/.test(l)) found.push({ kind: 'new3dTask', at, l });
  if (/agentId === 'design3d'|kind: '3d'/.test(l)) found.push({ kind: '3d task creation/dispatch', at, l });
}); }
console.log('3D entry points found by grep (' + found.length + '):'); for (const x of found) console.log('  - [' + x.kind + '] ' + x.at);
const gateSrc = rd('lib/feature-gate.js'), blSrc = rd('lib/blender.js'), d3Src = rd('lib/executors/design3d.js'), svSrc = rd('lib/services.js'), srvSrc = rd('server.js'), rnSrc = rd('runner.js');
const NOT_BLENDER = { 'node-agent/agent.js': 'generic execFile helper; node profiles forbid Blender caps (FORBIDDEN regex), never runs Blender' };
for (const x of found.filter(x => x.kind === 'blender spawn' && !x.at.startsWith('lib/blender.js'))) console.log('    reviewed, not a Blender spawn: ' + x.at + ' — ' + (NOT_BLENDER[x.at.split(':')[0]] || 'UNREVIEWED'));
t('inventory: only spawn of Blender is lib/blender.js runProc (others reviewed)', found.filter(x => x.kind === 'blender spawn').every(x => x.at.startsWith('lib/blender.js') || NOT_BLENDER[x.at.split(':')[0]]) && /FORBIDDEN = [^\n]*blender/i.test(rd('node-agent/agent.js')));
t('inventory: runProc (every Blender spawn) asserts the gate first', /function runProc[^\n]*\n\s*require\('\.\/feature-gate\.js'\)\.assert3dAllowed\('blender:spawn'\)/.test(blSrc));
t('inventory: blender.runTemplate + detect gated', /runTemplate\([^\n]*\n\s*require\('\.\/feature-gate\.js'\)\.assert3dAllowed/.test(blSrc) && /detect\(configured[^\n]*\n[^\n]*feature-gate/.test(blSrc));
t('inventory: design3d executor run + confirm gated', /async function run\(a, t, signal\) \{\n\s*require\('\.\.\/feature-gate\.js'\)\.assert3dAllowed/.test(d3Src) && /function confirm\(jobId, ok\) \{ require\('\.\.\/feature-gate\.js'\)/.test(d3Src));
t('inventory: services createJob + blender_template service gated', /G3D\.assert3dAllowed\('jobsApi\.createJob/.test(svSrc) && /G3D\.assert3dAllowed\('services\.blender\.runTemplate'\)/.test(svSrc));
t('inventory: runner dispatch gated (shared gate passed to runner)', /ctx\.gate3d\.assert3dAllowed\('runner:'/.test(rnSrc) && /runner\.js'\)\(\{[^\n]*gate3d,/.test(srvSrc) && /runner\.register\('design3d', \(a, t, signal\) => \{ gate3d\.assert3dAllowed/.test(srvSrc));
t('inventory: route-level guards for /api/studio3d/*, projects3d rerender|run, jobs retry|confirm|review', /app\.use\('\/api\/studio3d'/.test(srvSrc) && /projects3d\\\/\[\^\/\]\+\\\/\[\^\/\]\+\\\/\(rerender\|run\)/.test(srvSrc) && /\(retry\|confirm\|review\)/.test(srvSrc));
t('inventory: director plan + new3dTask gated', /assert3dAllowed\('director\/chat'\)/.test(srvSrc) && /function new3dTask\(fields, user\) \{ gate3d\.assert3dAllowed/.test(srvSrc));
t('inventory: no local DESIGN3D_ENABLED literal outside lib/feature-gate.js', files.filter(f => f !== path.join('lib', 'feature-gate.js')).every(f => !/DESIGN3D_ENABLED\s*=\s*(true|false)/.test(rd(f))) && /const DESIGN3D_ENABLED = false;/.test(gateSrc));
// ---- 0b) unit: executor / Blender layer fails closed even if called directly (unknown path) ----
{ const g = require(path.join(ROOT, 'lib/feature-gate.js')); let e; try { g.assert3dAllowed('unit'); } catch (x) { e = x; } t('gate throws 403 feature_disabled', e && e.status === 403 && e.code === 'feature_disabled' && e.message === MSG);
  const bl = require(path.join(ROOT, 'lib/blender.js'))(); const d = await bl.detect('/usr/bin/blender', { force: true }); t('blender.detect → disabled, no probe spawn', d.ok === false && d.code === 'feature_disabled');
  let e2; try { await bl.runTemplate('/bin/true', 'scene_basic', 'build', '/nonexistent', os.tmpdir()); } catch (x) { e2 = x; } t('blender.runTemplate → feature_disabled (nothing spawned)', e2 && e2.code === 'feature_disabled');
  const d3 = require(path.join(ROOT, 'lib/executors/design3d.js'))({ jobs: {}, ws: {}, blender: bl, get: () => null, put: () => {}, log: () => {}, sec: {} });
  let e3; try { await d3.run({ id: 'design3d' }, { id: 't' }, new AbortController().signal); } catch (x) { e3 = x; } t('design3d executor run() → feature_disabled', e3 && e3.code === 'feature_disabled');
  let e4; try { d3.confirm('x', true); } catch (x) { e4 = x; } t('design3d executor confirm() → feature_disabled', e4 && e4.code === 'feature_disabled'); }
const gated = (r, j) => r.status === 403 && j.code === 'feature_disabled' && j.feature === 'design3d' && j.error === MSG;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(200); }
  const H = { 'content-type': 'application/json', 'x-studio-request': '1', origin: B };
  const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ username: 'igor', password: PW }) }); const ck = (lr.headers.get('set-cookie') || '').split(';')[0];
  const api = async (m, u, body, extra = {}) => { const r = await fetch(B + u, { method: m, headers: { ...H, cookie: ck, ...extra }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { r, j }; };
  const app = fs.readFileSync(path.join(dir, 'app-token'), 'utf8').trim();
  // 1) POST /api/jobs
  for (const body of [{ type: 'design3d', input: { prompt: 'cat' } }, { kind: 'design3d' }, { type: 'design3d' }, { type: 'blender_template', input: { template: 'x' } }, { kind: 'blender_template' }]) {
    const { r, j } = await api('POST', '/api/jobs', body); t('jobs ' + JSON.stringify(body) + ' → 403 feature_disabled', gated(r, j), r.status + ' ' + JSON.stringify(j));
  }
  for (const type of ['design3d', 'blender_template']) { const r = await fetch(B + '/api/jobs', { method: 'POST', headers: { ...H, 'x-studio-app-token': app }, body: JSON.stringify({ type }) }); t(type + ' via app token → 403', r.status === 403); }
  const oc = await api('POST', '/api/jobs', { type: 'opencode_task' }); t('opencode_task gate still 403', oc.r.status === 403);
  const bt = await api('POST', '/api/jobs', { type: 'no_such_type' }); t('other types not caught by gate (400 unknown type)', bt.r.status === 400);
  // 2) rerender
  const pr = await api('POST', '/api/projects3d', { title: 'gate test' }); const pid = pr.j && (pr.j.id || pr.j.projectId) || 'p_none';
  for (const p of [pid, 'p_none']) { const { r, j } = await api('POST', `/api/projects3d/${p}/v1/rerender`, { params: {} }); t('rerender ' + p + ' → 403 feature_disabled', gated(r, j), r.status + ' ' + JSON.stringify(j)); }
  // 2b) studio3d/run (Director → 3D DESIGN)
  { const before = (await api('GET', '/api/tasks')).j.length;
    for (const body of [{ text: 'Создай фиолетового кота MOONKATTY' }, { text: 'x', projectId: pid }]) { const { r, j } = await api('POST', '/api/studio3d/run', body); t('studio3d/run → 403 feature_disabled', gated(r, j), r.status + ' ' + JSON.stringify(j)); }
    const r2 = await fetch(B + '/api/studio3d/run', { method: 'POST', headers: { ...H, 'x-studio-app-token': app }, body: JSON.stringify({ text: 'кот' }) }); t('studio3d/run via app token → 403', r2.status === 403);
    t('studio3d/run created no task', (await api('GET', '/api/tasks')).j.length === before); }
  // 2c) Director chat whose plan targets the 3D agent (rule planner offline: «3D … Blender» → design3d)
  { const before = (await api('GET', '/api/tasks')).j.length;
    const { r, j } = await api('POST', '/api/director/chat', { text: 'Создай 3D модель кота в Blender' });
    t('director chat with 3D plan → 403 feature_disabled', gated(r, j) && Array.isArray(j.tasks) && !j.tasks.length, r.status + ' ' + JSON.stringify(j).slice(0, 300));
    t('director chat created no task', (await api('GET', '/api/tasks')).j.length === before);
    const ch = (await api('GET', '/api/chat')).j; t('director chat note shows unavailable text', Array.isArray(ch) && ch.some(m => m.role === 'director' && m.code === 'feature_disabled' && m.text === MSG));
    const n = await api('POST', '/api/director/chat', { text: 'Напиши пост про новости кота' }); t('non-3D director chat not caught by gate', n.r.status !== 403 || n.j?.code !== 'feature_disabled', n.r.status + ' ' + JSON.stringify(n.j).slice(0, 200)); }
  // 2d) other /api/studio3d/* writes, jobs retry/confirm/review, status for UI
  { const r = await api('PUT', '/api/studio3d/settings', { blenderPath: '/usr/bin/blender' }); t('PUT /api/studio3d/settings → 403 feature_disabled', gated(r.r, r.j));
    for (const a of ['confirm', 'review']) { const x = await api('POST', `/api/jobs/job_x/${a}`, { approve: true, action: 'approve' }); t(`POST /api/jobs/:id/${a} → 403 feature_disabled`, gated(x.r, x.j), x.r.status + ' ' + JSON.stringify(x.j)); }
    const rr = await api('POST', `/api/projects3d/${pid}/v1/run`, {}); t('POST /api/projects3d/:pid/:ver/run → 403 feature_disabled', gated(rr.r, rr.j), rr.r.status);
    const st = (await api('GET', '/api/studio3d/status')).j; t('GET /api/studio3d/status exposes design3d disabled + message for the page', st && st.design3d && st.design3d.enabled === false && st.design3d.message === MSG && st.blender && st.blender.code === 'feature_disabled');
    const ui = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8'); t('3D Studio page renders the 403 banner and disables «Создать 3D-модель»', /id=\"s3disabled\"|id="s3disabled"/.test(ui) && /403 feature_disabled/.test(ui) && /id="s3run"\$\{off3d \?/.test(ui)); }
  // version
  { const h = await (await fetch(B + '/api/health')).json(); t('version 1.3.2-test in /api/health', h.version === '1.3.2-test', h.version); }
  // 3) runner: task for the design3d agent is refused before execution
  const tasks = [];
  for (const body of [{ title: 'd3d gate task', agentId: 'design3d', status: 'queued' }, { title: 'd3d gate code task', agentId: 'design3d', status: 'queued', kind: 'code' }]) {
    const { r, j } = await api('POST', '/api/tasks', body); t('task created for design3d (' + (body.kind || 'default') + ')', r.ok && j && j.id, r.status + ' ' + JSON.stringify(j)); if (j && j.id) tasks.push(j.id);
  }
  const st = await api('POST', '/api/agents/design3d/start'); t('agent start request handled', st.r.status < 500, st.r.status + ' ' + JSON.stringify(st.j));
  for (const id of tasks) { let x; for (let i = 0; i < 40; i++) { x = (await api('GET', '/api/tasks')).j.find(z => z.id === id); if (x && x.status !== 'queued') break; await api('POST', '/api/agents/design3d/start'); await sleep(250); }
    if (st.r.ok) { t('task ' + id + ' failed with feature_disabled', x && x.status === 'failed' && x.errorCode === 'feature_disabled' && x.error === MSG, JSON.stringify(x));
      t('task ' + id + ' never started (no startedAt / not in_progress)', x && !x.startedAt); }
    else t('task ' + id + ' not executed (agent cannot start)', x && x.status !== 'in_progress' && !x.startedAt, JSON.stringify(x)); }
  const jl = (await api('GET', '/api/jobs?limit=200')).j; t('no 3D job created', Array.isArray(jl) && !jl.some(j => ['design3d', '3d', 'blender_template', 'opencode_task'].includes(j.kind)), JSON.stringify(jl).slice(0, 300));
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
