#!/usr/bin/env node
'use strict';
const { ensureTts, VOICE } = require('../src/tts');
ensureTts().then(tts => {
  console.log(JSON.stringify({ ok: true, engine: tts.name, voice: tts.voiceId || VOICE, license: tts.license }));
}).catch(err => { console.error(err.message); process.exit(1); });
