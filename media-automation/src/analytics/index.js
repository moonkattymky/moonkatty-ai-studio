'use strict';
const A = require('./adapters');
function defaultAnalyticsAdapters(o = {}) { return { youtube: new A.YouTubeAnalyticsAdapter(o), x: new A.XAnalyticsAdapter(o), telegram: new A.TelegramStatsAdapter(o), instagram: new A.MetaInsightsAdapter({ ...o, kind: 'instagram' }), facebook: new A.MetaInsightsAdapter({ ...o, kind: 'facebook' }), tiktok: new A.TikTokAnalyticsAdapter(o) }; }
module.exports = { ...A, ...require('./analytics'), defaultAnalyticsAdapters };
