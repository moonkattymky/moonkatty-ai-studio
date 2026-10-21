'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path'); const fs = require('fs');
const { validateSrt, buildSrt, qaVideo, generateAmbientBed, VideoFactory, hasBinary, run } = require('../src/video');
const { tmp, StubTTS } = require('./helpers');

test('validateSrt detects overlaps, long lines, short cues, bad index, beyond end', () => {
  const bad = '1\n00:00:00,000 --> 00:00:02,000\nok\n\n3\n00:00:01,500 --> 00:00:01,700\n' + 'x'.repeat(50) + '\n\n';
  const r = validateSrt(bad, { totalSec: 1.6 });
  for (const e of ['bad index', 'overlaps', 'too short', 'chars', 'beyond']) assert.ok(r.errors.some(x => x.includes(e)), e);
  assert.ok(validateSrt(buildSrt([{ text: 'A normal sentence for testing. And a second one, a bit longer than the first.', start: 0, duration: 5 }])).ok);
});
test('buildSrt: 2-line cues, no tiny trailing cue', () => {
  const s = buildSrt([{ text: 'Second scene text, with a comma.', start: 0, duration: 2 }], { maxChars: 26 });
  assert.ok(validateSrt(s, { maxChars: 26 }).ok, s);
});
test('qaVideo flags wrong resolution / missing audio (mocked ffprobe)', async () => {
  const fake = async cmd => ({ stdout: JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', pix_fmt: 'yuv420p' }] }), stderr: '' });
  const r = await qaVideo('x.mp4', { width: 1920, height: 1080, durationSec: 10, runFn: fake });
  assert.equal(r.ok, false); assert.deepEqual(r.checks.filter(c => !c.ok).map(c => c.name).sort(), ['audio_codec', 'audio_present', 'resolution']);
});
test('ambient bed: generated CC0 with license file (real ffmpeg)', async t => {
  if (!(await hasBinary('ffmpeg'))) return t.skip('no ffmpeg');
  const f = path.join(tmp(), 'bed.wav'); const meta = await generateAmbientBed(f, { durationSec: 6 });
  assert.equal(meta.license, 'CC0-1.0'); assert.ok(fs.statSync(f).size > 100000); assert.equal(JSON.parse(fs.readFileSync(f + '.license.json')).license, 'CC0-1.0');
});
test('v1 render: intro/credits/outro, xfade, loudnorm -16 LUFS, QA passes (real ffmpeg, stub tone voice)', async t => {
  if (!(await hasBinary('ffmpeg'))) return t.skip('no ffmpeg');
  const dir = tmp(); const bed = path.join(dir, 'bed.wav'); const meta = await generateAmbientBed(bed, { durationSec: 10 });
  const f = new VideoFactory({ tts: new StubTTS() });
  const m = await f.render({ title: 'QA Test', scenes: [{ heading: 'One', text: 'First scene text here.' }, { text: 'Second scene text here.' }], sources: [{ name: 'NASA', url: 'https://www.nasa.gov/x' }] },
    { preset: 'reels', outDir: dir, basename: 'qa', music: meta });
  assert.deepEqual(m.segments.map(s => s.kind), ['intro', 'scene', 'scene', 'credits', 'outro']);
  assert.equal(m.qa.ok, true, JSON.stringify(m.qa.checks.filter(c => !c.ok)));
  const L = m.qa.checks.find(c => c.name === 'loudness_lufs'); assert.ok(Math.abs(L.actual + 16) <= 1.5);
  assert.equal(m.music.license, 'CC0-1.0');
});
