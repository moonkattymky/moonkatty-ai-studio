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

function createReports(db, { now, permissions, transaction }) {
  const insertCost = db.prepare(`INSERT INTO si_cost_entries (id, namespace, at, component, amount_usd, note, actor_id, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const costByKey = db.prepare('SELECT * FROM si_cost_entries WHERE namespace = ? AND idempotency_key = ?');
  const insertHealth = db.prepare(`INSERT INTO si_health_samples (id, at, component, ok, detail, actor_id) VALUES (?, ?, ?, ?, ?, ?)`);

  function readable(principal) {
    const actor = permissions.normalize(principal);
    if (actor.role === 'owner') return NAMESPACES.slice();
    return NAMESPACES.filter(namespace => permissions.canReadNamespace(actor, namespace));
  }

  function recordCost({ principal, entry }) {
    const actor = permissions.normalize(principal);
    if (actor.role !== 'owner') throw new StudioError('PERMISSION_DENIED', 'Стоимость записывает владелец', { retryable: false });
    const errors = validate('cost-entry', entry);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    permissions.assertPermission(actor, 'approve', { namespace: entry.namespace });
    return transaction(() => {
      const prev = costByKey.get(entry.namespace, entry.idempotencyKey);
      if (prev) return { id: prev.id, namespace: prev.namespace, amountUsd: prev.amount_usd, component: prev.component, at: prev.at };
      const rowId = crypto.randomBytes(12).toString('hex');
      insertCost.run(rowId, entry.namespace, entry.at || now(), entry.component, entry.amountUsd, entry.note || null, actor.id, entry.idempotencyKey);
      return { id: rowId, namespace: entry.namespace, amountUsd: entry.amountUsd, component: entry.component, at: entry.at || now() };
    });
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
    const costRow = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS total FROM si_cost_entries WHERE namespace IN (${ns}) AND at >= ? AND at < ?`).get(from, to);
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
      costs: { entries: Number(costRow.n), totalUsd: Number(costRow.total) || 0, available: Number(costRow.n) > 0 },
      health: { available: components.length > 0, components },
      approvals: { pending, approved, rejected },
      qa: { failed: qaFailed, passed: qaPassed },
      attention: attention.slice(0, compact ? 8 : 40)
    };
    const errors = validate('studio-daily-report', report);
    if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
    return report;
  }

  return { recordCost, recordHealth, daily };
}

module.exports = { createReports };
