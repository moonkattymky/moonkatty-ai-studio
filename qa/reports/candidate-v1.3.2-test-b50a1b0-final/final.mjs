import fs from 'fs'; const D = fs.readFileSync('/tmp/fin/srvdir', 'utf8').trim(), B = 'http://127.0.0.1:8971', PW = fs.readFileSync(D + '/pw', 'utf8').trim();
const lr = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ username: 'igor', password: PW }) });
const ck = (lr.headers.get('set-cookie') || '').split(';')[0]; const app = fs.readFileSync(D + '/data/app-token', 'utf8').trim();
const H = { sess: { cookie: ck }, app: { 'x-studio-app-token': app } }; const out = []; let n500 = 0;
async function call(who, m, p, b) { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', 'x-studio-request': '1', ...H[who] }, body: b && !['GET', 'HEAD'].includes(m) ? JSON.stringify(b) : undefined }); let t = ''; try { t = await r.text(); } catch {} let j; try { j = JSON.parse(t); } catch {} if (r.status >= 500) n500++; return { s: r.status, code: j?.code, j, t }; }
const blocked = r => r.s === 403 && r.code === 'feature_disabled';
const rec = (n, r, ok) => { out.push({ n, s: r.s, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + ' => ' + r.s + ' ' + (r.code || '') + (r.extra ? ' ' + r.extra : '')); };
console.log('LOGIN', lr.status);
const proj = await call('sess', 'POST', '/api/projects3d', { title: 'p' }); console.log('INFO create projects3d =>', proj.s, proj.code); const pid = proj.j?.id || 'p_x';
const E = [['POST', '/api/jobs', { type: 'design3d' }], ['POST', '/api/jobs', { kind: 'design3d' }], ['POST', '/api/jobs', { type: 'blender_template' }], ['POST', '/api/jobs', { kind: 'blender_template' }], ['POST', '/api/jobs', { type: '3d' }],
  ['POST', '/api/studio3d/run', { text: 'кот' }], ['POST', '/api/studio3d/run/', { text: 'кот' }], ['POST', '/API/Studio3d/run', { text: 'кот' }], ['PUT', '/api/studio3d/settings', { blenderPath: '/bin/true' }],
  ['POST', `/api/projects3d/${pid}/v1/rerender`, {}], ['POST', `/api/projects3d/${pid}/v1/run`, {}], ['POST', `/api/projects3d/${pid}/v1/rerender/`, {}], ['POST', `/API/projects3d/${pid}/v1/rerender`, {}],
  ['POST', '/api/jobs/x/confirm', { approve: true }], ['POST', '/api/jobs/x/review', { action: 'rework' }], ['POST', '/api/jobs/x/confirm/', { approve: true }], ['POST', '/API/jobs/x/confirm', { approve: true }], ['POST', '/api/jobs/x/Review', { action: 'rework' }],
  ['POST', '/api/director/chat', { text: 'сделай 3d модель кота в blender' }]];
for (const who of ['sess', 'app']) for (const [m, p, b] of E) rec(`[old] ${who} ${m} ${p}`, await call(who, m, p, b), null) ;
// fix: evaluate old ones
for (const o of out) o.ok = o.s === 403; 
const X = [ ['POST', '/api/studio3d%2Frun', { text: 'x' }], ['POST', '/api/%73tudio3d/run', { text: 'x' }], ['POST', '/api/studio3d/%2e/run', { text: 'x' }], ['POST', '/api/studio3d/./run', { text: 'x' }], ['POST', '/api/x/%2e%2e/studio3d/run', { text: 'x' }], ['POST', '/api/x/../studio3d/run', { text: 'x' }],
  ['POST', '//api/studio3d/run', { text: 'x' }], ['POST', '/api//studio3d//run', { text: 'x' }], ['POST', '/api/studio3d/run;x=1', { text: 'x' }], ['POST', '/api/studio3d/run?x=1', { text: 'x' }], ['POST', '/api/studio3d/run%3Bx', { text: 'x' }],
  ['PATCH', '/api/studio3d/run', {}], ['DELETE', '/api/studio3d/run', {}], ['PUT', '/api/studio3d/run', {}], ['DELETE', `/api/projects3d/${pid}/v1`, {}], ['POST', `/api/projects3d/${pid}/references`, {}], ['POST', '/api/projects3d', { title: 'q' }],
  ['POST', `/api/projects3d/${pid}/v1/rerender%2F`, {}], ['POST', `/api/projects3d/${pid}//v1/rerender`, {}], ['POST', `/api/projects3d/${pid}/v1/RUN;a`, {}],
  ['POST', '/api/jobs/x%2Fconfirm', { approve: true }], ['POST', '/api/jobs//x/confirm', { approve: true }], ['POST', '/api/jobs/x/confirm;a', { approve: true }], ['POST', '/api/jobs/x/%63onfirm', { approve: true }], ['PUT', '/api/jobs/x/confirm', {}],
  ['POST', '/api/agents/design3d/start', {}], ['POST', '/api/agents/Design3D/start/', {}], ['POST', '/api/agents/design3d%2Fstart', {}], ['POST', '/api/agents/%64esign3d/start', {}], ['POST', '/api/agents//design3d/start', {}],
  ['POST', '/api/tasks', { title: 't', agentId: 'design3d' }], ['POST', '/api/tasks', { title: 't', kind: '3d', agentId: 'video' }], ['POST', '/api/tasks/', { title: 't', agentId: 'design3d' }], ['POST', '/API/Tasks', { title: 't', agentId: 'design3d' }], ['POST', '/api/tasks', { title: 't', type: 'blender_template' }],
  ['POST', '/api/world/plan', { goal: 'сделать 3d сцену в blender' }], ['POST', '/api/world/plan', { goal: 'Blender рендер' }], ['POST', '/api/jobs', { type: 'DESIGN3D' }], ['POST', '/api/jobs', { type: ['design3d'] }], ['POST', '/api/jobs/', { type: 'design3d' }]];
for (const who of ['sess', 'app']) for (const [m, p, b] of X) { const r = await call(who, m, p, b); rec(`[new] ${who} ${m} ${p} ${JSON.stringify(b).slice(0, 50)}`, r, (blocked(r) || r.s === 404 || r.s === 400) && r.s < 500); }
for (const m of ['HEAD', 'OPTIONS']) for (const p of ['/api/studio3d/run', `/api/projects3d/${pid}/v1/rerender`, '/api/jobs/x/confirm', '/api/agents/design3d/start']) { const r = await call('sess', m, p); rec(`[method] ${m} ${p}`, r, r.s < 500 && r.s !== 201); }
// relabel attacks (b50a1b0)
const vt = await call('sess', 'POST', '/api/tasks', { title: 'plain', agentId: 'video', kind: 'video_render', status: 'queued', schedule: { type: 'none' } }); console.log('INFO create task agent video', vt.s, vt.j?.id);
const nt = await call('sess', 'POST', '/api/tasks', { title: 'plain2', agentId: 'news', status: 'queued', schedule: { type: 'none' } });
for (const [lbl, body] of [['agentId→design3d', { agentId: 'design3d' }], ['kind→3d', { kind: '3d' }], ['kind→design3d', { kind: 'design3d' }], ['type→blender_template', { type: 'blender_template' }]]) {
  for (const id of [vt.j?.id, nt.j?.id]) { const r = await call('app', 'PUT', '/api/tasks/' + id, body); const cur = (await call('sess', 'GET', '/api/tasks/' + id)); rec(`[relabel] PUT ${lbl} on ${id === vt.j?.id ? 'video' : 'news'} task`, r, blocked(r) && !(cur.j?.agentId === 'design3d' || ['3d', 'design3d', 'blender_template'].includes(cur.j?.kind))); } }
await new Promise(r => setTimeout(r, 2500));
const tq = (await call('sess', 'GET', '/api/tasks')).j; const tasks = Array.isArray(tq) ? tq : (tq?.items || []); console.log('INFO 3D tasks in DB:', JSON.stringify(tasks.filter(t => t.agentId === 'design3d' || ['3d', 'design3d', 'blender_template'].includes(t.kind)).map(t => [t.agentId, t.kind, t.status])));
const jl = (await call('sess', 'GET', '/api/jobs?limit=200')).j || []; console.log('INFO 3D jobs:', (Array.isArray(jl) ? jl : []).filter(j => ['design3d', 'blender_template', '3d'].includes(j.kind || j.type)).length);
console.log('INFO 5xx count', n500); console.log('SUMMARY', JSON.stringify({ total: out.length, pass: out.filter(o => o.ok).length, fail: out.filter(o => !o.ok).map(o => o.n + ' ' + o.s) }));
