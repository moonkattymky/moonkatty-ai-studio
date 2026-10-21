'use strict';
const { spawn } = require('child_process');

/** Production Keychain service. The test service is separate so a test item cannot be the live key. */
const SERVICE = 'MOONKATTY AI STUDIO.azure-speech';
const TEST_SERVICE = 'MOONKATTY AI STUDIO.azure-speech-test';
const ACCOUNT = 'azure-speech';
const OWNER_SERVICE = 'MOONKATTY AI STUDIO.azure-speech-owner';
const OWNER_ACCOUNT = 'azure-speech-owner';
const MISSING = 'Azure Speech key is not in the Keychain.';
const MAC_ONLY = 'Azure Speech Keychain is macOS-only.';
const NOT_STORED = 'Azure Speech key was not stored.';
const OWNER_UNREADABLE = 'Azure Speech owner key is not readable by this process.';

function redact(value, secret) {
  let out = String(value == null ? '' : value);
  if (!secret) return out;
  out = out.split(secret).join('[redacted]');
  try { out = out.split(encodeURIComponent(secret)).join('[redacted]'); } catch { /* leave out */ }
  return out;
}

function assertKeyMaterial(key) {
  if (typeof key !== 'string' || key.length === 0) throw new Error('Azure Speech key is empty.');
  if (/[\r\n"'\\]/.test(key)) throw new Error('Azure Speech key contains a character the Keychain writer will not accept.');
}

/**
 * Read a generic password. The secret is returned to the caller and is never
 * copied into an Error, including when `security` writes it to stdout or stderr.
 * This module does not read the environment.
 */
function readKey({ service = SERVICE, account = ACCOUNT, spawnFn = spawn, platform = process.platform } = {}) {
  if (service === OWNER_SERVICE || account === OWNER_ACCOUNT) return Promise.reject(new Error(OWNER_UNREADABLE));
  if (platform !== 'darwin') return Promise.reject(new Error(MAC_ONLY));
  return new Promise((resolve, reject) => {
    let proc;
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new Error(MISSING)); } };
    try { proc = spawnFn('security', ['find-generic-password', '-s', service, '-a', account, '-w']); }
    catch { return fail(); }
    if (!proc || !proc.stdout) return fail();
    let out = '';
    proc.stdout.on('data', d => { out += d; });
    if (proc.stderr) proc.stderr.on('data', () => {});
    proc.on('error', fail);
    proc.on('close', code => {
      if (settled) return;
      if (code !== 0) return fail();
      const key = out.replace(/\r?\n$/, '');
      if (!key) return fail();
      settled = true;
      resolve(key);
    });
  });
}

/**
 * Store a generic password. `security` is spawned as `security -i` and the
 * add-generic-password command, including the secret, is written to stdin.
 * The secret is never placed in argv.
 */
function storeKey(key, { service = SERVICE, account = ACCOUNT, spawnFn = spawn, platform = process.platform, lockdown = false } = {}) {
  if (platform !== 'darwin') return Promise.reject(new Error(MAC_ONLY));
  try { assertKeyMaterial(key); }
  catch (e) { return Promise.reject(e); }
  const acl = lockdown ? ' -T ""' : '';
  const command = `add-generic-password -U -s "${service}" -a "${account}" -w "${key}"${acl}\n`;
  return new Promise((resolve, reject) => {
    let proc;
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(new Error(NOT_STORED)); } };
    try { proc = spawnFn('security', ['-i']); }
    catch { return fail(); }
    if (!proc || !proc.stdin) return fail();
    if (proc.stdout) proc.stdout.on('data', () => {});
    if (proc.stderr) proc.stderr.on('data', () => {});
    proc.on('error', fail);
    proc.on('close', code => {
      if (settled) return;
      settled = true;
      if (code !== 0) reject(new Error(NOT_STORED));
      else resolve({ stored: true });
    });
    proc.stdin.write(command);
    proc.stdin.end();
  });
}

module.exports = {
  SERVICE, TEST_SERVICE, ACCOUNT, OWNER_SERVICE, OWNER_ACCOUNT, readKey, storeKey, redact, MISSING, MAC_ONLY, NOT_STORED, OWNER_UNREADABLE,
};
