// Master key for encrypting tokens/secrets (AES-256-GCM) stored in SQLite.
// Order: STUDIO_SECRET_KEY env → macOS Keychain (security CLI) → file <data>/secret.key (0600).
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const SERVICE = 'MOONKATTY AI STUDIO', ACCOUNT = 'studio-master-key';
function keychainGet() { try { return execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString().trim(); } catch { return null; } }
function keychainSet(hex) { execFileSync('/usr/bin/security', ['add-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w', hex, '-U'], { stdio: 'ignore', timeout: 10000 }); }
function loadKey(dataDir) {
  if (process.env.STUDIO_SECRET_KEY) return { key: crypto.createHash('sha256').update(process.env.STUDIO_SECRET_KEY).digest(), source: 'env' };
  const f = path.join(dataDir, 'secret.key');
  const useKc = process.platform === 'darwin' && process.env.STUDIO_KEYCHAIN !== '0' && fs.existsSync('/usr/bin/security');
  if (useKc) {
    let hex = keychainGet();
    if (!hex) { // migrate an existing file key, or create a new one
      hex = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : crypto.randomBytes(32).toString('hex');
      try { keychainSet(hex); if (keychainGet() === hex) { if (fs.existsSync(f)) fs.renameSync(f, f + '.migrated-to-keychain'); } else throw new Error('verify'); }
      catch { if (!fs.existsSync(f)) fs.writeFileSync(f, hex, { mode: 0o600 }); return { key: Buffer.from(hex, 'hex'), source: 'file (Keychain недоступна)' }; }
    }
    return { key: Buffer.from(hex, 'hex'), source: 'keychain' };
  }
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return { key: Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'), source: 'file' };
}
module.exports = { loadKey, SERVICE, ACCOUNT };
