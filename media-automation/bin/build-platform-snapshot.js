#!/usr/bin/env node
'use strict';
/** Regenerates data/platforms-snapshot.sample.json — ALL values are MOCK (dataMode:'mock'). No network. */
const fs = require('fs'); const path = require('path');
const { PLATFORMS } = require('../src/platforms/registry');
const { READ_API_VERSION } = require('../src/platforms/read-api');
const AS_OF = '2026-10-21T17:00:00.000Z'; const R = { since: '2026-10-14', until: '2026-10-21' };
const UNAV = { telegram: ['views', 'likes', 'comments', 'shares'], web: ['views', 'likes', 'comments', 'shares', 'reach', 'followers'] };
const platforms = {};
PLATFORMS.forEach((p, i) => { const impl = p.implemented !== false; const n = (i + 1) * 1000;
  const est = p.kind === 'facebook' ? [{ platform: p.id, amount: 3.42, currency: 'USD', status: 'estimated', source: 'meta:monetization_approximate_earnings', payoutId: null, period: '2026-10-14..2026-10-21' }]
    : p.kind === 'youtube' ? [{ platform: p.id, amount: 1.1, currency: 'USD', status: 'estimated', source: 'youtube:estimatedRevenue(mock)', payoutId: null, period: '2026-10' }] : [];
  const conf = p.id === 'youtube-news' ? [{ platform: p.id, amount: 12.5, currency: 'USD', status: 'confirmed', source: 'adsense:payment_statement(mock)', payoutId: 'MOCK-PAYOUT-0001', period: '2026-09' }] : [];
  const sum = a => a.reduce((t, e) => ({ ...t, [e.currency]: +((t[e.currency] || 0) + e.amount).toFixed(2) }), {});
  platforms[p.id] = { dataMode: 'mock',
    status: { platformId: p.id, dataMode: 'mock', mode: 'DRY-RUN', liveGate: { live: false, reason: impl ? 'owner flag off' : 'not implemented' }, connected: false, postCounts: impl ? { dry_run: 2, queued: 1 } : {}, asOf: AS_OF },
    pipeline: { platformId: p.id, dataMode: 'mock', items: impl ? [{ postId: `mock-${p.id}-1`, contentId: 'news-2026-10-21-a', status: 'dry_run', reviewStatus: 'approved' }, { postId: `mock-${p.id}-2`, contentId: 'news-2026-10-21-b', status: p.kind === 'instagram' ? 'scheduled' : 'queued', reviewStatus: 'pending' }] : [] },
    analytics: { platformId: p.id, dataMode: 'mock', range: R, totals: impl ? { views: n, likes: n / 20, comments: n / 100, shares: n / 200, reach: n * 0.8, followers: 100 + i * 37 } : null, unavailable: UNAV[p.kind] || [] },
    revenue: { platformId: p.id, dataMode: 'mock', confirmed: { totals: sum(conf), entries: conf }, unconfirmed: { totals: sum(est), entries: est }, viewsAreRevenue: false } };
  if (UNAV[p.kind] && platforms[p.id].analytics.totals) for (const k of UNAV[p.kind]) platforms[p.id].analytics.totals[k] = null;
});
const out = { schemaVersion: '1.0.0', readApiVersion: READ_API_VERSION, generatedAt: AS_OF, note: 'SAMPLE: every platform is dataMode=mock. No accounts are connected; no real publishing or revenue.', platforms };
const f = path.join(__dirname, '..', 'fixtures', 'platforms-snapshot.sample.json'); fs.writeFileSync(f, JSON.stringify(out, null, 2) + '\n'); console.log('wrote', f);
