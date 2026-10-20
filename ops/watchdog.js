#!/usr/bin/env node
// MOONKATTY System Watchdog — separate process. Usage: node ops/watchdog.js [--once | --reset]
// Config via env (see docs/ops/WATCHDOG.md). State: $OPS_DATA_DIR/ops/watchdog-state.json
'use strict';
const path = require('path');
const { createWatchdog, config } = require('../lib/ops/watchdog.js');
const { stateFile } = require('../lib/ops/state.js');
const { makeNotifier } = require('../lib/ops/notifier.js');
const fs = require('fs');
// Token source preference: macOS Keychain (service com.moonkatty.watchdog) → env file (must be chmod 600).
function keychainToken() { if (process.platform !== 'darwin' || process.env.OPS_WATCHDOG_TOKEN) return;
  try { const t = require('child_process').execFileSync('/usr/bin/security', ['find-generic-password', '-s', 'com.moonkatty.watchdog', '-a', 'watchdog', '-w'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim(); if (t) process.env.OPS_WATCHDOG_TOKEN = t; } catch {} }
const envFile = process.env.OPS_ENV_FILE || require('path').join(require('os').homedir(), '.config', 'moonkatty', 'watchdog.env');
try { const m = fs.statSync(envFile).mode & 0o777; if (m & 0o077) { console.error(`ВНИМАНИЕ: ${envFile} имеет права ${m.toString(8)} — выполните chmod 600. Токен из файла не используется.`); delete process.env.OPS_WATCHDOG_TOKEN; } } catch {}
keychainToken();
const cfg = config();
require('fs').mkdirSync(path.join(cfg.dataDir, 'ops'), { recursive: true, mode: 0o700 });
const store = stateFile(path.join(cfg.dataDir, 'ops', 'watchdog-state.json'));
if (process.argv.includes('--reset')) { const s = store.load(); s.breakers = {}; s.actions = []; store.save(s); console.log('Circuit breakers сброшены'); process.exit(0); }
const notifier = makeNotifier(process.env, { log: m => console.error(m) });
const wd = createWatchdog({ cfg, store, notifier, log: m => console.log(m) });
const line = out => Object.entries(out).map(([k, v]) => `${v.ok ? 'OK ' : 'ERR'} ${k}: ${v.detail}${v.action ? ' [action ' + JSON.stringify(v.action) + ']' : ''}`).join('\n');
async function loop() {
  try { const out = await wd.cycle(); console.log(new Date().toISOString() + '\n' + line(out)); } catch (e) { console.error('cycle failed: ' + e.message); }
  if (!process.argv.includes('--once')) setTimeout(loop, cfg.intervalMs);
}
console.log(`Watchdog: ${cfg.serverUrl}, notify=${notifier.kind}, restart=${cfg.restart}, killHung=${cfg.killHung}`);
loop();
process.on('SIGTERM', () => process.exit(0));
