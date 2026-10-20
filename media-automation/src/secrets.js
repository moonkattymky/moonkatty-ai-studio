'use strict';
const { execFile } = require('child_process');
/**
 * Secrets: values are never logged, never written to disk by this module.
 * KeychainSecrets uses macOS `security find-generic-password -s <service> -a <account> -w` (argv only, no shell).
 * EnvSecrets reads MA_SECRET_<NAME> (for tests / CI). ChainSecrets tries in order.
 */
const SERVICE = 'moonkatty-media-automation';
class KeychainSecrets {
  constructor({ service = SERVICE, execFileFn = execFile, platform = process.platform } = {}) { Object.assign(this, { service, execFileFn, platform }); this.name = 'keychain'; }
  get(name) {
    if (this.platform !== 'darwin') return Promise.resolve(null);
    return new Promise(res => this.execFileFn('security', ['find-generic-password', '-s', this.service, '-a', name, '-w'], { timeout: 5000 }, (err, stdout) => res(err ? null : String(stdout).replace(/\n$/, '') || null)));
  }
  /** Store/update a secret via `security -i` (command read from stdin, so the value never appears in argv / ps). */
  set(name, value, { spawnFn = require('child_process').spawn } = {}) {
    if (this.platform !== 'darwin') return Promise.reject(new Error('Keychain write requires macOS'));
    if (/["\\\n]/.test(value) || /["\\\n\s]/.test(name)) return Promise.reject(new Error('unsupported characters in secret'));
    return new Promise((res, rej) => { const p = spawnFn('security', ['-i']); p.on('error', rej); p.on('close', c => c ? rej(new Error('security exit ' + c)) : res(true));
      p.stdin.end(`add-generic-password -U -s ${this.service} -a ${name} -w "${value}"\n`); });
  }
  /** Shown to owner in docs: how to store a secret (interactive prompt, value not in argv/history): */
  static storeCommand(name, service = SERVICE) { return `security add-generic-password -U -s ${service} -a ${name} -w`; }
}
class EnvSecrets {
  constructor(env = process.env) { this.env = env; this.name = 'env'; }
  async get(name) { return this.env['MA_SECRET_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || null; }
}
/** In-memory store (tests / ephemeral). */
class MemorySecrets { constructor(init = {}) { this.m = new Map(Object.entries(init)); this.name = 'memory'; } async get(n) { return this.m.get(n) || null; } async set(n, v) { this.m.set(n, v); return true; } }
class ChainSecrets {
  constructor(list = [new KeychainSecrets(), new EnvSecrets()]) { this.list = list; }
  async get(name) { for (const s of this.list) { const v = await s.get(name); if (v) return v; } return null; }
  /** Writes go to the first writable store (Keychain on macOS). */
  async set(name, value) { for (const s of this.list) if (typeof s.set === 'function') { try { return await s.set(name, value); } catch (e) { if (s === this.list[this.list.length - 1]) throw e; } } throw new Error('no writable secret store (Keychain requires macOS)'); }
  async require(name) { const v = await this.get(name); if (!v) throw new Error(`secret "${name}" not found (Keychain service ${SERVICE} / env MA_SECRET_*)`); return v; }
}
/** Replace any known secret values / bearer tokens / bot tokens in a string. */
function redact(s, secrets = []) {
  let out = String(s);
  for (const v of secrets) if (v && v.length > 3) out = out.split(v).join('***');
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot***').replace(/(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***').replace(/(access_token=)[^&\s]+/g, '$1***');
}
module.exports = { KeychainSecrets, EnvSecrets, MemorySecrets, ChainSecrets, redact, SERVICE };
