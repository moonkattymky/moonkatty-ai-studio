'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { tmp } = require('./helpers');
const A = require('../src/anchor'); const { MasterVoice } = require('../src/video/master-voice');
const { wordCaptions } = require('../src/video/factory2'); const { validateSrt } = require('../src/video/srtcheck');
const { relevant } = require('../src/media/library'); const { strictMediaPlan } = require('../src/orchestrator/facts'); const { panelSvg } = require('../src/media/panel');
const sents = [{ text: 'Hello there.', start: 0.25, end: 1.1 }, { text: 'This is a test, friends?', start: 1.5, end: 2.9 }];
test('word timestamps: monotonic, inside measured sentences', () => {
  const w = A.wordTimestamps(sents, 10); assert.equal(w.length, 7);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end - 1e-6);
  assert.equal(w[0].start, 10.25); assert.ok(Math.abs(w[w.length - 1].end - 12.9) < 0.01);
});
test('cue generator output validates against schema for every mode; schema catches bad docs', () => {
  for (const m of A.NAMES) { const d = A.buildCues({ segmentId: 's', audio: { file: 'a.wav', sha256: 'x', durationSec: 3.2, sampleRate: 44100 }, text: 't', emotion: m, sentences: sents, offset: 4, humorTag: m === 'WITTY' ? 'j' : null });
    const r = A.checkCues(d); assert.ok(r.ok, m + ': ' + r.errors.join(';')); }
  const d = A.buildCues({ segmentId: 's', audio: { file: 'a.wav', sha256: 'x', durationSec: 3.2, sampleRate: 44100 }, text: 't', emotion: 'NEUTRAL', sentences: sents });
  assert.ok(!A.checkCues({ ...d, version: '2' }).ok); assert.ok(!A.checkCues({ ...d, emotion: { mode: 'ANGRY' } }).ok);
  assert.ok(!A.checkCues({ ...d, gestures: [{ start: 0, end: 1, type: 'ear_flick' }] }).ok);
  assert.ok(!A.checkCues({ ...d, smile: [{ t: 0, value: 0.9 }], emotion: { mode: 'SERIOUS' } }).ok, 'serious must not smile');
  assert.ok(!A.checkCues({ ...d, words: [{ w: 'x', start: 0, end: 99 }] }).ok, 'beyond audio');
});
test('emotion-aware captions from words pass SRT rules', () => {
  const words = A.wordTimestamps([{ text: 'The European Space Agency-led Solar Orbiter spacecraft has flown through an S-shaped kink known as a switchback in the solar wind magnetic field.', start: 0.25, end: 8 }, { text: 'Wow.', start: 8.3, end: 8.6 }]);
  for (const [mc, v] of [[26, 28], [42, 46]]) { const c = wordCaptions(words, mc, 'CURIOUS'); assert.ok(c.every(x => x.style === 'Curious'));
    const srt = c.map((x, i) => `${i + 1}\n00:00:${x.start.toFixed(3).padStart(6, '0').replace('.', ',')} --> 00:00:${x.end.toFixed(3).padStart(6, '0').replace('.', ',')}\n${x.text}\n`).join('\n');
    const r = validateSrt(srt, { maxChars: v, totalSec: 10 }); assert.ok(r.ok, r.errors.join(';')); }
  assert.equal(wordCaptions(words, 42, 'SERIOUS')[0].style, 'Serious');
});
test('master voice am_fenrir: locked, autoReplace=false, fails (no fallback) when model/voices missing or voices hash differs', () => {
  const d = tmp(); const model = path.join(d, 'm.onnx'), voices = path.join(d, 'v.bin'); fs.writeFileSync(model, 'm'); fs.writeFileSync(voices, 'v');
  const { sha256File } = require('../src/video/master-voice');
  const cfg = { ...JSON.parse(fs.readFileSync(path.join(__dirname, '../config/master-voice.json'))), model: { file: model, sha256: sha256File(model) }, voicesFile: voices, voicesSha256: sha256File(voices) };
  const f = path.join(d, 'mv.json'); fs.writeFileSync(f, JSON.stringify(cfg));
  const t = new MasterVoice({ file: f, env: {} }).createTTS(); assert.equal(t.constructor.name, 'KokoroBlendTTS'); assert.deepEqual(t.blend, { am_fenrir: 1 }); assert.equal(t.speed, 1); assert.equal(t.pitchSemitones, 0); assert.equal(t.emotionPitch, false);
  fs.writeFileSync(f, JSON.stringify({ ...cfg, voicesSha256: 'f'.repeat(64) })); assert.throws(() => new MasterVoice({ file: f, env: {} }).createTTS(), /hash mismatch/);
  fs.writeFileSync(f, JSON.stringify({ ...cfg, autoReplace: true })); assert.throws(() => new MasterVoice({ file: f, env: {} }).createTTS(), /autoReplace/);
  fs.writeFileSync(f, JSON.stringify(cfg)); fs.unlinkSync(voices); assert.throws(() => new MasterVoice({ file: f, env: {} }).createTTS(), /Refusing to substitute/);
  const ex = new MasterVoice({ file: f, env: {} }).exportForStudio5(); assert.equal(ex.id, 'MOONKATTY_NEWS_MASTER_VOICE'); assert.equal(ex.approval.approvedBy, 'Igor'); assert.equal(ex.policy.autoReplace, false);
});
test('Studio 5 export JSON in docs matches config', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/media-automation/exports/master-voice.studio5.json')));
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/master-voice.json')));
  assert.deepEqual(ex.voice.blend, c.blend); assert.equal(ex.engine.model.sha256, c.model.sha256); assert.equal(ex.engine.voicesPack.sha256, c.voicesSha256);
});
test('stricter image relevance: mission names as phrase, story-specific place required', () => {
  assert.equal(relevant('Solar Orbiter origin', { title: 'ESCAPADE Unloading', description: 'solar wind origin' }), false);
  assert.equal(relevant('Solar Orbiter', { title: 'Solar Orbiter orbiting the Sun' }), true);
  const plan = strictMediaPlan({ headline: 'Extratropical Cyclone Whips Past Iceland', summary: 'The powerful low-pressure system formed over the North Atlantic.' });
  assert.deepEqual(plan.requireAny, ['Iceland']); assert.ok(plan.queries.some(q => /Iceland/.test(q.q)));
  const p2 = strictMediaPlan({ headline: 'Solar Orbiter tracks origin of mysterious magnetic switchbacks', summary: 'The European Space Agency-led Solar Orbiter spacecraft has flown through a kink.' });
  assert.deepEqual(p2.requireAny, ['Solar Orbiter']);
});
test('branded panel never repeats the headline', () => { assert.doesNotMatch(panelSvg({ headline: 'Unique Headline Text', category: 'space' }), /Unique Headline/); });
