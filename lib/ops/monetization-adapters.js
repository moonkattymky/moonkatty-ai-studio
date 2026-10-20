// Platform monetization analytics — INTERFACES + MOCKS only. No real connections, no paid services, no credentials here.
// Every adapter returns platform-reported numbers as kind 'estimate' (they are not receipts). A real payout enters the ledger
// only as 'actual' with proof (payout report / bank statement). Engagement metrics live in feat/media-automation analytics (not duplicated).
'use strict';
// Interface: { platform, status() -> {connected:false, reason, officialApi}, fetchRevenue({from,to}) -> RevenueEstimate[] }
// RevenueEstimate: { platform, periodFrom, periodTo, amount: '12.34', currency, metric, kind: 'estimate', basis, projectId|null, externalRef }
const PLATFORMS = {
  youtube: { officialApi: 'YouTube Analytics API v2 — метрики estimatedRevenue/estimatedAdRevenue (scope yt-analytics-monetary.readonly), только для монетизированных каналов', metric: 'estimatedRevenue' },
  tiktok: { officialApi: 'Публичного API доходов Creator Rewards нет (проверить на момент подключения) — только ручной импорт выгрузки', metric: 'creatorRewards' },
  instagram: { officialApi: 'Instagram Graph API не отдаёт доходы авторов в общем виде — ручной импорт отчётов', metric: 'bonuses' },
  x: { officialApi: 'X API не предоставляет данные о выплатах Creator Revenue Sharing — ручной импорт', metric: 'revenueSharing' },
  telegram: { officialApi: 'Bot API: getStarTransactions (Telegram Stars) для бота; доходы рекламы канала — ручной импорт', metric: 'stars' },
};
class NotConnectedAdapter {
  constructor(platform) { if (!PLATFORMS[platform]) throw new Error('unknown platform ' + platform); this.platform = platform; }
  status() { return { platform: this.platform, connected: false, reason: 'не подключено (интерфейс-заглушка; реальные подключения не выполняются)', officialApi: PLATFORMS[this.platform].officialApi }; }
  async fetchRevenue() { const e = new Error(`${this.platform}: не подключено`); e.code = 'NOT_CONNECTED'; throw e; }
}
// Mock for tests/demos: returns ONLY the fixture it was given (never generates numbers), labelled mock.
class MockRevenueAdapter extends NotConnectedAdapter {
  constructor(platform, fixture = []) { super(platform); this.fixture = fixture; }
  status() { return { ...super.status(), connected: true, mock: true, reason: 'MOCK' }; }
  async fetchRevenue({ from, to } = {}) { return this.fixture.filter(r => (!from || r.periodTo >= from) && (!to || r.periodFrom <= to)).map(r => normalize(this.platform, r, 'mock')); }
}
function normalize(platform, r, via) { if (!/^\d+(\.\d{1,2})?$/.test(String(r.amount))) throw new Error('amount'); if (!/^[A-Z]{3}$/.test(r.currency || '')) throw new Error('currency');
  return { platform, periodFrom: r.periodFrom, periodTo: r.periodTo, amount: String(r.amount), currency: r.currency, metric: r.metric || PLATFORMS[platform].metric, kind: 'estimate',
    basis: `${platform} ${r.metric || PLATFORMS[platform].metric} (${via}) за ${r.periodFrom}…${r.periodTo}; оценка платформы, не выплата`, projectId: r.projectId || null, externalRef: r.externalRef || null }; }
// Push estimates into the ledger (idempotent per platform+period+metric+project). Never creates 'actual'.
function syncToLedger(ledger, estimates, { by } = {}) { let added = 0, dup = 0; for (const e of estimates) { if (e.kind !== 'estimate') throw new Error('адаптер может давать только estimate');
  const r = ledger.add({ kind: 'estimate', direction: 'income', amount: e.amount, currency: e.currency, date: e.periodTo, category: 'platform_payout', source: 'adapter:' + e.platform, basis: e.basis, projectId: e.projectId, idempotencyKey: `est:${e.platform}:${e.metric}:${e.periodFrom}:${e.periodTo}:${e.projectId || '-'}` }, { by }); r.duplicate ? dup++ : added++; } return { added, duplicates: dup }; }
const registry = () => Object.fromEntries(Object.keys(PLATFORMS).map(p => [p, new NotConnectedAdapter(p)]));
module.exports = { PLATFORMS, NotConnectedAdapter, MockRevenueAdapter, normalize, syncToLedger, registry };
