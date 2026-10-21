'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');

/**
 * Контракт конвейеров. run() намеренно не исполняет шаги:
 * исполнение — Agent Runtime (dev #1) и медиа-модуль (dev #2), не этот пакет.
 * Шаг с утверждением владельца никогда не помечен autoExecute.
 */
const PIPELINES = [
  {
    id: 'news',
    namespace: 'moonkatty_news',
    title: 'Новости: поиск → фактчек → сценарий → видео → QA → утверждение → публикация → аналитика',
    steps: [
      { id: 'search', agentId: 'news', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'factcheck', agentId: 'news', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'script', agentId: 'news', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'video', agentId: 'video', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'qa', agentId: 'director', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'approval', agentId: 'owner', requiresOwnerApproval: true, autoExecute: false, executor: 'human' },
      { id: 'publish', agentId: 'publishing', requiresOwnerApproval: true, autoExecute: false, executor: 'human' },
      { id: 'analytics', agentId: 'analytics', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' }
    ]
  },
  {
    id: 'studio3d',
    namespace: 'moonkatty_project',
    title: '3D: референсы → модель → материалы → анимация → рендер → сверка сходства → утверждение',
    steps: [
      { id: 'references', agentId: 'design3d', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'model', agentId: 'design3d', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'materials', agentId: 'design3d', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'animation', agentId: 'design3d', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'render', agentId: 'design3d', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'likeness', agentId: 'director', requiresOwnerApproval: true, autoExecute: false, executor: 'human' },
      { id: 'approval', agentId: 'owner', requiresOwnerApproval: true, autoExecute: false, executor: 'human' }
    ]
  },
  {
    id: 'games',
    namespace: 'moonkatty_project',
    title: 'Игры: тест → баг → исправление → повторный тест → утверждение',
    steps: [
      { id: 'test', agentId: 'games', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'bug_found', agentId: 'games', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'fix', agentId: 'games', requiresOwnerApproval: true, autoExecute: false, executor: 'opencode' },
      { id: 'retest', agentId: 'games', requiresOwnerApproval: false, autoExecute: true, executor: 'runtime' },
      { id: 'approval', agentId: 'owner', requiresOwnerApproval: true, autoExecute: false, executor: 'human' }
    ]
  }
];

function validation(errors) {
  throw new StudioError('VALIDATION', errors[0] || 'Некорректный сценарий', { retryable: false, details: { errors } });
}

function validatePipeline(spec) {
  const errors = validate('workflow-pipeline', spec);
  if (errors.length) validation(errors);
  for (const step of spec.steps) {
    if (step.requiresOwnerApproval && step.autoExecute !== false) {
      validation([`${step.id}: шаг владельца нельзя исполнять автоматически`]);
    }
    if (step.executor === 'opencode' && (!step.requiresOwnerApproval || step.autoExecute !== false)) {
      validation([`${step.id}: OpenCode требует утверждения владельца и не запускается сам`]);
    }
    if (step.executor === 'human' && step.autoExecute !== false) {
      validation([`${step.id}: ручной шаг нельзя исполнять автоматически`]);
    }
  }
  return spec;
}

for (const pipeline of PIPELINES) validatePipeline(pipeline);

function describe(id) {
  const found = PIPELINES.find(item => item.id === id);
  if (!found) throw new StudioError('NOT_FOUND', 'Сценарий не описан: ' + id, { retryable: false });
  return JSON.parse(JSON.stringify(found));
}

function run() {
  throw new StudioError('NOT_IMPLEMENTED', 'Движок сценариев описан контрактом и не исполняет шаги.', { retryable: false });
}

module.exports = { PIPELINES, validatePipeline, describe, run };
