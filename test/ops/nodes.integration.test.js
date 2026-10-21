'use strict';
// Real server with STUDIO_OPS_NODES=1: owner-only admin API, node API on a SEPARATE TLS listener (127.0.0.1 by default),
// node token rejected by the main app, main app routes not reachable via the node listener; runner dispatches node tasks.
const test = require('node:test'); const assert = require('node:assert/strict'); const https = require('https'); const fs = require('fs'), path = require('path');
const { startServer, sleep } = require('../helpers/server.js');
const nreq = (port, p, token, body, ca) => new Promise((res, rej) => { const d = body ? JSON.stringify(body) : null;
  const r = https.request({ host: '127.0.0.1', port, path: p, method: body ? 'POST' : 'GET', ca, checkServerIdentity: () => undefined, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' } }, x => { let s = ''; x.on('data', c => s += c); x.on('end', () => { let j = null; try { j = JSON.parse(s); } catch {} res({ status: x.statusCode, body: j }); }); });
  r.on('error', rej); if (d) r.write(d); r.end(); });
test('nodes flag: admin API + separate TLS node listener + runner dispatch', { timeout: 60000 }, async () => {
  const NP = 18790 + (process.pid % 200); const s = await startServer({ port: 18600 + (process.pid % 300), env: { STUDIO_OPS_NODES: '1', OPS_NODES_PORT: String(NP), STUDIO_NODES_LEGACY_TOKENS: '1' } });
  try {
    assert.equal((await s.j('GET', '/api/ops/nodes', s.R)).status, 401, 'owner session required');
    const pre = await s.j('POST', '/api/ops/nodes', s.A, { id: 'imac', role: 'imac', name: 'iMac 27' }); assert.equal(pre.status, 428, 'legacy token needs password step-up'); assert.equal(pre.body.action, 'node-legacy-token');
    const ct = (await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-legacy-token', password: 'fake-password-123' })).body.confirmToken;
    const reg = await s.j('POST', '/api/ops/nodes', { ...s.A, 'x-studio-confirm': ct }, { id: 'imac', role: 'imac', name: 'iMac 27' }); assert.equal(reg.status, 200); assert.match(reg.body.token, /^nk_imac\./);
    const ct2 = (await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-legacy-token', password: 'fake-password-123' })).body.confirmToken;
    assert.equal((await s.j('POST', '/api/ops/nodes', { ...s.A, 'x-studio-confirm': ct2 }, { id: 'mb', role: 'macbook', caps: ['opencode.run'] })).status, 400);
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

test('nodes defaults: legacy bearer-only tokens off; device confirm / revoke / rotate need owner password step-up', { timeout: 60000 }, async () => {
  const NP = 19090 + (process.pid % 200); const s = await startServer({ port: 18950 + (process.pid % 300), env: { STUDIO_OPS_NODES: '1', OPS_NODES_PORT: String(NP) } });
  try { const r = await s.j('POST', '/api/ops/nodes', s.A, { id: 'imac', role: 'news' }); assert.ok([403, 428].includes(r.status));
    const ct = (await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-legacy-token', password: 'fake-password-123' })).body.confirmToken;
    const r2 = await s.j('POST', '/api/ops/nodes', { ...s.A, 'x-studio-confirm': ct }, { id: 'imac', role: 'news' }); assert.equal(r2.status, 403); assert.equal(r2.body.code, 'E_LEGACY_DISABLED');
    const en = await s.j('POST', '/api/ops/nodes/enroll', s.A, { role: 'news' }); assert.equal(en.status, 200);
    const c = await s.j('POST', `/api/ops/nodes/enroll/${en.body.requestId}/confirm`, s.A, {}); assert.equal(c.status, 428); assert.equal(c.body.action, 'node-confirm');
    const bad = await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-confirm', password: 'wrong' }); assert.equal(bad.status, 403);
    const ok = (await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-confirm', password: 'fake-password-123' })).body.confirmToken;
    const c2 = await s.j('POST', `/api/ops/nodes/enroll/${en.body.requestId}/confirm`, { ...s.A, 'x-studio-confirm': ok }, {}); assert.equal(c2.status, 400, 'passes step-up; request not pending yet');
    assert.equal((await s.j('POST', '/api/ops/nodes/imac/revoke', s.A, {})).status, 428); assert.equal((await s.j('POST', '/api/ops/nodes/imac/rotate', s.A, {})).status, 428);
    assert.notEqual((await s.j('POST', `/api/ops/nodes/enroll/${en.body.requestId}/reject`, s.A, {})).status, 428);
  } finally { await s.cleanup(); }
});

test('node step-up actions also work with Security Center ON (STUDIO_OPS_SECURITY=1)', { timeout: 60000 }, async () => {
  const NP = 19390 + (process.pid % 200); const s = await startServer({ port: 19250 + (process.pid % 300), env: { STUDIO_OPS_NODES: '1', STUDIO_OPS_SECURITY: '1', OPS_NODES_PORT: String(NP) } });
  try { for (const action of ['node-confirm', 'node-revoke', 'node-rotate', 'node-legacy-token']) { const r = await s.j('POST', '/api/ops/confirm', s.A, { action, password: 'fake-password-123' }); assert.equal(r.status, 200, action); assert.ok(r.body.confirmToken); }
    assert.equal((await s.j('POST', '/api/ops/nodes/x/revoke', s.A, {})).status, 428);
  } finally { await s.cleanup(); }
});
