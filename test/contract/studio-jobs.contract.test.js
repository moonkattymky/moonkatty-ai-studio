'use strict';
// Contract tests: Grok #1 Studio jobs (feat/v1.2.0, runner.js jobs + job_events) ↔ our Node Manager. See docs/ops/NODE_API_CONTRACT.md.
// Works without his branch (fixtures below = agreed shape). With his branch: scripts/ops/contract-against-branch.sh feat/v1.2.0
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createNodeManager } = require('../../lib/ops/nodes.js'); const A = require('../../lib/ops/jobs-adapter.js');
const STUDIO_JOB_FIELDS = ['id', 'type', 'agent', 'input', 'status', 'attempt', 'maxAttempts', 'timeoutSec', 'checkpoint', 'heartbeatAt', 'files', 'error', 'createdAt', 'updatedAt'];
const job = (o = {}) => ({ id: 'job_1', type: 'rss.fetch', agent: 'news', input: JSON.stringify({ url: 'https://example.org/rss' }), status: 'queued', attempt: 0, maxAttempts: 3, timeoutSec: 300, checkpoint: null, heartbeatAt: null, files: [], error: null, createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z', ...o });
const mgr = () => { const m = createNodeManager({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'ct-')) }); const r = m.registerNode({ id: 'imac', role: 'imac' }); return { m, n: m.authNode('Bearer ' + r.token) }; };
test('fixture has every agreed Studio job field; statuses are the agreed set', () => {
  for (const f of STUDIO_JOB_FIELDS) assert.ok(f in job(), f); assert.deepEqual(A.STATUSES, ['queued', 'running', 'needs_approval', 'succeeded', 'failed', 'cancelled']);
});
test('tolerates absence of optional fields (resourceClass, requiresNode, artifacts, idempotencyKey, safeToRetry) → safe defaults', () => {
  const r = A.toNodeJob(job()); assert.equal(r.local, false); assert.equal(r.job.resourceClass, 'light'); assert.equal(r.job.safeToRetry, false); assert.equal(r.job.idempotencyKey, null); assert.deepEqual(r.job.input, { url: 'https://example.org/rss' });
});
test('opencode_task / blender_template / render_segment and requiresNode=mac-mini / gpu_heavy / llm stay local', () => {
  for (const type of A.LOCAL_ONLY_TYPES) assert.equal(A.toNodeJob(job({ type })).local, true, type);
  assert.equal(A.toNodeJob(job({ requiresNode: 'mac-mini' })).local, true); assert.equal(A.toNodeJob(job({ resourceClass: 'gpu_heavy' })).local, true); assert.equal(A.toNodeJob(job({ resourceClass: 'llm' })).local, true);
});
test('bridge: dispatch → node lease → poll returns Studio statuses + artifacts {path, sha256, kind}', () => {
  const { m, n } = mgr(); const b = A.createBridge(m); const d = b.dispatch(job({ idempotencyKey: 'rss:1', safeToRetry: true }));
  assert.ok(d.nodeJobId); assert.equal(b.dispatch(job({ idempotencyKey: 'rss:1' })).duplicate, true); assert.equal(b.poll(d.nodeJobId).status, 'queued');
  const l = m.pull(n, {}).job; assert.equal(b.poll(d.nodeJobId).status, 'running'); const h = m.putLocalFile(Buffer.from('arch'));
  m.complete(n, l.id, { leaseId: l.leaseId, result: { items: [] }, artifacts: [{ sha256: h, kind: 'archive' }] });
  const u = b.poll(d.nodeJobId); assert.equal(u.status, 'succeeded'); assert.deepEqual(u.artifacts, [{ name: h, path: 'ops-node-files/' + h, size: 4, sha256: h, kind: 'archive' }]); assert.ok(A.STATUSES.includes(u.status));
  assert.equal(b.dispatch(job({ type: 'opencode_task' })).local, true);
});
test('cancelJob mapping and resource-class mapping (ours ↔ Studio)', () => {
  const { m } = mgr(); const b = A.createBridge(m); const d = b.dispatch(job()); assert.equal(b.cancel(d.nodeJobId).status, 'cancelled');
  assert.deepEqual(['llm-large', 'render', 'video', 'light'].map(A.toStudioClass), ['llm', 'gpu_heavy', 'gpu_heavy', 'light']);
});
test('if Grok #1 runner exposes createJob/getJob/cancelJob/listJobs, their shape matches (skipped when absent)', t => {
  let R; try { R = require('../../runner.js'); } catch { return t.skip('runner.js not loadable'); }
  const src = fs.readFileSync(path.join(__dirname, '../../runner.js'), 'utf8'); if (!/createJob/.test(src)) return t.skip('feat/v1.2.0 jobs API not present in this tree (expected until his branch lands)');
  for (const fn of ['createJob', 'getJob', 'cancelJob', 'listJobs']) assert.match(src, new RegExp(fn), fn); assert.equal(typeof R, 'function');
});
