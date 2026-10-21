'use strict';
/** Meta account-level analytics + monetization ESTIMATES. Network only through injected fetchFn (tests use mocks). */
const { call } = require('../publish/http');
const G = v => `https://graph.facebook.com/${v}`;
const sumVal = v => typeof v === 'object' && v ? Object.values(v).reduce((a, b) => a + (+b || 0), 0) : v;
function parse(body) { const o = {}; for (const d of body.data || []) { const vals = d.values || []; o[d.name] = d.total_value ? sumVal(d.total_value.value) : vals.reduce((a, x) => a + (+sumVal(x.value) || 0), 0); } return o; }
class MetaAccountInsights {
  constructor({ fetchFn = globalThis.fetch, graphVersion = process.env.META_GRAPH_VERSION || 'v26.0' } = {}) { Object.assign(this, { fetchFn, graphVersion }); }
  async instagram(igUserId, { token, since, until }) {
    const q = new URLSearchParams({ metric: 'reach,views,accounts_engaged,total_interactions', metric_type: 'total_value', period: 'day', since, until, access_token: token });
    const r = await call(this.fetchFn, 'instagram', `${G(this.graphVersion)}/${igUserId}/insights?${q}`); const v = parse(r.body);
    return { platform: 'instagram', range: { since, until }, views: v.views ?? null, reach: v.reach ?? null, engaged: v.accounts_engaged ?? null, interactions: v.total_interactions ?? null, unavailable: ['watchTimeMin'], source: 'ig_user_insights' };
  }
  async facebook(pageId, { token, since, until }) {
    const q = new URLSearchParams({ metric: 'page_post_engagements,page_video_views,page_follows', period: 'day', since, until, access_token: token });
    const r = await call(this.fetchFn, 'facebook', `${G(this.graphVersion)}/${pageId}/insights?${q}`); const v = parse(r.body);
    return { platform: 'facebook', range: { since, until }, views: v.page_video_views ?? null, engagements: v.page_post_engagements ?? null, followers: v.page_follows ?? null, unavailable: [], source: 'page_insights' };
  }
  /** Estimated earnings only (monetization_approximate_earnings). Returns ledger-ready ESTIMATED rows, never confirmed. */
  async facebookEarningsEstimate(pageId, { token, since, until, currency = 'USD' }) {
    const q = new URLSearchParams({ metric: 'monetization_approximate_earnings', period: 'day', since, until, access_token: token });
    const r = await call(this.fetchFn, 'facebook', `${G(this.graphVersion)}/${pageId}/insights?${q}`); const v = parse(r.body);
    return { platform: 'facebook', amount: +(+(v.monetization_approximate_earnings || 0)).toFixed(2), currency, status: 'estimated', source: 'meta:monetization_approximate_earnings', payoutId: null, period: `${since}..${until}` };
  }
}
module.exports = { MetaAccountInsights };
