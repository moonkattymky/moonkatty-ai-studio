// Master key for encrypting tokens/secrets (AES-256-GCM) stored in SQLite.
// Order: STUDIO_SECRET_KEY env → macOS Keychain (security CLI) → file <data>/secret.key (0600).
// Keychain service/account come from lib/studio-config.js (the TEST build uses its own service "… .test").
// v1.2.2: the key is NEVER passed in argv (visible in `ps`): it is written hex-encoded (-X) to stdin of `security -i`.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { spawnSync } = require('child_process');
const CFG = require('./studio-config.js');
const SERVICE = CFG.keychainService, ACCOUNT = CFG.kcAccountMasterKey;
function securityBin() {
  if (process.env.NODE_ENV === 'test' && !process.versions.electron && process.env.STUDIO_TEST_SECURITY_BIN) return process.env.STUDIO_TEST_SECURITY_BIN; // test fixture only
  if (process.platform === 'darwin' && process.env.STUDIO_KEYCHAIN !== '0' && fs.existsSync('/usr/bin/security')) return '/usr/bin/security';
  return null;
}
function sec(args, input) {
  const bin = securityBin(); const env = { PATH: '/usr/bin:/bin', HOME: process.env.HOME || '' };
  if (bin !== '/usr/bin/security') for (const k of ['FAKE_KEYCHAIN_FILE', 'FAKE_KEYCHAIN_ARGV_LOG']) if (process.env[k]) env[k] = process.env[k];
  return spawnSync(bin, args, { input: input || '', stdio: ['pipe', 'pipe', 'ignore'], timeout: 10000, env });
}
const q = s => '"' + String(s).replace(/(["\\])/g, '\\$1') + '"';
function keychainGet() { const r = sec(['find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w']); return r.status === 0 ? String(r.stdout).trim() || null : null; }
function keychainSet(hex) { // argv is only ["-i"]; the command (with the secret) goes over stdin
  const r = sec(['-i'], `add-generic-password -U -s ${q(SERVICE)} -a ${q(ACCOUNT)} -l ${q(SERVICE + ' — master key')} -X ${Buffer.from(hex, 'utf8').toString('hex')}\n`);
  if (r.status !== 0) throw new Error('security add-generic-password failed');
}
function loadKey(dataDir) {
  if (process.env.STUDIO_SECRET_KEY) return { key: crypto.createHash('sha256').update(process.env.STUDIO_SECRET_KEY).digest(), source: 'env' };
  const f = path.join(dataDir, 'secret.key');
  if (securityBin()) {
    let hex = keychainGet();
    if (!hex) { // migrate an existing file key, or create a new one
      hex = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : crypto.randomBytes(32).toString('hex');
      try { keychainSet(hex); if (keychainGet() === hex) { if (fs.existsSync(f)) fs.renameSync(f, f + '.migrated-to-keychain'); } else throw new Error('verify'); }
      catch { if (!fs.existsSync(f)) fs.writeFileSync(f, hex, { mode: 0o600 }); return { key: Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'), source: 'file (Keychain недоступна)' }; }
    }
    return { key: Buffer.from(hex, 'hex'), source: 'keychain' };
  }
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return { key: Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'), source: 'file' };
}
// v1.2.3-test: generic Keychain secrets for the flavor-specific service (TEST: «MOONKATTY AI STUDIO.test»).
// Values go ONLY over stdin of `security -i` (-X hex), never argv. Returns null when no Keychain is available —
// callers must then refuse the operation (no file / DB fallback for these secrets).
const ACCOUNTS = Object.freeze({ publishSeal: 'publish-seal-key' });
const available = () => !!securityBin();
function secretGet(account) { if (!securityBin()) return null; const r = sec(['find-generic-password', '-s', SERVICE, '-a', account, '-w']); return r.status === 0 ? String(r.stdout).trim() || null : null; }
function secretSet(account, value) { if (!securityBin()) throw new Error('Keychain недоступна');
  const r = sec(['-i'], `add-generic-password -U -s ${q(SERVICE)} -a ${q(account)} -l ${q(SERVICE + ' — ' + account)} -X ${Buffer.from(String(value), 'utf8').toString('hex')}\n`);
  if (r.status !== 0 || secretGet(account) !== String(value)) throw new Error('security add-generic-password failed'); }
module.exports = { loadKey, SERVICE, ACCOUNT, ACCOUNTS, available, secretGet, secretSet };
