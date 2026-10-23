'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseFreezes, detectVisualIssues } = require('../src/video/qa');
const { makeStarfield } = require('../src/video/graphics');
const { run } = require('../src/video/exec');

test('parseFreezes keeps a span that runs to EOF', () => {
  const log = [
    'lavfi.freezedetect.freeze_start: 1.5',
    'lavfi.freezedetect.freeze_duration: 3.0',
    'lavfi.freezedetect.freeze_end: 4.5',
    'lavfi.freezedetect.freeze_start: 10',
  ].join('\n');
  const freezes = parseFreezes(log);
  assert.deepEqual(freezes, [{ start: 1.5, end: 4.5 }, { start: 10, end: null }]);
  assert.equal(parseFreezes('no freeze here').length, 0);
});

test('a held colour is frozen at n=-60dB even when the hold runs to EOF', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-hold-'));
  const file = path.join(dir, 'hold.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x102040:s=320x180:r=30:d=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-pix_fmt', 'yuv420p', '-an', file]);
  const vi = await detectVisualIssues(file);
  assert.ok(vi.freezes.length >= 1, 'held colour must fail no_frozen_frames');
  assert.equal(vi.freezes[0].end, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('starfield grain keeps the factory drift above -60dB under a static card', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeze-stars-'));
  const stars = await makeStarfield(path.join(dir, 'stars.png'), { size: 900 });
  const panel = path.join(dir, 'panel.png');
  const out = path.join(dir, 'drift.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x0b1020:s=520x220:d=1', '-frames:v', '1', panel]);
  // Same crop as factory2 stars: x travels (iw-W) over 6*L, y = 20*sin(t). Card covers the middle.
  const L = 4;
  await run('ffmpeg', ['-y', '-v', 'error', '-loop', '1', '-framerate', '30', '-t', String(L), '-i', stars, '-loop', '1', '-framerate', '30', '-t', String(L), '-i', panel,
    '-filter_complex', `[0:v]crop=640:360:'(iw-640)*t/${(L * 6).toFixed(2)}':'(ih-360)/2+20*sin(t)',fps=30[bg];[bg][1:v]overlay=x=60:y=70`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-an', '-r', '30', out]);
  const vi = await detectVisualIssues(out);
  assert.deepEqual(vi.freezes, [], JSON.stringify(vi.freezes));
  fs.rmSync(dir, { recursive: true, force: true });
});
