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
