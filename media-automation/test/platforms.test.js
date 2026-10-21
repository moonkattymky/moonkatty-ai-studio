'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const P = require('../src/platforms'); const api = require('../src/platforms/read-api');
const { check } = require('../src/platforms/schema-check'); const S = require('../schemas/platforms/read-api.schema.json');
const { ApprovalCenter } = require('../src/approval/center'); const { tmp } = require('./helpers');
const noNet = () => { throw new Error('network forbidden in tests'); };
const H = { get: () => null };
const mockFetch = body => { const calls = []; const fn = async (url, o) => { calls.push(url); return { ok: true, status: 200, headers: H, text: async () => JSON.stringify(body) }; }; fn.calls = calls; return fn; };

test('registry covers all 8 platforms incl. FB/IG/moonkatty.com', () => {
  assert.deepEqual(P.PLATFORMS.map(p => p.id).sort(), ['facebook', 'instagram', 'moonkatty-web', 'telegram', 'tiktok', 'x', 'youtube-news', 'youtube-project']);
});
test('IG reel format: 9:16, duration, caption/hashtag limits', () => {
  const ok = P.adapt('ig-reel', { text: 'News', hashtags: ['a', 'b'], media: { url: 'https://x/v.mp4', width: 1080, height: 1920, durationSec: 40, fps: 30 } });
  assert.deepEqual(ok.errors, []); assert.match(ok.post.caption, /#a #b$/);
  const bad = P.adapt('ig-reel', { text: 'x', media: { url: 'u', width: 1920, height: 1080, durationSec: 2, fps: 15 } });
  assert.equal(bad.errors.length, 3);
  const many = P.buildCaption({ text: 'y', hashtags: Array.from({ length: 40 }, (_, i) => 't' + i) }); assert.equal(many.hashtagsUsed, 30); assert.equal(many.droppedHashtags, 10);
  assert.ok(P.checkCaption('a'.repeat(2201), 'instagram').length);
  const pl = P.FORMATS['ig-reel'].payload(ok.post, 'IG1'); assert.equal(pl.body.media_type, 'REELS'); assert.equal(pl.path, '/IG1/media');
});
test('IG image/carousel and FB reel/video/post formats', () => {
  assert.ok(P.adapt('ig-image', { media: { url: 'u', mime: 'image/png', width: 1000, height: 2000 } }).errors.length >= 2);
  assert.deepEqual(P.adapt('ig-carousel', { items: [{ url: 'a', width: 1080, height: 1350 }, { url: 'b', width: 1080, height: 1080 }] }).errors, []);
  assert.ok(P.adapt('ig-carousel', { items: Array.from({ length: 11 }, () => ({ url: 'a' })) }).errors.length);
  assert.deepEqual(P.adapt('fb-reel', { text: 'r', media: { url: 'u', width: 1080, height: 1920, durationSec: 60, fps: 30 } }).errors, []);
  assert.ok(P.adapt('fb-reel', { media: { url: 'u', width: 1080, height: 1920, durationSec: 120, fps: 30 } }).errors.length);
  assert.ok(P.adapt('fb-video', { media: { url: 'u', width: 3000, height: 1000 } }).errors.length);
  assert.ok(P.adapt('fb-post', {}).errors.length); assert.equal(P.FORMATS['fb-post'].payload({ caption: 'hi' }, 'PG').path, '/PG/feed');
});
test('FB native scheduling window 10min..75d; IG own scheduler respects quota', () => {
  const now = 1e12; assert.equal(P.fbScheduleFields(now + 3600e3, now).published, false);
  assert.throws(() => P.fbScheduleFields(now + 60e3, now)); assert.throws(() => P.fbScheduleFields(now + 76 * 86400e3, now));
  assert.equal(P.fbReelScheduleFields(now + 3600e3, now).video_state, 'SCHEDULED');
  let t = now; const s = new P.IgScheduler({ quotaTotal: 2, now: () => t }); ['a', 'b', 'c'].forEach(id => s.add({ id, atMs: now })); assert.equal(s.add({ id: 'a', atMs: now }), false);
  const due = s.due(); assert.equal(due.length, 2); due.forEach(d => s.markPublished(d.id)); assert.equal(s.plan.find(p => p.id === 'c').status, 'deferred_quota');
  s.applyQuota({ quota_usage: 1, config: { quota_total: 100 } }); assert.equal(s.quotaTotal, 100);
});
test('promotion: draft only, never auto-spend, needs approval + budget', () => {
  const d = P.draftBoostPlan({ platform: 'facebook', postRef: 'PG_1' }); assert.equal(d.autoSpend, false); assert.ok(d.blockers.includes('budget missing'));
  assert.ok(d.requests.every(r => !r.body.status || r.body.status === 'PAUSED')); assert.throws(() => P.launch(d), /auto-spend disabled/);
  const ac = new ApprovalCenter({ statePath: path.join(tmp(), 'a.json') }); const b = P.draftBoostPlan({ platform: 'instagram', postRef: 'M1', budget: { amount: 10, currency: 'USD' } });
  const it = ac.submit(P.toApprovalItem(b), 'sys'); assert.equal(P.reviewBoostPlan(b, it).status, 'draft');
  ac.approve(it.id, 'Igor'); assert.equal(P.reviewBoostPlan(b, ac.get(it.id)).status, 'approved_manual_launch');
});
test('ledger: views never revenue, confirmed needs payoutId, totals separate', () => {
  const L = new P.RevenueLedger({ statePath: path.join(tmp(), 'l.json') });
  assert.throws(() => L.add({ platform: 'facebook', amount: 5, currency: 'USD', status: 'estimated', source: 'views*cpm' }), /never revenue/);
  assert.throws(() => L.add({ platform: 'facebook', amount: 5, currency: 'USD', status: 'confirmed', source: 'stmt' }), /payoutId/);
  const e = L.add({ platform: 'facebook', amount: 3, currency: 'USD', status: 'estimated', source: 'meta:monetization_approximate_earnings' });
  assert.equal(L.add({ platform: 'facebook', amount: 3, currency: 'USD', status: 'estimated', source: 'meta:monetization_approximate_earnings' }).id, e.id);
  assert.deepEqual(L.totals('facebook'), { confirmed: {}, estimated: { USD: 3 } });
  L.confirm(e.id, { payoutId: 'PO-1', amount: 2.5 }); assert.deepEqual(L.totals('facebook'), { confirmed: { USD: 2.5 }, estimated: {} });
});
test('live mode needs owner flag AND approved live_mode item', () => {
  const ac = new ApprovalCenter({ statePath: path.join(tmp(), 'a.json') });
  assert.equal(P.liveMode('instagram', { liveFlags: { instagram: true }, approvals: ac }).live, false);
  P.requestLiveMode(ac, 'instagram', 'sys'); ac.approve('live_mode:instagram', 'Igor');
  assert.equal(P.liveMode('instagram', { approvals: ac }).live, false); assert.equal(P.liveMode('instagram', { liveFlags: { instagram: true }, approvals: ac }).live, true);
  assert.equal(P.liveMode('moonkatty-web', { liveFlags: { web: true }, approvals: ac }).live, false);
});
test('Meta account insights + earnings estimate (mock fetch)', async () => {
  const f = mockFetch({ data: [{ name: 'views', total_value: { value: 500 } }, { name: 'reach', total_value: { value: 300 } }] });
  const m = new P.MetaAccountInsights({ fetchFn: f }); const ig = await m.instagram('IG1', { token: 't', since: '2026-10-01', until: '2026-10-07' }); assert.equal(ig.views, 500); assert.match(f.calls[0], /IG1\/insights/);
  const fe = new P.MetaAccountInsights({ fetchFn: mockFetch({ data: [{ name: 'monetization_approximate_earnings', values: [{ value: 1.2 }, { value: 0.8 }] }] }) });
  const est = await fe.facebookEarningsEstimate('PG', { token: 't', since: 'a', until: 'b' }); assert.equal(est.status, 'estimated'); assert.equal(est.amount, 2); assert.equal(est.payoutId, null);
});
test('meta.js bridge: reads connections, never decrypts, no OAuth', async () => {
  const b = new P.MetaOAuthBridge({ listWorkspaces: () => [{ id: 'w1', platform: 'instagram', connection: { status: 'connected', pageId: 'PG', igUserId: 'IG9', accessToken: 'SHOULD_NOT_LEAK' } }, { id: 'w2', platform: 'facebook', connection: { status: 'select_page' } }], studioFetch: noNet });
  const c = await b.connections('instagram'); assert.equal(c[0].igUserId, 'IG9'); assert.ok(!JSON.stringify(c).includes('SHOULD_NOT_LEAK'));
  assert.equal(await b.target('instagram'), 'IG9'); assert.equal(await b.target('facebook'), null); assert.equal(await b.secretsProvider().get('meta_page_token_news'), null);
  const fs = require('fs'); assert.ok(!/require\(['"][./]*meta(\.js)?['"]\)/.test(fs.readFileSync(require.resolve('../src/platforms/meta-oauth-bridge'), 'utf8')));
});
test('read API: all functions, schema-valid, frozen, revenue split', () => {
  assert.equal(api.READ_API_VERSION, '1.0.0'); assert.deepEqual(check({ $ref: '#/$defs/snapshot' }, require('../fixtures/platforms-snapshot.sample.json'), '$', S), []);
  for (const p of api.getPlatforms()) { assert.equal(p.dataMode, 'mock');
    for (const [k, f] of [['status', 'getPlatformStatus'], ['pipeline', 'getContentPipeline'], ['analytics', 'getAnalytics'], ['revenue', 'getRevenue'], ['capabilities', 'getCapabilities']]) assert.deepEqual(check({ $ref: '#/$defs/' + k }, api[f](p.id), p.id, S), [], `${p.id} ${k}`); }
  const r = api.getRevenue('youtube-news'); assert.ok(Object.isFrozen(r)); assert.throws(() => { r.confirmed.totals.USD = 1e6; }); assert.equal(r.viewsAreRevenue, false);
  assert.ok(r.confirmed.entries.every(e => e.payoutId)); assert.ok(r.unconfirmed.entries.every(e => e.status === 'estimated'));
  assert.throws(() => api.getPlatformStatus('nope'), /unknown platform/); assert.equal(api.getAnalytics('x', { since: '2026-10-01' }).range.since, '2026-10-01');
  assert.ok(api.getCapabilities('instagram').capabilities.find(c => c.id === 'monetization_payouts').available === false);
});
test('read API live providers are read-only views', () => {
  const L = new P.RevenueLedger({ statePath: path.join(tmp(), 'l.json') }); L.add({ platform: 'facebook', amount: 9, currency: 'EUR', status: 'confirmed', source: 'stmt', payoutId: 'P9' });
  const a = api.createReadApi({ ledger: L, publisher: { posts: () => [{ id: 'p', contentId: 'c', status: 'dry_run', content: { reviewStatus: 'approved' } }] } });
  assert.deepEqual(a.getRevenue('facebook').confirmed.totals, { EUR: 9 }); assert.equal(a.getPlatformStatus('facebook').mode, 'DRY-RUN'); assert.equal(a.getContentPipeline('facebook').items.length, 1);
  assert.equal(typeof a.publish, 'undefined'); assert.ok(Object.isFrozen(a));
});
