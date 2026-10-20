'use strict';

/**
 * Заглушка чтения журнала Studio 3.
 * Сигнатура совпадает с lib/ops/ledger.listEntries и с GET /api/ops/ledger:
 * listEntries({ kind, direction, projectId, from, to }).
 * Модуль lib/ops/ledger на ветке операций ещё не запушен — вызов идёт через эту функцию.
 */
function createLedgerStub(entries) {
  const rows = Array.isArray(entries) ? entries.slice() : [];

  function listEntries(query = {}) {
    return rows.filter(row => {
      if (query.kind && row.kind !== query.kind) return false;
      if (query.direction && row.direction !== query.direction) return false;
      if (query.projectId && row.projectId !== query.projectId) return false;
      if (query.from && row.date < query.from) return false;
      if (query.to && row.date >= query.to) return false;
      return true;
    }).map(row => Object.assign({}, row));
  }

  return { listEntries };
}

module.exports = { createLedgerStub };
