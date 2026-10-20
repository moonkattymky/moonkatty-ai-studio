// Stage C (v1.2.1) e2e + security test: real opencode serve (fake pw), real headless Blender, mock LLM.
import { spawn, execFileSync } from 'child_process'; import fs from 'fs'; import path from 'path';
const PW = 'test-fake-pw-123', WRONG = 'wrong-fake-pw-456';
const OC_BIN = process.env.OPENCODE_BIN || '/workspace/tools/oc/node_modules/.bin/opencode';
const BL_BIN = process.env.STUDIO_BLENDER_BIN || '/workspace/tools/blender-5.2.2-linux-x64/blender';
const P = 8830, LLM = 11630, OC = 14216, OCPERM = 14217, T = '/tmp/mk-3c-test', UD = T + '/data', KC = T + '/kc';
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

const waitJob = async (taskId, pred, ms = 240000) => { const t0 = Date.now(); let j; while (Date.now() - t0 < ms) { const l = (await api('GET', '/api/jobs?limit=100')).j; j = Array.isArray(l) && l.find(x => x.taskId === taskId); if (j && pred(j)) return (await api('GET', '/api/jobs/' + j.id)).j; await sleep(700); } return j ? (await api('GET', '/api/jobs/' + j.id)).j : null; };
const run = async text => (await api('POST', '/api/studio3d/run', { text })).j;
const terminal = j => ['waiting_approval', 'failed', 'blocked', 'cancelled', 'done'].includes(j.status);
const evText = j => (j?.events || []).map(e => `[${e.stage}] ${e.msg} ${e.rule || ''}`).join('\n');
// ===== Stage C (v1.2.1): references, review, versions, re-render, downloads, viewer =====
const B = `http://127.0.0.1:${P}`; const raw = (p, buf, h = H()) => fetch(B + p, { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream' }, body: buf });
const PNG1 = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(64, 1)]);
const proj = (await api('POST', '/api/projects3d', { title: 'Stage C test' })).j.id; ok('project created', /^p_/.test(proj));
const up = await raw(`/api/projects3d/${proj}/references?name=cat.png`, PNG1); const upj = await up.json();
ok('reference upload stored with SHA-256', up.status === 201 && /^[0-9a-f]{64}$/.test(upj.sha256) && fs.existsSync(`${UD}/projects3d/${proj}/references/${upj.sha256}.png`) || fs.readdirSync(UD, { recursive: true }).some(f => String(f).endsWith(upj.sha256 + '.png')), JSON.stringify(upj));
ok('duplicate reference detected', (await (await raw(`/api/projects3d/${proj}/references?name=again.png`, PNG1)).json()).duplicate === true);
ok('spoofed extension (.png containing HTML) refused', (await raw(`/api/projects3d/${proj}/references?name=x.png`, Buffer.from('<html><script>alert(1)</script>'))).status >= 400);
ok('SVG refused', (await raw(`/api/projects3d/${proj}/references?name=x.svg`, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status >= 400);
ok('oversize (>15 MB) refused', [400, 413].includes((await raw(`/api/projects3d/${proj}/references?name=big.png`, Buffer.concat([PNG1, Buffer.alloc(16 * 1024 * 1024)]))).status));
ok('empty upload refused', (await raw(`/api/projects3d/${proj}/references?name=e.png`, Buffer.alloc(0))).status === 400);
const tr = await raw(`/api/projects3d/${proj}/references?name=${encodeURIComponent('../../../../tmp/mk-evil.png')}`, Buffer.concat([PNG1, Buffer.from('x')]));
ok('traversal in file name neutralised (stored by sha, not by name)', !fs.existsSync('/tmp/mk-evil.png') && (tr.status >= 400 || !(await tr.json()).path?.includes('..')));
ok('traversal in project id refused', [400, 404].includes((await raw(`/api/projects3d/..%2F..%2Fetc/references?name=a.png`, PNG1)).status));
const noCsrf = { ...H() }; delete noCsrf['x-studio-request']; ok('upload without CSRF header → 403', (await raw(`/api/projects3d/${proj}/references?name=c.png`, PNG1, noCsrf)).status === 403);
ok('upload without auth → 401', (await fetch(`${B}/api/projects3d/${proj}/references?name=c.png`, { method: 'POST', headers: { 'x-studio-request': '1' }, body: PNG1 })).status === 401);
const rg = await fetch(`${B}/api/projects3d/${proj}/references/${upj.sha256}`, { headers: H() });
ok('reference served with nosniff + sandbox CSP', rg.status === 200 && rg.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(rg.headers.get('content-security-policy')));
ok('reference by bad sha → 404', (await api('GET', `/api/projects3d/${proj}/references/..%2F..%2Fstudio.db`)).status === 404);
// --- run in this project
const t1 = (await api('POST', '/api/studio3d/run', { text: 'Создай фиолетового кота MOONKATTY', projectId: proj })).j;
const j1 = await waitJob(t1.id, terminal); ok('job in project reaches waiting_approval', j1?.status === 'waiting_approval' && j1.checkpoint.projectId === proj, j1?.status + ' ' + (j1?.error || '') + '\n' + evText(j1));
const v1 = j1.checkpoint.version;
// --- approval not settable via generic API
ok('generic PUT cannot set 3D task status (403)', (await api('PUT', '/api/tasks/' + t1.id, { status: 'done' })).status === 403);
ok('generic PUT cannot change kind/agentId', (await api('PUT', '/api/tasks/' + t1.id, { agentId: 'news' })).status === 403 || (await api('GET', '/api/tasks/' + t1.id)).j.agentId === 'design3d');
const pz = (await api('POST', '/api/tasks', { title: 'forged', kind: '3d', agentId: 'design3d', status: 'done', review: { decision: 'approved' } })).j;
ok('generic POST forces 3D task to queued, strips review', pz.status === 'queued' && !pz.review); if (pz.id) { await api('DELETE', '/api/tasks/' + pz.id); }
ok('review without CSRF → 403', (await fetch(`${B}/api/jobs/${j1.id}/review`, { method: 'POST', headers: { ...noCsrf, 'content-type': 'application/json' }, body: '{"action":"approve"}' })).status === 403);
ok('review bad action → 400', (await api('POST', `/api/jobs/${j1.id}/review`, { action: 'hack' })).status === 400);
ok('rework without comment → 400', (await api('POST', `/api/jobs/${j1.id}/review`, { action: 'rework', comment: '' })).status === 400);
// --- downloads
const dl = await fetch(`${B}/api/projects3d/${proj}/${v1}/file?name=exports/scene.glb&download=1`, { headers: H() });
ok('GLB download: attachment + nosniff', dl.status === 200 && /attachment/.test(dl.headers.get('content-disposition')) && dl.headers.get('x-content-type-options') === 'nosniff' && Buffer.from(await dl.arrayBuffer()).subarray(0, 4).toString() === 'glTF');
const bl = await fetch(`${B}/api/projects3d/${proj}/${v1}/file?name=scene.blend&download=1`, { headers: H() }); ok('.blend download', bl.status === 200 && Buffer.from(await bl.arrayBuffer()).subarray(0, 7).toString() === 'BLENDER');
for (const bad of ['../../studio.db', 'logs/agent.log', '/etc/passwd', 'exports/../../../app-token', 'scene_params.json']) ok('download whitelist blocks ' + bad, (await api('GET', `/api/projects3d/${proj}/${v1}/file?name=${encodeURIComponent(bad)}`)).status === 404);
ok('download traversal in version → 404', (await api('GET', `/api/projects3d/${proj}/..%2F..%2F/file?name=scene.blend`)).status === 404);
// --- rework → new version from previous
const rw = (await api('POST', `/api/jobs/${j1.id}/review`, { action: 'rework', comment: 'сделай синим и солнечный свет, ближе' })).j;
ok('rework accepted and created a new task', rw.ok && rw.nextTask?.id, JSON.stringify(rw).slice(0, 200));
ok('old task marked rework (not approved)', (await api('GET', '/api/tasks/' + t1.id)).j.review?.decision === 'rework');
const j2 = await waitJob(rw.nextTask.id, terminal); const v2 = j2?.checkpoint?.version;
ok('rework job → waiting_approval in new version', j2?.status === 'waiting_approval' && v2 && v2 !== v1 && j2.checkpoint.projectId === proj, j2?.status + ' ' + evText(j2));
const P1 = (await api('GET', '/api/projects3d/' + proj)).j; const V2 = P1.versions.find(v => v.version === v2), V1 = P1.versions.find(v => v.version === v1);
ok('new version records parent + comment', V2?.parent === v1 && /синим/.test(V2.comment || ''));
ok('rework changed params per comment', V2?.params && V1?.params && V2.params.lighting === 'sun' && JSON.stringify(V2.params.color || V2.params.materials || V2.params) !== JSON.stringify(V1.params.color || V1.params.materials || V1.params) && V2.params.camera.distance < V1.params.camera.distance, JSON.stringify(V2?.params));
ok('previous version left intact (preview still there)', V1.files.some(f => f.name === 'renders/preview.png'));
// --- approve / reject
ok('approve v2', (await api('POST', `/api/jobs/${j2.id}/review`, { action: 'approve' })).j.ok && (await api('GET', '/api/jobs/' + j2.id)).j.status === 'done');
ok('cannot review twice (409)', (await api('POST', `/api/jobs/${j2.id}/review`, { action: 'reject' })).status === 409);
// --- re-render with controls
const rr2 = await api('POST', `/api/projects3d/${proj}/${v2}/rerender`, { lighting: 'studio', camera: { distance: 12, height: 2, focal: 50 }, animation: { frames: 3 }, render: { engine: 'CYCLES', samples: 4, width: 320, height: 240 }, exports: ['glb', 'fbx'] });
ok('rerender accepted', rr2.status === 201 || rr2.status === 200, rr2.t.slice(0, 200));
ok('rerender rejects unknown fields', (await api('POST', `/api/projects3d/${proj}/${v2}/rerender`, { script: 'import os' })).status === 400);
ok('rerender rejects bad values', (await api('POST', `/api/projects3d/${proj}/${v2}/rerender`, { render: { samples: 99999 } })).status === 400);
const j3 = await waitJob(rr2.j.id, terminal); const v3 = j3?.checkpoint?.version;
ok('rerender job → waiting_approval, agent skipped', j3?.status === 'waiting_approval' && /агент OpenCode не нужен/.test(evText(j3)), j3?.status + ' ' + evText(j3));
const V3 = (await api('GET', '/api/projects3d/' + proj)).j.versions.find(v => v.version === v3);
ok('rerender: 320×240, 3 turntable frames, FBX exported', V3 && V3.params.render.width === 320 && V3.animFrames === 3 && V3.files.some(f => f.name === 'exports/scene.fbx'), JSON.stringify(V3?.files));
const pn = fs.readdirSync(UD, { recursive: true }).find(f => String(f).endsWith(`${proj}/${v3}/renders/preview.png`));
ok('preview PNG at requested resolution', pn && (b => b.readUInt32BE(16) === 320 && b.readUInt32BE(20) === 240)(fs.readFileSync(path.join(UD, pn))));
const fb = await fetch(`${B}/api/projects3d/${proj}/${v3}/file?name=exports/scene.fbx&download=1`, { headers: H() }); ok('FBX download', fb.status === 200 && /Kaydara FBX Binary/.test(Buffer.from(await fb.arrayBuffer()).subarray(0, 20).toString()));
ok('reject v3', (await api('POST', `/api/jobs/${j3.id}/review`, { action: 'reject', comment: 'не то' })).j.ok && (await api('GET', '/api/jobs/' + j3.id)).j.status === 'rejected');
// --- delete with confirm + backup
ok('delete without confirm → 409 needsConfirmation', (await api('DELETE', `/api/projects3d/${proj}/${v3}`)).j.needsConfirmation === true);
const del = (await api('DELETE', `/api/projects3d/${proj}/${v3}`, { confirm: true })).j;
ok('delete with confirm → backup in _trash', del.ok && /_trash/.test(del.backup) && fs.existsSync(path.join(UD, del.backup)) || fs.readdirSync(UD, { recursive: true }).some(f => String(f).includes('_trash/' + v3)), JSON.stringify(del));
const P2 = (await api('GET', '/api/projects3d/' + proj)).j; ok('deleted version hidden, listed as backup', !P2.versions.some(v => v.version === v3) && P2.deleted.some(d => d.version === v3));
ok('delete traversal refused', [400, 403, 404].includes((await api('DELETE', `/api/projects3d/${proj}/..%2F..`, { confirm: true })).status));
// --- viewer + CSP
const ix = await fetch(B + '/'); const csp = ix.headers.get('content-security-policy') || ''; const html = await ix.text();
ok('CSP strict: script-src self only', /script-src 'self'(;|$)/.test(csp) && !/unsafe-eval|https?:/.test(csp.match(/script-src[^;]*/)?.[0] || ''), csp);
ok('index loads local glb-viewer.js', /src="\/?glb-viewer\.js"/.test(html));
const gv = await (await fetch(B + '/glb-viewer.js')).text(); ok('glb-viewer has no external URLs / eval', !/https?:\/\//.test(gv.replace(/\/\/.*$/gm, '')) && !/\beval\(|new Function/.test(gv));
const vm = await import('vm'); const sb = { window: {}, document: {}, console, TextDecoder }; vm.runInNewContext(gv, sb); const parseGLB = sb.window.MKGlbViewer.parseGLB;
const glbBuf = fs.readFileSync(path.join(UD, fs.readdirSync(UD, { recursive: true }).find(f => String(f).endsWith(`${proj}/${v2}/exports/scene.glb`))));
let prims = 0; try { prims = parseGLB(glbBuf.buffer.slice(glbBuf.byteOffset, glbBuf.byteOffset + glbBuf.length)).length; } catch (e) { outLog.push('parse ' + e.message); }
ok('viewer parses real Blender GLB', prims > 0, prims + ' primitives');
ok('no password in API bodies', !bodies.some(b => b.includes(PW)));

for (const k of kids) { try { k.kill('SIGKILL'); } catch {} }
const failed = res.filter(r => !r[1]); console.log(`\n${res.length - failed.length}/${res.length} passed`);
if (failed.length) { fs.writeFileSync(T + '/out.log', outLog.join('')); console.log('logs: ' + T + '/out.log'); process.exit(1); } process.exit(0);
