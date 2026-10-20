'use strict';
// Real server with STUDIO_OPS_NODES=1: owner-only admin API, node API on a SEPARATE TLS listener (127.0.0.1 by default),
// node token rejected by the main app, main app routes not reachable via the node listener; runner dispatches node tasks.
const test = require('node:test'); const assert = require('node:assert/strict'); const https = require('https'); const fs = require('fs'), path = require('path');
const { startServer, sleep } = require('../helpers/server.js');
const nreq = (port, p, token, body, ca) => new Promise((res, rej) => { const d = body ? JSON.stringify(body) : null;
  const r = https.request({ host: '127.0.0.1', port, path: p, method: body ? 'POST' : 'GET', ca, checkServerIdentity: () => undefined, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => { let j = null; try { j = JSON.parse(s); } catch {} res({ status: x.statusCode, body: j }); }); });
  r.on('error', rej); if (d) r.write(d); r.end(); });
test('nodes flag: admin API + separate TLS node listener + runner dispatch', { timeout: 60000 }, async () => {
  const NP = 18790 + (process.pid % 200); const s = await startServer({ port: 18600 + (process.pid % 300), env: { STUDIO_OPS_NODES: '1', OPS_NODES_PORT: String(NP) } });
  try {
    assert.equal((await s.j('GET', '/api/ops/nodes', s.R)).status, 401, 'owner session required');
    const reg = await s.j('POST', '/api/ops/nodes', s.A, { id: 'imac', role: 'imac', name: 'iMac 27' }); assert.equal(reg.status, 200); assert.match(reg.body.token, /^nk_imac\./);
    assert.equal((await s.j('POST', '/api/ops/nodes', s.A, { id: 'mb', role: 'macbook', caps: ['opencode.run'] })).status, 400);
    assert.equal((await s.j('GET', '/api/tasks', { ...s.R, authorization: 'Bearer ' + reg.body.token })).status, 401, 'node token useless on main app');
    let st; for (let i = 0; i < 50; i++) { st = (await s.j('GET', '/api/ops/nodes', s.A)).body; if (st.fingerprint) break; await sleep(100); } assert.match(st.fingerprint, /^[a-f0-9]{64}$/);
    const ca = fs.readFileSync(path.join(s.UD, 'ops', 'nodes-tls.crt'));
    assert.equal(fs.statSync(path.join(s.UD, 'ops', 'nodes-tls.key')).mode & 0o777, 0o600);
    assert.equal((await nreq(NP, '/api/tasks', reg.body.token, null, ca)).status, 404, 'main app not served on node listener');
    assert.equal((await nreq(NP, '/api/nodes/pull', 'nk_imac.wrong', {}, ca)).status, 401);
    // runner dispatches a node task (task.node) through the normal agent runtime
    const t = await s.j('POST', '/api/tasks', s.A, { title: 'dedup', agentId: 'news', status: 'queued', node: { capability: 'news.dedup', input: { items: [{ title: 'a', link: '1' }, { title: 'A', link: '1' }] } } });
    assert.ok(t.status < 300, JSON.stringify(t.body)); await s.j('POST', '/api/agents/news/start', s.A, {});
    let job; for (let i = 0; i < 50 && !job; i++) { job = (await nreq(NP, '/api/nodes/pull', reg.body.token, { info: { cpus: 4, memTotal: 8e9, memAvailable: 4e9, diskFree: 1e11 } }, ca)).body.job; if (!job) await sleep(200); }
    assert.ok(job, 'node received task via runner'); assert.equal(job.capability, 'news.dedup');
    assert.equal((await nreq(NP, `/api/nodes/jobs/${job.id}/complete`, reg.body.token, { leaseId: job.leaseId, result: { items: [{ title: 'a' }] } }, ca)).status, 200);
    let task; for (let i = 0; i < 50; i++) { task = (await s.j('GET', '/api/tasks/' + t.body.id, s.A)).body; if (task.status !== 'in_progress' && task.status !== 'queued') break; await sleep(100); }
    assert.equal(task.status, 'waiting_approval'); assert.match(task.result, /узле imac/);
  } finally { await s.cleanup(); }
});
