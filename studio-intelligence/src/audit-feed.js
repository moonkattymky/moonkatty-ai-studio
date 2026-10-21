'use strict';
const crypto = require('crypto');
const { containsSecret } = require('./secrets');

/** Тот же потолок, что у журнала панели в server.js (`logs`, 2000). Сам список здесь не хранится. */
const PANEL_LOG_CAP = 2000;

function scrubMessage(message) {
  let text = String(message || '').slice(0, 2000);
  text = text
    .replace(/(access_token|client_secret|password|token|secret)=([^&\s"']+)/gi, '$1=[скрыто]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [скрыто]')
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, '[скрыто]');
  if (containsSecret(text)) return 'Запись журнала скрыта: в тексте был секрет';
  return text;
}

function toPanelLog(entry, now) {
  const line = {
    id: entry.id || crypto.randomBytes(12).toString('hex'),
    at: entry.at || now(),
    level: entry.level || 'info',
    source: entry.source || 'studio-intelligence',
    message: scrubMessage(entry.message),
    user: entry.user || null
  };
  return line;
}

/**
 * Короткий след в существующий журнал панели.
 * Долгая история остаётся в si_approval_events и si_asset_events: журнал панели обрезается до 2000.
 * @param {{ log?: Function, now: Function }} opts
 * log — та же функция, что server.js log(level, source, message, user). Если её нет, строка только возвращается.
 */
function createAuditFeed({ log, now }) {
  function feed(entry) {
    const line = toPanelLog(entry, now);
    if (typeof log === 'function') log(line.level, line.source, line.message, line.user);
    return line;
  }
  return { feed, toPanelLog: entry => toPanelLog(entry, now), cap: PANEL_LOG_CAP };
}

/** Повторяет обрезку server.js, чтобы тест показал стык, а не второй журнал. */
function createCappedPanelLog(now, cap = PANEL_LOG_CAP) {
  const rows = [];
  function log(level, source, message, user) {
    rows.push({ id: crypto.randomBytes(8).toString('hex'), at: now(), level, source, message, user: user || null });
    if (rows.length > cap) rows.splice(0, rows.length - cap);
  }
  return { log, rows };
}

module.exports = { createAuditFeed, createCappedPanelLog, scrubMessage, toPanelLog, PANEL_LOG_CAP };
