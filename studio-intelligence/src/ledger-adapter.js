'use strict';
const { StudioError } = require('./errors');
const { validate } = require('./validate');
const { containsSecret } = require('./secrets');

const QUERY_KEYS = ['kind', 'direction', 'projectId', 'from', 'to'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)Z$/;

/**
 * Чтение журнала Studio 3. Своих проводок модуль не пишет.
 * listEntries — их функция. Если её нет, журнал считается неподключённым.
 * Их сравнение дат — включительное по строке YYYY-MM-DD. Сюда период приходит
 * полуинтервалом ISO. toQuery переводит границы, read оставляет полуинтервал.
 */
function createLedgerAdapter({ listEntries, projects }) {
  const connected = typeof listEntries === 'function';

  function ledgerDay(value, end) {
    if (value == null || value === '') return undefined;
    const text = String(value);
    if (DAY.test(text)) return text;
    const match = ISO.exec(text);
    if (!match) return undefined;
    const midnight = /^00:00:00(?:\.0{1,3})?$/.test(match[2]);
    if (end && midnight) {
      return new Date(Date.parse(match[1] + 'T00:00:00.000Z') - 86400000).toISOString().slice(0, 10);
    }
    return match[1];
  }

  function toQuery(params = {}) {
    const query = {};
    for (const key of QUERY_KEYS) {
      if (params[key] == null || params[key] === '') continue;
      if (key === 'from') {
        const day = ledgerDay(params.from, false);
        if (day) query.from = day;
      } else if (key === 'to') {
        const day = ledgerDay(params.to, true);
        if (day) query.to = day;
      } else query[key] = params[key];
    }
    return query;
  }

  function amountOf(row) {
    if (Number.isInteger(row.amountMinor) && row.amountMinor > 0) return row.amountMinor / 100;
    if (typeof row.amount === 'number' && Number.isFinite(row.amount)) return row.amount;
    if (typeof row.amount === 'string' && /^\d+(\.\d+)?$/.test(row.amount.trim())) return Number(row.amount);
    return row.amount;
  }

  function proofOf(proof) {
    if (proof == null || proof === '') return null;
    if (typeof proof === 'string') return proof;
    if (typeof proof === 'object') {
      const out = {};
      if (proof.type != null) out.type = String(proof.type);
      if (proof.ref != null) out.ref = String(proof.ref);
      if (typeof proof.sha256 === 'string' && /^[a-f0-9]{64}$/.test(proof.sha256)) out.sha256 = proof.sha256;
      return Object.keys(out).length ? out : null;
    }
    return null;
  }

  function normalize(row) {
    const dateOnly = typeof row.date === 'string' && DAY.test(row.date);
    const item = {
      id: row.id,
      kind: row.kind,
      direction: row.direction,
      amount: amountOf(row),
      currency: typeof row.currency === 'string' ? row.currency.toUpperCase() : row.currency,
      date: dateOnly ? row.date + 'T00:00:00.000Z' : row.date,
      source: row.source ? String(row.source) : 'manual',
      proof: proofOf(row.proof)
    };
    if (row.projectId != null && row.projectId !== '') item.projectId = String(row.projectId).slice(0, 140);
    return { item, dateOnly };
  }

  function inWindow(date, from, to, dateOnly) {
    if (dateOnly) {
      const start = date.slice(0, 10) + 'T00:00:00.000Z';
      const end = new Date(Date.parse(start) + 86400000).toISOString();
      if (from && end <= from) return false;
      if (to && start >= to) return false;
      return true;
    }
    if (from && date < from) return false;
    if (to && date >= to) return false;
    return true;
  }

  function read(query = {}) {
    if (!connected) return [];
    const call = toQuery(query);
    const wide = Object.assign({}, call);
    if (wide.projectId === 'unassigned') delete wide.projectId;
    const fetched = listEntries(wide) || [];
    const out = [];
    for (const raw of fetched) {
      const { item, dateOnly } = normalize(raw);
      const errors = validate('studio3-ledger-entry', item);
      if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
      if (containsSecret(item.source) || containsSecret(item.proof)) {
        item.source = 'скрыто';
        item.proof = null;
      }
      const project = projects.resolveProject(item.projectId);
      if (call.kind && item.kind !== call.kind) continue;
      if (call.direction && item.direction !== call.direction) continue;
      if (!inWindow(item.date, query.from, query.to, dateOnly)) continue;
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
