'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { editorialScript, SAMPLE_TEXT } = require('../src/editorial');
const { applyLexicon, loadLexicon } = require('../../media-automation/src/video/speech');
const LEXICON = loadLexicon();
const { rejectedForCommercial, VOICES } = require('../src/voices');
const { assertSchema, SCHEMAS } = require('../src/schemas');

test('editorial script is editor-written and the stored lines stay in normal spelling', () => {
  const script = editorialScript();
  assertSchema(script, SCHEMAS.script, 'NewsScript');
  assert.equal(script.llm.mode, 'editor');
  assert.equal(script.llm.adapter, null);
  assert.equal(script.llm.model, null);
  const written = script.scenes.map(s => s.text).join('\n');
  assert.doesNotMatch(written, /Moo-hah-mud|Hoo-thee|Ty-foon|Street-ing/);
  assert.match(written, /No winner is called/);
  assert.match(written, /forty-four/);
  assert.match(written, /will not conduct offensive strikes/);
  const spoken = applyLexicon(written, LEXICON);
  assert.match(spoken, /Moo-hah-mud Ah-lee Pah-tay/);
  assert.match(spoken, /Hoo-theez/);
  assert.match(spoken, /Wes Street-ing/);
  assert.match(spoken, /Ty-foon/);
  assert.equal(applyLexicon('Alberta and Alberta', LEXICON), 'Al-ber-tuh and Al-ber-tuh');
  assert.match(applyLexicon(SAMPLE_TEXT, LEXICON), /Ah-boo-jah/);
});

test('ryan, joe, and lessac are refused for commercial use', () => {
  const ids = rejectedForCommercial().map(v => v.id);
  assert.deepEqual(ids.sort(), ['en_US-joe-medium', 'en_US-lessac-medium', 'en_US-ryan-high']);
  const ljspeech = VOICES.find(v => v.id === 'en_US-ljspeech-high');
  assert.equal(ljspeech.commercialUse, true);
  assert.equal(ljspeech.fit, false);
  for (const id of ['am_michael', 'am_adam', 'am_fenrir']) {
    const voice = VOICES.find(v => v.id === id);
    assert.equal(voice.commercialUse, true);
    assert.equal(voice.locked, false);
  }
});
