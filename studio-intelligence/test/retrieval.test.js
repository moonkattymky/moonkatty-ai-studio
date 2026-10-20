'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setup, decision } = require('./helpers');

test('поиск возвращает цитату с id, путём и версией и не выдумывает ответ', () => {
  const { si, owner, agent } = setup();
  const saved = si.memory.put({ principal: owner, record: decision() });
  const found = si.retrieval.search({ principal: owner, query: 'мастер-модель кота', namespace: 'moonkatty_project' });
  assert.equal(found.citations.length, 1);
  assert.equal(found.citations[0].recordId, saved.id);
  assert.equal(found.citations[0].filePath, null);
  assert.equal(found.citations[0].version, 1);
  assert.match(found.answer, /\[1\]/);
  const empty = si.retrieval.search({ principal: owner, query: 'несуществующий пароход', namespace: 'moonkatty_project' });
  assert.deepEqual(empty.citations, []);
  assert.equal(empty.answer, 'В разрешённой области ничего не найдено.');
  const leaked = si.retrieval.search({ principal: agent('news'), query: 'мастер-модель' });
  assert.deepEqual(leaked.citations, []);
  assert.throws(
    () => si.retrieval.search({ principal: agent('news'), query: 'мастер-модель', namespace: 'moonkatty_project' }),
    err => err.code === 'PERMISSION_DENIED'
  );
  si.close();
});

test('индекс документов цитирует файл и не показывает чужое пространство', () => {
  const { si, owner, agent } = setup();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-docs-'));
  fs.mkdirSync(path.join(root, 'news'), { recursive: true });
  fs.writeFileSync(path.join(root, 'news', 'brief.md'), '# Выпуск\n\nСюжет про лунную базу подтверждён двумя источниками.\n');
  fs.writeFileSync(path.join(root, 'brand.md'), '# Бренд\n\nУтверждённая палитра MOONKATTY и мастер-модель кота.\n');
  fs.writeFileSync(path.join(root, 'leak.md'), 'token access_token=supersecretvalue\n');
  const report = si.retrieval.indexDocs({ principal: owner, root });
  assert.ok(report.indexed >= 2);
  assert.ok(report.skipped.some(item => item.reason === 'secret'));
  const again = si.retrieval.indexDocs({ principal: owner, root });
  assert.equal(again.unchanged, report.indexed);
  const newsHit = si.retrieval.search({ principal: agent('news'), query: 'лунную базу' });
  assert.equal(newsHit.citations.length, 1);
  assert.equal(newsHit.citations[0].namespace, 'moonkatty_news');
  assert.equal(newsHit.citations[0].filePath, 'news/brief.md');
  assert.ok(newsHit.citations[0].version >= 1);
  assert.match(newsHit.answer, /news\/brief\.md|Выпуск|лунн/);
  const projectHit = si.retrieval.search({ principal: agent('games'), query: 'палитра' });
  assert.equal(projectHit.citations[0].filePath, 'brand.md');
  assert.equal(projectHit.citations[0].namespace, 'moonkatty_project');
  assert.throws(() => si.retrieval.indexDocs({ principal: agent('director'), root }), err => err.code === 'PERMISSION_DENIED');
  fs.writeFileSync(path.join(root, 'brand.md'), '# Бренд\n\nНовая утверждённая палитра индиго.\n');
  const updated = si.retrieval.indexDocs({ principal: owner, root });
  assert.ok(updated.updated >= 1);
  const fresh = si.retrieval.search({ principal: owner, query: 'индиго', namespace: 'moonkatty_project' });
  assert.equal(fresh.citations.length, 1);
  assert.ok(fresh.citations[0].version >= 2);
  const stale = si.retrieval.search({ principal: owner, query: 'мастер-модель кота', namespace: 'moonkatty_project' });
  assert.equal(stale.citations.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
  si.close();
});

test('сократившийся документ снимает лишний фрагмент', () => {
  const { si, owner } = setup();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'si-docs-'));
  const body = ['# Один', 'альфа '.repeat(400), '# Два', 'бета уникальнаяметра'].join('\n');
  fs.writeFileSync(path.join(root, 'long.md'), body);
  si.retrieval.indexDocs({ principal: owner, root });
  assert.ok(si.retrieval.search({ principal: owner, query: 'уникальнаяметра' }).citations.length >= 1);
  fs.writeFileSync(path.join(root, 'long.md'), '# Один\n\nТолько альфа осталась в файле.\n');
  const report = si.retrieval.indexDocs({ principal: owner, root });
  assert.ok(report.superseded >= 1);
  assert.equal(si.retrieval.search({ principal: owner, query: 'уникальнаяметра' }).citations.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
  si.close();
});
