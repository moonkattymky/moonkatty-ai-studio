'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
const { tmp } = require('./helpers'); const { createStudioMock } = require('./fixtures/studio-jobs-mock');
const { createVideoRenderExecutor, writeEpisode, JobsApiQueue, selectJobQueue, LocalJobQueue } = require('../src/jobs');
const fakeFactory = { calls: [], async render(ep, { preset, outDir, basename }) { this.calls.push(preset); const f = e => { const p = path.join(outDir, `${basename}.${e}`); fs.writeFileSync(p, `${ep.title}-${e}`); return p; };
  await new Promise(r => setTimeout(r, 10)); return { files: { video: f('mp4'), subtitles: f('srt'), thumbnail: f('jpg') } }; } };
const setup = () => { const dataDir = tmp(); const m = createStudioMock({ dataDir }); writeEpisode(dataDir, 'news/2026-10-21/a', { title: 'EP' }); return { dataDir, ...m }; };

test('video_render via services.videoRender.setExecutor: artifacts verified by contract mock', async () => {
  const { dataDir, services, jobsApi } = setup(); const unload = { n: 0, unload: async () => { unload.n++; } };
  services.videoRender.setExecutor(createVideoRenderExecutor({ dataDir, factory: fakeFactory, llm: unload }));
  const q = new JobsApiQueue({ jobsApi, videoRender: services.videoRender, env: {}, pollMs: 5 });
  assert.ok(q.adapter.supportedTypes.includes('video_render'));
  const j = await q.run('video_render', { runId: 'r1', preset: 'shorts', episodeRef: 'news/2026-10-21/a', idempotencyKey: 'mine' });
  assert.equal(j.status, 'succeeded'); assert.deepEqual(j.artifacts.map(a => a.kind).sort(), ['jpg', 'mp4', 'srt']); assert.equal(j.idempotencyKey, 'r1:shorts'); assert.equal(unload.n, 1);
  const again = await q.submit('video_render', { runId: 'r1', preset: 'shorts', episodeRef: 'news/2026-10-21/a' }); assert.equal(again.existing, true);
});
test('no executor -> stub failure; bad input -> 400; artifact outside media -> failed', async () => {
  const { dataDir, services, jobsApi } = setup(); const q = new JobsApiQueue({ jobsApi, env: {}, pollMs: 5 });
  await assert.rejects(q.run('video_render', { runId: 'r2', preset: 'youtube', episodeRef: 'news/2026-10-21/a' }), /Не подключено/);
  await assert.rejects(q.submit('video_render', { runId: 'r3', preset: 'tiktok', episodeRef: 'x' }), /bad preset/);
  services.videoRender.setExecutor(async () => { const p = path.join(tmp(), 'x.mp4'); fs.writeFileSync(p, 'x'); return { artifacts: [{ kind: 'mp4', path: p, size: 1, sha256: 'x' }] }; });
  await assert.rejects(q.run('video_render', { runId: 'r4', preset: 'youtube', episodeRef: 'news/2026-10-21/a' }), /exactly mp4/);
});
test('tts + render share the heavy lock (never overlap); publish_dry_run is dry-run only', async () => {
  const { dataDir, services, jobsApi, lock } = setup(); services.videoRender.setExecutor(createVideoRenderExecutor({ dataDir, factory: fakeFactory }));
  const q = new JobsApiQueue({ jobsApi, videoRender: services.videoRender, env: {}, pollMs: 5 });
  await Promise.all([q.run('tts', { text: 'hi' }), q.run('video_render', { runId: 'r5', preset: 'youtube', episodeRef: 'news/2026-10-21/a' }), q.run('tts', { text: 'yo' })]);
  let depth = 0; for (const [ev] of lock.log) { depth += ev === 'start' ? 1 : -1; assert.ok(depth <= 1, 'overlap'); } assert.equal(lock.log.length, 6);
  assert.throws(() => q.spec('publish_dry_run', { live: true }), /dry-run only/); const s = q.spec('publish_dry_run', { postId: 'p' }); assert.equal(s.input.dryRun, true); assert.equal(s.resourceClass, 'light');
  assert.equal('idempotencyKey' in q.spec('tts', { idempotencyKey: 'k' }), false); assert.equal('idempotencyKey' in q.spec('tts', { idempotencyKey: 'k' }).input, false);
  assert.throws(() => new JobsApiQueue({ jobsApi, env: {}, resourceClasses: { tts: 'light' } }), /heavy lock/);
  assert.equal(new JobsApiQueue({ jobsApi, env: { MA_JOBS_TYPE_MAP: '{"tts":"tts_v2"}' } }).spec('tts', {}).type, 'tts_v2');
});
test('flag gate: default OFF keeps LocalJobQueue; only MA_JOBS_BACKEND=jobsapi + client switches', () => {
  const { jobsApi } = setup(); const local = new LocalJobQueue({ statePath: path.join(tmp(), 'q.json') });
  assert.equal(selectJobQueue({ env: {}, local, jobsApi }).queue, local);
  assert.equal(selectJobQueue({ env: { MA_JOBS_BACKEND: 'jobsapi' }, local }).backend, 'local');
  const s = selectJobQueue({ env: { MA_JOBS_BACKEND: 'jobsapi' }, local, jobsApi }); assert.equal(s.backend, 'jobsapi'); assert.ok(s.queue.provisional);
});
