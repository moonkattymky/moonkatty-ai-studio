// Filtered Ollama proxy (lib/ollama-proxy.js) + sandbox bridge (lib/llm-bridge.js) + N3-1 marker sweep (Linux).
// Uses a local Ollama STUB on a random port (no real/paid API). Usage: node scripts/ollama-proxy-test.mjs (Node >= 22.5)
import { createRequire } from 'module'; import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http';
const require = createRequire(import.meta.url); process.env.STUDIO_FLAVOR = 'test'; process.env.NODE_ENV = 'test'; delete process.env.MK_TEST_LLM_STUB;
const OP = require('../lib/ollama-proxy.js'), TR = require('../lib/task-runners.js');
let fail = 0, pass = 0; const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-op-'));
// stub Ollama
const seen = []; let slow = 0;
const stub = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', async () => { seen.push({ m: q.method, u: q.url, h: q.headers, b });
  if (q.url === '/api/redirect') { r.writeHead(302, { location: 'http://evil.example/' }); return r.end(); }
  if (slow) await sleep(slow);
  if (q.url === '/api/tags') { r.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'x=1' }); return r.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama-secret:70b' }] })); }
  r.writeHead(200, { 'content-type': 'application/json', 'x-internal': 'leak' }); r.end(JSON.stringify({ message: { role: 'assistant', content: 'STUB_REPLY' }, done: true })); }); });
await new Promise(r => stub.listen(0, '127.0.0.1', r)); const SP = stub.address().port;
const req = (sock, { method = 'POST', p = '/api/chat', body, headers = {} } = {}) => new Promise(res => {
  const q = http.request({ socketPath: sock, method, path: p, headers: { 'content-type': 'application/json', ...headers } }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ s: r.statusCode, h: r.headers, d })); });
  q.on('error', e => res({ s: 0, d: e.message })); if (body !== undefined) q.write(typeof body === 'string' ? body : JSON.stringify(body)); q.end(); });
const chat = (model = 'qwen3:8b') => ({ model, messages: [{ role: 'user', content: 'hi' }], stream: false });
// 1 unit
{ const P = OP.startProxy({ dir: path.join(TMP, 'w1', '.llm'), port: SP, models: ['qwen3:8b'], maxBody: 4096, maxConcurrent: 1, ratePerMin: 1000, timeoutMs: 800 }); await P.ready;
  ok('socket mode 0600, dir 0700', (fs.statSync(P.sock).mode & 0o777) === 0o600 && (fs.statSync(P.dir).mode & 0o777) === 0o700);
  let r = await req(P.sock, { body: chat() }); ok('POST /api/chat allowed model -> 200 forwarded', r.s === 200 && r.d.includes('STUB_REPLY'), JSON.stringify(r));
  ok('response headers filtered (no x-internal)', !r.h['x-internal']);
  r = await req(P.sock, { p: '/api/generate', body: { model: 'qwen3:8b', prompt: 'x' } }); ok('POST /api/generate -> 200', r.s === 200);
  r = await req(P.sock, { p: '/v1/chat/completions', body: chat('ollama/qwen3:8b') }); ok('POST /v1/chat/completions (ollama/ prefix) -> 200', r.s === 200);
  r = await req(P.sock, { method: 'GET', p: '/api/tags' }); ok('GET /api/tags filtered to allowlist, no set-cookie', r.s === 200 && r.d.includes('qwen3:8b') && !r.d.includes('llama-secret') && !r.h['set-cookie'], r.d);
  const n0 = seen.length;
  for (const [m, p] of [['POST', '/api/pull'], ['DELETE', '/api/delete'], ['POST', '/api/create'], ['POST', '/api/push'], ['GET', '/api/chat'], ['PUT', '/api/chat'], ['POST', '/api/chat/../pull'], ['POST', '/api/redirect'], ['GET', '/']]) {
    r = await req(P.sock, { method: m, p, body: m === 'GET' ? undefined : chat() }); ok(`rejected ${m} ${p} -> 403`, r.s === 403, String(r.s)); }
  r = await req(P.sock, { p: 'http://evil.example/api/chat', body: chat() }); ok('absolute-form URL (other host) -> 403', r.s === 403, String(r.s));
  r = await req(P.sock, { p: 'http://127.0.0.1:8080/api/chat', body: chat() }); ok('absolute-form to other localhost port -> 403', r.s === 403, String(r.s));
  r = await req(P.sock, { method: 'CONNECT', p: 'evil.example:443' }); ok('CONNECT -> rejected', r.s === 403 || r.s === 400 || r.s === 0, String(r.s));
  r = await req(P.sock, { body: chat('llama-secret:70b') }); ok('model not in allowlist -> 403', r.s === 403);
  r = await req(P.sock, { body: { messages: [] } }); ok('missing model -> 403', r.s === 403);
  r = await req(P.sock, { body: 'not json' }); ok('invalid JSON -> 400', r.s === 400);
  r = await req(P.sock, { body: { ...chat(), pad: 'x'.repeat(10000) } }); ok('oversize body (content-length) -> 413', r.s === 413, String(r.s));
  r = await new Promise(res => { const q = http.request({ socketPath: P.sock, method: 'POST', path: '/api/chat', headers: { 'transfer-encoding': 'chunked' } }, rr => { rr.resume(); rr.on('end', () => res(rr.statusCode)); }); q.on('error', () => res('reset'));
    q.write('{"model":"qwen3:8b","x":"'); for (let i = 0; i < 10; i++) q.write('y'.repeat(1000)); q.end('"}'); });
  ok('oversize chunked body -> 413 / reset', r === 413 || r === 'reset', String(r));
  ok('no rejected request reached Ollama', seen.length === n0, JSON.stringify(seen.slice(n0).map(x => x.m + ' ' + x.u)));
  r = await req(P.sock, { body: chat(), headers: { authorization: 'Bearer AGENT-TOKEN', cookie: 'sid=SESSION', 'x-api-key': 'k', 'x-forwarded-for': '1.2.3.4', host: 'evil.example' } });
  const h = seen[seen.length - 1].h; ok('auth/cookie/agent headers stripped, Host fixed to 127.0.0.1', r.s === 200 && !h.authorization && !h.cookie && !h['x-api-key'] && !h['x-forwarded-for'] && h.host === '127.0.0.1:' + SP, JSON.stringify(h));
  slow = 1500; const a = req(P.sock, { body: chat() }); await sleep(100); r = await req(P.sock, { body: chat() }); ok('concurrency limit -> 429', r.s === 429, String(r.s));
  r = await a; ok('upstream timeout -> 504', r.s === 504, String(r.s)); slow = 0; await sleep(50);
  await P.close(); ok('socket removed on close', !fs.existsSync(P.sock)); }
{ const P = OP.startProxy({ dir: path.join(TMP, 'w2', '.llm'), port: SP, models: ['qwen3:8b'], ratePerMin: 2 }); await P.ready;
  await req(P.sock, { body: chat() }); await req(P.sock, { body: chat() }); const r = await req(P.sock, { body: chat() }); ok('rate limit -> 429', r.s === 429, String(r.s)); await P.close(); }
{ const P = OP.startProxy({ dir: path.join(TMP, 'w3', '.llm'), port: 1, models: ['qwen3:8b'] }); await P.ready; const r = await req(P.sock, { body: chat() }); ok('Ollama down -> 502 ollama unavailable', r.s === 502); await P.close(); }
ok('probe: stub up -> true, closed port -> false (fast)', await OP.probe(SP) === true && await (async () => { const t = Date.now(); const v = await OP.probe(1); return v === false && Date.now() - t < 2000; })());
ok('default allowlist from config (qwen3:8b)', OP.defaultModels().includes('qwen3:8b'));
// 2 integration: real runOpencode in bwrap with an opencode shim that talks to 127.0.0.1:11434 INSIDE the sandbox
let hostHits = 0; const hs = http.createServer((q, r) => { hostHits++; r.end('HOST_API'); }); await new Promise(r => hs.listen(0, '127.0.0.1', r)); const HP = hs.address().port;
const shimDir = path.join(TMP, 'opencode-shim'); fs.mkdirSync(shimDir); const shim = path.join(shimDir, 'opencode');
const httpReq = (port, method, p, body) => `(exec 3<>/dev/tcp/127.0.0.1/${port} && printf '${method} ${p} HTTP/1.0\\r\\nHost: x\\r\\nContent-Type: application/json\\r\\nContent-Length: ${Buffer.byteLength(body)}\\r\\n\\r\\n${body}' >&3 && cat <&3)`;
fs.writeFileSync(shim, `#!/bin/bash
echo "CFG:$(cat opencode.json | tr -d '\\n ')"
${httpReq(11434, 'POST', '/api/chat', JSON.stringify(chat()))} 2>&1 | tr -d '\r' | tr '\n' ' ' | sed 's/^/CHAT:/'; echo
${httpReq(11434, 'POST', '/api/pull', '{"model":"qwen3:8b"}')} 2>&1 | head -1 | sed 's/^/PULL:/'
${httpReq(11434, 'POST', '/api/chat', JSON.stringify(chat('llama-secret:70b')))} 2>&1 | head -1 | sed 's/^/BADMODEL:/'
${httpReq(HP, 'GET', '/', '')} >/dev/null 2>&1 && echo HOSTNET_OK || echo HOSTNET_BLOCKED
(exec 3<>/dev/tcp/1.1.1.1/80) 2>/dev/null && echo EGRESS_OK || echo EGRESS_BLOCKED
${httpReq(SP, 'GET', '/api/tags', '')} >/dev/null 2>&1 && echo DIRECT_OLLAMA_OK || echo DIRECT_OLLAMA_BLOCKED
echo "SOCKS:$(ls -la .llm 2>&1 | grep -c sock)"
echo "ENV:$(env | cut -d= -f1 | tr '\\n' ,)"
[ "$1" = run ] && [ "$3" = sleep ] && sleep 30
echo DONE
`, { mode: 0o755 });
process.env.MK_TEST_OLLAMA_PORT = String(SP); process.env.OPENCODE_BIN = shim; const P0 = process.env.PATH; process.env.PATH = shimDir + ':' + P0;
process.env.STUDIO_SECRET_KEY = 'sk-nope'; process.env.MK_AGENT_TOKEN = 'tok-nope';
const ch = await TR.llmChannel(); ok('llmChannel: Ollama up -> ollama-proxy', ch && ch.kind === 'ollama-proxy', JSON.stringify(ch));
{ const wd = path.join(TMP, 'task1'); const n0 = seen.length; const r = await TR.runOpencode({ prompt: 'hello', workDir: wd, timeoutMs: 30000 }); const lg = fs.readFileSync(r.logFile, 'utf8');
  ok('runOpencode via proxy: sandbox=bwrap, llm=ollama-proxy', r.sandbox === 'bwrap' && r.llm === 'ollama-proxy', JSON.stringify(r) + lg);
  ok('in-sandbox POST /api/chat (allowed) -> STUB_REPLY', /CHAT:.*STUB_REPLY/.test(lg), lg);
  ok('in-sandbox /api/pull -> 403', /PULL:HTTP\/1\.1 403/.test(lg), lg);
  ok('in-sandbox disallowed model -> 403', /BADMODEL:HTTP\/1\.1 403/.test(lg), lg);
  ok('no TCP to host localhost services from sandbox', lg.includes('HOSTNET_BLOCKED') && hostHits === 0, lg);
  ok('no TCP egress to internet from sandbox', lg.includes('EGRESS_BLOCKED'), lg);
  ok('no direct TCP to the real Ollama port (only via proxy)', lg.includes('DIRECT_OLLAMA_BLOCKED'), lg);
  ok('opencode.json points to sandbox-local 127.0.0.1:11434/v1, allowlisted model', lg.includes('"baseURL":"http://127.0.0.1:11434/v1"') && lg.includes('ollama/qwen3:8b'), lg);
  ok('no secrets/tokens in sandbox env', !/STUDIO_SECRET_KEY|MK_AGENT_TOKEN/.test(lg.split('ENV:')[1] || 'X'), lg);
  ok('only allowed requests reached Ollama', seen.slice(n0).filter(x => !(x.m === 'GET' && x.u === '/api/tags')).every(x => x.u === '/api/chat' && x.b.includes('qwen3:8b')) && seen.slice(n0).filter(x => x.u === '/api/chat').length === 1, JSON.stringify(seen.slice(n0).map(x => x.u)) /* GET /api/tags = host-side probe */);
  ok('socket removed after normal finish', !fs.existsSync(path.join(wd, '.llm', 'ollama.sock'))); }
{ const wd = path.join(TMP, 'task2'); const ac = new AbortController(); const pr = TR.runOpencode({ prompt: 'sleep', workDir: wd, signal: ac.signal, timeoutMs: 60000 }).catch(e => e);
  let seenSock = false; for (let i = 0; i < 50 && !seenSock; i++) { await sleep(100); seenSock = fs.existsSync(path.join(wd, '.llm', 'ollama.sock')); }
  await sleep(1500); ac.abort(); const e = await pr;
  ok('cancel: socket existed during task, removed after kill', seenSock && e && e.cancelled && !fs.existsSync(path.join(wd, '.llm', 'ollama.sock')), JSON.stringify({ seenSock, e: e && e.message })); }
{ process.env.MK_TEST_OLLAMA_PORT = '1'; const t0 = Date.now(); let err; try { await TR.runOpencode({ prompt: 'x', workDir: path.join(TMP, 'task3') }); } catch (e) { err = e; }
  ok('Ollama down -> llm_unavailable fast (<3s), nothing run', err && err.code === 'llm_unavailable' && Date.now() - t0 < 3000 && !fs.existsSync(path.join(TMP, 'task3', 'opencode.log')), String(err && err.message)); }
hs.close(); delete process.env.STUDIO_SECRET_KEY; delete process.env.MK_AGENT_TOKEN; process.env.PATH = P0;
// 3 N3-1 marker / cwd sweep on Linux: double-fork + setsid reparents the grandchild to init; ps walk alone misses it
const runCase = async (name, body) => { const d = fs.mkdtempSync(path.join(TMP, 'n31-')), f = path.join(d, 'g.txt'), sc = path.join(d, 'k.sh');
  fs.writeFileSync(sc, `#!/bin/bash\n${body.replaceAll('$F', f)}\nsleep 60\n`, { mode: 0o755 });
  const ac = new AbortController(); const pr = TR.run(sc, [], { cwd: d, signal: ac.signal }).catch(e => e); await sleep(900);
  const desc = (() => { const out = []; for (const e of fs.readdirSync('/proc')) { if (!/^\d+$/.test(e)) continue; try { if (fs.readFileSync(`/proc/${e}/cmdline`, 'latin1').includes(f)) out.push(Number(e)); } catch {} } return out; })();
  ac.abort(); await pr; await sleep(700); const a1 = fs.existsSync(f) ? fs.readFileSync(f).length : 0; await sleep(1200); const a2 = fs.existsSync(f) ? fs.readFileSync(f).length : 0;
  ok(name, a1 > 0 && a1 === a2, JSON.stringify({ a1, a2, desc })); };
await runCase('N3-1 Linux: double-fork+setsid grandchild (reparented, env marker) killed on cancel', `( setsid bash -c 'cd /; while true; do echo x >> $F; sleep 0.2; done' & ) &`);
await runCase('N3-1 Linux: double-fork+setsid with env -i (cwd match in task dir) killed on cancel', `( setsid env -i /bin/bash -c 'while true; do echo x >> $F; sleep 0.2; done' & ) &`);
{ const d = fs.mkdtempSync(path.join(TMP, 'n31n-')), f = path.join(d, 'g.txt'), sc = path.join(d, 'k.sh');
  fs.writeFileSync(sc, `#!/bin/bash\n( setsid bash -c 'cd /; while true; do echo x >> ${f}; sleep 0.2; done' & ) &\nsleep 0.5\nexit 0\n`, { mode: 0o755 });
  await TR.run(sc, [], { cwd: d }); await sleep(400); const a1 = fs.existsSync(f) ? fs.readFileSync(f).length : 0; await sleep(1000); const a2 = fs.existsSync(f) ? fs.readFileSync(f).length : 0;
  ok('N3-1 Linux: leftover reparented process swept after NORMAL exit', a1 > 0 && a1 === a2, JSON.stringify({ a1, a2 })); }
ok('sweep never matches own process / unrelated cwd', !TR.sweep('no-such-mark', path.join(TMP, 'nothing')).includes(process.pid) && TR.sweep('no-such-mark', path.join(TMP, 'nothing')).length === 0);
stub.close(); fs.rmSync(TMP, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`); console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
