'use strict';

/**
 * Три пространства. NEWS и PROJECT не смешиваются.
 * SHARED читают оба по правам: мастер-модель, логотипы, цвета, общие шаблоны, библиотека активов.
 */
const NAMESPACES = Object.freeze(['moonkatty_news', 'moonkatty_project', 'moonkatty_shared']);

/** Постоянный id утверждённой мастер-модели. Один на NEWS, PROJECT, рекламу и остальные студии. */
const MASTER_CHARACTER_ID = 'MOONKATTY_MASTER_CHARACTER';

const SHARED_NAMESPACE = 'moonkatty_shared';

/**
 * Роль доверенного редактора описана в схеме и в политике, но в фазе 1 выключена.
 * Пока флаг false, участник с role=editor не получает ни чтения, ни утверждения.
 */
const EDITORS_ENABLED = false;

/** Итоговое утверждение этих предметов — только владелец. */
const OWNER_FINAL_SUBJECTS = Object.freeze([
  'publication', 'model', 'project_change', 'expense', 'brand_substitution', 'asset'
]);

const CHARACTER_FOLDERS = Object.freeze([
  'references', 'models', 'textures', 'rigs', 'animations', 'outfits', 'renders', 'versions', 'metadata'
]);

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
  ['design3d', 'moonkatty_project', 'write'],
  ['news', 'moonkatty_shared', 'read'],
  ['content', 'moonkatty_shared', 'read'],
  ['video', 'moonkatty_shared', 'read'],
  ['social', 'moonkatty_shared', 'read'],
  ['publishing', 'moonkatty_shared', 'read'],
  ['analytics', 'moonkatty_shared', 'read'],
  ['director', 'moonkatty_shared', 'read'],
  ['director', 'moonkatty_shared', 'write'],
  ['pr', 'moonkatty_shared', 'read'],
  ['games', 'moonkatty_shared', 'read'],
  ['mkty', 'moonkatty_shared', 'read'],
  ['marketing', 'moonkatty_shared', 'read'],
  ['community', 'moonkatty_shared', 'read'],
  ['design3d', 'moonkatty_shared', 'read'],
  ['design3d', 'moonkatty_shared', 'write']
]);

/** Проект в коллекции tasks на main: news | main. */
const RUNTIME_PROJECT = Object.freeze({
  moonkatty_news: 'news',
  moonkatty_project: 'main'
});

/**
 * Идентификаторы проектов для журнала Studio 3.
 * Формат `<пространство>:<slug>`, плюс само пространство moonkatty_shared.
 * Неизвестный id не выбрасывается: resolveProject относит его к unassigned.
 */
const PROJECT_SEEDS = Object.freeze([
  ['moonkatty_project:games', 'moonkatty_project', 'games', 'Игры'],
  ['moonkatty_project:mkty', 'moonkatty_project', 'mkty', 'MKTY'],
  ['moonkatty_project:youtube', 'moonkatty_project', 'youtube', 'YouTube'],
  ['moonkatty_project:ads', 'moonkatty_project', 'ads', 'Реклама'],
  ['moonkatty_news:episodes', 'moonkatty_news', 'episodes', 'Выпуски новостей'],
  ['moonkatty_shared', 'moonkatty_shared', '', 'Общие материалы']
]);

const UNASSIGNED_PROJECT = 'unassigned';

const SCHEMA_VERSION = 4;

module.exports = {
  NAMESPACES, AGENTS, KINDS, OWNER_ONLY_KINDS, AGENT_WRITE_KINDS,
  DEFAULT_GRANTS, RUNTIME_PROJECT, SCHEMA_VERSION,
  MASTER_CHARACTER_ID, SHARED_NAMESPACE, EDITORS_ENABLED, OWNER_FINAL_SUBJECTS,
  CHARACTER_FOLDERS, PROJECT_SEEDS, UNASSIGNED_PROJECT
};
