'use strict';
const { call } = require('../publish/http');
/** All adapters: async fetch(remoteId, { token, ...ctx }) -> normalized metrics. Official APIs only. */
const norm = (platform, remoteId, m) => ({ platform, remoteId, views: m.views ?? null, likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null,
  reach: m.reach ?? null, watchTimeMin: m.watchTimeMin ?? null, avgViewSec: m.avgViewSec ?? null, followers: m.followers ?? null, unavailable: m.unavailable || [], collectedAt: new Date().toISOString() });

class YouTubeAnalyticsAdapter { // YouTube Analytics API v2 (scope yt-analytics.readonly)
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.platform = 'youtube'; }
  async fetch(videoId, { token, startDate = '2020-01-01', endDate = new Date().toISOString().slice(0, 10) }) {
    const q = new URLSearchParams({ ids: 'channel==MINE', startDate, endDate, metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares', filters: `video==${videoId}` });
    const r = await call(this.fetchFn, 'youtube-analytics', `https://youtubeanalytics.googleapis.com/v2/reports?${q}`, { headers: { authorization: `Bearer ${token}` } });
    const h = (r.body.columnHeaders || []).map(c => c.name); const row = (r.body.rows || [])[0] || []; const v = k => row[h.indexOf(k)] ?? 0;
    return norm('youtube', videoId, { views: v('views'), watchTimeMin: v('estimatedMinutesWatched'), avgViewSec: v('averageViewDuration'), likes: v('likes'), comments: v('comments'), shares: v('shares') });
  }
}
class XAnalyticsAdapter { // X API v2 public_metrics (+ non_public_metrics with owner user token)
  constructor({ fetchFn = globalThis.fetch, base = 'https://api.x.com' } = {}) { Object.assign(this, { fetchFn, base }); this.platform = 'x'; }
  async fetch(id, { token }) {
    const r = await call(this.fetchFn, 'x', `${this.base}/2/tweets/${id}?tweet.fields=public_metrics,non_public_metrics`, { headers: { authorization: `Bearer ${token}` } });
    const pm = r.body.data?.public_metrics || {}; const np = r.body.data?.non_public_metrics || {};
    return norm('x', id, { views: pm.impression_count ?? np.impression_count, likes: pm.like_count, comments: pm.reply_count, shares: (pm.retweet_count || 0) + (pm.quote_count || 0) });
  }
}
class TelegramStatsAdapter { // Bot API: only member count; per-post views are NOT available to bots (MTProto stats.* needed).
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.platform = 'telegram'; }
  async fetch(remoteId, { token, chatId }) {
    const r = await call(this.fetchFn, 'telegram', `https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`);
    return norm('telegram', remoteId, { followers: r.body.result, unavailable: ['views', 'likes', 'comments', 'shares'] });
  }
}
class MetaInsightsAdapter { // IG media insights / FB video_insights
  constructor({ fetchFn = globalThis.fetch, graphVersion = process.env.META_GRAPH_VERSION || 'v26.0', kind = 'instagram' } = {}) { Object.assign(this, { fetchFn, graphVersion, kind }); this.platform = kind; }
  async fetch(id, { token }) {
    const metric = this.kind === 'instagram' ? 'views,reach,likes,comments,shares,saved,ig_reels_avg_watch_time' : 'total_video_views,total_video_impressions_unique,total_video_avg_time_watched,total_video_reactions_by_type_total';
    const path = this.kind === 'instagram' ? `${id}/insights` : `${id}/video_insights`;
    const r = await call(this.fetchFn, this.kind, `https://graph.facebook.com/${this.graphVersion}/${path}?metric=${metric}&access_token=${encodeURIComponent(token)}`);
    const v = {}; for (const d of r.body.data || []) { const val = d.values?.[0]?.value ?? d.total_value?.value; v[d.name] = typeof val === 'object' && val ? Object.values(val).reduce((a, b) => a + b, 0) : val; }
    return this.kind === 'instagram'
      ? norm('instagram', id, { views: v.views, reach: v.reach, likes: v.likes, comments: v.comments, shares: v.shares, avgViewSec: v.ig_reels_avg_watch_time != null ? v.ig_reels_avg_watch_time / 1000 : null })
      : norm('facebook', id, { views: v.total_video_views, reach: v.total_video_impressions_unique, likes: v.total_video_reactions_by_type_total, avgViewSec: v.total_video_avg_time_watched != null ? v.total_video_avg_time_watched / 1000 : null });
  }
}
class TikTokAnalyticsAdapter { // Display API /v2/video/query/ (scope video.list)
  constructor({ fetchFn = globalThis.fetch } = {}) { this.fetchFn = fetchFn; this.platform = 'tiktok'; }
  async fetch(videoId, { token }) {
    const r = await call(this.fetchFn, 'tiktok', 'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count,duration', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ filters: { video_ids: [videoId] } }) });
    const v = r.body.data?.videos?.[0] || {}; return norm('tiktok', videoId, { views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count });
  }
}
module.exports = { YouTubeAnalyticsAdapter, XAnalyticsAdapter, TelegramStatsAdapter, MetaInsightsAdapter, TikTokAnalyticsAdapter, norm };
