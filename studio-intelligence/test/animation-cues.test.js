'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

const MODEL = 'a'.repeat(64);
const PACK = 'b'.repeat(64);
const ID = 'MOONKATTY_NEWS_MASTER_VOICE';

function profile(id, hashes = {}) {
  return {
    voiceProfileId: id,
    label: 'MOONKATTY NEWS anchor',
    note: null,
    sampleAssetId: null,
    sampleRate: 48000,
    recognizer: 'tts-timing',
    gain: 1,
    mouthScale: 1,
    engine: 'kokoro',
    voice: 'am_fenrir',
    speed: 1,
    pitchShift: 0,
    modelSha256: hashes.modelSha256 === undefined ? MODEL : hashes.modelSha256,
    voicesSha256: hashes.voicesSha256 === undefined ? PACK : hashes.voicesSha256
  };
}

function cues(voice) {
  return {
    contract: 'moonkatty/animation-cues/v1',
    video: { file: 'ep1-youtube.mp4', preset: 'youtube' },
    voice,
    segments: []
  };
}

test('voice в cues совпадает с утверждённым профилем, иначе отказ', () => {
  const { si, owner, agent } = setup();
  si.voices.define({ principal: agent('video'), profile: profile(ID) });
  assert.throws(
    () => si.animationCues.assertVoice({
      principal: agent('video'),
      cues: cues({ voiceProfileId: ID, modelSha256: MODEL, voicesSha256: PACK })
    }),
    err => err.code === 'NOT_FOUND'
  );
  const approved = si.voices.approve({ principal: owner, voiceProfileId: ID });
  assert.equal(approved.executed, false);
  const match = si.animationCues.assertVoice({
    principal: agent('video'),
    cues: cues({ voiceProfileId: ID, modelSha256: MODEL.toUpperCase(), voicesSha256: PACK })
  });
  assert.equal(match.ok, true);
  assert.equal(match.executed, false);
  assert.equal(match.voiceProfileId, ID);
  assert.throws(
    () => si.animationCues.assertVoice({
      principal: agent('video'),
      cues: cues({ voiceProfileId: 'other_voice', modelSha256: MODEL, voicesSha256: PACK })
    }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.animationCues.assertVoice({
      principal: agent('video'),
      cues: cues({ voiceProfileId: ID, modelSha256: 'c'.repeat(64), voicesSha256: PACK })
    }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.animationCues.assertVoice({
      principal: agent('video'),
      cues: cues({ voiceProfileId: ID, modelSha256: MODEL, voicesSha256: 'd'.repeat(64) })
    }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.animationCues.assertVoice({ principal: agent('video'), cues: cues('MOONKATTY_NEWS_MASTER_VOICE') }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.animationCues.assertVoice({ principal: agent('video'), cues: { contract: 'moonkatty/animation-cues/v1', segments: [] } }),
    err => err.code === 'VALIDATION'
  );
  assert.throws(
    () => si.animationCues.assertVoice({ principal: agent('design3d'), cues: cues({ voiceProfileId: ID, modelSha256: MODEL, voicesSha256: PACK }) }),
    err => err.code === 'PERMISSION_DENIED'
  );
  si.voices.define({ principal: owner, profile: profile('voice_next') });
  si.voices.approve({ principal: owner, voiceProfileId: 'voice_next' });
  assert.throws(
    () => si.animationCues.assertVoice({
      principal: agent('video'),
      cues: cues({ voiceProfileId: ID, modelSha256: MODEL, voicesSha256: PACK })
    }),
    err => err.code === 'VALIDATION'
  );
  const next = si.animationCues.assertVoice({
    principal: owner,
    cues: cues({ voiceProfileId: 'voice_next', modelSha256: MODEL, voicesSha256: PACK })
  });
  assert.equal(next.voiceProfileId, 'voice_next');
  si.close();
});
