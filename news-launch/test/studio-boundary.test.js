'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isStudioOwned, assertLaunchPaths, probeStudioJobs } = require('../src/studio-boundary');
const { StudioJobQueueAdapter } = require('../../media-automation/src/jobs/studio-adapter');
const { QueuedHost3D } = require('../../media-automation/src/host3d');
const { runLaunch } = require('../src/pipeline');

test('studio-owned job and blender paths are refused', () => {
  const jobs = path.join(os.tmpdir(), 'server', 'jobs', 'queue.json');
  const blender = path.join(os.tmpdir(), 'server', 'blender', 'host.blend');
  assert.equal(isStudioOwned(jobs), true);
  assert.equal(isStudioOwned(blender), true);
  assert.equal(isStudioOwned(path.join(os.tmpdir(), 'news-launch', 'artifacts')), false);
  assert.throws(() => assertLaunchPaths([jobs]), /studio-owned path/);
  assert.throws(() => assertLaunchPaths([blender]), /studio-owned path/);
});

test('studio job adapter stays disconnected and writes nothing when no client is injected', async () => {
  const probed = await probeStudioJobs(null);
  assert.equal(probed.connected, false);
  assert.match(probed.mode, /TEMPORARY_ADAPTER/);
  await assert.rejects(() => new StudioJobQueueAdapter().createJob({ type: 'blender_template' }), /not connected/);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'server', 'jobs')), false);
  assert.equal(fs.existsSync(path.join(process.cwd(), 'server', 'blender')), false);
});

test('a connected studio client is used only as a job port, not as a Blender call', async () => {
  const specs = [];
  const client = {
    async createJob(spec) { specs.push(spec); return { jobId: 'job-1' }; },
    async getJob() { return { jobId: 'job-1', status: 'succeeded', result: { videoPath: '/tmp/owner-approved-host.mp4' } }; },
    async cancelJob() { return null; },
    async listJobs() { return []; },
  };
  const probed = await probeStudioJobs(client);
  assert.equal(probed.connected, true);
  const host = new QueuedHost3D({ jobQueue: probed.adapter });
  const rendered = await host.renderSegment({
    script: 'MOONKATTY NEWS', audioPath: '/tmp/narration.wav', durationSec: 4, aspect: '16:9', outPath: '/tmp/segment.mp4',
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].type, 'render_segment');
  assert.equal(specs[0].input.outPath, '/tmp/segment.mp4');
  assert.equal(rendered.videoPath, '/tmp/owner-approved-host.mp4');
  assert.equal(fs.existsSync(path.join(process.cwd(), 'server', 'blender')), false);
});

test('launch refuses to place its output under server/jobs', async () => {
  await assert.rejects(() => runLaunch({
    prompt: 'Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях',
    outDir: path.join(os.tmpdir(), 'server', 'jobs', 'episode'),
    profile: 'test', skipOllama: true,
  }), /studio-owned path/);
});
