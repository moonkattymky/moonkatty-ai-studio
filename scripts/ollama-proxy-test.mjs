// Filtered Ollama proxy only. OpenCode is not started.
import { createRequire } from 'module';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
process.env.STUDIO_FLAVOR = 'test';
process.env.NODE_ENV = 'test';
const OP = require('../lib/ollama-proxy.js');
let fail = 0, pass = 0;
const ok = (n, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x && !c ? ' — ' + x : '')); c ? pass++ : fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-op-'));
const seen = []; let slow = 0;
const stub = http.createServer((q, r) => {
  let b = ''; q.on('data', c => b += c); q.on('end', async () => {
    seen.push({ m: q.method, u: q.url, h: q.headers, b });
    if (q.url === '/api/redirect') { r.writeHead(302, { location: 'http://evil.example/' }); return r.end(); }
    if (slow) await sleep(slow);
    if (q.url === '/api/tags') { r.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'x=1' }); return r.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'llama-secret:70b' }] })); }
    r.writeHead(200, { 'content-type': 'application/json', 'x-internal': 'leak' });
    r.end(JSON.stringify({ message: { role: 'assistant', content: 'STUB_REPLY' }, done: true }));
  });
});
await new Promise(r => stub.listen(0, '127.0.0.1', r));
const SP = stub.address().port;
const req = (sock, { method = 'POST', p = '/api/chat', body, headers = {} } = {}) => new Promise(res => {
  const q = http.request({ socketPath: sock, method, path: p, headers: { 'content-type': 'application/json', ...headers } }, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res({ s: r.statusCode, h: r.headers, d }));
  });
  q.on('error', e => res({ s: 0, d: e.message }));
  if (body !== undefined) q.write(typeof body === 'string' ? body : JSON.stringify(body));
  q.end();
});
const chat = (model = 'qwen3:8b') => ({ model, messages: [{ role: 'user', content: 'hi' }], stream: false });
{
  const P = OP.startProxy({ dir: path.join(TMP, 'w1', '.llm'), port: SP, models: ['qwen3:8b'], maxBody: 4096, maxConcurrent: 1, ratePerMin: 1000, timeoutMs: 800 });
  await P.ready;
  ok('socket 0600, dir 0700', (fs.statSync(P.sock).mode & 0o777) === 0o600 && (fs.statSync(P.dir).mode & 0o777) === 0o700);
  let r = await req(P.sock, { body: chat() });
  ok('POST /api/chat allowed -> 200', r.s === 200 && r.d.includes('STUB_REPLY'), JSON.stringify(r));
  ok('response headers filtered', !r.h['x-internal']);
  r = await req(P.sock, { method: 'GET', p: '/api/tags' });
  ok('GET /api/tags allowlist, no cookie', r.s === 200 && r.d.includes('qwen3:8b') && !r.d.includes('llama-secret') && !r.h['set-cookie'], r.d);
  const n0 = seen.length;
  for (const [m, p] of [['POST', '/api/pull'], ['DELETE', '/api/delete'], ['POST', '/api/push'], ['POST', '/api/redirect']]) {
    r = await req(P.sock, { method: m, p, body: m === 'GET' ? undefined : chat() });
    ok('rejected ' + m + ' ' + p, r.s === 403, String(r.s));
  }
  r = await req(P.sock, { p: 'http://evil.example/api/chat', body: chat() });
  ok('absolute-form URL rejected', r.s === 403, String(r.s));
  r = await req(P.sock, { body: chat('llama-secret:70b') });
  ok('model not allowed', r.s === 403);
  ok('rejected requests did not reach Ollama', seen.length === n0, JSON.stringify(seen.slice(n0).map(x => x.u)));
  r = await req(P.sock, { body: chat(), headers: { authorization: 'Bearer AGENT-TOKEN', cookie: 'sid=SESSION', 'x-api-key': 'k' } });
  const h = seen[seen.length - 1].h;
  ok('auth headers stripped', r.s === 200 && !h.authorization && !h.cookie && !h['x-api-key'] && h.host === '127.0.0.1:' + SP, JSON.stringify(h));
  slow = 1500;
  const a = req(P.sock, { body: chat() });
  await sleep(80);
  r = await req(P.sock, { body: chat() });
  ok('concurrency -> 429', r.s === 429, String(r.s));
  r = await a;
  ok('upstream timeout -> 504', r.s === 504, String(r.s));
  slow = 0;
  await P.close();
  ok('socket removed', !fs.existsSync(P.sock));
}
ok('probe down is fast', await (async () => { const t = Date.now(); const v = await OP.probe(1); return v === false && Date.now() - t < 2000; })());
stub.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
