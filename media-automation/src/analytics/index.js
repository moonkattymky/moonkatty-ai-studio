'use strict';
const A = require('./adapters');
const { experimentalEnabled } = require('../experimental');
function defaultAnalyticsAdapters(o = {}) { const exp = experimentalEnabled(o); return { youtube: new A.YouTubeAnalyticsAdapter(o), ...(exp ? { x: new A.XAnalyticsAdapter(o), telegram: new A.TelegramStatsAdapter(o) } : {}), instagram: new A.MetaInsightsAdapter({ ...o, kind: 'instagram' }), facebook: new A.MetaInsightsAdapter({ ...o, kind: 'facebook' }), tiktok: new A.TikTokAnalyticsAdapter(o) }; }
module.exports = { ...A, ...require('./analytics'), defaultAnalyticsAdapters };
