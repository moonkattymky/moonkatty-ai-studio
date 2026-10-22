import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import http from 'http'; import net from 'net';
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const ROOT = '/workspace/n5audit-e2bb'; const OP = require(ROOT + '/lib/ollama-proxy.js');
const FAKE = 19134; const out = []; const rec = (n, ok, x = '') => { out.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.writeFileSync('/tmp/fake-ollama.log', '');
const fake = spawn(process.execPath, ['/workspace/opprobe/fake-ollama.mjs'], { env: { ...process.env, FAKE_PORT: String(FAKE) }, stdio: 'ignore' });
await sleep(400);

const W = fs.mkdtempSync('/tmp/opatt-'); const dir = path.join(W, '.llm');
const proxy = OP.startProxy({ dir, port: FAKE, models: ['qwen3:8b', 'qwen2.5-coder:7b'], maxBody: 1 << 20, maxConcurrent: 2, ratePerMin: 60, timeoutMs: 5000 });
await proxy.ready;
const sock = proxy.sock;
rec('socket mode 0600', (fs.statSync(sock).mode & 0o777) === 0o600, 'mode=' + (fs.statSync(sock).mode & 0o777).toString(8));
rec('socket dir 0700', (fs.statSync(dir).mode & 0o777) === 0o700, 'mode=' + (fs.statSync(dir).mode & 0o777).toString(8));

function raw(reqLine, headers, body) {
  return new Promise((resolve) => {
    const c = net.connect(sock); let buf = ''; let done = false;
    const fin = () => { if (done) return; done = true; try { c.destroy(); } catch {} resolve(buf); };
    c.setTimeout(3000, fin); c.on('data', d => buf += d); c.on('end', fin); c.on('error', fin); c.on('close', fin);
    let msg = reqLine + '\r\n'; for (const [k, v] of Object.entries(headers || {})) msg += k + ': ' + v + '\r\n';
    msg += '\r\n'; if (body) msg += body; c.write(msg); if (!body || headers['Transfer-Encoding'] !== 'chunked') setTimeout(() => { try { c.end(); } catch {} }, 50);
  });
}
function httpSock(method, url, body, hdr = {}) {
  return new Promise((resolve) => {
    const r = http.request({ socketPath: sock, path: url, method, headers: { 'content-type': 'application/json', ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...hdr }, timeout: 4000 }, res => {
      const b = []; res.on('data', c => b.push(c)); res.on('end', () => resolve({ s: res.statusCode, h: res.headers, b: Buffer.concat(b).toString('utf8') }));
    });
    r.on('error', e => resolve({ s: 0, b: e.message })); r.on('timeout', () => { r.destroy(); resolve({ s: 0, b: 'timeout' }); });
    if (body) r.write(body); r.end();
  });
}
const upLast = () => { const lines = fs.readFileSync('/tmp/fake-ollama.log', 'utf8').trim().split('\n').filter(Boolean); return lines.length ? JSON.parse(lines[lines.length - 1]) : null; };

for (const p of ['/api/pull', '/api/delete', '/api/create', '/api/push', '/api/copy', '/api/embed', '/api/embeddings', '/api/ps', '/api/version', '/api/show', '/']) {
  const r = await httpSock('POST', p, JSON.stringify({ model: 'qwen3:8b', name: 'qwen3:8b' }));
  rec('deny ' + p, r.s === 403, 's=' + r.s);
}
for (const p of ['/api/chat', '/api/generate', '/v1/chat/completions']) {
  const r = await httpSock('POST', p, JSON.stringify({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], prompt: 'hi' }));
  rec('allow ' + p, r.s === 200 && /"ok"/.test(r.b), 's=' + r.s);
}
const tags = await httpSock('GET', '/api/tags');
rec('GET /api/tags filters models', tags.s === 200 && /qwen3:8b/.test(tags.b) && !/evil/.test(tags.b), tags.b.slice(0, 120));

for (const [line, note] of [
  ['POST /api/%70ull HTTP/1.1', 'encoded pull'],
  ['POST /api/chat/../pull HTTP/1.1', 'path traversal'],
  ['POST /api/chat/%2e%2e/pull HTTP/1.1', 'encoded traversal'],
  ['POST http://127.0.0.1:8971/api/jobs HTTP/1.1', 'absolute-URI to Studio'],
  ['POST http://evil.example/api/chat HTTP/1.1', 'absolute-URI other host'],
  ['CONNECT 127.0.0.1:8971 HTTP/1.1', 'CONNECT'],
  ['POST /api/chat%00/../pull HTTP/1.1', 'null byte'],
  ['POST /API/CHAT HTTP/1.1', 'case'],
  ['POST //api/chat HTTP/1.1', 'double slash'],
  ['POST /api/chat;x=1 HTTP/1.1', 'matrix'],
]) {
  const buf = await raw(line, { Host: '127.0.0.1:11434', 'Content-Type': 'application/json', 'Content-Length': '28' }, '{"model":"qwen3:8b","x":1}');
  const code = +(buf.match(/HTTP\/1\.\d (\d+)/) || [])[1] || 0;
  rec('deny ' + note, code === 403 || code === 400 || code === 0, 'code=' + code);
}

for (const m of ['evil:1b', 'llama3:70b', '', '../x']) {
  const r = await httpSock('POST', '/api/chat', JSON.stringify({ model: m, messages: [] }));
  rec('deny model ' + JSON.stringify(m), r.s === 403 || r.s === 400, 's=' + r.s);
}
rec('allow model qwen3:8b', (await httpSock('POST', '/api/chat', JSON.stringify({ model: 'qwen3:8b', messages: [] }))).s === 200);
rec('allow model ollama/qwen3:8b', (await httpSock('POST', '/api/chat', JSON.stringify({ model: 'ollama/qwen3:8b', messages: [] }))).s === 200);

const bigBody = JSON.stringify({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'a'.repeat((1 << 20) + 50) }] });
const rBig = await httpSock('POST', '/api/chat', bigBody);
rec('deny body > 1MB (CL)', rBig.s === 413, 's=' + rBig.s);

{
  const c = net.connect(sock); let buf = '';
  await new Promise(res => {
    c.on('data', d => buf += d); c.on('end', res); c.on('error', res); c.setTimeout(5000, () => { c.destroy(); res(); });
    c.write('POST /api/chat HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n');
    const chunk = Buffer.alloc(65536, 0x62); let sent = 0;
    const pump = () => { if (sent > (1 << 20) + 200000) { try { c.write('0\r\n\r\n'); } catch {} return; }
      try { c.write(chunk.length.toString(16) + '\r\n'); c.write(chunk); c.write('\r\n'); sent += chunk.length; setImmediate(pump); } catch { res(); } };
    pump();
  });
  const code = +(buf.match(/HTTP\/1\.\d (\d+)/) || [])[1] || 0;
  rec('deny chunked oversize', code === 413 || code === 400 || code === 0, 'code=' + code);
}

{
  const before = fs.readFileSync('/tmp/fake-ollama.log', 'utf8').length;
  const buf = await raw('POST /api/chat HTTP/1.1', { Host: 'x', 'Content-Length': '28', 'Transfer-Encoding': 'chunked', 'Content-Type': 'application/json' },
    '1c\r\n{"model":"qwen3:8b","x":1}\r\n0\r\n\r\n');
  const code = +(buf.match(/HTTP\/1\.\d (\d+)/) || [])[1] || 0;
  await sleep(100);
  const last = upLast();
  const smuggled = last && fs.readFileSync('/tmp/fake-ollama.log', 'utf8').length > before && (last.headers['transfer-encoding'] || last.headers.authorization || last.headers.cookie);
  rec('TE/CL: no client hop-by-hop to upstream', !smuggled, 'code=' + code + ' up=' + (last && JSON.stringify(last.headers)));
}

{
  const before = fs.readFileSync('/tmp/fake-ollama.log', 'utf8').length;
  await raw('POST /api/chat HTTP/1.1', { Host: 'x\r\nX-Smuggled: yes', 'Content-Type': 'application/json', 'Content-Length': '28', Authorization: 'Bearer SECRET', Cookie: 'a=b', 'X-Studio-App-Token': 'TOK' },
    '{"model":"qwen3:8b","x":1}');
  await sleep(100);
  const last = upLast();
  const bad = last && fs.readFileSync('/tmp/fake-ollama.log', 'utf8').length > before && (last.headers.authorization || last.headers.cookie || last.headers['x-studio-app-token'] || last.headers['x-smuggled']);
  rec('headers rebuilt (no Auth/Cookie/token/smuggle)', !bad, last ? JSON.stringify(last.headers) : 'none');
}

{
  await httpSock('POST', '/api/chat', JSON.stringify({ model: 'qwen3:8b', messages: [] }), { Host: 'evil.example:443' });
  await sleep(50);
  const last = upLast();
  rec('client Host ignored; upstream Host fixed', last && last.host === '127.0.0.1:' + FAKE, last && last.host);
}

{
  const rs = await Promise.all(Array.from({ length: 5 }, () => httpSock('POST', '/api/chat', JSON.stringify({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'x'.repeat(2000) }] }))));
  const codes = rs.map(r => r.s);
  rec('concurrency: 429 among parallel', codes.includes(429) || codes.filter(c => c === 200).length <= 2, 'codes=' + codes.join(','));
}

{
  let n429 = 0, n200 = 0;
  for (let i = 0; i < 70; i++) { const r = await httpSock('POST', '/api/chat', JSON.stringify({ model: 'qwen3:8b', messages: [] })); if (r.s === 429) n429++; if (r.s === 200) n200++; }
  rec('rate limit 60/min', n429 >= 5 && n200 <= 65, '200=' + n200 + ' 429=' + n429);
}

// redirect: swap fake
fake.kill(); await sleep(200);
const fake2 = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>{if(q.url==='/api/tags')return s.end(JSON.stringify({models:[{name:'qwen3:8b'}]}));s.writeHead(302,{Location:'http://127.0.0.1:9/steal'});s.end();}).listen(${FAKE},'127.0.0.1')`], { stdio: 'ignore' });
await sleep(300);
{
  // new proxy against redirecting upstream (rate window may still be full — use fresh proxy)
  await proxy.close();
  const W2 = fs.mkdtempSync('/tmp/opattR-'); const d2 = path.join(W2, '.llm');
  const pR = OP.startProxy({ dir: d2, port: FAKE, models: ['qwen3:8b'], ratePerMin: 1000 }); await pR.ready;
  const r = await new Promise(res => { const rq = http.request({ socketPath: pR.sock, path: '/api/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': 28 } }, x => { const b=[]; x.on('data',c=>b.push(c)); x.on('end',()=>res({s:x.statusCode,b:Buffer.concat(b).toString()})); }); rq.on('error', e => res({ s: 0, b: e.message })); rq.end('{"model":"qwen3:8b","x":1}'); });
  rec('upstream 302 → 502 redirect refused', r.s === 502 && /redirect/.test(r.b), 's=' + r.s + ' ' + r.b.slice(0, 80));
  await pR.close();
}
fake2.kill();

// restart fake for remaining
const fake3 = spawn(process.execPath, ['/workspace/opprobe/fake-ollama.mjs'], { env: { ...process.env, FAKE_PORT: String(FAKE) }, stdio: 'ignore' });
await sleep(300);

{
  const W2 = fs.mkdtempSync('/tmp/opatt2-'); const d2 = path.join(W2, '.llm');
  const holder = spawn(process.execPath, ['-e', `
const OP=require('${ROOT}/lib/ollama-proxy.js');
OP.startProxy({dir:process.argv[1],port:${FAKE},models:['qwen3:8b']}).ready.then(()=>{require('fs').writeFileSync(process.argv[1]+'/ready','1'); setInterval(()=>{},1e9);});
`], [d2], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { if (fs.existsSync(path.join(d2, 'ready'))) break; await sleep(50); }
  const sock2 = path.join(d2, 'ollama.sock');
  rec('holder created socket', fs.existsSync(sock2));
  process.kill(holder.pid, 9); await sleep(200);
  rec('after kill -9 socket file still present (stale)', fs.existsSync(sock2));
  const p2 = OP.startProxy({ dir: d2, port: FAKE, models: ['qwen3:8b'] });
  let ok = true; try { await p2.ready; } catch (e) { ok = false; rec('restart after stale', false, e.message); }
  if (ok) {
    const r = await new Promise(res => { const rq = http.request({ socketPath: p2.sock, path: '/api/tags', method: 'GET' }, x => { const b=[]; x.on('data',c=>b.push(c)); x.on('end',()=>res({s:x.statusCode})); }); rq.on('error', e => res({ s: 0, b: e.message })); rq.end(); });
    rec('restart after kill -9 serves', r.s === 200, 's=' + r.s); await p2.close();
  }
  rec('close() removes socket', !fs.existsSync(p2?.sock || sock2) || !fs.existsSync(path.join(d2, 'ollama.sock')));
}

{
  const W3 = fs.mkdtempSync('/tmp/opatt3-'); const d3 = path.join(W3, '.llm');
  const p3 = OP.startProxy({ dir: d3, port: FAKE, models: ['qwen3:8b'] }); await p3.ready;
  const mode = fs.statSync(p3.sock).mode & 0o777;
  rec('socket not group/other accessible', (mode & 0o077) === 0, 'mode=' + mode.toString(8));
  const r = await new Promise(res => { const c = net.connect(p3.sock); c.on('connect', () => { c.end(); res(true); }); c.on('error', () => res(false)); });
  rec('same-uid can connect', r);
  await p3.close();
}

// UPSTREAM_HOST fixed
rec('UPSTREAM_HOST is 127.0.0.1', OP.UPSTREAM_HOST === '127.0.0.1');
rec('ROUTES exact 4', Object.keys(OP.ROUTES).length === 4);

console.log('SUMMARY', JSON.stringify({ pass: out.filter(o => o.ok).length, fail: out.filter(o => !o.ok).map(o => o.n) }));
fake3.kill();
process.exit(out.some(o => !o.ok) ? 1 : 0);
