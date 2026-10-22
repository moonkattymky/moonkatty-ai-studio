// SHA-256 of application files. codesign --verify is macOS-only and read-only.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const DEFAULT_FILES = ['server.js', 'package.json', 'lib/security.js', 'lib/ops/doctor/mount.js'];

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashTree(root, files) {
  const out = {};
  for (const rel of files) {
    if (rel.includes('..') || path.isAbsolute(rel)) throw Object.assign(new Error('Плохой путь манифеста'), { code: 'FORBIDDEN' });
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) { out[rel] = null; continue; }
    out[rel] = sha256File(abs);
  }
  return out;
}

function verify(root, manifest, files = DEFAULT_FILES) {
  const hashes = hashTree(root, files);
  if (!manifest) {
    return { id: 'files', status: 'BLOCKED', summary: 'Нет подписанного манифеста файлов — хеши посчитаны, сверка не выполнялась', data: { hashes } };
  }
  const expected = manifest.files || manifest;
  const problems = [];
  for (const rel of Object.keys(expected)) {
    if (hashes[rel] == null) problems.push(rel + ': нет файла');
    else if (hashes[rel] !== expected[rel]) problems.push(rel + ': хеш не совпал');
  }
  return {
    id: 'files',
    status: problems.length ? 'FAIL' : 'OK',
    summary: problems.length ? problems.slice(0, 3).join('; ') : 'Хеши совпали с манифестом',
    data: { hashes, problems }
  };
}

function codesign() {
  if (process.platform !== 'darwin') {
    return { id: 'codesign', status: 'BLOCKED', summary: 'codesign --verify доступен только на macOS', data: { platform: process.platform } };
  }
  return { id: 'codesign', status: 'BLOCKED', summary: 'Путь к .app не задан — проверка подписи не запускалась', data: {} };
}

module.exports = { verify, codesign, sha256File, hashTree, DEFAULT_FILES };
