'use strict';
const { StudioError } = require('./errors');

const SHA256 = /^[a-f0-9]{64}$/i;

/**
 * Сверяет объект voice в файле cues с утверждённым профилем реестра.
 * Схему сегментов не проверяет: её файл — media-automation/config/animation-cues.schema.json,
 * $id moonkatty/animation-cues/v1. Здесь только id и оба sha256, и только если профиль утверждён.
 */
function createAnimationCues({ voices }) {
  function hashOrNull(value, label) {
    if (value == null || value === '') return null;
    const text = String(value);
    if (!SHA256.test(text)) {
      throw new StudioError('VALIDATION', label + ': нужен SHA-256 из 64 hex-символов', { retryable: false });
    }
    return text.toLowerCase();
  }

  function assertVoice({ principal, cues }) {
    if (!cues || typeof cues !== 'object' || Array.isArray(cues)) {
      throw new StudioError('VALIDATION', 'Файл cues не объект', { retryable: false });
    }
    const voice = cues.voice;
    if (!voice || typeof voice !== 'object' || Array.isArray(voice)) {
      throw new StudioError('VALIDATION', 'В cues нет объекта voice', { retryable: false });
    }
    const approved = voices.approved({ principal });
    if (approved.approved !== true || approved.status !== 'approved') {
      throw new StudioError('VALIDATION', 'Профиль голоса в реестре не утверждён', { retryable: false });
    }
    const modelSha256 = hashOrNull(voice.modelSha256, 'modelSha256');
    const voicesSha256 = hashOrNull(voice.voicesSha256, 'voicesSha256');
    if (
      voice.voiceProfileId !== approved.voiceProfileId
      || modelSha256 !== approved.modelSha256
      || voicesSha256 !== approved.voicesSha256
    ) {
      throw new StudioError('VALIDATION', 'voice в cues не совпадает с утверждённым профилем реестра', { retryable: false });
    }
    return { ok: true, executed: false, voiceProfileId: approved.voiceProfileId };
  }

  return { assertVoice };
}

module.exports = { createAnimationCues };
