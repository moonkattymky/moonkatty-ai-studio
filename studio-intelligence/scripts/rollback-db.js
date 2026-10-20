'use strict';
const { rollbackDatabase } = require('../src/db-backup');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

const dbPath = arg('--db');
const from = arg('--from');
if (!dbPath || !from) {
  console.error('Нужны --db и --from. Без --apply файл не меняется.');
  process.exit(1);
}
const apply = process.argv.includes('--apply');
const report = rollbackDatabase({ dbPath, from, apply });
console.log(report.restored ? 'База заменена файлом копии.' : 'Только отчёт. База не изменена.');
console.log(report.dbPath);
console.log(report.from);
