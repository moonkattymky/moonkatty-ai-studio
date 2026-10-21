'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const { Analytics, recommend, defaultAnalyticsAdapters } = require('../src/analytics');
const { ChainSecrets, EnvSecrets } = require('../src/secrets');
const { tmp } = require('./helpers');
const secrets = new ChainSecrets([new EnvSecrets({ MA_SECRET_YT: 'yt', MA_SECRET_XT: 'xt', MA_SECRET_TG: 'bot123:ABCDEFGHIJKLMNOPQRSTUVWX', MA_SECRET_META: 'mt', MA_SECRET_TT: 'tt' })]);
const J = body => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) });
function fetchMock(calls) { return async (url, o = {}) => { calls.push({ url, o });
  if (url.includes('youtubeanalytics')) return J({ columnHeaders: ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'likes', 'comments', 'shares'].map(name => ({ name })), rows: [[1000, 300, 18, 50, 5, 7]] });
  if (url.includes('api.x.com')) return J({ data: { public_metrics: { impression_count: 500, like_count: 10, reply_count: 2, retweet_count: 3, quote_count: 1 } } });
  if (url.includes('getChatMemberCount')) return J({ ok: true, result: 1234 });
  if (url.includes('/insights')) return J({ data: [{ name: 'views', values: [{ value: 800 }] }, { name: 'reach', values: [{ value: 600 }] }, { name: 'likes', values: [{ value: 40 }] }, { name: 'ig_reels_avg_watch_time', values: [{ value: 9000 }] }] });
  if (url.includes('video_insights')) return J({ data: [{ name: 'total_video_views', values: [{ value: 300 }] }, { name: 'total_video_reactions_by_type_total', values: [{ value: { like: 5, love: 2 } }] }] });
  if (url.includes('video/query')) return J({ data: { videos: [{ view_count: 2000, like_count: 100, comment_count: 4, share_count: 9 }] } });
  if (url.includes('fail')) return { ok: false, status: 500, headers: { get: () => null }, text: async () => 'boom' };
  throw new Error('unmocked ' + url); }; }

test('official API adapters normalize metrics (mocked)', async () => {
  const calls = []; const a = new Analytics({ statePath: path.join(tmp(), 'a.json'), adapters: defaultAnalyticsAdapters({ experimental: true, fetchFn: fetchMock(calls) }), secrets });
  const r = await a.collect([
    { id: 'yt1', platform: 'youtube', remoteId: 'v1', secret: 'yt' }, { id: 'x1', platform: 'x', remoteId: 't1', secret: 'xt' },
    { id: 'tg1', platform: 'telegram', remoteId: '@c:1', secret: 'tg', ctx: { chatId: '@c' } }, { id: 'ig1', platform: 'instagram', remoteId: 'm1', secret: 'meta' },
    { id: 'fb1', platform: 'facebook', remoteId: 'f1', secret: 'meta' }, { id: 'tt1', platform: 'tiktok', remoteId: 'k1', secret: 'tt' }, { id: 'bad', platform: 'myspace', remoteId: 'z', secret: 'yt' }]);
  assert.equal(r.ok, 6); assert.equal(r.errors.length, 1);
  const L = Object.fromEntries(a.latest().map(x => [x.id, x]));
  assert.deepEqual([L.yt1.views, L.yt1.watchTimeMin, L.yt1.avgViewSec, L.yt1.shares], [1000, 300, 18, 7]);
  assert.deepEqual([L.x1.views, L.x1.shares], [500, 4]); assert.equal(L.tg1.followers, 1234); assert.ok(L.tg1.unavailable.includes('views'));
  assert.deepEqual([L.ig1.views, L.ig1.reach, L.ig1.avgViewSec], [800, 600, 9]); assert.equal(L.fb1.likes, 7); assert.equal(L.tt1.views, 2000);
  assert.ok(calls.find(c => c.url.includes('youtubeanalytics')).url.includes('filters=video%3D%3Dv1'));
});
test('API error recorded per post, bot token redacted', async () => {
  const a = new Analytics({ statePath: path.join(tmp(), 'a.json'), adapters: { telegram: { fetch: async () => { throw new Error('telegram API 500 bot123:ABCDEFGHIJKLMNOPQRSTUVWX'); } } }, secrets });
  const r = await a.collect([{ id: 't', platform: 'telegram', remoteId: 'x', secret: 'tg' }]); assert.equal(r.ok, 0); assert.ok(!r.errors[0].error.includes('ABCDEFGH'));
});
test('recommendations: insufficient data guard, best hour, retention, category, underperformer', () => {
  assert.equal(recommend([{ views: 10 }])[0].type, 'insufficient_data');
  const row = (id, views, hourUtc, cat, likes, avg = 10) => ({ id, platform: 'youtube', views, likes, comments: 0, shares: 0, avgViewSec: avg, meta: { publishedAt: `2026-10-1${id.length}T${String(hourUtc).padStart(2, '0')}:00:00Z`, category: cat, durationSec: 60 } });
  const rows = [row('a', 1000, 6, 'space', 100), row('bb', 1200, 6, 'space', 90), row('c', 300, 16, 'politics', 3), row('dd', 400, 16, 'politics', 4), row('e', 100, 16, 'tech', 1)];
  const recs = recommend(rows); const types = recs.map(r => r.type);
  for (const t of ['best_hour', 'retention', 'category', 'underperformer']) assert.ok(types.includes(t), t);
  assert.equal(recs.find(r => r.type === 'best_hour').hour, 9, '06:00Z = 09:00 Asia/Jerusalem');
  assert.equal(recs.find(r => r.type === 'category').ranking[0].category, 'space');
});
