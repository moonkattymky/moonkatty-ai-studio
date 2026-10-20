// End-to-end test of the 3D DESIGN agent (v1.2.0) with a REAL `opencode serve` (Basic Auth, fake password) and a
// REAL headless Blender. The LLM behind OpenCode is a deterministic MOCK (scripts/test-fixtures/mock-llm.mjs) because
// no Ollama model is available on the CI box — tool execution, permission asks, file writes are done by real OpenCode.
// Env: OPENCODE_BIN (opencode 1.19.x), STUDIO_BLENDER_BIN (Blender 4.2+). Usage: node scripts/design3d-test.mjs
import { spawn, execFileSync } from 'child_process'; import fs from 'fs'; import path from 'path';
const PW = 'test-fake-pw-123', WRONG = 'wrong-fake-pw-456';
const OC_BIN = process.env.OPENCODE_BIN || '/workspace/tools/oc/node_modules/.bin/opencode';
const BL_BIN = process.env.STUDIO_BLENDER_BIN || '/workspace/tools/blender-5.2.2-linux-x64/blender';
const P = 8810, LLM = 11610, OC = 14196, OCPERM = 14197, T = '/tmp/mk-3d-test', UD = T + '/data', KC = T + '/kc';
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(KC, { recursive: true }); for (const f of ['/tmp/mk-pwned-by-agent', '/tmp/mk-outside-by-agent.txt']) fs.rmSync(f, { force: true });
const sleep = ms => new Promise(r => setTimeout(r, ms)); const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 300) : '')); };
for (const [b, n] of [[OC_BIN, 'opencode'], [BL_BIN, 'blender']]) if (!fs.existsSync(b)) { console.log(`SKIP: ${n} not found at ${b}`); process.exit(2); }
const kids = []; const outLog = [];
const sp = (cmd, args, env, tag) => { const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); p.stdout.on('data', d => outLog.push(tag + String(d))); p.stderr.on('data', d => outLog.push(tag + String(d))); kids.push(p); return p; };
sp(process.execPath, ['scripts/test-fixtures/mock-llm.mjs', String(LLM)], process.env, '[llm] ');
const studioCfg = JSON.parse(fs.readFileSync('opencode/opencode-studio.json', 'utf8'));
const mk = perm => ({ ...studioCfg, provider: { mock: { npm: '@ai-sdk/openai-compatible', name: 'Mock', options: { baseURL: `http://127.0.0.1:${LLM}/v1` }, models: { 'mock-coder': { name: 'mock-coder', tool_call: true } } } }, model: 'mock/mock-coder', small_model: 'mock/mock-coder', permission: perm });
fs.writeFileSync(T + '/oc-policy.json', JSON.stringify(mk(studioCfg.permission))); fs.writeFileSync(T + '/oc-permissive.json', JSON.stringify(mk({ '*': 'allow' })));
const ocEnv = (cfg, h = '/ochome') => ({ PATH: process.env.PATH, HOME: T + h, OPENCODE_CONFIG: cfg, OPENCODE_SERVER_PASSWORD: PW, OPENCODE_DISABLE_AUTOUPDATE: '1' }); fs.mkdirSync(T + '/ochome'); fs.mkdirSync(T + '/ochome2');
sp(OC_BIN, ['serve', '--hostname', '127.0.0.1', '--port', String(OC)], ocEnv(T + '/oc-policy.json'), '[oc] ');
sp(OC_BIN, ['serve', '--hostname', '127.0.0.1', '--port', String(OCPERM)], ocEnv(T + '/oc-permissive.json', '/ochome2'), '[oc2] ');
let studio;
const startStudio = () => { studio = sp(process.execPath, ['server.js'], { ...process.env, STUDIO_DATA_DIR: UD, PORT: String(P), NODE_ENV: 'test', STUDIO_BLENDER_BIN: BL_BIN,
  STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs'), FAKE_KEYCHAIN_FILE: KC + '/kc.json', FAKE_KEYCHAIN_ARGV_LOG: KC + '/argv.log', STUDIO_3D_AGENT_TIMEOUT_MS: '60000' }, '[studio] '); return studio; };
startStudio();
const waitHttp = async (u, h) => { for (let i = 0; i < 120; i++) { try { const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(3000) }); if (r.status < 500) return r.status; } catch {} await sleep(500); } return 0; };
await waitHttp(`http://127.0.0.1:${P}/api/health`);
const basic = { authorization: 'Basic ' + Buffer.from('opencode:' + PW).toString('base64') };
ok('real opencode serve requires Basic Auth (401 without)', (await waitHttp(`http://127.0.0.1:${OC}/global/health`)) === 401);
const hv = await (await fetch(`http://127.0.0.1:${OC}/global/health`, { headers: basic })).json(); ok('real opencode serve healthy with fake password', hv.healthy === true, 'version ' + hv.version);
await waitHttp(`http://127.0.0.1:${OCPERM}/global/health`);
const bodies = []; const H = () => ({ 'x-studio-app-token': fs.readFileSync(UD + '/app-token', 'utf8').trim(), 'content-type': 'application/json', 'x-studio-request': '1' });
const api = async (m, p, b) => { const r = await fetch(`http://127.0.0.1:${P}${p}`, { method: m, headers: H(), body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); bodies.push(t); let j = {}; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t, r }; };
await api('POST', '/api/auth/setup', { username: 'igor', password: 'fake-admin-pw-1' });
await api('PUT', '/api/integrations/ollama', { url: 'http://127.0.0.1:11999', model: 'qwen3:8b' });
const keep = (await api('POST', '/api/tasks', { title: 'Keep me (news)', agentId: 'news', status: 'done' })).j; const keepPost = (await api('POST', '/api/posts', { title: 'Keep post', text: 'x', channelId: 'telegram', status: 'draft' })).j;
const agents0 = (await api('GET', '/api/agents')).j.map(a => a.id).sort();
ok('3D DESIGN agent migrated: enabled, not «в разработке»', (a => a.enabled && !a.inDevelopment)((await api('GET', '/api/agents/design3d')).j));
await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}`, username: 'opencode', password: PW });
ok('OpenCode connection check via Basic Auth', (await api('POST', '/api/opencode/test')).j.ok === true);
ok('settings: OpenCode model provider/model accepted', (await api('PUT', '/api/studio3d/settings', { opencodeModel: 'mock/mock-coder' })).status === 200);
ok('settings: bad model string refused', (await api('PUT', '/api/studio3d/settings', { opencodeModel: 'x; rm -rf /' })).status === 400);
ok('settings: relative Blender path refused', (await api('PUT', '/api/studio3d/settings', { blenderPath: 'blender' })).status === 400);
const st = (await api('GET', '/api/studio3d/status?refresh=1')).j;
ok('Blender detected, version + Python API probed headless', st.blender?.ok && /^\d+\.\d+/.test(st.blender.version) && st.blender.engines?.includes('CYCLES') && st.blender.gltf, `Blender ${st.blender?.version}, Python ${st.blender?.python}`);
const dc = (await api('POST', '/api/director/chat', { text: 'Сделай 3D-модель кота для заставки' })).j;
const dt = dc.tasks?.find(t => t.agentId === 'design3d');
ok('Director (rule planner, Ollama absent) assigns 3D DESIGN with kind=3d', dt && dt.kind === '3d', dc.message?.planner);
if (dt) await api('DELETE', '/api/tasks/' + dt.id);
const waitJob = async (taskId, pred, ms = 240000) => { const t0 = Date.now(); let j; while (Date.now() - t0 < ms) { const l = (await api('GET', '/api/jobs?limit=100')).j; j = Array.isArray(l) && l.find(x => x.taskId === taskId); if (j && pred(j)) return (await api('GET', '/api/jobs/' + j.id)).j; await sleep(700); } return j ? (await api('GET', '/api/jobs/' + j.id)).j : null; };
const run = async text => (await api('POST', '/api/studio3d/run', { text })).j;
const terminal = j => ['waiting_approval', 'failed', 'blocked', 'cancelled', 'done'].includes(j.status);
const evText = j => (j?.events || []).map(e => `[${e.stage}] ${e.msg} ${e.rule || ''}`).join('\n');
let argvLeak = false; const scanArgv = () => { for (const p of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) { try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); if (c.includes(PW) || c.includes(Buffer.from('opencode:' + PW).toString('base64'))) argvLeak = true; } catch {} } };
// ---- 1. safe test
const t1 = await run('Создай фиолетового кота MOONKATTY в студийном свете');
const scan = setInterval(scanArgv, 500); let j1 = await waitJob(t1.id, terminal); clearInterval(scan);
ok('safe test job reaches waiting_approval', j1?.status === 'waiting_approval', j1?.status + ' ' + (j1?.error || '') + '\n' + evText(j1));
const stagesSeen = new Set((j1?.events || []).map(e => e.stage)); ok('all stages executed in order', ['preflight', 'params', 'agent', 'validate', 'build', 'render', 'verify'].every(s => stagesSeen.has(s)));
ok('params honestly marked as rules (no Ollama model here)', /Ollama недоступна/.test(evText(j1)) && j1.checkpoint?.paramsBy === 'rules');
ok('OpenCode config verified against policy', /Политика OpenCode проверена/.test(evText(j1)));
ok('real OpenCode session created and edit permission allowed by studio policy (rule oc.edit.ws)', /Сессия OpenCode ses_/.test(evText(j1)) && /«edit» scene_params\.json → разрешено.*oc\.edit\.ws/.test(evText(j1)));
const vdir = j1 && j1.checkpoint.vdir;
ok('scene_params.json written by the OpenCode agent (real write tool)', vdir && fs.existsSync(vdir + '/scene_params.json'));
const rj = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const br = vdir && rj(vdir + '/logs/build-result.json'), rr = vdir && rj(vdir + '/logs/render-result.json');
ok('.blend saved by Blender (BLENDER magic)', vdir && fs.existsSync(vdir + '/scene.blend') && fs.readFileSync(vdir + '/scene.blend').subarray(0, 7).toString() === 'BLENDER');
ok('.blend reopened in a separate Blender process; objects preserved', rr?.mode === 'render' && JSON.stringify(rr.objects) === JSON.stringify(br.objects) && br.objects.includes('Head'), (br?.objects || []).join(','));
const png = vdir && fs.existsSync(vdir + '/renders/preview.png') && fs.readFileSync(vdir + '/renders/preview.png');
ok('PNG preview rendered (640×480)', png && png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 640 && png.readUInt32BE(20) === 480, png && png.length + ' bytes');
ok('GLB exported', vdir && fs.existsSync(vdir + '/exports/scene.glb') && fs.readFileSync(vdir + '/exports/scene.glb').subarray(0, 4).toString() === 'glTF');
ok('task waiting_approval with result + jobId', (t => t.status === 'waiting_approval' && t.jobId === j1?.id && /preview\.png/.test(t.result))((await api('GET', '/api/tasks/' + t1.id)).j));
if (png) fs.copyFileSync(vdir + '/renders/preview.png', '/workspace/sample-render-agent.png');
if (j1?.checkpoint?.projectId) {
  const fileUrl = `/api/projects3d/${j1.checkpoint.projectId}/${j1.checkpoint.version}/file?name=renders/preview.png`;
  const fr = await fetch(`http://127.0.0.1:${P}${fileUrl}`, { headers: H() }); ok('preview served via authenticated API', fr.status === 200 && fr.headers.get('content-type') === 'image/png');
  ok('preview requires auth (401)', (await fetch(`http://127.0.0.1:${P}${fileUrl}`)).status === 401);
  ok('file API blocks traversal', (await api('GET', `/api/projects3d/${j1.checkpoint.projectId}/${j1.checkpoint.version}/file?name=../../../studio.db`)).status === 404);
}
// ---- 1b. shared jobs API (feat/media-automation contract)
const cj = await api('POST', '/api/jobs', { type: 'design3d', input: { text: 'Синий тор' }, timeoutSec: 600, maxAttempts: 2 });
const jj = cj.j.jobId && await (async () => { for (let i = 0; i < 200; i++) { const x = (await api('GET', '/api/jobs/' + cj.j.jobId)).j; if (['needs_approval', 'failed', 'cancelled', 'succeeded'].includes(x.publicStatus)) return x; await sleep(700); } })();
ok('createJob(design3d) → {jobId}; public status needs_approval', cj.status === 201 && jj?.publicStatus === 'needs_approval', jj?.error);
ok('listJobs({status:needs_approval}) filters', (await api('GET', '/api/jobs?status=needs_approval')).j.every(x => x.publicStatus === 'needs_approval'));
const rs = await api('POST', '/api/jobs', { type: 'render_segment', input: {} }); const rsj = (await api('GET', '/api/jobs/' + rs.j.jobId)).j;
ok('render_segment reserved: job created as failed «не реализовано»', rsj.publicStatus === 'failed' && /не реализовано/.test(rsj.error));
const bt = await api('POST', '/api/jobs', { type: 'blender_template', input: { params: { subject: 'sphere', render: { engine: 'CYCLES', samples: 8, width: 320, height: 240 } }, projectId: 'p_tpl' }, idempotencyKey: 'tpl-key-1' });
const bt2 = await api('POST', '/api/jobs', { type: 'blender_template', input: {}, idempotencyKey: 'tpl-key-1' });
ok('idempotencyKey: second createJob returns the same jobId', bt.j.jobId && bt2.j.jobId === bt.j.jobId && bt2.j.existing === true);
let btj; for (let i = 0; i < 200; i++) { btj = (await api('GET', '/api/jobs/' + bt.j.jobId)).j; if (!['queued', 'running'].includes(btj.status)) break; await sleep(500); }
const png2 = (btj.artifacts || []).find(a => a.kind === 'png');
ok('blender_template job: needs_approval, artifacts {path,sha256,kind}, ops fields', btj.publicStatus === 'needs_approval' && png2 && /^[0-9a-f]{64}$/.test(png2.sha256) && fs.existsSync(png2.path) && btj.resourceClass === 'gpu_heavy' && btj.requiresNode === 'mac-mini' && btj.safeToRetry === true, btj.error);
ok('invalid resourceClass refused', (await api('POST', '/api/jobs', { type: 'blender_template', resourceClass: 'quantum' })).status === 400);
ok('opencode_task reserved stub (failed «не реализовано», resourceClass llm)', await (async () => { const r = await api('POST', '/api/jobs', { type: 'opencode_task', input: { text: 'x' } }); const x = (await api('GET', '/api/jobs/' + r.j.jobId)).j; return x.publicStatus === 'failed' && x.resourceClass === 'llm'; })());
ok('unknown job type refused', (await api('POST', '/api/jobs', { type: 'shell' })).status === 400);
// ---- 2. permission policy denial cases with the REAL OpenCode server
const tp = await run('Кот MOCK_PROTECTED'); const jp = await waitJob(tp.id, terminal);
ok('policy: agent write of .blend inside workspace REJECTED (fs.blender-only), job fails', jp?.status === 'failed' && /ОТКЛОНЕНО.*fs\.blender-only/.test(evText(jp)) && !fs.existsSync(jp.checkpoint.vdir + '/scene.blend'), jp?.error);
const to = await run('Кот MOCK_OUTSIDE'); const jo = await waitJob(to.id, terminal);
ok('policy: write outside workspace blocked (no file created), job fails', jo?.status === 'failed' && !fs.existsSync('/tmp/mk-outside-by-agent.txt'), jo?.error);
const tb = await run('Кот MOCK_BASH'); const jb = await waitJob(tb.id, terminal);
ok('policy: bash never executes (tool not available / denied), job fails', jb?.status === 'failed' && !fs.existsSync('/tmp/mk-pwned-by-agent'), jb?.error);
const tv = await run('Кот MOCK_BADPARAMS'); const jv = await waitJob(tv.id, terminal);
ok('agent output violating schema rejected at validate stage (no Blender run)', jv?.status === 'failed' && jv.stage === 'validate' && /схемы/.test(jv.error), jv?.error);
await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OCPERM}` });
const tc = await run('Кот проверка конфига'); const jc = await waitJob(tc.id, terminal);
ok('permissive OpenCode server config refused (blocked, bash/edit named)', jc?.status === 'blocked' && /bash/.test(jc.error) && /edit/.test(jc.error), jc?.error);
await api('PUT', '/api/opencode/auth', { url: `http://127.0.0.1:${OC}`, password: WRONG });
const tw = await run('Кот неверный пароль'); const jw = await waitJob(tw.id, terminal);
ok('wrong OpenCode password → blocked with 401 message, no password in error', jw?.status === 'blocked' && /401/.test(jw.error) && !jw.error.includes(WRONG), jw?.error);
await api('PUT', '/api/opencode/auth', { password: PW });
const rt = await api('POST', `/api/jobs/${jw.id}/retry`); const jw2 = await waitJob(tw.id, j => j.retries >= 1 && terminal(j));
ok('retry of blocked job (after fixing password) resumes and succeeds', rt.status === 200 && jw2?.status === 'waiting_approval', jw2?.status + ' ' + (jw2?.error || rt.t));
ok('retry refused for a job that is not failed/blocked', (await api('POST', `/api/jobs/${jw2.id}/retry`)).status === 400);
// ---- 3. Blender error handling
const fb = T + '/fakebl/blender'; fs.mkdirSync(path.dirname(fb));
fs.writeFileSync(fb, `#!/bin/sh\ncase "$*" in *--version*) echo "Blender 5.2.2 LTS";; *probe.py*) echo 'MKPROBE {"version":"5.2.2 LTS","python":"3.13","engines":["CYCLES"],"gltf":true,"fbx":true}';;\n*) echo 'Traceback (most recent call last):'; echo 'RuntimeError: fake template failure'; exit 3;; esac\n`, { mode: 0o755 });
await api('PUT', '/api/studio3d/settings', { blenderPath: fb });
const te = await run('Кот ошибка блендера'); const je = await waitJob(te.id, terminal);
ok('Blender script error → failed with Python error text, after 1 automatic retry', je?.status === 'failed' && /RuntimeError: fake template failure/.test(je.error) && /повтор 2\/2/.test(evText(je)), je?.error);
await api('PUT', '/api/studio3d/settings', { blenderPath: '' });
// ---- 4. cancel during render
const tx = await run('Куб 1920x1080 256 samples отмена'); let jx = await waitJob(tx.id, j => j.stage === 'render' || terminal(j));
await sleep(1500); const blPids = () => execFileSync('ps', ['-eo', 'pid,args']).toString().split('\n').filter(l => l.includes(jx.checkpoint.vdir) && /blender/.test(l));
const before = blPids().length; await api('POST', `/api/jobs/${jx.id}/cancel`); await sleep(7000); jx = (await api('GET', '/api/jobs/' + jx.id)).j;
ok('cancel during Blender render: job+task cancelled, Blender process killed', before > 0 && jx.status === 'cancelled' && blPids().length === 0 && (await api('GET', '/api/tasks/' + tx.id)).j.status === 'cancelled', `procs before ${before}, status ${jx.status}`);
// ---- 5. restart recovery
const tr = await run('Куб 1920x1080 200 samples восстановление'); let jr = await waitJob(tr.id, j => j.stage === 'render' || terminal(j)); await sleep(1500);
const orphan = (() => { const l = execFileSync('ps', ['-eo', 'pid,args']).toString().split('\n').find(x => x.includes(jr.checkpoint.vdir) && /blender/.test(x)); return l ? +l.trim().split(/\s+/)[0] : 0; })();
studio.kill('SIGKILL'); await sleep(1000); const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } }; const orphanAlive = orphan && alive(orphan);
startStudio(); await waitHttp(`http://127.0.0.1:${P}/api/health`); await sleep(3000);
ok('after hard kill: orphaned Blender process found and killed on recovery', orphanAlive && !alive(orphan), `pid ${orphan}`);
jr = await waitJob(tr.id, j => terminal(j) && j.attempt >= 2, 400000);
const builds = (jr?.events || []).filter(e => /▶ Сборка/.test(e.msg)).length;
ok('job resumed after restart from render stage (build not repeated) and finished', jr?.status === 'waiting_approval' && builds === 1 && /Приложение перезапущено/.test(evText(jr)), `${jr?.status} builds=${builds} ${jr?.error || ''}`);
// ---- 6. data preservation
ok('data preserved: tasks, posts, agents, Ollama settings', (await api('GET', '/api/tasks/' + keep.id)).j.title === 'Keep me (news)' && (await api('GET', '/api/posts/' + keepPost.id)).j.title === 'Keep post'
  && JSON.stringify((await api('GET', '/api/agents')).j.map(a => a.id).sort()) === JSON.stringify(agents0) && (await api('GET', '/api/integrations/ollama')).j.model === 'qwen3:8b');
// ---- 7. dangerous action: delete needs confirmation
if (jr?.checkpoint?.vdir) {
  const dv = `/api/projects3d/${jr.checkpoint.projectId}/${jr.checkpoint.version}`;
  const d1 = await fetch(`http://127.0.0.1:${P}${dv}`, { method: 'DELETE', headers: H(), body: '{}' });
  ok('delete version without confirmation → 409 needsConfirmation, nothing deleted', d1.status === 409 && fs.existsSync(jr.checkpoint.vdir));
  const d2 = await fetch(`http://127.0.0.1:${P}${dv}`, { method: 'DELETE', headers: H(), body: JSON.stringify({ confirm: true }) });
  ok('delete version with confirm:true → removed', d2.status === 200 && !fs.existsSync(jr.checkpoint.vdir));
}
ok('delete with traversal id refused', (await fetch(`http://127.0.0.1:${P}/api/projects3d/..%2F..%2Fx/v001`, { method: 'DELETE', headers: H(), body: JSON.stringify({ confirm: true }) })).status >= 400);
// ---- 8. no password leaks
await api('POST', '/api/backups/run'); await sleep(500);
const grepDir = d => { const hits = []; const walk = x => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else if (e.isFile()) { const b = fs.readFileSync(p); for (const s of [PW, WRONG, Buffer.from('opencode:' + PW).toString('base64'), Buffer.from(PW).toString('hex')]) if (b.includes(s)) hits.push(p + ':' + s.slice(0, 4)); } } }; walk(d); return hits; };
const hits = grepDir(UD); ok('password absent from SQLite/WAL/backups/project files/job logs', hits.length === 0, hits.join(', '));
const logs = (await api('GET', '/api/logs')).j; ok('password absent from logs API', !JSON.stringify(logs).includes(PW));
const allJobs = (await api('GET', '/api/jobs?limit=200')).j; let evAll = ''; for (const j of allJobs) evAll += JSON.stringify((await api('GET', '/api/jobs/' + j.id)).j);
ok('password absent from all job events/API bodies', !evAll.includes(PW) && !bodies.some(b => b.includes(PW) || b.includes(WRONG)));
ok('password never in any process argv (scanned during the agent job)', !argvLeak);
ok('fake keychain argv log has no plaintext password', !fs.readFileSync(KC + '/argv.log', 'utf8').includes(PW));
ok('studio stdout/stderr has no password', !outLog.filter(l => l.startsWith('[studio]')).join('').includes(PW));
console.log(`\n${res.filter(r => r[1]).length}/${res.length} passed`); console.log('sample PNG: /workspace/sample-render-agent.png');
if (process.env.D3_DEBUG) fs.writeFileSync('/tmp/d3-out.log', outLog.join(''));
for (const k of kids) { try { k.kill('SIGTERM'); } catch {} } await sleep(500); process.exit(res.every(r => r[1]) ? 0 : 1);
