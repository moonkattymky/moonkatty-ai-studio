// Runs INSIDE the bwrap sandbox (own empty network namespace, loopback only). Listens on the sandbox-private
// 127.0.0.1:11434 and pipes every connection to the per-task unix socket of lib/ollama-proxy.js (bound in by bwrap),
// then runs the real tool and exits with its status. Nothing here can reach the host network: the namespace has no
// interfaces except its own lo; filtering happens host-side in the proxy.
// Usage: node llm-bridge.js <sock> -- <bin> [args...]
'use strict';
const net = require('net'), { spawn } = require('child_process');
const [sock, sep, bin, ...args] = process.argv.slice(2);
if (!sock || sep !== '--' || !bin) { console.error('llm-bridge: usage'); process.exit(2); }
const srv = net.createServer(c => { const u = net.connect(sock); c.pipe(u).pipe(c); const k = () => { c.destroy(); u.destroy(); }; c.on('error', k); u.on('error', k); });
srv.listen(11434, '127.0.0.1', () => {
  const p = spawn(bin, args, { stdio: 'inherit' });
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { try { p.kill(s); } catch {} });
  p.on('exit', (code, sig) => process.exit(code == null ? 128 + 15 : code));
  p.on('error', e => { console.error('llm-bridge: ' + e.message); process.exit(127); });
});
srv.on('error', e => { console.error('llm-bridge listen: ' + e.message); process.exit(3); });
