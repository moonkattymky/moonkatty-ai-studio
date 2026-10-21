'use strict';

/**
 * Грубый отказ от секретов в памяти и в индексе документов.
 * Совпадает по смыслу с редактированием журнала в lib/security.js (ветка безопасности),
 * но не заменяет его: сюда секрет не должен попасть даже в зашифрованном виде поля.
 */
const SECRET = /access_token|client_secret|appsecret|authorization\s*:|"password"\s*:|password\s*=|bearer\s+[a-z0-9._~+/-]{8,}|\bEA[A-Za-z0-9]{20,}\b|\b(ghp_|github_pat_)[a-z0-9_]{10,}/i;

function containsSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return SECRET.test(text || '');
}

module.exports = { containsSecret };
