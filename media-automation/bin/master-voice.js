#!/usr/bin/env node
'use strict';
// Usage: node media-automation/bin/master-voice.js show | check | lock --by <owner> | unlock --by <owner> --reason <text>
const { MasterVoice } = require('../src/video/master-voice');
const a = process.argv.slice(2); const opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : null; };
const mv = new MasterVoice();
try {
  if (a[0] === 'lock') console.log(mv.lock(opt('by')));
  else if (a[0] === 'unlock') console.log(mv.unlock(opt('by'), opt('reason')));
  else if (a[0] === 'check') { const t = mv.createTTS(); console.log('OK', t.name, mv.cfg.status); }
  else console.log(JSON.stringify(mv.exportForLipSync(), null, 2));
} catch (e) { console.error('ERROR:', e.message); process.exit(1); }
