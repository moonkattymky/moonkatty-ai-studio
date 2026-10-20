'use strict';
const { openStudioIntelligence } = require('./index');
const { RUNTIME_PROJECT } = require('./constants');
const { StudioError } = require('./errors');

/**
 * Стык с существующим server.js. Сам server.js не импортируется и не монтирует маршруты.
 * Хост передаёт уже открытую базу и свою функцию журнала.
 */
function attach(db, { log, ledger, now } = {}) {
  if (!db) {
    throw new StudioError('VALIDATION', 'Нужна уже открытая база панели. Новый файл здесь не выбирается.', { retryable: false });
  }
  return openStudioIntelligence({
    db,
    auditLog: typeof log === 'function' ? log : undefined,
    ledger,
    now
  });
}

function panelProject(namespace) {
  return RUNTIME_PROJECT[namespace] || null;
}

/** Описание маршрутов, которые хост добавит сам. Этот модуль их не регистрирует. */
function describeRoutes() {
  return [
    {
      method: 'GET',
      path: '/api/ops/ledger',
      owner: 'studio-3',
      note: 'Чтение журнала денег. Память только вызывает listEntries с теми же полями.'
    }
  ];
}

module.exports = { attach, panelProject, describeRoutes };
