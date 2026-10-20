import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyCorrection, PROCEDURE } from '../corrections.mjs';
import { extractDates, extractNumbers, extractQuotes } from '../extract.mjs';
import { reviewScript, reviewScriptLive } from '../review.mjs';
import { inspectVideo } from '../video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const good = JSON.parse(fs.readFileSync(path.join(root, 'qa/content/fixtures/good-script.json'), 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('extractor pulls the quote, the cost and the calendar day', () => {
  const text = good.body;
  assert.deepEqual(extractQuotes(text), ['the crew is safe on the surface']);
  assert.ok(extractNumbers(text).some(item => item.value === 2.4e9));
  assert.deepEqual(extractDates(text), ['2026-03-12']);
  assert.equal(extractNumbers('landed at 14:02 UTC').length, 0);
});

test('a package that matches its stored source is clear and publishable', () => {
  const verdict = reviewScript(good);
  assert.equal(verdict.contract, 'moonkatty.qa.content.verdict/1');
  assert.equal(verdict.decision, 'clear');
  assert.equal(verdict.publish, true);
  assert.equal(verdict.findings.length, 0);
  assert.match(verdict.note, /not a quality score/);
});

test('a changed quotation, cost, date, claim, image and citation are held', () => {
  const script = clone(good);
  script.body = 'On 13 March 2026 the mission cost $4.2 billion. NASA said: "the crew was lost on arrival".';
  script.claims.push({ id: 'c2', text: 'The rover found liquid water on Mars.' });
  script.images[0].caption = 'Mars rover on 4 July 2020';
  script.images[0].credit = 'Reuters';
  script.images[0].takenAt = '2020-07-04';
  script.citations.push('ap');
  const verdict = reviewScript(script);
  const kinds = new Set(verdict.findings.map(item => item.kind));
  for (const kind of ['quote_mismatch', 'number_mismatch', 'date_mismatch', 'unsupported_claim', 'image_mismatch', 'image_credit', 'mismatched_source']) {
    assert.ok(kinds.has(kind), `missing ${kind}: ${[...kinds].join(',')}`);
  }
  assert.equal(verdict.decision, 'hold');
  assert.equal(verdict.publish, false);
});

test('a date with no related source sentence is a minor note, not a hold', () => {
  const script = clone(good);
  script.body += ' Filed on 1 January 1999.';
  const verdict = reviewScript(script);
  assert.ok(verdict.findings.some(item => item.kind === 'date_unsupported' && item.severity === 'minor'));
  assert.equal(verdict.decision, 'clear_with_notes');
  assert.equal(verdict.publish, true);
});

test('stored HTTP 404 is a dead source even when the saved text still matches', () => {
  const script = clone(good);
  script.sources[0].status = 404;
  script.sources[0].error = 'HTTP 404';
  const verdict = reviewScript(script);
  assert.ok(verdict.findings.some(item => item.kind === 'dead_source'));
  assert.equal(verdict.decision, 'hold');
});

test('a missing image file is reported and a present file is not', () => {
  const missing = clone(good);
  missing.images[0].file = path.join(root, 'qa/content/fixtures/no-such-image.png');
  assert.ok(reviewScript(missing).findings.some(item => item.kind === 'image_file_missing'));
  const png = path.join(os.tmpdir(), `qa-content-${process.pid}.png`);
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const present = clone(good);
  present.images[0].file = png;
  const verdict = reviewScript(present);
  assert.ok(!verdict.findings.some(item => item.kind === 'image_file_missing' || item.kind === 'image_unreadable'));
  fs.rmSync(png, { force: true });
});

test('probe marks a local 404 dead and leaves a local 200 usable', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/dead') {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const script = clone(good);
    script.sources[0].url = `http://127.0.0.1:${port}/live`;
    script.sources.push({
      id: 'gone',
      name: 'Gone',
      url: `http://127.0.0.1:${port}/dead`,
      status: 200,
      title: 'Unused',
      text: 'This stored text is not enough once the probe returns 404.'
    });
    const verdict = await reviewScriptLive(script);
    const dead = verdict.findings.filter(item => item.kind === 'dead_source');
    assert.equal(dead.length, 1);
    assert.equal(dead[0].evidence.sourceId, 'gone');
    assert.equal(verdict.decision, 'hold');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('a correction is verified only when the addressed finding is gone and the log keeper is studio-5', () => {
  const before = clone(good);
  before.body = before.body.replace('$2.4 billion', '$4.2 billion');
  const prior = reviewScript(before);
  const id = prior.findings.find(item => item.kind === 'number_mismatch').id;
  const base = {
    id: 'corr-1',
    itemId: good.id,
    correctedBy: 'studio-5',
    addresses: [id],
    log: { keeper: 'studio-5', entryId: 'log-1' },
    sources: good.sources,
    before: { id: good.id, body: before.body, claims: good.claims, images: good.images },
    after: { id: good.id, body: good.body, claims: good.claims, images: good.images }
  };
  const ok = verifyCorrection(base);
  assert.equal(ok.verified, true);
  assert.equal(ok.decision, 'verified');
  assert.equal(ok.contract, 'moonkatty.qa.content.correction-verification/1');
  assert.equal(ok.remaining.length, 0);
  assert.ok(ok.procedure.length >= 8);
  assert.match(ok.procedure.join('\n'), /studio-5/);

  const same = verifyCorrection({ ...base, after: base.before });
  assert.equal(same.verified, false);
  assert.ok(same.errors.some(error => /identical/.test(error)));

  const wrongKeeper = verifyCorrection({ ...base, log: { keeper: 'studio-2' } });
  assert.equal(wrongKeeper.verified, false);
});

test('procedure text matches the corrections document', () => {
  const doc = fs.readFileSync(path.join(root, 'qa/content/CORRECTIONS.md'), 'utf8');
  for (const step of PROCEDURE) assert.ok(doc.includes(step), step);
});

test('invalid packages are rejected', () => {
  assert.throws(() => reviewScript({}), /invalid script/);
  assert.throws(() => verifyCorrection({}), /invalid correction/);
});

test('ffmpeg measures a picture with audio, and flags black frames and the wrong raster', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-video-'));
  const color = path.join(dir, 'color.mp4');
  const black = path.join(dir, 'black.mp4');
  const encode = (args, dest) => {
    const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, dest], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  encode([
    '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'
  ], color);
  encode([
    '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'
  ], black);
  const clean = inspectVideo(color, {
    width: 320,
    height: 240,
    aspect: '4:3',
    minDurationSec: 0.5,
    maxDurationSec: 3,
    requireAudio: true,
    loudnessLUFS: { min: -30, max: -10 },
    maxBlackFramePct: 0.5
  });
  assert.equal(clean.findings.length, 0, JSON.stringify(clean.findings));
  assert.equal(clean.metrics.width, 320);
  assert.equal(clean.metrics.height, 240);
  assert.equal(clean.metrics.aspect, '4:3');
  assert.ok(clean.metrics.audio && clean.metrics.audio.codec);
  assert.ok(typeof clean.metrics.integratedLUFS === 'number');
  assert.ok(clean.metrics.durationSec >= 0.5);

  const bad = inspectVideo(black, { width: 1920, height: 1080, aspect: '16:9', maxBlackFramePct: 0 });
  const kinds = new Set(bad.findings.map(item => item.kind));
  assert.ok(kinds.has('video_resolution'), [...kinds].join(','));
  assert.ok(kinds.has('video_aspect'));
  assert.ok(kinds.has('black_frames'));
  assert.ok(bad.metrics.blackPct > 0.5);

  const script = clone(good);
  script.video = { file: black, expected: { maxBlackFramePct: 0 } };
  const verdict = reviewScript(script);
  assert.ok(verdict.findings.some(item => item.kind === 'black_frames'));
  assert.equal(verdict.video.blackPct > 0.5, true);
  assert.equal(verdict.publish, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the CLI writes a verdict and a failing exit code for a held package', () => {
  const cli = path.join(root, 'qa/content/cli.mjs');
  const fixture = path.join(root, 'qa/content/fixtures/good-script.json');
  const ok = spawnSync(process.execPath, [cli, fixture], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const verdict = JSON.parse(ok.stdout);
  assert.equal(verdict.publish, true);

  const heldFile = path.join(os.tmpdir(), `qa-held-${process.pid}.json`);
  const held = clone(good);
  held.sources[0].status = 410;
  fs.writeFileSync(heldFile, JSON.stringify(held));
  const bad = spawnSync(process.execPath, [cli, heldFile], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).publish, false);
  fs.rmSync(heldFile, { force: true });
});
