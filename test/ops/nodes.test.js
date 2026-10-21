'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const N = require('../../lib/ops/nodes.js'); const A = require('../../lib/ops/jobs-adapter.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nodes-'));
const GB = 1024 ** 3; const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const info = (o = {}) => ({ hostname: 'x', os: 'macOS 13.7.1', cpus: 4, memTotal: 8 * GB, memAvailable: 4 * GB, diskFree: 100 * GB, load1: 0.5, ...o });
function setup(o = {}) { let t = 1e12; const alerts = []; const m = N.createNodeManager({ dir: tmp(), now: () => t, leaseMs: 1000, nodeDownMs: 5000, notify: async a => alerts.push(a), ...o });
  const im = m.registerNode({ id: 'imac', role: 'imac', name: 'iMac 27' }); const mb = m.registerNode({ id: 'macbook', role: 'macbook', name: 'MacBook 13' });
  return { m, im, mb, alerts, adv: ms => { t += ms; }, auth: tok => m.authNode('Bearer ' + tok) }; }
test('tokens: hashed at rest, scoped, revocable; caps allowlist per role; forbidden caps refused', () => {
  const { m, im, auth } = setup(); const raw = fs.readFileSync(path.join(m.filesDir, '..', 'nodes.json'), 'utf8');
  assert.ok(!raw.includes(im.token.split('.')[1]), 'token not stored plaintext'); assert.equal(fs.statSync(path.join(m.filesDir, '..', 'nodes.json')).mode & 0o777, 0o600);
  assert.equal(auth(im.token).id, 'imac'); assert.equal(auth(im.token + 'x'), null); assert.equal(auth('nk_macbook.' + im.token.split('.')[1]), null);
  assert.throws(() => m.registerNode({ id: 'mb2', role: 'macbook', caps: ['blender.render'] }), /недопустимые/); assert.throws(() => m.registerNode({ id: 'mb2', role: 'macbook', caps: ['x.post'] }), /недопустимые/);
  assert.throws(() => m.registerNode({ id: 'mac-mini', role: 'imac' })); m.revokeNode('imac'); assert.equal(auth(im.token), null);
});
test('local-only jobs (OpenCode/Blender/render, heavy) never go to nodes; secrets never leave', () => {
  const { m } = setup();
  for (const type of ['opencode_task', 'blender_template', 'render_segment']) assert.equal(m.submit({ type, agent: 'x', input: {} }).local, true);
  assert.equal(m.submit({ type: 'rss.fetch', resourceClass: 'llm', input: {} }).local, true); assert.equal(m.submit({ type: 'rss.fetch', requiresNode: 'mac-mini' }).local, true);
  assert.throws(() => m.submit({ capability: 'rss.fetch', input: { url: 'x', opencodePassword: 'p' } }), /секрет/); assert.throws(() => m.submit({ capability: 'rss.fetch', input: { h: 'Basic b3BlbmNvZGU6c2VjcmV0MTIz' } }), /секрет/);
  assert.throws(() => m.submit({ capability: 'opencode.run', input: {} }), /не разрешена/); assert.throws(() => m.submit({ capability: 'x.like', input: {} }), /не разрешена/);
});
test('pull: capability routing, resource fit, idempotency dedup, ack + duplicate ack', () => {
  const { m, im, mb, auth } = setup(); const I = auth(im.token), B = auth(mb.token);
  const a = m.submit({ capability: 'ffprobe.check', input: {}, idempotencyKey: 'k1' }); assert.deepEqual(m.submit({ capability: 'ffprobe.check', input: {}, idempotencyKey: 'k1' }), { jobId: a.jobId, duplicate: true });
  assert.equal(m.pull(I, info()).job, null, 'iMac has no ffprobe.check cap'); const big = m.submit({ capability: 'stats.compute', input: {}, requires: { ramGB: 6 } });
  const j = m.pull(B, info()).job; assert.equal(j.id, a.jobId); assert.equal(m.pull(B, info()).job, null, 'stats needs 6GB, only 4 free'); m.pull(B, info({ memAvailable: 7 * GB }));
  assert.equal(m.complete(B, j.id, { leaseId: 'bad' }).code, 409); assert.ok(m.complete(B, j.id, { leaseId: j.leaseId, result: { ok: 1 } }).ok);
  assert.equal(m.complete(B, j.id, { leaseId: j.leaseId, result: { ok: 1 } }).duplicate, true); assert.equal(m.status().counts.succeeded, 1); assert.ok(big.jobId);
});
test('node loss: requeue ONLY safeToRetry jobs; others → needs_approval + alert; node down alert', () => {
  const { m, im, mb, auth, adv, alerts } = setup(); const I = auth(im.token), B = auth(mb.token);
  const s = m.submit({ capability: 'rss.fetch', input: {}, safeToRetry: true, maxAttempts: 3 }); const u = m.submit({ capability: 'archive.store', input: {} });
  const j1 = m.pull(I, info()).job, j2 = m.pull(I, info()).job; assert.deepEqual([j1.id, j2.id].sort(), [s.jobId, u.jobId].sort()); m.hello(B, info());
  adv(1500); m.sweep(); const S = m._state.jobs; assert.equal(S[s.jobId].status, 'queued'); assert.equal(S[u.jobId].status, 'needs_approval'); assert.ok(alerts.some(a => /требует решения/.test(a.title)));
  assert.equal(m.heartbeat(I, j1.id, { leaseId: j1.leaseId }).code, 409, 'stale lease rejected'); adv(6000); m.sweep(); assert.equal(m.status().nodes.find(n => n.id === 'imac').status, 'down'); assert.ok(alerts.some(a => /недоступен/.test(a.title)));
  m.retry(u.jobId); assert.equal(S[u.jobId].status, 'queued');
});
test('heartbeat extends lease; timeout → stuck handling; low resources alert', () => {
  const { m, im, auth, adv, alerts } = setup(); const I = auth(im.token); const r = m.submit({ capability: 'rss.fetch', input: {}, timeoutSec: 10 });
  const j = m.pull(I, info()).job; for (let k = 0; k < 5; k++) { adv(800); assert.ok(m.heartbeat(I, j.id, { leaseId: j.leaseId }).ok); m.sweep(); } assert.equal(m._state.jobs[r.jobId].status, 'leased');
  adv(7000); m.heartbeat(I, j.id, { leaseId: j.leaseId }); m.sweep(); assert.equal(m._state.jobs[r.jobId].status, 'needs_approval');
  m.hello(I, info({ diskFree: 1 * GB })); m.sweep(); assert.ok(alerts.some(a => /Мало ресурсов/.test(a.title)));
});
test('file transfer: SHA-256 verified upload, bad checksum rejected, artifacts verified, downloads scoped to leased jobs', () => {
  const { m, im, mb, auth } = setup(); const I = auth(im.token), B = auth(mb.token); const buf = Buffer.from('video-bytes');
  assert.equal(m.putFile(I, sha(buf), Buffer.from('tampered')).code, 422); assert.ok(m.putFile(I, sha(buf), buf).ok);
  const h = m.putLocalFile(Buffer.from('clip')); m.submit({ capability: 'ffprobe.check', input: {}, files: [{ sha256: h, name: 'clip.mp4' }] });
  assert.equal(m.getFile(I, h).code, 403); const j = m.pull(B, info()).job; assert.equal(m.getFile(B, h).buf.toString(), 'clip');
  assert.equal(m.complete(B, j.id, { leaseId: j.leaseId, artifacts: [{ sha256: 'a'.repeat(64) }] }).code, 409); assert.ok(m.complete(B, j.id, { leaseId: j.leaseId, artifacts: [{ sha256: sha(buf), name: 'x' }] }).ok);
});
test('LAN listener refuses 0.0.0.0 / public IPs', async () => { const { m } = setup(); for (const h of ['0.0.0.0', '8.8.8.8', '::']) await assert.rejects(() => N.listen(m, { host: h, insecureHttpForTests: true }), /только/); assert.ok(N.isPrivateIPv4('192.168.1.20')); });
test('runner hook: runViaNode waits for node, stop() cancels the node job', async () => {
  const { m, mb, auth } = setup(); const B = auth(mb.token); const t = { id: 't1', title: 'проверить ролик', node: { capability: 'ffprobe.check', input: {} } };
  const p = m.runViaNode({ id: 'video' }, t); const j = m.pull(B, info()).job; m.complete(B, j.id, { leaseId: j.leaseId, result: { ok: true } }); const r = await p; assert.match(r.result, /macbook/);
  const ac = new AbortController(); const p2 = m.runViaNode({ id: 'video' }, { ...t, id: 't2' }, ac.signal); ac.abort(); await assert.rejects(p2, /aborted/); assert.equal(m.status().counts.cancelled, 1);
});
test('adapter maps resource classes and statuses both ways', () => {
  assert.equal(A.toStudioClass('render'), 'gpu_heavy'); assert.equal(A.toStudioClass('llm-large'), 'llm'); assert.equal(A.fromStudioClass('gpu_heavy'), 'render'); assert.equal(A.fromStudioClass(undefined), 'light');
  assert.equal(A.toStudioUpdate({ status: 'leased', attempt: 1 }).status, 'running');
});
test('central commands: pause/drain stop handing out jobs, stop is delivered, run resumes; profiles news/monitor', () => {
  const { m, im, auth } = setup(); const I = auth(im.token); m.submit({ capability: 'rss.fetch', input: {} });
  m.setCommand('imac', 'pause'); assert.deepEqual(m.pull(I, info()), { job: null, command: 'pause' }); m.setCommand('imac', 'drain'); assert.equal(m.pull(I, info()).command, 'drain');
  m.setCommand('imac', 'stop'); assert.equal(m.pull(I, info()).command, 'stop'); assert.throws(() => m.setCommand('imac', 'rm -rf')); m.setCommand('imac', 'run'); assert.ok(m.pull(I, info()).job);
  const n = m.registerNode({ id: 'news1', role: 'news' }); assert.ok(n.caps.includes('image.light')); assert.equal(m.hello(auth(n.token), info()).title, 'NEWS NODE');
  assert.throws(() => m.registerNode({ id: 'mon1', role: 'monitor', caps: ['news.collect'] }), /недопустимые/);
});
