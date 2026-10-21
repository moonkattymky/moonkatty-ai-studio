'use strict';

/**
 * Черновик голоса ведущего из экспорта студии 2.
 * Утверждение сюда не копируется: status в файле и блок approval игнорируются.
 */
function profileFromStudio2Export(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('Нужен объект экспорта студии 2');
  }
  const blend = record.voice && record.voice.blend;
  const fromBlend = blend && typeof blend === 'object'
    ? Object.keys(blend).find(name => Number(blend[name]) === 1)
    : null;
  const model = record.engine && record.engine.model;
  const pack = record.engine && record.engine.voicesPack;
  return {
    voiceProfileId: record.id || 'MOONKATTY_NEWS_MASTER_VOICE',
    label: record.displayName || 'MOONKATTY NEWS anchor',
    note: null,
    sampleAssetId: null,
    engine: 'kokoro',
    voice: fromBlend || 'am_fenrir',
    speed: record.voice && record.voice.speed != null ? record.voice.speed : 1,
    pitchShift: record.voice && record.voice.pitchSemitones != null ? record.voice.pitchSemitones : 0,
    sampleRate: 48000,
    recognizer: 'tts-timing',
    gain: 1,
    mouthScale: 1,
    modelSha256: model ? model.sha256 : null,
    voicesSha256: pack ? pack.sha256 : null
  };
}

function importMasterVoiceDraft(voices, { principal, record }) {
  const saved = voices.define({ principal, profile: profileFromStudio2Export(record) });
  return { profile: saved, executed: false };
}

module.exports = { profileFromStudio2Export, importMasterVoiceDraft };
