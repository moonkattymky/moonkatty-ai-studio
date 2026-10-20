'use strict';
const crypto = require('crypto');
const { NAMESPACES } = require('./constants');
const { StudioError } = require('./errors');
const { validate } = require('./validate');

function sqlList(values, allowed) {
  if (values.some(value => !allowed.includes(value))) {
    throw new StudioError('VALIDATION', 'Некорректный фильтр отчёта', { retryable: false });
  }
  return values.map(value => `'${value}'`).join(', ');
}

function emptyBucket() {
  return { entries: 0, expenseUsd: 0, incomeUsd: 0 };
}

function createReports(db, { now, permissions, ledger }) {
  const insertHealth = db.prepare(`INSERT INTO si_health_samples (id, at, component, ok, detail, actor_id) VALUES (?, ?, ?, ?, ?, ?)`);

  function readable(principal) {
    const actor = permissions.normalize(principal);
    if (actor.role === 'owner') return NAMESPACES.slice();
    return NAMESPACES.filter(namespace => permissions.canReadNamespace(actor, namespace));
  }

  function recordCost() {
    throw new StudioError('NOT_IMPLEMENTED', 'Деньги ведёт журнал студии 3: lib/ops/ledger.listEntries и GET /api/ops/ledger. Таблица si_cost_entries не пополняется.', { retryable: false });
  }

  function recordHealth({ principal, sample }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Состояние компонентов записывает владелец', { retryable: false });
    const errors = validate('health-sample', sample);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    const rowId = crypto.randomBytes(12).toString('hex');
    insertHealth.run(rowId, sample.at || now(), sample.component, sample.ok ? 1 : 0, sample.detail || null, actor.id);
    return { id: rowId, component: sample.component, ok: !!sample.ok, at: sample.at || now() };
  }

  function count(sql, params) {
    return Number(db.prepare(sql).get(...params).n);
  }

  function daily({ principal, from, to, compact = false }) {
    const actor = permissions.normalize(principal);
    const namespaces = readable(actor);
    if (!namespaces.length) throw new StudioError('PERMISSION_DENIED', 'Нет доступа к отчёту', { retryable: false });
    if (!/^\d{4}-\d{2}-\d{2}T/.test(from) || !/^\d{4}-\d{2}-\d{2}T/.test(to)) {
      throw new StudioError('VALIDATION', 'Нужны границы периода в ISO-8601', { retryable: false });
    }
    const ns = sqlList(namespaces, NAMESPACES);
    const tasks = count(`SELECT COUNT(*) AS n FROM si_records WHERE namespace IN (${ns}) AND kind = 'task' AND created_at >= ? AND created_at < ?`, [from, to]);
    const progressEvents = count(`SELECT COUNT(*) AS n FROM si_progress WHERE namespace IN (${ns}) AND at >= ? AND at < ?`, [from, to]);
    const failedProgress = count(`SELECT COUNT(*) AS n FROM si_progress WHERE namespace IN (${ns}) AND kind = 'failed' AND at >= ? AND at < ?`, [from, to]);
    const versions = count(`SELECT COUNT(*) AS n FROM si_records WHERE namespace IN (${ns}) AND kind = 'publication_version' AND created_at >= ? AND created_at < ?`, [from, to]);
    const usages = count(`SELECT COUNT(*) AS n FROM si_asset_usage WHERE namespace IN (${ns}) AND where_used IN ('publication','shorts','reels','episode') AND used_at >= ? AND used_at < ?`, [from, to]);
    const qaFailed = count(`SELECT COUNT(*) AS n FROM si_qa_findings WHERE namespace IN (${ns}) AND ok = 0 AND at >= ? AND at < ?`, [from, to]);
    const qaPassed = count(`SELECT COUNT(*) AS n FROM si_qa_findings WHERE namespace IN (${ns}) AND ok = 1 AND at >= ? AND at < ?`, [from, to]);
    const pending = count(`SELECT COUNT(*) AS n FROM si_approvals WHERE namespace IN (${ns}) AND status = 'pending' AND requested_at >= ? AND requested_at < ?`, [from, to]);
    const approved = count(`SELECT COUNT(*) AS n FROM si_approvals WHERE namespace IN (${ns}) AND status = 'approved' AND requested_at >= ? AND requested_at < ?`, [from, to]);
    const rejected = count(`SELECT COUNT(*) AS n FROM si_approvals WHERE namespace IN (${ns}) AND status = 'rejected' AND requested_at >= ? AND requested_at < ?`, [from, to]);
    const money = { actual: emptyBucket(), estimate: emptyBucket(), forecast: emptyBucket() };
    const otherCurrencies = [];
    const groups = new Map();
    let unassignedEntries = 0;
    if (ledger && ledger.connected) {
      for (const row of ledger.read({ from, to })) {
        const ns = row.project.namespace;
        if (ns && !namespaces.includes(ns)) continue;
        if (!ns && actor.role !== 'owner') continue;
        const bucket = money[row.kind];
        bucket.entries += 1;
        if (row.project.projectId === 'unassigned') unassignedEntries += 1;
        if (!groups.has(row.project.projectId)) {
          groups.set(row.project.projectId, {
            projectId: row.project.projectId,
            known: row.project.known && row.project.projectId !== 'unassigned',
            rawProjectIds: [],
            actualExpenseUsd: 0, actualIncomeUsd: 0,
            estimateExpenseUsd: 0, estimateIncomeUsd: 0,
            forecastExpenseUsd: 0, forecastIncomeUsd: 0
          });
        }
        const group = groups.get(row.project.projectId);
        if (row.project.rawProjectId && !group.rawProjectIds.includes(row.project.rawProjectId)) group.rawProjectIds.push(row.project.rawProjectId);
        if (row.currency === 'USD') {
          const field = row.kind + (row.direction === 'income' ? 'IncomeUsd' : 'ExpenseUsd');
          group[field] += row.amount;
          if (row.direction === 'income') bucket.incomeUsd += row.amount;
          else bucket.expenseUsd += row.amount;
        } else {
          otherCurrencies.push({
            kind: row.kind, direction: row.direction, currency: row.currency, amount: row.amount, projectId: row.project.projectId
          });
        }
      }
    }
    const attribution = [...groups.values()].sort((a, b) => a.projectId.localeCompare(b.projectId));
    const healthRows = db.prepare(`SELECT component, ok, detail, at FROM si_health_samples WHERE at >= ? AND at < ? ORDER BY at`).all(from, to);
    const latest = new Map();
    for (const row of healthRows) latest.set(row.component, row);
    const components = [...latest.values()].map(row => {
      const item = { component: row.component, ok: !!row.ok };
      if (!compact && row.detail) item.detail = row.detail;
      return item;
    });
    const attention = [];
    if (failedProgress) attention.push(`Ошибки задач: ${failedProgress}`);
    if (qaFailed) attention.push(`Техническая проверка не пройдена: ${qaFailed}`);
    if (pending) attention.push(`Ждут утверждения: ${pending}`);
    for (const item of components) if (!item.ok) attention.push(`Компонент ${item.component} не в порядке`);
    const report = {
      from, to, namespaces, compact: !!compact,
      work: { tasks, progressEvents },
      publications: { versions, usages },
      errors: { failedProgress, qaFailed },
      costs: { entries: money.actual.entries, totalUsd: money.actual.expenseUsd, available: money.actual.entries > 0, scope: 'actual' },
      ledger: {
        source: ledger && ledger.connected ? 'studio3' : 'none',
        available: !!(ledger && ledger.connected),
        actual: money.actual,
        estimate: money.estimate,
        forecast: money.forecast,
        unassignedEntries,
        otherCurrencies,
        attribution
      },
      health: { available: components.length > 0, components },
      approvals: { pending, approved, rejected },
      qa: { failed: qaFailed, passed: qaPassed },
      attention: attention.slice(0, compact ? 8 : 40)
    };
    const errors = validate('studio-daily-report', report);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    return report;
  }

  return { recordCost, recordAttribution: recordCost, recordHealth, daily };
}

module.exports = { createReports };
