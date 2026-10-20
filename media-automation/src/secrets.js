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
  /** Shown to owner in docs: how to store a secret (interactive prompt, value not in argv/history): */
  static storeCommand(name, service = SERVICE) { return `security add-generic-password -U -s ${service} -a ${name} -w`; }
}
class EnvSecrets {
  constructor(env = process.env) { this.env = env; this.name = 'env'; }
  async get(name) { return this.env['MA_SECRET_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_')] || null; }
}
class ChainSecrets {
  constructor(list = [new KeychainSecrets(), new EnvSecrets()]) { this.list = list; }
  async get(name) { for (const s of this.list) { const v = await s.get(name); if (v) return v; } return null; }
  async require(name) { const v = await this.get(name); if (!v) throw new Error(`secret "${name}" not found (Keychain service ${SERVICE} / env MA_SECRET_*)`); return v; }
}
/** Replace any known secret values / bearer tokens / bot tokens in a string. */
function redact(s, secrets = []) {
  let out = String(s);
  for (const v of secrets) if (v && v.length > 3) out = out.split(v).join('***');
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, 'bot***').replace(/(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***').replace(/(access_token=)[^&\s]+/g, '$1***');
}
module.exports = { KeychainSecrets, EnvSecrets, ChainSecrets, redact, SERVICE };
