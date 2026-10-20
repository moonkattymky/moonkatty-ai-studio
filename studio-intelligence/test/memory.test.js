'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, decision } = require('./helpers');

test('владелец пишет утверждённое решение, агент — нет', () => {
  const { si, owner, agent } = setup();
  const saved = si.memory.put({ principal: owner, record: decision() });
  assert.equal(saved.status, 'approved');
  assert.equal(saved.version, 1);
  assert.equal(saved.approvedBy, 'igor');
  assert.equal(saved.namespace, 'moonkatty_project');
  assert.throws(() => si.memory.put({ principal: agent('news'), record: decision({ idempotencyKey: 'decision/other' }) }), err => err.code === 'PERMISSION_DENIED');
  si.close();
});

test('повтор того же ключа возвращает ту же запись, другое тело — конфликт', () => {
  const { si, owner } = setup();
  const first = si.memory.put({ principal: owner, record: decision() });
  const again = si.memory.put({ principal: owner, record: decision() });
  assert.equal(again.id, first.id);
  assert.throws(
    () => si.memory.put({ principal: owner, record: decision({ body: 'Другой текст решения.' }) }),
    err => err.code === 'IDEMPOTENCY_CONFLICT'
  );
  si.close();
});

test('смена статуса тем же ключом создаёт новую версию и снимает старую с поиска', () => {
  const { si, owner } = setup();
  const draft = si.memory.put({
    principal: owner,
    record: decision({ status: 'draft', idempotencyKey: 'decision/brand/v' })
  });
  assert.equal(draft.approvedBy, null);
  const approved = si.memory.put({
    principal: owner,
    versionPolicy: 'bump',
    record: decision({ status: 'approved', idempotencyKey: 'decision/brand/v' })
  });
  assert.equal(approved.version, 2);
  assert.equal(approved.supersedes, draft.id);
  assert.equal(si.memory.get({ principal: owner, id: draft.id }).status, 'superseded');
  const listed = si.memory.list({ principal: owner, namespace: 'moonkatty_project', kind: 'decision' });
  assert.deepEqual(listed.map(item => item.id), [approved.id]);
  si.close();
});

test('пространства не смешиваются: news не видит проект, games не видит новости', () => {
  const { si, owner, agent } = setup();
  const project = si.memory.put({ principal: owner, record: decision() });
  const news = si.memory.put({
    principal: owner,
    record: decision({
      namespace: 'moonkatty_news',
      title: 'Фактчек выпуска подтверждён',
      body: 'Сюжет выпуска MOONKATTY NEWS проверен по двум источникам.',
      idempotencyKey: 'decision/news/factcheck'
    })
  });
  assert.throws(() => si.memory.get({ principal: agent('news'), id: project.id }), err => err.code === 'NOT_FOUND');
  assert.equal(si.memory.get({ principal: agent('news'), id: news.id }).id, news.id);
  assert.throws(() => si.memory.list({ principal: agent('games'), namespace: 'moonkatty_news' }), err => err.code === 'PERMISSION_DENIED');
  assert.equal(si.memory.list({ principal: agent('games'), namespace: 'moonkatty_project' }).length, 1);
  const visible = si.memory.list({ principal: agent('publishing'), namespace: 'moonkatty_news' });
  assert.equal(visible.length, 1);
  assert.throws(
    () => si.memory.put({
      principal: agent('publishing'),
      record: { namespace: 'moonkatty_news', kind: 'result', title: 'Черновик', body: 'текст', status: 'draft', idempotencyKey: 'result/pub/1', payload: {} }
    }),
    err => err.code === 'PERMISSION_DENIED'
  );
  si.close();
});

test('агент пишет только свой черновик и не утверждает его', () => {
  const { si, owner, agent } = setup();
  const draft = si.memory.put({
    principal: agent('news'),
    record: {
      namespace: 'moonkatty_news', kind: 'task', title: 'Собрать сюжеты', body: 'Источники за утро.',
      status: 'draft', idempotencyKey: 'task/news/morning', payload: {}
    }
  });
  assert.equal(draft.createdBy, 'news');
  assert.equal(draft.status, 'draft');
  assert.throws(() => si.memory.get({ principal: agent('content'), id: draft.id }), err => err.code === 'NOT_FOUND');
  assert.equal(si.memory.get({ principal: agent('news'), id: draft.id }).id, draft.id);
  assert.equal(si.memory.list({ principal: agent('news'), namespace: 'moonkatty_news' }).length, 0);
  assert.equal(si.memory.list({ principal: agent('news'), namespace: 'moonkatty_news', history: true }).length, 1);
  assert.throws(
    () => si.memory.put({
      principal: agent('news'),
      record: {
        namespace: 'moonkatty_news', kind: 'task', title: 'Собрать сюжеты', body: 'Источники за утро.',
        status: 'approved', idempotencyKey: 'task/news/approved', payload: {}
      }
    }),
    err => err.code === 'PERMISSION_DENIED'
  );
  const model = si.memory.put({
    principal: owner,
    record: {
      namespace: 'moonkatty_project', kind: 'model_version', title: 'qwen3:8b', body: 'Локальная модель Director.',
      status: 'approved', idempotencyKey: 'model/ollama/qwen3-8b', payload: { model: 'qwen3:8b' }
    }
  });
  assert.equal(model.kind, 'model_version');
  assert.throws(() => si.memory.put({
    principal: agent('director'),
    record: {
      namespace: 'moonkatty_project', kind: 'publication_version', title: 'Выпуск 1', body: 'Не утверждено.',
      status: 'draft', idempotencyKey: 'pub/1', payload: {}
    }
  }), err => err.code === 'PERMISSION_DENIED');
  si.close();
});

test('секрет не записывается', () => {
  const { si, owner } = setup();
  assert.throws(() => si.memory.put({
    principal: owner,
    record: decision({ body: 'access_token=EAABsecretvalue1234567890', idempotencyKey: 'decision/secret' })
  }), err => err.code === 'SECRET_REJECTED');
  si.close();
});

test('прогресс только добавляется', () => {
  const { si, owner, agent } = setup();
  const event = si.progress.append({
    principal: agent('news'),
    event: {
      id: 'prog1', taskId: 'task_1', namespace: 'moonkatty_news', kind: 'started',
      message: 'Агент взял задачу', actorId: 'news', pct: 0
    }
  });
  assert.equal(event.at, '2026-10-20T12:00:00.000Z');
  const replay = si.progress.append({
    principal: agent('news'),
    event: {
      id: 'prog1', taskId: 'task_1', namespace: 'moonkatty_news', kind: 'started',
      message: 'Агент взял задачу', actorId: 'news', pct: 0
    }
  });
  assert.equal(replay.id, event.id);
  assert.throws(() => si.progress.append({
    principal: agent('news'),
    event: { id: 'prog1', taskId: 'task_1', namespace: 'moonkatty_news', kind: 'done', message: 'Другое', actorId: 'news' }
  }), err => err.code === 'IDEMPOTENCY_CONFLICT');
  assert.throws(() => si.progress.append({
    principal: agent('analytics'),
    event: { id: 'prog2', taskId: 'task_1', namespace: 'moonkatty_news', kind: 'progress', message: 'Счёт', actorId: 'analytics' }
  }), err => err.code === 'PERMISSION_DENIED');
  assert.equal(si.progress.list({ principal: owner, namespace: 'moonkatty_news', taskId: 'task_1' }).length, 1);
  assert.equal(typeof si.progress.update, 'undefined');
  assert.equal(typeof si.progress.delete, 'undefined');
  si.close();
});
