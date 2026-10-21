'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path'); const fs = require('fs');
const { Publisher, DEFAULT_ACCOUNTS, defaultAdapters, YouTubeAdapter, TelegramAdapter, XAdapter, TikTokAdapter, MetaAdapter, LIVE_ENV_VALUE } = require('../src/publish');
const { EnvSecrets, KeychainSecrets, ChainSecrets, redact } = require('../src/secrets');
const { tmp } = require('./helpers');
const TOKEN = 'tok_SECRET_123456';
const secrets = new ChainSecrets([new EnvSecrets({ MA_SECRET_YOUTUBE_NEWS_TOKEN: TOKEN, MA_SECRET_YOUTUBE_PROJECT_TOKEN: 'proj_tok_999', MA_SECRET_TELEGRAM_BOT_TOKEN: 'bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', MA_SECRET_X_NEWS_TOKEN: TOKEN, MA_SECRET_TIKTOK_NEWS_TOKEN: TOKEN, MA_SECRET_META_PAGE_TOKEN_NEWS: TOKEN })]);
const H = (h = {}) => ({ get: k => h[k.toLowerCase()] ?? null });
function router(routes, calls = []) { // routes: [ [regex, fn(url,opts)->{status,body,headers}] ]
  return async (url, opts = {}) => { calls.push({ url, opts }); for (const [re, fn] of routes) if (re.test(url)) { const r = typeof fn === 'function' ? fn(url, opts) : fn; if (r === 'neterr') throw new Error('ECONNRESET');
    return { ok: r.status < 400, status: r.status, headers: H(r.headers), text: async () => typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {}) }; }
    throw new Error('unmocked ' + url); };
}
const video = () => { const f = path.join(tmp(), 'v.mp4'); fs.writeFileSync(f, Buffer.alloc(1024)); return f; };
const ytRoutes = (seq = []) => [[/upload\/youtube.*uploadType=resumable/, () => seq.shift() || { status: 200, headers: { location: 'https://upload.example/session1' } }], [/upload\.example\/session1/, { status: 200, body: { id: 'vid123' } }], [/youtube\/v3\/videos\?part=status/, { status: 200, body: { items: [{ status: { uploadStatus: 'processed', privacyStatus: 'private' }, processingDetails: { processingStatus: 'succeeded' } }] } }]];
const mk = (fetchFn, extra = {}) => { let t = 1e6; const pub = new Publisher({ statePath: path.join(tmp(), 'p.json'), adapters: defaultAdapters({ fetchFn, pollMs: 1 }), accounts: DEFAULT_ACCOUNTS.map(a => ({ ...a, live: true })), secrets, env: {}, now: () => t, backoffMs: 10, ...extra }); pub.tick = ms => { t += ms; }; return pub; };

test('DRY-RUN is default: no network, account.live false or no owner flag', async () => {
  const calls = []; const p = new Publisher({ statePath: path.join(tmp(), 'p.json'), adapters: defaultAdapters({ fetchFn: router([], calls) }), accounts: DEFAULT_ACCOUNTS, secrets, env: {} });
  const post = p.enqueue({ accountId: 'youtube-news', contentId: 'ep1', payload: { videoPath: video(), title: 'Ep 1' }, content: { reviewStatus: 'approved' } });
  const [r] = await p.processDue(); assert.equal(r.status, 'dry_run'); assert.equal(calls.length, 0); assert.equal(r.remote.preview.privacy, 'private');
  const p2 = mk(router([], calls)); assert.equal(p2.isLive('youtube-news'), false, 'account live but no owner flag -> dry');
  const p3 = mk(router([]), { env: { MA_PUBLISH_LIVE_YOUTUBE: 'yes' } }); assert.equal(p3.isLive('youtube-news'), false, 'wrong flag value');
  const p4 = mk(router([]), { env: { MA_PUBLISH_LIVE_YOUTUBE: LIVE_ENV_VALUE } }); assert.equal(p4.isLive('youtube-news'), true); assert.equal(p4.isLive('x-news'), false, 'per platform');
  assert.equal(post.id.length, 24);
});
test('live requires owner approval of content', async () => {
  const p = mk(router(ytRoutes()), { liveFlags: { youtube: true } });
  p.enqueue({ accountId: 'youtube-news', contentId: 'c', payload: { videoPath: video(), title: 'T' }, content: { reviewStatus: 'pending_approval' } });
  const [r] = await p.processDue(); assert.equal(r.status, 'failed'); assert.match(r.error, /not approved/);
});
test('YouTube (mocked): resumable upload, separate NEWS vs PROJECT tokens, status check, history', async () => {
  const calls = []; const p = mk(router(ytRoutes(), calls), { liveFlags: { youtube: true } });
  const a = p.enqueue({ accountId: 'youtube-news', contentId: 'ep1', payload: { videoPath: video(), title: 'News', shorts: true }, content: { reviewStatus: 'approved' } });
  p.enqueue({ accountId: 'youtube-project', contentId: 'ep1', payload: { videoPath: video(), title: 'Project' }, content: { reviewStatus: 'approved' } });
  const rs = await p.processDue(); assert.deepEqual(rs.map(r => r.status), ['published', 'published']);
  assert.equal(rs[0].remote.url, 'https://www.youtube.com/watch?v=vid123');
  const auths = calls.filter(c => /resumable/.test(c.url)).map(c => c.opts.headers.authorization); assert.deepEqual(auths, [`Bearer ${TOKEN}`, 'Bearer proj_tok_999']);
  const meta = JSON.parse(calls[0].opts.body); assert.equal(meta.status.privacyStatus, 'private'); assert.match(meta.snippet.description, /#Shorts/); assert.equal(meta.status.containsSyntheticMedia, true);
  assert.equal((await p.checkStatus(a.id)).remote.state, 'processed');
  assert.deepEqual(p.history(a.id).map(h => h.event), ['enqueued', 'publishing', 'published', 'status_checked']);
});
test('idempotency: same account+content never published twice', async () => {
  const calls = []; const p = mk(router(ytRoutes(), calls), { liveFlags: { youtube: true } });
  const args = { accountId: 'youtube-news', contentId: 'same', payload: { videoPath: video(), title: 'T' }, content: { reviewStatus: 'approved' } };
  p.enqueue(args); await p.processDue(); const again = p.enqueue(args); assert.equal(again.deduplicated, true); await p.processDue();
  assert.equal(calls.filter(c => /resumable/.test(c.url)).length, 1);
});
test('transient errors retried with backoff/Retry-After; permanent 4xx fails; secrets redacted', async () => {
  const p = mk(router(ytRoutes([{ status: 503, body: 'down ' + TOKEN }, { status: 429, headers: { 'retry-after': '7' } }, 'neterr'])), { liveFlags: { youtube: true } });
  const post = p.enqueue({ accountId: 'youtube-news', contentId: 'r', payload: { videoPath: video(), title: 'T' }, content: { reviewStatus: 'approved' } });
  let [r] = await p.processDue(); assert.equal(r.status, 'retry_wait'); assert.ok(!r.error.includes(TOKEN), 'redacted'); assert.equal(r.nextAt - 1e6, 10);
  assert.equal((await p.processDue()).length, 0, 'not due yet'); p.tick(10); [r] = await p.processDue(); assert.equal(r.status, 'retry_wait'); assert.equal(r.nextAt - (1e6 + 10), 7000);
  p.tick(7000); [r] = await p.processDue(); assert.equal(r.status, 'retry_wait'); p.tick(1e5); [r] = await p.processDue(); assert.equal(r.status, 'published'); assert.equal(p.post(post.id).attempts, 4);
  const p2 = mk(router([[/resumable/, { status: 403, body: 'quotaExceeded' }]]), { liveFlags: { youtube: true } });
  p2.enqueue({ accountId: 'youtube-news', contentId: 'q', payload: { videoPath: video(), title: 'T' }, content: { reviewStatus: 'approved' } });
  [r] = await p2.processDue(); assert.equal(r.status, 'failed'); assert.match(r.error, /403/);
});
test('restart mid-publish -> needs_check (no blind re-publish), resolve', async () => {
  const sp = path.join(tmp(), 'p.json'); const base = { statePath: sp, adapters: { youtube: { validate: () => [], preview: x => x, publish: () => new Promise(() => {}), status: async () => ({}) } }, accounts: DEFAULT_ACCOUNTS.map(a => ({ ...a, live: true })), secrets, liveFlags: { youtube: true } };
  const p1 = new Publisher(base); const post = p1.enqueue({ accountId: 'youtube-news', contentId: 'x', payload: { videoPath: 'v', title: 't' }, content: { reviewStatus: 'approved' } }); p1.processDue();
  await new Promise(r => setTimeout(r, 20)); assert.equal(p1.post(post.id).status, 'publishing');
  const p2 = new Publisher(base); assert.equal(p2.post(post.id).status, 'needs_check'); assert.equal((await p2.processDue()).length, 0);
  assert.equal(p2.resolve(post.id, 'requeue').status, 'queued');
});
test('Telegram (mocked): sendVideo multipart and sendMessage; bot token redacted', async () => {
  const calls = []; const p = mk(router([[/sendVideo/, { status: 200, body: { ok: true, result: { message_id: 42 } } }], [/sendMessage/, { status: 500, body: 'err' }]], calls), { liveFlags: { telegram: true }, maxAttempts: 1 });
  p.enqueue({ accountId: 'telegram-news', contentId: 'v', payload: { videoPath: video(), text: 'Caption' }, content: { reviewStatus: 'approved' } });
  p.enqueue({ accountId: 'telegram-news', contentId: 't', payload: { text: 'Hello' }, content: { reviewStatus: 'approved' } });
  const [a, b] = await p.processDue(); assert.equal(a.remote.url, 'https://t.me/moonkatty_news/42'); assert.ok(calls[0].opts.body instanceof FormData);
  assert.equal(b.status, 'failed'); assert.ok(!JSON.stringify(p.history(b.id)).includes('ABCDEFGHIJKLMNOP'));
});
test('X (mocked): media upload + tweet with media_ids; 280 limit', async () => {
  const calls = []; const f = path.join(tmp(), 'i.jpg'); fs.writeFileSync(f, 'jpg');
  const p = mk(router([[/media\/upload/, { status: 200, body: { data: { id: 'm1' } } }], [/2\/tweets$/, { status: 201, body: { data: { id: 't1' } } }]], calls), { liveFlags: { x: true } });
  assert.throws(() => p.enqueue({ accountId: 'x-news', contentId: 'long', payload: { text: 'a'.repeat(281) } }), /280/);
  p.enqueue({ accountId: 'x-news', contentId: 'n1', payload: { text: 'Headline', imagePath: f }, content: { reviewStatus: 'approved' } });
  const [r] = await p.processDue(); assert.equal(r.remote.url, 'https://x.com/i/web/status/t1'); assert.deepEqual(JSON.parse(calls[1].opts.body).media.media_ids, ['m1']);
});
test('TikTok (mocked): init FILE_UPLOAD, PUT, status fetch, SELF_ONLY default, AIGC flag', async () => {
  const calls = []; const p = mk(router([[/video\/init/, { status: 200, body: { data: { publish_id: 'pub1', upload_url: 'https://up.tiktok.example/u' } } }], [/up\.tiktok/, { status: 201, body: '' }], [/status\/fetch/, { status: 200, body: { data: { status: 'PUBLISH_COMPLETE' } } }]], calls), { liveFlags: { tiktok: true } });
  const post = p.enqueue({ accountId: 'tiktok-news', contentId: 'k', payload: { videoPath: video(), title: 'Cap' }, content: { reviewStatus: 'approved' } });
  await p.processDue(); const init = JSON.parse(calls[0].opts.body); assert.equal(init.post_info.privacy_level, 'SELF_ONLY'); assert.equal(init.post_info.is_aigc, true);
  assert.equal((await p.checkStatus(post.id)).remote.state, 'PUBLISH_COMPLETE');
});
test('Instagram Reels (mocked): container -> poll -> media_publish; Facebook Reels start/upload/finish', async () => {
  let polls = 0; const calls = [];
  const p = mk(router([[/\/ig1\/media$/, { status: 200, body: { id: 'c1' } }], [/\/c1\?fields=status_code/, () => ({ status: 200, body: { status_code: polls++ < 1 ? 'IN_PROGRESS' : 'FINISHED' } })], [/media_publish/, { status: 200, body: { id: 'ig_post_1' } }],
    [/page1\/video_reels/, (u, o) => ({ status: 200, body: String(o.body).includes('start') ? { video_id: 'fbv1' } : { success: true } })], [/rupload/, { status: 200, body: { success: true } }]], calls), { liveFlags: { instagram: true, facebook: true } });
  p.enqueue({ accountId: 'instagram-news', contentId: 'i', payload: { targetId: 'ig1', videoUrl: 'https://cdn.example/v.mp4', caption: 'c' }, content: { reviewStatus: 'approved' } });
  p.enqueue({ accountId: 'facebook-news', contentId: 'f', payload: { targetId: 'page1', videoUrl: 'https://cdn.example/v.mp4', caption: 'c' }, content: { reviewStatus: 'approved' } });
  const [ig, fb] = await p.processDue(); assert.equal(ig.remote.remoteId, 'ig_post_1'); assert.equal(polls, 2); assert.equal(fb.remote.url, 'https://www.facebook.com/reel/fbv1');
  assert.ok(calls.every(c => c.url.includes('/v26.0/') || !c.url.includes('graph.facebook')));
});
test('preview + missing secret', async () => {
  const p = mk(router([]), { liveFlags: { youtube: true }, secrets: new ChainSecrets([new EnvSecrets({})]) });
  const pv = p.preview('youtube-news', { videoPath: 'x', title: 'T' }); assert.equal(pv.mode, 'LIVE'); assert.equal(pv.account.label, 'YouTube — MOONKATTY NEWS');
  p.enqueue({ accountId: 'youtube-news', contentId: 'z', payload: { videoPath: video(), title: 'T' }, content: { reviewStatus: 'approved' } });
  const [r] = await p.processDue(); assert.equal(r.status, 'failed'); assert.match(r.error, /secret "youtube_news_token" not found/);
});
test('Keychain adapter uses security CLI argv; non-mac returns null; redact()', async () => {
  const seen = []; const k = new KeychainSecrets({ platform: 'darwin', execFileFn: (cmd, args, o, cb) => { seen.push([cmd, args]); cb(null, 'secretval\n'); } });
  assert.equal(await k.get('x_news_token'), 'secretval'); assert.deepEqual(seen[0], ['security', ['find-generic-password', '-s', 'moonkatty-media-automation', '-a', 'x_news_token', '-w']]);
  assert.equal(await new KeychainSecrets({ platform: 'linux' }).get('a'), null);
  assert.equal(redact('Bearer abcdefghijk and bot123:ABCDEFGHIJKLMNOPQRSTUVWX and access_token=zzz'), 'Bearer *** and bot*** and access_token=***');
  assert.match(KeychainSecrets.storeCommand('x'), /-w$/, 'value prompted, not in argv');
});
