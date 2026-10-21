#!/usr/bin/env node
'use strict';
// One-time per channel, on the Mac mini: node media-automation/bin/youtube-auth.js youtube-news|youtube-project [login_hint_email]
// Prereq: Keychain secret youtube_oauth_client = {"client_id":"...apps.googleusercontent.com","client_secret":"..."} (Desktop app OAuth client).
const { execFile } = require('child_process'); const { YouTubeOAuth } = require('../src/auth'); const { ChainSecrets } = require('../src/secrets');
const [account, hint] = process.argv.slice(2);
new YouTubeOAuth({ secrets: new ChainSecrets() }).authorize(account, { loginHint: hint, onUrl: u => { console.log('Open this URL and choose the', account, 'channel:\n' + u); if (process.platform === 'darwin') execFile('open', [u]); } })
  .then(r => console.log('Authorized', r.account, '- refresh token stored in Keychain.'), e => { console.error('FAILED:', e.message); process.exit(1); });
