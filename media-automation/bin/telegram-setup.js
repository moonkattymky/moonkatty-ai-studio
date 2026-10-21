#!/usr/bin/env node
'use strict';
// node media-automation/bin/telegram-setup.js [@channel]   — token is read from stdin (not argv), e.g.  pbpaste | node ... @moonkatty_news
const { setupTelegram } = require('../src/auth'); const { ChainSecrets } = require('../src/secrets');
let buf = ''; process.stdin.on('data', d => { buf += d; }).on('end', () => setupTelegram({ token: buf.trim(), channel: process.argv[2], secrets: new ChainSecrets() })
  .then(r => console.log(JSON.stringify(r, null, 2)), e => { console.error('FAILED:', e.message.replace(/bot\d+:[\w-]+/g, 'bot***')); process.exit(1); }));
