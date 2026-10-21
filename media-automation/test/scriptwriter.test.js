'use strict';
const test = require('node:test'); const assert = require('node:assert');
const { strictFactCheck } = require('../src/llm/factcheck'); const { AnchorScriptWriter } = require('../src/anchor/scriptwriter');
const { buildAss } = require('../src/video/ass');
const SRC = ['NASA: Extratropical Cyclone Whips Past Iceland. The powerful low-pressure system formed over the North Atlantic out of the remnants of Hurricane Isaias.'];
test('strict fact check rejects invented numbers, number words, dates, relative dates and names', () => {
  assert.ok(strictFactCheck('A powerful storm swept past Iceland. NASA says it formed from Hurricane Isaias.', SRC).ok);
  for (const bad of ['The storm hit 3 towns near Iceland.', 'Two storms formed over the North Atlantic.', 'It formed in October over Iceland.', 'The storm passed Iceland yesterday.',
    'Officials in Reykjavik warned residents.', 'Experts like Smith are watching.', 'The cyclone recently passed Iceland.', 'Stay tuned for updates.'])
    assert.equal(strictFactCheck(bad, SRC).ok, false, bad);
  assert.ok(strictFactCheck("They're watching. Picture this: a storm over Iceland.", SRC).ok, 'sentence-initial ordinary words are not names');
});
const story = { headline: 'Extratropical Cyclone Whips Past Iceland', summary: 'The powerful low-pressure system formed over the North Atlantic out of the remnants of Hurricane Isaias.' };
const sources = [{ sourceName: 'NASA', title: story.headline, summary: story.summary, link: 'https://science.nasa.gov/x', published: 'Wed, 21 Oct 2026 04:01:00 +0000' }];
const llmSeq = outs => { let i = 0; return { name: 'mock-llm', calls: [], async generate(a) { this.calls.push(a); return { text: outs[Math.min(i++, outs.length - 1)] }; } }; };
test('script writer: invented fact rejected, retried with feedback + new seed, then accepted; signoff added; no humor on serious', async () => {
  const bad = JSON.stringify({ hook: 'A big storm hit Iceland.', body: ['NASA says 40 homes lost power.', 'It formed from Hurricane Isaias.'] });
  const good = JSON.stringify({ hook: 'A powerful storm swept past Iceland.', body: ['NASA reports a low-pressure system formed over the North Atlantic.', 'It grew out of the remnants of Hurricane Isaias.'] });
  const llm = llmSeq([bad, good, '{"unsupported_claims": []}']);
  const r = await new AnchorScriptWriter({ llm }).write({ story, emotion: 'SERIOUS', sources, jokeCandidates: ['Finally, a storm with priorities.'] });
  assert.equal(r.provider, 'mock-llm'); assert.equal(r.rejections.length, 1); assert.match(JSON.stringify(r.rejections[0].unsupported), /40/);
  assert.match(llm.calls[1].prompt, /REJECTED/); assert.notEqual(llm.calls[0].seed, llm.calls[1].seed);
  assert.equal(r.humorTag, null); assert.equal(r.lines[r.lines.length - 1].role, 'signoff'); assert.ok(r.lines.every(l => l.emotion === 'SERIOUS'));
});
test('script writer: verifier-flagged added claim rejected; falls back to source text after max attempts', async () => {
  const d = JSON.stringify({ hook: 'A powerful storm swept past Iceland.', body: ['NASA reports a low-pressure system formed over the North Atlantic.', 'Residents faced severe flooding and evacuations.'] });
  const llm = llmSeq([d, '{"unsupported_claims": ["Residents faced severe flooding and evacuations"]}']);
  const r = await new AnchorScriptWriter({ llm, maxAttempts: 2 }).write({ story, emotion: 'SERIOUS', sources });
  assert.equal(r.provider, 'local-deterministic'); assert.ok(r.rejections.length >= 1); assert.match(r.spoken, /remnants of Hurricane Isaias/);
});
test('script writer: anchor never names itself / credits research to "we"', async () => {
  const d = JSON.stringify({ hook: 'Katty here with a storm.', body: ['We traced the storm past Iceland.', 'It formed over the North Atlantic.'] });
  const r = await new AnchorScriptWriter({ llm: llmSeq([d, '{"unsupported_claims": []}']), maxAttempts: 1 }).write({ story, emotion: 'SERIOUS', sources });
  assert.equal(r.provider, 'local-deterministic'); assert.match(JSON.stringify(r.rejections), /attribution/);
});
test('karaoke captions: \\kf per word, Serious style keeps no gold', () => {
  const ass = buildAss([{ start: 1, end: 2, text: 'Hello there', style: 'Serious', words: [[{ w: 'Hello', start: 1, end: 1.4 }, { w: 'there', start: 1.5, end: 2 }]] }], { W: 1080, H: 1920 });
  assert.match(ass, /\{\\kf40\}Hello \{\\k10\}\{\\kf50\}there/); assert.match(ass, /Style: Serious,Inter,\d+,&H00FFFFFF,&H00BEBEBE/);
});
