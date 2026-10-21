'use strict';
// Test coordinator process: real Node Manager + TLS listener (self-signed, pinned) on 127.0.0.1, plus a loopback admin port for the test.
const http = require('http'); const N = require('../../lib/ops/nodes.js');
const dir = process.env.COORD_DIR; const mgr = N.createNodeManager({ dir, leaseMs: +process.env.COORD_LEASE_MS || 1500, nodeDownMs: +process.env.COORD_DOWN_MS || 2500,
  notify: async m => { alerts.push(m); } }); const alerts = [];
const tls = N.ensureCert(dir);
N.listen(mgr, { host: '127.0.0.1', port: 0, tls }).then(srv => {
  setInterval(() => mgr.sweep(), 300);
  const admin = http.createServer(async (req, res) => { const c = []; for await (const d of req) c.push(d); const b = c.length ? JSON.parse(Buffer.concat(c)) : {};
    try { let out; const u = req.url;
      if (u === '/register') out = mgr.registerNode(b); else if (u === '/submit') out = mgr.submit(b); else if (u === '/status') out = { ...mgr.status(), alerts, jobsFull: mgr._state.jobs };
      else if (u === '/put-file') out = { sha256: mgr.putLocalFile(Buffer.from(b.data, 'base64')) }; else if (u === '/command') out = mgr.setCommand(b.id, b.command); else if (u === '/retry') out = mgr.retry(b.id); else throw new Error('404');
      res.end(JSON.stringify(out)); } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); } });
  admin.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: srv.address().port, admin: admin.address().port, fingerprint: tls.fingerprint, cert: dir + '/nodes-tls.crt' }) + '\n'));
});
