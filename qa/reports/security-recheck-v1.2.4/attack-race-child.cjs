'use strict';
const fs = require('fs');
const { createNodeManager } = require(process.env.NODES_JS);
const dir = process.argv[2];
const secret = process.argv[3];
const rid = process.argv[4];
const sig = process.argv[5];
const ts = process.argv[6];
const loaded = process.argv[7];
const go = process.argv[8];
const mgr = createNodeManager({ dir, idSuffix: '-test', allowPlainEnrollForTests: true });
fs.writeFileSync(loaded, '1');
const t0 = Date.now();
while (!fs.existsSync(go)) { if (Date.now() - t0 > 8000) { process.stdout.write(JSON.stringify({ ok: false, code: 'barrier' })); process.exit(0); } }
try {
  const r = mgr.enrollment.status({ requestId: rid, requestSecret: secret, ts: +ts, sig }, '127.0.0.1');
  process.stdout.write(JSON.stringify({ ok: true, status: r.status, token: r.token || null }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, code: e.code || '', message: e.message }));
}
