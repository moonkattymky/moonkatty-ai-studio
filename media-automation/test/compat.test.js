'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'); const path = require('path');
const { check } = require('../src/platforms/schema-check');
test('voice profile export carries schemaVersion and validates; committed export is in sync', () => {
  const { MasterVoice } = require('../src/video/master-voice'); const ex = new MasterVoice({ env: {} }).exportForStudio5();
  assert.deepEqual(check(require('../schemas/voice-profile.v1.schema.json'), ex), []); assert.equal(ex.schemaVersion, '1.0.0');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'media-automation', 'exports', 'master-voice.studio5.json'), 'utf8')), JSON.parse(JSON.stringify(ex)));
});
test('animation cues keep version "1" (provisional) and schema id', () => {
  const s = require('../config/animation-cues.schema.json'); assert.equal(s.properties.version.const, '1'); assert.match(s.$id, /animation-cues\/v1$/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'media-automation', 'ANIMATION_CUES.md'), 'utf8'), /PROVISIONAL/);
});
test('cues.json top-level voice object (provisional)', () => {
  const s = require('../config/animation-cues.file.schema.json'); const c = require('../config/master-voice.json');
  const doc = { contract: 'moonkatty/animation-cues/v1', video: 'a.mp4', voice: { voiceProfileId: c.id, modelSha256: c.model.sha256, voicesSha256: c.voicesSha256 }, voiceLabel: 'kokoro-blend', segments: [] };
  assert.deepEqual(check(s, doc), []); assert.ok(check(s, { ...doc, voice: 'kokoro' }).length);
  assert.match(fs.readFileSync(require.resolve('../src/video/factory2.js'), 'utf8'), /voice: cuesVoice\(\), voiceLabel:/);
});
