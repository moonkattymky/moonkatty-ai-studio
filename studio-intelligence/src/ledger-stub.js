'use strict';

/**
 * Заглушка чтения журнала Studio 3.
 * Сигнатура совпадает с lib/ops/ledger.listEntries:
 * listEntries({ kind, direction, projectId, from, to }).
 * Граница YYYY-MM-DD включительная, как у их журнала. Граница ISO у to исключает сам момент.
 */
function createLedgerStub(entries) {
  const rows = Array.isArray(entries) ? entries.slice() : [];
  const day = value => String(value || '').slice(0, 10);
  const isDay = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

  function listEntries(query = {}) {
    return rows.filter(row => {
      if (query.kind && row.kind !== query.kind) return false;
      if (query.direction && row.direction !== query.direction) return false;
      if (query.projectId && row.projectId !== query.projectId) return false;
      if (query.from) {
        const ok = isDay(query.from) ? day(row.date) >= query.from : String(row.date) >= query.from;
        if (!ok) return false;
      }
      if (query.to) {
        const ok = isDay(query.to) ? day(row.date) <= query.to : String(row.date) < query.to;
        if (!ok) return false;
      }
      return true;
    }).map(row => Object.assign({}, row));
  }

  return { listEntries };
}

module.exports = { createLedgerStub };
