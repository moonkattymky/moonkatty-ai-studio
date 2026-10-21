// Runner test with a LOCAL MOCK of the Ollama HTTP API (not a real model): verifies the LLM path wiring,
// approval status and stop/abort. Real qwen3:8b output must be checked on the Mac.
import http from 'http'; import { spawn } from 'child_process'; import fs from 'fs';
const OPORT = 11499, PORT = 8798, UD = '/tmp/mk-runner-test'; fs.rmSync(UD, { recursive: true, force: true });
let slow = false;
const mock = http.createServer((q, r) => { let b = ''; q.on('data', d => b += d); q.on('end', () => {
  if (q.url === '/api/tags') return r.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
  if (q.url === '/api/chat') { const go = () => r.end(JSON.stringify({ message: { content: '<think>x</think>MOCK DRAFT for: ' + JSON.parse(b).messages[0].content.split('\n')[1] } })); return slow ? setTimeout(go, 20000) : go(); }
  r.statusCode = 404; r.end(); }); }).listen(OPORT);
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: process.env.STUDIO_FLAVOR || 'prod', STUDIO_DATA_DIR: UD, PORT }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(2500);
const tok = fs.readFileSync(UD + '/app-token', 'utf8').trim(); const H = { 'x-studio-app-token': tok, 'content-type': 'application/json', 'x-studio-request': '1' };
const api = async (m, p, b) => (await fetch(`http://127.0.0.1:${PORT}${p}`, { method: m, headers: H, body: b && JSON.stringify(b) })).json();
await fetch(`http://127.0.0.1:${PORT}/api/auth/setup`, { method: 'POST', headers: H, body: JSON.stringify({ username: 'igor', password: 'testpass123' }) });
await api('PUT', '/api/integrations/ollama', { url: `http://127.0.0.1:${OPORT}`, model: 'qwen3:8b' });
const t = await api('POST', '/api/tasks', { title: 'Write a brand post', agentId: 'content', status: 'queued' });
await api('POST', '/api/agents/content/start'); await sleep(7000);
const r1 = await api('GET', '/api/tasks/' + t.id); const out = [];
out.push(['content via (mock) Ollama → waiting_approval with result', r1.status === 'waiting_approval' && /MOCK DRAFT/.test(r1.result) && !/think/.test(r1.result)]);
slow = true; const t2 = await api('POST', '/api/tasks', { title: 'Slow task', agentId: 'content', status: 'queued' }); await sleep(6000);
const mid = await api('GET', '/api/tasks/' + t2.id); out.push(['task in_progress while LLM works', mid.status === 'in_progress']);
await api('POST', '/api/agents/content/stop'); await sleep(500); const r2 = await api('GET', '/api/tasks/' + t2.id); const a = await api('GET', '/api/agents/content');
out.push(['stop aborts and returns task to queue', r2.status === 'queued' && a.status === 'idle']);
const c = await api('POST', '/api/tasks', { title: 'Code: hello', agentId: 'director', kind: 'code', status: 'queued' }); await api('POST', '/api/agents/director/start'); await sleep(6000);
const c1 = await api('GET', '/api/tasks/' + c.id); out.push(['OpenCode task blocked until explicit approval', c1.status === 'blocked' && /подтверждения/.test(c1.blockedReason)]);
await api('POST', `/api/tasks/${c.id}/approve-code`); await sleep(6000); const c2 = await api('GET', '/api/tasks/' + c.id);
out.push(['after approval: runs, or blocked with «OpenCode не найден» when CLI absent', ['blocked', 'waiting_approval', 'failed'].includes(c2.status) && c2.codeApproved, c2.blockedReason || c2.status]);
for (const [n, ok, x] of out) console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : ''));
srv.kill('SIGTERM'); mock.close(); process.exit(out.every(x => x[1]) ? 0 : 1);
