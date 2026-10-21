// Game growth figures. Import or an explicit read-only adapter. No game code, no invented zeros.
'use strict';
const ND = 'НЕТ ДАННЫХ';
const KEYS = ['new_players', 'dau', 'mau', 'retention', 'stage_completion', 'referrals', 'iap', 'ad_clicks', 'marketing_efficiency'];
function empty() { return Object.fromEntries(KEYS.map(k => [k, ND])); }
function normalize(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'ожидается объект метрик' };
  if (body.fabricated === true) return { error: 'fake_financials' };
  const metrics = {}; let any = false; const demo = body.demo === true;
  for (const k of KEYS) {
    if (!(k in body) || body[k] == null || body[k] === '') { metrics[k] = ND; continue; }
    if (typeof body[k] !== 'number' || !Number.isFinite(body[k]) || body[k] < 0) return { error: k + ': число ≥ 0 или пусто' };
    metrics[k] = body[k]; any = true;
  }
  if (!any) return { error: 'нет ни одной метрики' };
  return { metrics, demo, source: 'import' };
}
function present(stored) {
  const base = empty(); if (!stored) return { connected: false, source: 'not_connected', metrics: base, demo: false, note: 'Read-only API игры не настроен. Доступен импорт CSV/JSON. ' + ND };
  return { connected: true, source: stored.source, metrics: Object.assign(base, stored.metrics), demo: !!stored.demo, at: stored.at, note: stored.demo ? 'DEMO' : 'импорт', api: { connected: false, mode: 'read_only_unconfigured' } };
}
module.exports = { KEYS, empty, normalize, present, ND };
