const OP = require('/workspace/n5audit-e2bb/lib/ollama-proxy.js');
const TR = require('/workspace/n5audit-e2bb/lib/task-runners.js');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const http = require('http'); const net = require('net');
const FAKE = 19150; const out = []; const rec = (n, ok, x = '') => { out.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function httpSock(sock, method, url, body) {
  return new Promise(res => {
    const rq = http.request({ socketPath: sock, path: url, method, headers: { 'content-type': 'application/json', ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) }, timeout: 4000 },
      x => { const b = []; x.on('data', c => b.push(c)); x.on('end', () => res({ s: x.statusCode, b: Buffer.concat(b).toString() })); });
    rq.on('error', e => res({ s: 0, b: e.message })); rq.on('timeout', () => { rq.destroy(); res({ s: 0, b: 'timeout' }); });
    if (body) rq.end(body); else rq.end();
  });
}
(async () => {
  // redirect
  const fakeR = spawn(process.execPath, ['-e', `require('http').createServer((q,s)=>{q.resume();if(q.url==='/api/tags')return s.end(JSON.stringify({models:[{name:'qwen3:8b'}]}));s.writeHead(302,{Location:'http://127.0.0.1:9/steal'});s.end();}).listen(${FAKE},'127.0.0.1')`], { stdio: 'ignore' });
  await sleep(300);
  { const d = path.join(fs.mkdtempSync('/tmp/opR-'), '.llm'); const p = OP.startProxy({ dir: d, port: FAKE, models: ['qwen3:8b'], ratePerMin: 1000, timeoutMs: 3000 }); await p.ready;
    const r = await httpSock(p.sock, 'POST', '/api/chat', '{"model":"qwen3:8b","x":1}');
    rec('upstream 302 → 502 redirect refused', r.s === 502 && /redirect/.test(r.b), 's=' + r.s + ' ' + String(r.b).slice(0, 80));
    await p.close(); rec('socket removed after close()', !fs.existsSync(path.join(d, 'ollama.sock'))); }
  fakeR.kill();

  const fake = spawn(process.execPath, ['/workspace/opprobe/fake-ollama.mjs'], { env: { ...process.env, FAKE_PORT: String(FAKE) }, stdio: 'ignore' });
  await sleep(400);

  // stale socket kill -9
  { const d2 = path.join(fs.mkdtempSync('/tmp/opatt2-'), '.llm');
    const holder = spawn(process.execPath, ['-e', `const OP=require('/workspace/n5audit-e2bb/lib/ollama-proxy.js');OP.startProxy({dir:process.argv[1],port:${FAKE},models:['qwen3:8b']}).ready.then(()=>{require('fs').writeFileSync(process.argv[1]+'/ready','1');setInterval(()=>{},1e9);});`, d2], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { if (fs.existsSync(path.join(d2, 'ready'))) break; await sleep(50); }
    const sock2 = path.join(d2, 'ollama.sock');
    rec('holder created socket', fs.existsSync(sock2));
    process.kill(holder.pid, 9); await sleep(200);
    rec('after kill -9 socket file still present (stale)', fs.existsSync(sock2));
    const p2 = OP.startProxy({ dir: d2, port: FAKE, models: ['qwen3:8b'] }); await p2.ready;
    const r = await httpSock(p2.sock, 'GET', '/api/tags');
    rec('restart after kill -9 serves', r.s === 200, 's=' + r.s);
    await p2.close(); rec('close after restart removes socket', !fs.existsSync(sock2)); }

  { const d3 = path.join(fs.mkdtempSync('/tmp/opatt3-'), '.llm');
    const p3 = OP.startProxy({ dir: d3, port: FAKE, models: ['qwen3:8b'] }); await p3.ready;
    const mode = fs.statSync(p3.sock).mode & 0o777;
    rec('socket not group/other accessible', (mode & 0o077) === 0, 'mode=' + mode.toString(8));
    const r = await new Promise(res => { const c = net.connect(p3.sock); c.on('connect', () => { c.end(); res(true); }); c.on('error', () => res(false)); });
    rec('same-uid can connect', r); await p3.close(); }
  rec('UPSTREAM_HOST is 127.0.0.1', OP.UPSTREAM_HOST === '127.0.0.1');
  rec('ROUTES exact 4', Object.keys(OP.ROUTES).length === 4);

  // N3-1 sweep
  { const mark = 'test-mark-' + Date.now(); const cwd = fs.mkdtempSync('/tmp/orphcwd-');
    const orphan = spawn('bash', ['-c', `cd "${cwd}" && export MK_TASK_MARK=${mark} && (setsid bash -c 'exec -a orphmark sleep 300' &) ; sleep 300`], { detached: true, stdio: 'ignore', env: { ...process.env, MK_TASK_MARK: mark } });
    await sleep(600);
    const found = TR.sweep(mark, cwd);
    const byName = execFileSync('ps', ['-eo', 'pid=,args=']).toString().split('\n').filter(l => l.includes('orphmark')).map(l => +l.trim().split(/\s+/)[0]);
    rec('N3-1 sweep finds double-fork orphan', found.some(p => byName.includes(p)) || (found.length > 0 && byName.length > 0), 'sweep=' + JSON.stringify(found) + ' byName=' + JSON.stringify(byName));
    const ac = new AbortController();
    const runP = TR.run('bash', ['-c', `(setsid bash -c 'exec -a orphmark2 sleep 300' &) ; sleep 60`], { cwd, signal: ac.signal, timeoutMs: 30000 }).catch(e => e);
    await sleep(800); ac.abort(); await runP; await sleep(600);
    const left = execFileSync('ps', ['-eo', 'pid=,args=']).toString().split('\n').filter(l => /orphmark/.test(l));
    rec('N3-1 run() abort kills double-fork orphan', left.length === 0, 'left=' + JSON.stringify(left));
    for (const p of [...found, ...byName]) { try { process.kill(p, 9); } catch {} }
    try { process.kill(-orphan.pid, 9); } catch {} try { process.kill(orphan.pid, 9); } catch {} }

  // sandbox via socket
  { const W = fs.mkdtempSync('/tmp/opsb-'); const d = path.join(W, '.llm');
    const p = OP.startProxy({ dir: d, port: FAKE, models: ['qwen3:8b'], ratePerMin: 1000 }); await p.ready;
    const probeSh = path.join(W, 'probe.sh');
    fs.writeFileSync(probeSh, `#!/bin/bash
L="$1"
echo -n "TCP_11434:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/11434' 2>/dev/null && echo yes >> "$L" || echo no >> "$L"
echo -n "TCP_FAKE:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/${FAKE}' 2>/dev/null && echo yes >> "$L" || echo no >> "$L"
echo -n "TCP_1:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/1.1.1.1/80' 2>/dev/null && echo yes >> "$L" || echo no >> "$L"
if [ -S /tmp/llm/ollama.sock ]; then
  printf 'GET /api/tags HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n' | timeout 2 nc -U /tmp/llm/ollama.sock | head -c 300 > "$L.tags" || true
  printf 'POST /api/pull HTTP/1.1\\r\\nHost: x\\r\\nContent-Type: application/json\\r\\nContent-Length: 20\\r\\nConnection: close\\r\\n\\r\\n{"name":"evil:1b"}' | timeout 2 nc -U /tmp/llm/ollama.sock | head -c 300 > "$L.pull" || true
fi
`, { mode: 0o755 });
    const sb = TR.sandboxed('/bin/bash', [probeSh, path.join(W, 'out.txt')], { workDir: W });
    if (!sb || sb.kind !== 'bwrap') rec('sandbox available', false, String(sb && sb.kind));
    else {
      const a = sb.args; const cut = a.indexOf('--');
      const args2 = [...a.slice(0, cut), '--tmpfs', '/tmp/llm', '--ro-bind', p.sock, '/tmp/llm/ollama.sock', ...a.slice(cut)];
      await TR.run(sb.bin, args2, { cwd: W, timeoutMs: 15000, env: TR.safeEnv({ HOME: sb.home, TMPDIR: '/tmp' }) }).catch(e => e);
      const log = fs.readFileSync(path.join(W, 'out.txt'), 'utf8');
      const tagsOut = fs.existsSync(path.join(W, 'out.txt.tags')) ? fs.readFileSync(path.join(W, 'out.txt.tags'), 'utf8') : '';
      const pullOut = fs.existsSync(path.join(W, 'out.txt.pull')) ? fs.readFileSync(path.join(W, 'out.txt.pull'), 'utf8') : '';
      rec('sandbox: no TCP to real 11434', /TCP_11434:no/.test(log), log.match(/TCP_.*/g)?.join(' | '));
      rec('sandbox: no TCP to fake upstream', /TCP_FAKE:no/.test(log));
      rec('sandbox: no TCP to internet', /TCP_1:no/.test(log));
      rec('sandbox: tags via bound socket', /qwen3:8b/.test(tagsOut) || /HTTP\/1\.1 200/.test(tagsOut), tagsOut.slice(0, 120));
      rec('sandbox: pull via socket → 403', /403/.test(pullOut), pullOut.slice(0, 120));
    }
    await p.close(); }

  // slowloris
  { const d = path.join(fs.mkdtempSync('/tmp/opslow-'), '.llm');
    const p = OP.startProxy({ dir: d, port: FAKE, models: ['qwen3:8b'], maxConcurrent: 2, ratePerMin: 1000 }); await p.ready;
    const slow = [];
    for (let i = 0; i < 3; i++) { const c = net.connect(p.sock); slow.push(c); c.write('POST /api/chat HTTP/1.1\r\nHost: x\r\n'); }
    await sleep(500);
    const t0 = Date.now();
    const r = await httpSock(p.sock, 'GET', '/api/tags');
    rec('slowloris: legit request still served', r.s === 200, 's=' + r.s + ' ms=' + (Date.now() - t0));
    // wait for headersTimeout to reap slow conns
    await sleep(11000);
    const r2 = await httpSock(p.sock, 'GET', '/api/tags');
    rec('slowloris: after headersTimeout still serves', r2.s === 200, 's=' + r2.s);
    for (const c of slow) try { c.destroy(); } catch {}
    await p.close(); }

  // MK_TEST_OLLAMA_PORT does not weaken: with port 1, llmChannel null even if real Ollama on 11434
  { process.env.NODE_ENV = 'test'; delete process.env.MK_TEST_LLM_STUB;
    process.env.MK_TEST_OLLAMA_PORT = '1';
    const ch = await TR.llmChannel();
    rec('MK_TEST_OLLAMA_PORT=1 → llmChannel null (Ollama on 11434 ignored)', ch === null, JSON.stringify(ch));
    delete process.env.MK_TEST_OLLAMA_PORT;
    // without override, real 11434 may make channel available on linux
    const ch2 = await TR.llmChannel();
    rec('without override, probe real 11434 (read-only)', ch2 === null || ch2.kind === 'ollama-proxy', JSON.stringify(ch2));
  }

  console.log('SUMMARY', JSON.stringify({ pass: out.filter(o => o.ok).length, fail: out.filter(o => !o.ok).map(o => o.n) }));
  fake.kill();
  process.exit(out.some(o => !o.ok) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
