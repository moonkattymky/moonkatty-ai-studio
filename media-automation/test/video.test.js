'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path'); const fs = require('fs');
const { VideoFactory, RenderQueue, StubTTS, MacSayTTS, StubCharacter3D, buildSrt, chunk, getPreset, PRESETS, validateMusic, validateScript, hasBinary, probeDuration, run } = require('../src/video');
const { tmp } = require('./helpers');
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('presets: 16:9 youtube, 9:16 shorts/tiktok/reels/fb_reels', () => {
  assert.equal(getPreset('youtube').aspect, '16:9');
  for (const p of ['shorts', 'tiktok', 'reels', 'fb_reels']) { assert.equal(PRESETS[p].width, 1080); assert.equal(PRESETS[p].height, 1920); }
  assert.throws(() => getPreset('vine'));
});

test('SRT generation and chunking', () => {
  assert.ok(chunk('one two three four five six seven eight nine ten', 15).every(c => c.length <= 15));
  const srt = buildSrt([{ text: 'Hello world.', start: 0, duration: 2 }, { text: 'Second scene here.', start: 2, duration: 3 }]);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\nHello world\.\n/);
  assert.match(srt, /2\n00:00:02,000 --> 00:00:05,000\nSecond scene here\./);
});

test('validation: script and music license required', () => {
  assert.throws(() => validateScript({ title: 'x', scenes: [] }));
  assert.throws(() => validateScript({ title: 'x', scenes: [{ text: ' ' }] }));
  const f = path.join(tmp(), 'm.wav'); fs.writeFileSync(f, 'x');
  assert.throws(() => validateMusic({ file: f }), /license/);
  assert.equal(validateMusic({ file: f, license: 'CC0' }).license, 'CC0');
});

test('MacSayTTS builds safe argv (no shell)', async () => {
  const calls = []; const fake = async (cmd, args) => { calls.push([cmd, args]); return { stdout: cmd === 'ffprobe' ? '2.5\n' : '' }; };
  const r = await new MacSayTTS({ runFn: fake }).synthesize('-rf; rm x', '/tmp/o.wav');
  assert.equal(r.durationSec, 2.5); assert.equal(calls[0][0], 'say'); assert.deepEqual(calls[0][1].slice(-2), ['--', '-rf; rm x']);
});

test('TTS failure propagates as render error (queue marks failed after retries)', async () => {
  const bad = { name: 'bad', synthesize: async () => { throw new Error('TTS API 503'); } };
  const f = new VideoFactory({ tts: bad, runFn: async () => ({ stdout: '' }) });
  const dir = tmp(); let n = 0;
  const q = new RenderQueue({ statePath: path.join(dir, 'q.json'), maxAttempts: 2, worker: async () => { n++; return f.render({ title: 't', scenes: [{ text: 'a' }] }, { outDir: dir }); } });
  q.add({}, { id: 'j1' }); q.start(); await q.onIdle();
  assert.equal(n, 2); assert.equal(q.job('j1').status, 'failed'); assert.match(q.job('j1').error, /TTS API 503/);
});

test('render queue: concurrency limit, retry then success, idempotent add', async () => {
  const dir = tmp(); let fails = 1;
  const q = new RenderQueue({ statePath: path.join(dir, 'q.json'), concurrency: 2, maxAttempts: 3,
    worker: async p => { await sleep(20); if (p.flaky && fails-- > 0) throw new Error('transient'); return { ok: p.n }; } });
  for (let n = 0; n < 6; n++) q.add({ n, flaky: n === 3 }, { id: 'j' + n });
  q.add({ n: 0 }, { id: 'j0' });
  assert.equal(q.jobs().length, 6);
  q.start(); await q.onIdle();
  assert.equal(q.maxActiveSeen, 2);
  assert.ok(q.jobs().every(j => j.status === 'done'));
  assert.equal(q.job('j3').attempts, 2);
});

test('render queue: restart recovery re-queues interrupted jobs', async () => {
  const dir = tmp(); const sp = path.join(dir, 'q.json');
  const q1 = new RenderQueue({ statePath: sp, worker: () => new Promise(() => {}) }); // hangs = simulated crash
  q1.add({ a: 1 }, { id: 'x' }); q1.add({ a: 2 }, { id: 'y' }); q1.start(); await sleep(10);
  assert.equal(q1.job('x').status, 'running'); q1.stop();
  const done = [];
  const q2 = new RenderQueue({ statePath: sp, worker: async p => { done.push(p.a); return 'ok'; } });
  assert.equal(q2.recovered, 1); assert.equal(q2.job('x').status, 'queued');
  q2.start(); await q2.onIdle();
  assert.deepEqual(done.sort(), [1, 2]); assert.equal(q2.job('x').status, 'done'); assert.equal(q2.job('x').recovered, 1);
});

test('real ffmpeg render: 16:9 and 9:16 MP4 + SRT + thumbnail + music + 3D stub', async t => {
  if (!(await hasBinary('ffmpeg'))) return t.skip('ffmpeg not installed');
  const dir = tmp(); const music = path.join(dir, 'm.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=3', music]);
  const c3d = new StubCharacter3D();
  const f = new VideoFactory({ tts: new StubTTS(), character3d: c3d });
  const script = { title: 'Test Title', scenes: [{ text: 'First scene of the test.' }, { heading: 'Two', text: 'Second scene text, with a comma.' }] };
  for (const [preset, w, h] of [['youtube', 1920, 1080], ['tiktok', 1080, 1920]]) {
    const m = await f.render(script, { preset, outDir: dir, basename: preset, music: { file: music, license: 'CC0', title: 'tone' } });
    for (const k of ['video', 'subtitles', 'thumbnail']) assert.ok(fs.statSync(m.files[k]).size > 0, k);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name', '-of', 'csv=p=0', m.files.video]);
    assert.equal(stdout.trim(), `h264,${w},${h}`);
    const { stdout: a } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', m.files.video]);
    assert.equal(a.trim(), 'aac');
    assert.ok(Math.abs(m.durationSec - (await probeDuration(m.files.video))) < 0.01 && m.durationSec > 3);
    assert.equal(m.music.license, 'CC0');
    assert.ok(!fs.existsSync(path.join(dir, `${preset}.work`)));
  }
  assert.equal(c3d.calls.length, 4);
});

test('preset duration limit enforced', async () => {
  const f = new VideoFactory({ tts: { name: 'x', synthesize: async (_, o) => ({ file: o, durationSec: 200 }) }, runFn: async () => ({ stdout: '' }) });
  await assert.rejects(f.render({ title: 't', scenes: [{ text: 'a' }] }, { preset: 'fb_reels', outDir: tmp() }), /exceeds/);
});
