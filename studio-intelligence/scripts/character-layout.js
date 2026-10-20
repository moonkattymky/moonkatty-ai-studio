'use strict';
const { inspectCharacterLayout, BLEND_NAME } = require('../src/character-layout');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function repeated(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const apply = process.argv.includes('--apply');
const root = arg('--root');
const scans = repeated('--scan');
const report = inspectCharacterLayout({ root: root || undefined, apply, scans });

console.log(report.dryRun ? 'Режим: только отчёт. Файлы не переносятся и не создаются.' : 'Режим: создаются только недостающие каталоги.');
console.log('Корень: ' + report.root);
console.log('');
console.log(BLEND_NAME);
if (!report.blends.length) console.log('  не найден');
for (const item of report.blends) {
  console.log('  ' + item.path);
  console.log('  sha256=' + (item.sha256 || 'не посчитан'));
}
console.log('');
console.log('references');
if (!report.references.length) console.log('  не найдены');
for (const item of report.references) {
  console.log('  ' + item.path);
  console.log('  sha256=' + (item.sha256 || 'не посчитан'));
}
if (report.errors.length) {
  console.log('');
  console.log('Не тронуто:');
  for (const line of report.errors) console.log('  ' + line);
}
console.log('');
console.log('Каталоги CHARACTERS/MASTER:');
for (const folder of report.folders) console.log('  ' + folder.action + '  ' + folder.path);
console.log('');
console.log('Эти пути передайте основной студии. Реестр памяти сам модель не создаёт.');
