'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Копия файла data/studio.db рядом с JSON-копиями панели.
 * JSON-бэкап коллекций не трогается и не заменяется.
 * По умолчанию только отчёт. Запись — с apply: true.
 */
function backupDatabase({ dbPath, backupDir, apply = false, now = () => new Date().toISOString(), keep = 14 } = {}) {
  if (!dbPath || !backupDir) throw new Error('Нужны dbPath и backupDir');
  const stamp = now().replace(/[:.]/g, '-');
  const name = 'studio-db-' + stamp + '.sqlite';
  const dest = path.join(backupDir, name);
  const report = { dbPath, backupDir, dest, apply: !!apply, copied: false, removed: [] };
  if (!apply) return report;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(dbPath, dest);
  for (const suffix of ['-wal', '-shm']) {
    const side = dbPath + suffix;
    if (fs.existsSync(side)) fs.copyFileSync(side, dest + suffix);
  }
  report.copied = true;
  const own = fs.readdirSync(backupDir).filter(file => file.startsWith('studio-db-') && file.endsWith('.sqlite')).sort();
  for (const file of own.slice(0, Math.max(0, own.length - keep))) {
    fs.rmSync(path.join(backupDir, file), { force: true });
    report.removed.push(file);
  }
  return report;
}

/**
 * Возвращает файл базы из копии. По умолчанию ничего не пишет.
 * JSON-файлы backup-*.json не читаются и не удаляются.
 */
function rollbackDatabase({ dbPath, from, apply = false } = {}) {
  if (!dbPath || !from) throw new Error('Нужны dbPath и from');
  const report = { dbPath, from, apply: !!apply, restored: false };
  if (!apply) return report;
  if (!fs.existsSync(from)) throw new Error('Файл копии не найден');
  for (const suffix of ['-wal', '-shm']) {
    const side = dbPath + suffix;
    if (fs.existsSync(side)) fs.rmSync(side);
  }
  fs.copyFileSync(from, dbPath);
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(from + suffix)) fs.copyFileSync(from + suffix, dbPath + suffix);
  }
  report.restored = true;
  return report;
}

module.exports = { backupDatabase, rollbackDatabase };
