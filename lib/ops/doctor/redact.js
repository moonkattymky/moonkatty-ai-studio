// System Doctor output redaction. Starts from lib/security.js redact() and adds the
// patterns the audit calls out: Basic auth, Authorization, nk_/sk- tokens, Keychain paths.
'use strict';
const EXTRA = [
  [/\bBasic\s+[A-Za-z0-9+/=]{6,}/gi, 'Basic [REDACTED]'],
  [/authorization\s*[:=]\s*\S+(?:\s+\S+)?/gi, 'Authorization: [REDACTED]'],
  [/\bnk_[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_NK]'],
  [/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_SK]'],
  [/Library\/Keychains\/\S+/gi, 'Library/Keychains/[REDACTED]'],
  [/Keychains[\/\\][^\s'"]+/gi, 'Keychains/[REDACTED]'],
  [/(OPENCODE_SERVER_PASSWORD|OPENCODE_PASSWORD)(\s*[=:]\s*)\S+/g, '$1$2[REDACTED]']
];

function redact(s, sec) {
  const base = sec && typeof sec.redact === 'function' ? sec.redact(s) : String(s ?? '');
  return EXTRA.reduce((t, [re, r]) => t.replace(re, r), base);
}

module.exports = { redact };
