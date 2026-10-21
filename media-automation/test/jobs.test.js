'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const { LocalJobQueue, StudioJobQueueAdapter, NotConnectedError, waitForJob } = require('../src/jobs');
const { QueuedHost3D, StubHost3D } = require('../src/host3d');
const { OllamaProvider } = require('../src/llm');
const { tmp } = require('./helpers');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('heavy jobs serialized; beforeHeavy hook runs; light jobs parallel', async () => {
  const hooks = []; const q = new LocalJobQueue({ statePath: path.join(tmp(), 'j.json'), beforeHeavy: t => hooks.push(t) });
  let active = 0, max = 0; const h = async () => { active++; max = Math.max(max, active); await sleep(15); active--; return { ok: 1 }; };
  q.registerHandler('render_segment', h).registerHandler('llm_generate', h);
  const ids = []; for (const type of ['render_segment', 'llm_generate', 'render_segment']) ids.push((await q.createJob({ type, input: {} })).jobId);
  for (const id of ids) await waitForJob(q, id, { pollMs: 5 });
  assert.equal(max, 1); assert.equal(q.maxHeavySeen, 1); assert.equal(hooks.length, 3);
  assert.equal((await q.listJobs({ status: 'succeeded' })).length, 3);
});
test('timeout, retries, cancel, needs_approval, events, idempotency', async () => {
  const q = new LocalJobQueue({ statePath: path.join(tmp(), 'j.json') }); let n = 0;
  q.registerHandler('slow', () => sleep(2000)).registerHandler('flaky', async () => { if (n++ < 1) throw new Error('boom'); return 'ok'; }).registerHandler('x', async () => 'x');
  const a = await q.createJob({ type: 'slow', timeoutSec: 0.05 }); await assert.rejects(waitForJob(q, a.jobId, { pollMs: 5 }), /timeout/);
  const b = await q.createJob({ type: 'flaky', maxAttempts: 2 }); assert.equal(await waitForJob(q, b.jobId, { pollMs: 5 }), 'ok');
  assert.deepEqual((await q.getJob(b.jobId)).events.map(e => e.event), ['created', 'started', 'retry', 'started', 'succeeded']);
  const c = await q.createJob({ type: 'x', requiresApproval: true }); await sleep(20); assert.equal((await q.getJob(c.jobId)).status, 'needs_approval');
  await q.approveJob(c.jobId, 'igor'); assert.equal(await waitForJob(q, c.jobId, { pollMs: 5 }), 'x');
  const d = await q.createJob({ type: 'nohandler' }); await q.cancelJob(d.jobId); assert.equal((await q.getJob(d.jobId)).status, 'cancelled');
  const e1 = await q.createJob({ type: 'nohandler', idempotencyKey: 'k' }); const e2 = await q.createJob({ type: 'nohandler', idempotencyKey: 'k' }); assert.equal(e1.jobId, e2.jobId);
});
test('restart recovery: running job re-queued and completed', async () => {
  const sp = path.join(tmp(), 'j.json');
  const q1 = new LocalJobQueue({ statePath: sp }); q1.registerHandler('render_segment', () => new Promise(() => {}));
  const { jobId } = await q1.createJob({ type: 'render_segment' }); await sleep(20); assert.equal((await q1.getJob(jobId)).status, 'running');
  const q2 = new LocalJobQueue({ statePath: sp }); assert.equal((await q2.getJob(jobId)).status, 'queued');
  q2.registerHandler('render_segment', async () => ({ videoPath: '/tmp/x.mov' })); q2._pump();
  assert.deepEqual(await waitForJob(q2, jobId, { pollMs: 5 }), { videoPath: '/tmp/x.mov' });
  assert.ok((await q2.getJob(jobId)).events.some(e => e.event === 'recovered'));
});
test('QueuedHost3D enqueues render_segment with contract signature', async () => {
  const q = new LocalJobQueue({ statePath: path.join(tmp(), 'j.json') }); const seen = [];
  q.registerHandler('render_segment', async inp => { seen.push(inp); return { videoPath: '/tmp/seg.mov' }; });
  const h = new QueuedHost3D({ jobQueue: q });
  const r = await h.renderSegment({ script: 'Hi', audioPath: '/a.wav', durationSec: 2, aspect: '9:16', outPath: '/o.mov' });
  assert.deepEqual(r, { videoPath: '/tmp/seg.mov' }); assert.deepEqual(Object.keys(seen[0]).sort(), ['aspect', 'audioPath', 'durationSec', 'outPath', 'script']);
  assert.equal(await new StubHost3D().renderSegment({}), null);
});
test('Studio adapter stub: NotConnected; with injected client follows contract', async () => {
  await assert.rejects(new StudioJobQueueAdapter().createJob({ type: 'x' }), NotConnectedError);
  const db = {}; const client = { createJob: async s => { db.j = { ...s, jobId: 'j', status: 'succeeded', internalStatus: 'done', artifacts: [{ kind: 'mp4', path: 'v' }] }; return { jobId: 'j' }; }, getJob: async () => db.j, cancelJob: async () => {}, listJobs: async () => [] };
  const a = new StudioJobQueueAdapter({ client, pollMs: 1 });
  assert.deepEqual(await a.runExclusive({ type: 'render_segment', agent: 'v', input: {}, timeoutSec: 1, maxAttempts: 1 }), { artifacts: [{ kind: 'mp4', path: 'v' }], videoPath: 'v' });
  await assert.rejects(a.runExclusive({ type: 'x' }, () => 1), /inline/);
});
test('Ollama heavy generations go through job queue when configured', async () => {
  const q = new LocalJobQueue({ statePath: path.join(tmp(), 'j.json') });
  const p = new OllamaProvider({ jobQueue: q, fetchFn: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response: 'hi' }) }) });
  assert.equal((await p.generate({ prompt: 'x' })).text, 'hi'); const [j] = await q.listJobs({}); assert.equal(j.type, 'llm_generate'); assert.equal(j.status, 'succeeded');
});
