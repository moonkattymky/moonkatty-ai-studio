'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path'); const fs = require('fs');
const { MacSayTTS, EspeakTTS, PiperTTS, detectTTS, VideoFactory, hasBinary, probeDuration } = require('../src/video');
const { tmp } = require('./helpers');
const fake = calls => async (cmd, args) => { calls.push([cmd, args]); return { stdout: cmd === 'ffprobe' ? '2.5\n' : '' }; };

test('MacSayTTS: voice, rate, safe argv, AIFF->WAV conversion', async () => {
  const calls = []; const r = await new MacSayTTS({ voice: 'Daniel', rate: 180, runFn: fake(calls) }).synthesize('-rf; rm x', '/tmp/o.wav');
  assert.equal(r.durationSec, 2.5);
  assert.deepEqual(calls[0], ['say', ['-v', 'Daniel', '-o', '/tmp/o.aiff', '-r', '180', '--', '-rf; rm x']]);
  assert.equal(calls[1][0], 'ffmpeg'); assert.ok(calls[1][1].includes('/tmp/o.aiff') && calls[1][1].includes('/tmp/o.wav'));
});
test('MacSayTTS: M4A export and voice list parsing', async () => {
  const calls = []; await new MacSayTTS({ runFn: fake(calls) }).exportM4a('hi', '/tmp/x.m4a');
  assert.ok(calls[1][1].includes('aac'));
  const v = MacSayTTS.parseVoices('Alex                en_US    # Most people recognize me by my voice.\nAnna (Premium)      de_DE    # Hallo\n');
  assert.deepEqual(v.map(x => [x.id, x.lang]), [['Alex', 'en_US'], ['Anna (Premium)', 'de_DE']]);
});
test('empty text rejected', async () => {
  await assert.rejects(new EspeakTTS({ runFn: fake([]) }).synthesize(' ', '/tmp/a.wav'), /empty/);
});
test('detectTTS fails loudly with no engine; honours MA_TTS', async () => {
  await assert.rejects(detectTTS({ env: {}, has: async () => false }), /No TTS engine/);
  const t = await detectTTS({ env: { MA_TTS: 'espeak' }, has: async b => b === 'espeak-ng' }); assert.equal(t.name, 'espeak-ng');
  await assert.rejects(detectTTS({ env: { MA_TTS: 'piper' }, has: async () => true }), /MA_TTS=piper/);
});
test('VideoFactory refuses to run without TTS (no tone fallback)', () => {
  assert.throws(() => new VideoFactory({}), /real TTS/);
});
test('REAL espeak-ng speech on this box', async t => {
  if (!(await hasBinary('espeak-ng'))) return t.skip('espeak-ng not installed');
  const out = path.join(tmp(), 's.wav'); const r = await new EspeakTTS().synthesize('Hello from MOONKATTY news.', out);
  assert.ok(r.durationSec > 1 && fs.statSync(out).size > 20000);
});
test('REAL piper speech (if MA_PIPER_MODEL set)', async t => {
  const m = process.env.MA_PIPER_MODEL; if (!m || !fs.existsSync(m)) return t.skip('MA_PIPER_MODEL not set');
  const out = path.join(tmp(), 'p.wav'); const r = await new PiperTTS({ model: m, bin: process.env.MA_PIPER_BIN || 'piper' }).synthesize('Hello from piper.', out);
  assert.ok(r.durationSec > 0.5 && (await probeDuration(out)) > 0.5);
});
