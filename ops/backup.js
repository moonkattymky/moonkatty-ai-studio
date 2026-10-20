#!/usr/bin/env node
// Backup CLI (works while the app runs: VACUUM INTO is an online snapshot).
//   node ops/backup.js list|create|verify <id>|test-restore <id>|restore <id> --to <EMPTY dir>   [--data <dir>] [--passphrase-env VAR]
// Data dir: --data, or STUDIO_DATA_DIR, or ~/Library/Application Support/MOONKATTY AI STUDIO (macOS).
'use strict';
const path = require('path'), os = require('os');
const { open } = require('../lib/db.js'); const { createBackupManager } = require('../lib/ops/backup.js');
const a = process.argv.slice(2); const opt = k => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
const dataDir = opt('--data') || process.env.STUDIO_DATA_DIR || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MOONKATTY AI STUDIO') : path.join(__dirname, '..', 'data'));
const passphrase = opt('--passphrase-env') ? process.env[opt('--passphrase-env')] : undefined; // never via argv
const db = open(path.join(dataDir, 'studio.db'));
const bm = createBackupManager({ db, openDb: open, dataDir, filesDir: path.join(dataDir, 'files'), version: require('../package.json').version, keep: +(process.env.OPS_BACKUP_KEEP || 7) });
const [cmd, id] = a; let r;
try {
  if (cmd === 'list') r = bm.list(); else if (cmd === 'create') r = bm.create({ passphrase, note: 'cli' });
  else if (cmd === 'verify') r = bm.verify(id); else if (cmd === 'test-restore') r = bm.testRestore(id, { passphrase });
  else if (cmd === 'restore') { if (!opt('--to')) throw new Error('--to <пустая папка> обязателен'); r = bm.restoreInto(id, path.resolve(opt('--to')), { passphrase }); }
  else { console.log('usage: list | create | verify <id> | test-restore <id> | restore <id> --to <dir>'); process.exit(2); }
  console.log(JSON.stringify(r, null, 1)); process.exit(r && r.ok === false ? 1 : 0);
} catch (e) { console.error(e.message); process.exit(1); } finally { try { db.close(); } catch {} }
