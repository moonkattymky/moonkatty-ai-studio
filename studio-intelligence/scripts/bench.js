'use strict';
// Локальный замер Project Memory / FTS. Не ходит в сеть и не трогает data/studio.db.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openStudioIntelligence } = require('../src');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'si-bench-'));
const dbPath = path.join(dir, 'studio.db');
const si = openStudioIntelligence({ dbPath });
const owner = { id: 'igor', role: 'owner', user: 'igor' };
const records = 2000;
const body = 'Утверждённая мастер-модель кота MOONKATTY и сюжет выпуска. ';

const t0 = process.hrtime.bigint();
for (let i = 0; i < records; i++) {
  si.memory.put({
    principal: owner,
    record: {
      namespace: i % 2 ? 'moonkatty_news' : 'moonkatty_project',
      kind: 'document',
      title: `Запись ${i} про кота и новости`,
      body: body.repeat(20) + ' номер ' + i,
      status: 'approved',
      sourcePath: `bench/doc-${i}.md`,
      idempotencyKey: `bench/doc/${i}`,
      payload: { i }
    }
  });
}
const insertMs = Number(process.hrtime.bigint() - t0) / 1e6;

const q0 = process.hrtime.bigint();
const queries = 40;
let hits = 0;
for (let i = 0; i < queries; i++) {
  hits += si.retrieval.search({ principal: owner, query: 'мастер-модель кота', limit: 8 }).citations.length;
}
const searchMs = Number(process.hrtime.bigint() - q0) / 1e6 / queries;
const rss = process.memoryUsage().rss;
const dbBytes = fs.readdirSync(dir).filter(name => name.startsWith('studio.db')).reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
si.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(JSON.stringify({
  node: process.version,
  platform: `${os.platform()} ${os.arch()} ${os.cpus()[0] && os.cpus()[0].model}`,
  cpus: os.cpus().length,
  records,
  insertMs: Math.round(insertMs),
  perRecordMs: Math.round(insertMs / records * 100) / 100,
  searchMs: Math.round(searchMs * 100) / 100,
  hitsPerQuery: hits / queries,
  dbBytes,
  rssBytes: rss
}, null, 2));
