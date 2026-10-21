'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { CHARACTER_FOLDERS } = require('./constants');

const BLEND_NAME = 'MOONKATTY_MASTER.blend';
const REF_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff']);

function defaultRoot() {
  return path.join(os.homedir(), 'Documents', 'MOONKATTY-ASSETS');
}

function fileSha256(full) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(full, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function remember(found, full) {
  if (found.some(item => item.path === full)) return;
  let sha256 = null;
  let error = null;
  try { sha256 = fileSha256(full); } catch (err) { error = err.message; }
  found.push({ path: full, sha256, error });
}

function walkFiles(dir, blends, references, depth) {
  if (depth > 8) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const inReferences = dir.split(path.sep).includes('references');
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, blends, references, depth + 1);
    else if (ent.isFile() && ent.name === BLEND_NAME) remember(blends, full);
    else if (ent.isFile() && inReferences && REF_EXT.has(path.extname(ent.name).toLowerCase())) remember(references, full);
  }
}

/**
 * Целевая раскладка персонажа. По умолчанию только отчёт.
 * Создаёт недостающие каталоги и никогда не переносит и не перезаписывает файлы.
 */
function inspectCharacterLayout({ root, apply = false, scans = [] } = {}) {
  const base = root || defaultRoot();
  const master = path.join(base, 'CHARACTERS', 'MASTER');
  const report = { root: base, master, apply: !!apply, dryRun: !apply, folders: [], blends: [], references: [], errors: [] };
  const roots = [base].concat(scans);
  for (const dir of roots) {
    if (fs.existsSync(dir)) walkFiles(dir, report.blends, report.references, 0);
  }
  for (const name of CHARACTER_FOLDERS) {
    const full = path.join(master, name);
    let action = 'would_create';
    if (fs.existsSync(full)) {
      const stat = fs.statSync(full);
      if (!stat.isDirectory()) {
        report.errors.push(full + ' существует и это не каталог. Файл не тронут.');
        action = 'blocked';
      } else action = 'exists';
    } else if (apply) {
      fs.mkdirSync(full, { recursive: true });
      action = 'created';
    }
    report.folders.push({ name, path: full, action });
  }
  return report;
}

module.exports = { inspectCharacterLayout, defaultRoot, BLEND_NAME, CHARACTER_FOLDERS };
