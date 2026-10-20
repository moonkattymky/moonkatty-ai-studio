'use strict';

/** Два продуктовых пространства. Смешивать записи между ними нельзя. */
const NAMESPACES = Object.freeze(['moonkatty_news', 'moonkatty_project']);

/** Агенты из public/core.js (seed). Владелец — не агент. */
const AGENTS = Object.freeze([
  'director', 'news', 'video', 'social', 'pr', 'games', 'mkty',
  'analytics', 'marketing', 'content', 'publishing', 'community', 'design3d'
]);

const KINDS = Object.freeze([
  'decision', 'task', 'result', 'file', 'model_version', 'publication_version', 'document'
]);

/** Утверждённые решения, версии модели и публикаций пишет только владелец. */
const OWNER_ONLY_KINDS = Object.freeze(['decision', 'model_version', 'publication_version']);

/** Агент может оставить только черновик. Утверждение — отдельное действие владельца. */
const AGENT_WRITE_KINDS = Object.freeze(['task', 'result', 'file']);

/**
 * Наименьшие права по умолчанию.
 * read/write относятся только к таблицам si_*. Общий CRUD `items` этот список не расширяет.
 * У director есть запись черновиков в обоих пространствах, но нет права утверждать.
 */
const DEFAULT_GRANTS = Object.freeze([
  ['news', 'moonkatty_news', 'read'],
  ['news', 'moonkatty_news', 'write'],
  ['content', 'moonkatty_news', 'read'],
  ['video', 'moonkatty_news', 'read'],
  ['video', 'moonkatty_news', 'write'],
  ['director', 'moonkatty_news', 'read'],
  ['director', 'moonkatty_news', 'write'],
  ['director', 'moonkatty_project', 'read'],
  ['director', 'moonkatty_project', 'write'],
  ['analytics', 'moonkatty_news', 'read'],
  ['analytics', 'moonkatty_project', 'read'],
  ['social', 'moonkatty_news', 'read'],
  ['social', 'moonkatty_project', 'read'],
  ['publishing', 'moonkatty_news', 'read'],
  ['publishing', 'moonkatty_project', 'read'],
  ['community', 'moonkatty_project', 'read'],
  ['pr', 'moonkatty_project', 'read'],
  ['pr', 'moonkatty_project', 'write'],
  ['games', 'moonkatty_project', 'read'],
  ['games', 'moonkatty_project', 'write'],
  ['mkty', 'moonkatty_project', 'read'],
  ['marketing', 'moonkatty_project', 'read'],
  ['design3d', 'moonkatty_project', 'read'],
  ['design3d', 'moonkatty_project', 'write']
]);

/** Проект в коллекции tasks на main: news | main. */
const RUNTIME_PROJECT = Object.freeze({
  moonkatty_news: 'news',
  moonkatty_project: 'main'
});

const SCHEMA_VERSION = 1;

module.exports = {
  NAMESPACES, AGENTS, KINDS, OWNER_ONLY_KINDS, AGENT_WRITE_KINDS,
  DEFAULT_GRANTS, RUNTIME_PROJECT, SCHEMA_VERSION
};
