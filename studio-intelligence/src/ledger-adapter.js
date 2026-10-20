'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

const QUERY_KEYS = ['kind', 'direction', 'projectId', 'from', 'to'];

/**
 * Чтение журнала Studio 3. Своих проводок модуль не пишет.
 * listEntries — функция с их сигнатурой. Если её нет, журнал считается неподключённым.
 */
function createLedgerAdapter({ listEntries, projects }) {
  const connected = typeof listEntries === 'function';

  function toQuery(params = {}) {
    const query = {};
    for (const key of QUERY_KEYS) {
      if (params[key] != null && params[key] !== '') query[key] = params[key];
    }
    return query;
  }

  function normalize(row) {
    const item = {
      id: row.id,
      kind: row.kind,
      direction: row.direction,
      amount: row.amount,
      currency: row.currency,
      date: row.date,
      source: row.source,
      proof: row.proof == null ? null : row.proof
    };
    if (row.projectId != null && row.projectId !== '') item.projectId = row.projectId;
    return item;
  }

  function read(query = {}) {
    if (!connected) return [];
    const call = toQuery(query);
    const wide = Object.assign({}, call);
    if (wide.projectId === 'unassigned') delete wide.projectId;
    const fetched = listEntries(wide) || [];
    const out = [];
    for (const raw of fetched) {
      const item = normalize(raw);
      const errors = validate('studio3-ledger-entry', item);
      if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
      if (containsSecret(item.source) || containsSecret(item.proof)) {
        item.source = 'скрыто';
        item.proof = null;
      }
      const project = projects.resolveProject(item.projectId);
      if (call.kind && item.kind !== call.kind) continue;
      if (call.direction && item.direction !== call.direction) continue;
      if (call.from && item.date < call.from) continue;
      if (call.to && item.date >= call.to) continue;
      if (call.projectId === 'unassigned' && project.projectId !== 'unassigned') continue;
      if (call.projectId && call.projectId !== 'unassigned' && project.projectId !== call.projectId && project.rawProjectId !== call.projectId) continue;
      out.push({
        id: item.id,
        kind: item.kind,
        direction: item.direction,
        amount: item.amount,
        currency: item.currency,
        date: item.date,
        source: item.source,
        proof: item.proof,
        project
      });
    }
    return out;
  }

  return { read, connected, toQuery };
}

module.exports = { createLedgerAdapter };
