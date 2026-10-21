'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { tmp } = require('./helpers');
const A = require('../src/anchor');
const robot = { title: 'Robot barista', text: 'Scientists have developed a robot that can prepare coffee.' };
test('classifier denies tragic topics', () => {
  for (const t of ['Three people died in a fire', 'Missile strikes hit the capital as war escalates', 'Terror attack at station',
    'Cholera outbreak spreads', 'Earthquake leaves 40 victims', 'Man charged with murder of neighbour'])
    assert.equal(A.classifyTopic(t).humorAllowed, false, t);
});
test('classifier allows light topics only via allow-list', () => {
  assert.equal(A.classifyTopic(robot.text).humorAllowed, true);
  assert.equal(A.classifyTopic('Parliament passes budget amendment').humorAllowed, false);
});
test('humor safety: approves short safe joke', () => {
  const r = A.humorSafetyCheck(robot, 'Finally, a robot with the right priorities.');
  assert.ok(r.ok, r.reasons.join(';'));
});
test('humor safety: rejects breaking, deny topics, long jokes, new facts, unsafe words', () => {
  assert.ok(!A.humorSafetyCheck({ ...robot, format: 'breaking' }, 'Nice robot.').ok);
  assert.ok(!A.humorSafetyCheck({ text: 'A robot crash left two victims injured' }, 'Robots, am I right?').ok);
  assert.ok(!A.humorSafetyCheck(robot, 'word '.repeat(30)).ok);
  assert.match(A.humorSafetyCheck(robot, 'It brews 500 cups an hour.').reasons.join(), /numbers/);
  assert.match(A.humorSafetyCheck(robot, 'Even Elon would want one.').reasons.join(), /names/);
  assert.ok(!A.humorSafetyCheck(robot, 'Coffee so good it could kill.').ok);
});
test('humor budget and spacing; story text never altered', () => {
  const stories = [robot, { text: 'A panda at the zoo learned a new trick.' }, { text: 'NASA rocket launch scheduled.' }, { text: 'Cat café opens downtown.' }];
  const jokes = ['Right priorities.', 'Show-off.', 'Ready for liftoff.', 'Purrfect.'];
  const r = A.applyHumor(stories, jokes, 'daily_briefing');
  assert.deepEqual(r.stories.map(s => !!s.humorTag), [true, false, false, true]);
  r.stories.forEach((s, i) => assert.equal(s.text, stories[i].text));
});
test('emotion selection', () => {
  assert.equal(A.selectEmotion({ ...robot, format: 'breaking' }), 'SERIOUS');
  assert.equal(A.selectEmotion({ text: 'Flood victims receive aid as death toll rises' }), 'EMPATHETIC');
  assert.equal(A.selectEmotion({ text: 'Troops move toward border in war' }), 'SERIOUS');
  assert.equal(A.selectEmotion({ ...robot, humorTag: 'x' }), 'WITTY');
  assert.equal(A.selectEmotion({ ...robot, humorTag: 'x', format: 'shorts' }), 'PLAYFUL');
  assert.equal(A.selectEmotion({ text: 'SpaceX rocket launches new telescope' }), 'EXCITED');
  assert.equal(A.selectEmotion({ text: 'Why do cats purr? Researchers investigate' }), 'CURIOUS');
  assert.equal(A.selectEmotion({ text: 'Council approves budget' }), 'NEUTRAL');
  assert.equal(A.selectEmotion({ text: 'Two killed in shooting', emotion: 'PLAYFUL' }), 'EMPATHETIC');
  assert.equal(A.selectEmotion({ text: 'Council approves budget', emotion: 'CURIOUS' }), 'CURIOUS');
});
test('prosody maps all 7 modes; pitch filter keeps duration', () => {
  assert.equal(A.NAMES.length, 7);
  for (const m of A.NAMES) { const p = A.prosody(m); assert.ok(p.speed > 0.8 && p.speed < 1.2); }
  assert.throws(() => A.prosody('ANGRY'));
  assert.equal(A.pitchFilter(0), null); assert.match(A.pitchFilter(1), /asetrate=25427.*atempo=0\.94/);
});
test('pipeline order, persistence, resume, breaking confirmed-only', async () => {
  assert.deepEqual(A.PIPELINE, ['news', 'fact_verification', 'script_editor', 'humor_safety', 'voice_emotion', 'video', 'qa', 'approval']);
  const dir = tmp(); const seen = []; const handlers = Object.fromEntries(A.PIPELINE.map(s => [s, async d => { seen.push(s); return { ...d, [s]: true }; }]));
  const r = await A.runPipeline({ dir, format: 'daily_briefing', handlers, input: { stories: [] } });
  assert.deepEqual(seen, A.PIPELINE); assert.equal(fs.readdirSync(dir).length, 8); assert.ok(r.output.approval);
  seen.length = 0; await A.runPipeline({ dir, format: 'daily_briefing', handlers, input: {} }); assert.equal(seen.length, 0);
  const h2 = { ...handlers, fact_verification: async () => ({ stories: [{ verification: 'primary_only' }] }) };
  await assert.rejects(A.runPipeline({ dir: tmp(), format: 'breaking', handlers: h2, input: {} }), /confirmed-only/);
  assert.equal(A.FORMATS.breaking.humor, false);
});
test('anchor-personality config is valid and points to pinned master voice', () => {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/anchor-personality.json'), 'utf8'));
  assert.equal(c.voice.pinned, true); assert.equal(c.voice.masterVoiceId, 'MOONKATTY_NEWS_MASTER_VOICE'); assert.ok(c.humor.neverAlterFacts); assert.ok(A.NAMES.includes(c.defaultEmotion));
});
