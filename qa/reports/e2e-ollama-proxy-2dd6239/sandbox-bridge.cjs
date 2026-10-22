const OP = require('/workspace/n5audit-e2bb/lib/ollama-proxy.js');
const TR = require('/workspace/n5audit-e2bb/lib/task-runners.js');
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const FAKE = 19160; const out = []; const rec = (n, ok, x = '') => { out.push({ n, ok }); console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
(async () => {
  const fake = spawn(process.execPath, ['/workspace/opprobe/fake-ollama.mjs'], { env: { ...process.env, FAKE_PORT: String(FAKE) }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 400));
  const W = fs.mkdtempSync('/tmp/opbr-'); const d = path.join(W, '.llm');
  const p = OP.startProxy({ dir: d, port: FAKE, models: ['qwen3:8b'], ratePerMin: 1000 }); await p.ready;
  // tool script: runs AFTER bridge is up on 127.0.0.1:11434 inside netns
  const tool = path.join(W, 'tool.sh');
  fs.writeFileSync(tool, `#!/bin/bash
L="$1"
echo -n "TCP_BRIDGE:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/11434' 2>/dev/null && echo yes >> "$L" || echo no >> "$L"
echo -n "TCP_REAL_HOST_OLLAMA:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/11434' >/dev/null; # same - bridge owns 11434 in netns
echo -n "TCP_FAKE:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/127.0.0.1/${FAKE}' 2>/dev/null && echo yes >> "$L" || echo no >> "$L"
echo -n "TCP_1:" >> "$L"; timeout 1 bash -c 'echo >/dev/tcp/1.1.1.1/80' 2>/dev/null && echo yes >> "$L" || echo no >> "$L"
# talk to bridge with bash /dev/tcp (HTTP)
exec 3<>/dev/tcp/127.0.0.1/11434
printf 'GET /api/tags HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n' >&3
cat <&3 | head -c 400 > "$L.tags" || true
exec 3>&-
exec 3<>/dev/tcp/127.0.0.1/11434
printf 'POST /api/pull HTTP/1.1\\r\\nHost: x\\r\\nContent-Type: application/json\\r\\nContent-Length: 20\\r\\nConnection: close\\r\\n\\r\\n{"name":"evil:1b"}' >&3
cat <&3 | head -c 400 > "$L.pull" || true
exec 3>&-
exec 3<>/dev/tcp/127.0.0.1/11434
printf 'POST /api/chat HTTP/1.1\\r\\nHost: x\\r\\nContent-Type: application/json\\r\\nContent-Length: 37\\r\\nConnection: close\\r\\n\\r\\n{"model":"evil:1b","messages":[]}' >&3
cat <&3 | head -c 400 > "$L.evil" || true
`, { mode: 0o755 });
  const bridge = path.join('/workspace/n5audit-e2bb/lib/llm-bridge.js');
  const sb = TR.sandboxed(process.execPath, [bridge, p.sock, '--', '/bin/bash', tool, path.join(W, 'out.txt')], { workDir: W, extraBins: ['/bin/bash'], roFiles: [bridge] });
  if (!sb) { rec('sandboxed bridge', false); process.exit(1); }
  // need sock visible at the path the bridge uses (absolute host path of sock is passed; bwrap must bind it)
  // llm-bridge connects to sock path as given — must be same path inside sandbox → ro-bind sock to itself
  const a = sb.args; const cut = a.indexOf('--');
  const args2 = [...a.slice(0, cut), '--ro-bind', p.sock, p.sock, ...a.slice(cut)];
  const err = await TR.run(sb.bin, args2, { cwd: W, timeoutMs: 20000, env: TR.safeEnv({ HOME: sb.home, TMPDIR: '/tmp', OLLAMA_HOST: 'http://127.0.0.1:11434' }) }).catch(e => e);
  const log = fs.existsSync(path.join(W, 'out.txt')) ? fs.readFileSync(path.join(W, 'out.txt'), 'utf8') : '';
  const tags = fs.existsSync(path.join(W, 'out.txt.tags')) ? fs.readFileSync(path.join(W, 'out.txt.tags'), 'utf8') : '';
  const pull = fs.existsSync(path.join(W, 'out.txt.pull')) ? fs.readFileSync(path.join(W, 'out.txt.pull'), 'utf8') : '';
  const evil = fs.existsSync(path.join(W, 'out.txt.evil')) ? fs.readFileSync(path.join(W, 'out.txt.evil'), 'utf8') : '';
  rec('bridge run ok', !(err && err.message) || /код/.test(err.message || '') === false, String(err && err.message || 'ok').slice(0, 80));
  rec('sandbox+bridge: TCP to 11434 (bridge) yes', /TCP_BRIDGE:yes/.test(log), log);
  rec('sandbox+bridge: no TCP to fake upstream port', /TCP_FAKE:no/.test(log));
  rec('sandbox+bridge: no internet', /TCP_1:no/.test(log));
  rec('sandbox+bridge: tags filtered ok', /qwen3:8b/.test(tags) && !/evil/.test(tags), tags.slice(0, 150));
  rec('sandbox+bridge: pull denied 403', /403/.test(pull), pull.slice(0, 120));
  rec('sandbox+bridge: evil model denied 403', /403/.test(evil), evil.slice(0, 120));
  await p.close(); fake.kill();
  console.log('SUMMARY', JSON.stringify({ pass: out.filter(o => o.ok).length, fail: out.filter(o => !o.ok).map(o => o.n) }));
  process.exit(out.some(o => !o.ok) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
