'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { runLaunch } = require('../src/pipeline');
const { saveToStudio } = require('../src/studio-save');
const core = require('../../public/core.js');

const recent = new Date().toUTCString();
const rss = items => `<?xml version="1.0"?><rss version="2.0"><channel>${items.map(i =>
  `<item><title>${i.title}</title><link>${i.link}</link><description>${i.desc || i.title}</description><pubDate>${i.published || recent}</pubDate></item>`).join('')}</channel></rss>`;

function mockFetch(routes) {
  return async url => {
    const body = routes[url];
    if (!body) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body };
  };
}

test('pipeline renders both frames from corroborated stories and holds approval', async () => {
  const A = 'https://alpha.example/rss';
  const B = 'https://beta.example/rss';
  const sources = [
    { id: 'alpha', org: 'alpha', name: 'Alpha News', url: A },
    { id: 'beta', org: 'beta', name: 'Beta News', url: B },
  ];
  const titles = [
    ['River bridge budget wins a council vote', 'https://alpha.example/bridge', 'https://beta.example/bridge'],
    ['Library publishes the restored medieval atlas', 'https://alpha.example/atlas', 'https://beta.example/atlas'],
    ['Observatory confirms comet Borrelly Nine', 'https://alpha.example/comet', 'https://beta.example/comet'],
  ];
  const fetchFn = mockFetch({
    [A]: rss(titles.map(([title, link]) => ({ title, link }))),
    [B]: rss(titles.map(([title, , link]) => ({ title, link })).concat([
      { title: 'Warehouse fire reported downtown', link: 'https://beta.example/fire' },
    ])),
  });
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-launch-'));
  const manifest = await runLaunch({
    prompt: 'Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях',
    outDir, profile: 'test', sources, fetchFn, skipOllama: true, retries: 0,
    tts: shortTts(),
  });
  assert.equal(manifest.publish, false);
  assert.equal(manifest.hostUsed, false);
  assert.equal(manifest.character3d, 'host3d-stub');
  assert.equal(manifest.targetLufs, -16);
  assert.ok(manifest.jobs.every(j => j.resourceClass === 'gpu_heavy' && j.requiresNode === 'mac-mini' && j.safeToRetry === true && j.idempotencyKey));
  assert.equal(manifest.imageLicenses.images[0].license, 'test-fixture');
  assert.ok(manifest.sources.every(s => s.editorialStatus === 'confirmed-publishers' && s.primarySourceUrl === null));
  assert.equal(manifest.selected.length, 3);
  assert.equal(manifest.jobs.length, 2);
  assert.deepEqual(manifest.jobs.map(j => [j.width, j.height]).sort(), [[1080, 1920], [1920, 1080]]);
  assert.equal(manifest.imageLicenses.music, null);
  assert.ok(manifest.qc.every(q => q.ok), JSON.stringify(manifest.qc.map(q => q.failures)));
  for (const job of manifest.jobs) {
    assert.ok(fs.existsSync(job.video));
    assert.ok(fs.existsSync(job.subtitles));
    assert.match(fs.readFileSync(job.subtitles, 'utf8'), /-->/);
  }
  assert.ok(!manifest.selected.some(s => /warehouse/i.test(s.claim)));
  const files = {};
  const saved = await saveToStudio({
    core, filesDir: path.join(outDir, 'files'),
    put: (col, obj) => { (files[col] = files[col] || []).push(obj); return obj; },
    log: () => {}, user: 'tester',
  }, manifest);
  assert.equal(saved.approval.publish, false);
  assert.equal(saved.approval.status, 'pending');
  assert.ok(saved.approval.licenses.length >= 1);
  assert.equal(saved.approval.licenses[0].license, 'test-fixture');
  assert.equal(saved.episode.versions.EN.factcheck, 'done');
  assert.equal(saved.episode.versions.EN.publish, 'todo');
  assert.equal(saved.episode.approvalStatus, 'pending_approval');
  assert.equal(files.queue, undefined);
  assert.ok(saved.publisherPosts.every(p => p.status === 'dry_run' && p.remote && p.remote.dryRun === true));
  assert.equal(files.tasks[0].status, 'waiting_approval');
});

function shortTts() {
  const { run } = require('../../media-automation/src/video/exec');
  return {
    name: 'test-tone', voiceId: 'none', license: 'test fixture, not a broadcast voice', commercialUse: false,
    async synthesize(text, outWav) {
      const durationSec = Math.min(8, Math.max(4, String(text).length / 24));
      await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${durationSec.toFixed(2)}:sample_rate=44100`, '-ac', '1', outWav]);
      return { file: outWav, durationSec };
    },
  };
}

test('prepare route requires a user and does not publish', async () => {
  const express = require('express');
  const { mountNewsLaunch } = require('../src/http');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-user']) req.user = req.headers['x-user']; next(); });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'news-http-'));
  const video = path.join(out, 'h.mp4');
  const srt = path.join(out, 'h.srt');
  fs.writeFileSync(video, 'mp4'); fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
  fs.writeFileSync(path.join(out, 'v.mp4'), 'mp4'); fs.writeFileSync(path.join(out, 'v.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi\n');
  fs.writeFileSync(path.join(out, 'a.wav'), 'wav');
  const cols = {};
  mountNewsLaunch(app, {
    filesDir: path.join(out, 'files'), core, log: () => {},
    put: (col, obj) => { (cols[col] = cols[col] || []).push(obj); return obj; },
    list: col => cols[col] || [],
    runLaunch: async () => ({
      episodeId: 'ep1', outDir: out, publish: false, hostUsed: false, adapters: [],
      script: { title: 'MOONKATTY NEWS', lang: 'en', llm: { mode: 'temporary-adapter', adapter: 'TEMPORARY_ADAPTER:extractive-headlines', reason: 'test' }, scenes: [{ kind: 'intro', text: 'This is MOONKATTY NEWS.' }] },
      voiceover: { segments: [{ file: path.join(out, 'a.wav'), text: 'hi', durationSec: 1 }] },
      jobs: [
        { preset: 'youtube', video, subtitles: srt, width: 1920, height: 1080 },
        { preset: 'shorts', video: path.join(out, 'v.mp4'), subtitles: path.join(out, 'v.srt'), width: 1080, height: 1920 },
      ],
      qc: [{ width: 1920, height: 1080, ok: true, durationSec: 40, loudnessLUFS: -14 }],
      sources: [
        { url: 'https://www.bbc.com/a', publisher: 'BBC News' },
        { url: 'https://www.theguardian.com/b', publisher: 'The Guardian' },
      ],
      selected: [],
    }),
  });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const port = server.address().port;
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/news/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);
    const ok = await fetch(`http://127.0.0.1:${port}/api/news/prepare`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-user': 'igor' },
      body: JSON.stringify({ text: 'Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях' }),
    });
    const body = await ok.json();
    assert.equal(ok.status, 200, JSON.stringify(body));
    assert.equal(body.publish, false);
    assert.equal(body.approval.status, 'pending');
    assert.equal(body.approval.publish, false);
    assert.ok(body.publisher.every(p => p.status === 'dry_run'));
    assert.equal(cols.queue, undefined);
  } finally { server.close(); }
});

test('real server middleware rejects an anonymous prepare call', async () => {
  const port = 18787 + Math.floor(Math.random() * 1000);
  const db = path.join(os.tmpdir(), `studio-auth-${port}.db`);
  const child = execFile(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: db },
  });
  let log = '';
  child.stdout.on('data', c => { log += c; });
  child.stderr.on('data', c => { log += c; });
  const started = Date.now();
  while (!log.includes('MOONKATTY AI STUDIO') && Date.now() - started < 8000) await new Promise(r => setTimeout(r, 50));
  try {
    assert.match(log, /MOONKATTY AI STUDIO/);
    const res = await fetch(`http://127.0.0.1:${port}/api/news/prepare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'news' }) });
    assert.equal(res.status, 401);
  } finally { child.kill('SIGTERM'); }
});
