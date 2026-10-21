'use strict';

/**
 * Anchor-voice evaluation. commercialUse false means the bulletin must not use that model.
 * Fit false means the licence allows use and the voice still does not match the requested anchor.
 */
const VOICES = [
  {
    id: 'am_michael',
    engine: 'kokoro',
    locked: false,
    role: 'provisional-default',
    commercialUse: true,
    gender: 'male',
    accent: 'en-US',
  },
  {
    id: 'am_adam',
    engine: 'kokoro',
    locked: false,
    role: 'candidate',
    commercialUse: true,
    gender: 'male',
    accent: 'en-US',
  },
  {
    id: 'am_fenrir',
    engine: 'kokoro',
    locked: false,
    role: 'candidate',
    commercialUse: true,
    gender: 'male',
    accent: 'en-US',
  },
  {
    id: 'en_US-ryan-high',
    engine: 'piper',
    commercialUse: false,
    reason: 'Piper MODEL_CARD dataset license is CC BY-NC-SA 4.0 (Ryan Speech). Non-commercial.',
  },
  {
    id: 'en_US-joe-medium',
    engine: 'piper',
    commercialUse: false,
    reason: 'MODEL_CARD says the voice is finetuned from U.S. English Lessac (medium). The Lessac licence is research-only. The fine-tune corpus card says CC0, which does not clear the base checkpoint.',
  },
  {
    id: 'en_US-lessac-medium',
    engine: 'piper',
    commercialUse: false,
    reason: 'Blizzard 2013 Lessac licence is research-only and excludes commercial use.',
  },
  {
    id: 'en_US-ljspeech-high',
    engine: 'piper',
    commercialUse: true,
    fit: false,
    gender: 'female',
    reason: 'Public-domain LJ Speech. Commercial use is allowed. The speaker is female, so it does not fit the requested adult male anchor.',
  },
];

function rejectedForCommercial() {
  return VOICES.filter(v => v.commercialUse === false);
}

module.exports = { VOICES, rejectedForCommercial };
