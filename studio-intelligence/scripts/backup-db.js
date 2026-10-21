'use strict';
const path = require('path');
const { backupDatabase } = require('../src/db-backup');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const dbPath = arg('--db') || path.join(process.cwd(), 'data', 'studio.db');
const backupDir = arg('--dir') || path.join(path.dirname(dbPath), 'backups');
const apply = process.argv.includes('--apply');
const report = backupDatabase({ dbPath, backupDir, apply });
console.log(report.copied ? 'Скопировано: ' + report.dest : 'Только отчёт. Копия не записана: ' + report.dest);
console.log('JSON-копии панели в этом каталоге не изменялись.');
