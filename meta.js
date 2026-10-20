// MOONKATTY AI STUDIO — Meta (Facebook Pages + Instagram Professional) integration.
// Official Graph API only. App ID/secret come from env or Settings (secret encrypted at rest). Tokens AES-256-GCM encrypted.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const S = require('./public/social.js');
const core = require('./public/core.js');

module.exports = function mountMeta(app, ctx) {
  const { q, get, put, list, log, DB_PATH, express } = ctx;
  // ---- encryption key ----
  let KEY;
  if (process.env.STUDIO_SECRET_KEY) KEY = crypto.createHash('sha256').update(process.env.STUDIO_SECRET_KEY).digest();
  else { const f = path.join(path.dirname(DB_PATH), 'secret.key');
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    KEY = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); }
  const enc = txt => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const e = Buffer.concat([c.update(String(txt), 'utf8'), c.final()]); return [iv, c.getAuthTag(), e].map(b => b.toString('base64')).join('.'); };
  const dec = s => { const [iv, tag, e] = s.split('.').map(b => Buffer.from(b, 'base64')); const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv); d.setAuthTag(tag); return Buffer.concat([d.update(e), d.final()]).toString('utf8'); };
  const setSecret = (k, v) => v == null ? db().prepare('DELETE FROM meta WHERE k = ?').run('secret:' + k) : q.setMeta.run('secret:' + k, enc(v));
  const getSecret = k => { const r = q.meta.get('secret:' + k); if (!r) return null; try { return dec(r.v); } catch { return null; } };
  const db = () => ctx.db;
  void db;

  // ---- config ----
  const cfg = () => { const c = JSON.parse(q.meta.get('metaConfig')?.v || '{}');
    return { appId: process.env.META_APP_ID || c.appId || '', appSecret: process.env.META_APP_SECRET || getSecret('metaAppSecret') || '', configId: process.env.META_CONFIG_ID || c.configId || '',
      redirectUri: process.env.META_REDIRECT_URI || c.redirectUri || '', graphVersion: process.env.META_GRAPH_VERSION || c.graphVersion || 'v26.0',
      source: process.env.META_APP_ID ? 'env' : 'settings' }; };
  const G = () => 'https://graph.facebook.com/' + cfg().graphVersion;

  // ---- Graph call with error + rate-limit capture ----
  async function graph(method, pathOrUrl, params = {}, token) {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : G() + pathOrUrl);
    const body = new URLSearchParams(); const p = Object.assign({}, params); if (token) p.access_token = token;
    if (method === 'GET') Object.entries(p).forEach(([k, v]) => url.searchParams.set(k, v)); else Object.entries(p).forEach(([k, v]) => body.set(k, typeof v === 'object' ? JSON.stringify(v) : v));
    const r = await fetch(url, { method, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(30000) });
    const rate = { appUsage: r.headers.get('x-app-usage'), bucUsage: r.headers.get('x-business-use-case-usage'), pageUsage: r.headers.get('x-page-usage'), at: core.now() };
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { const e = new Error(j.error?.message || 'HTTP ' + r.status); e.code = j.error?.code; e.subcode = j.error?.error_subcode; e.type = j.error?.type; e.fbtrace = j.error?.fbtrace_id; e.rate = rate;
      e.rateLimited = [4, 17, 32, 613, 80001, 80002, 80004, 80005, 80006].includes(e.code); throw e; }
    j.__rate = rate; return j;
  }
  const errInfo = e => ({ message: e.message, code: e.code || null, subcode: e.subcode || null, type: e.type || null, rateLimited: !!e.rateLimited, fbtrace: e.fbtrace || null, at: core.now() });
  const wsOr404 = (req, res) => { const w = get('workspaces', req.params.id); if (!w) res.status(404).json({ error: 'not found' }); return w; };
  const saveWs = w => put('workspaces', Object.assign(w, { updatedAt: core.now() }));
  const tokenFor = w => w.connection.pageId ? getSecret('pagetoken:' + w.connection.pageId) : null;

  // ---- OAuth callback (before auth middleware: Meta redirect won't carry SameSite=Strict cookie; protected by one-time state) ----
  const states = new Map();
  app.get('/api/meta/oauth/callback', async (req, res) => {
    const st = states.get(req.query.state); states.delete(req.query.state);
    const back = (ok, msg) => res.redirect('/#social?meta=' + (ok ? 'ok' : 'error') + '&msg=' + encodeURIComponent(msg || ''));
    if (!st || st.exp < Date.now()) { log('warn', 'meta', 'OAuth: неверный или просроченный state'); return back(false, 'state'); }
    if (req.query.error) { log('warn', 'meta', 'OAuth отменён: ' + (req.query.error_description || req.query.error), st.user); return back(false, req.query.error_reason || req.query.error); }
    const c = cfg(); const w = get('workspaces', st.ws);
    try {
      const short = await graph('GET', '/oauth/access_token', { client_id: c.appId, client_secret: c.appSecret, redirect_uri: c.redirectUri, code: req.query.code });
      const long = await graph('GET', '/oauth/access_token', { grant_type: 'fb_exchange_token', client_id: c.appId, client_secret: c.appSecret, fb_exchange_token: short.access_token });
      setSecret('usertoken:' + w.id, long.access_token);
      const pages = await graph('GET', '/me/accounts', { fields: 'id,name,category,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}', limit: 100 }, long.access_token);
      for (const p of pages.data || []) setSecret('pagetoken:' + p.id, p.access_token);
      w.connection.candidates = (pages.data || []).map(p => ({ id: p.id, name: p.name, category: p.category, picture: p.picture?.data?.url || null, ig: p.instagram_business_account || null }));
      w.connection.status = w.connection.candidates.length ? 'select_page' : 'error';
      w.connection.lastError = w.connection.candidates.length ? null : { message: 'Нет доступных страниц: создайте страницу и выдайте к ней доступ приложению', at: core.now() };
      saveWs(w); log('info', 'meta', `OAuth успешен (${w.title}), страниц: ${w.connection.candidates.length}`, st.user); back(true);
    } catch (e) { w.connection.status = 'error'; w.connection.lastError = errInfo(e); saveWs(w); log('error', 'meta', `OAuth ошибка (${w.title}): ${e.message}`, st.user); back(false, e.message); }
  });

  function mountProtected() {
    app.get('/api/meta/config', (req, res) => { const c = cfg(); res.json({ appId: c.appId, hasSecret: !!c.appSecret, configId: c.configId, redirectUri: c.redirectUri, graphVersion: c.graphVersion, source: c.source, encryption: process.env.STUDIO_SECRET_KEY ? 'env' : 'keyfile' }); });
    app.put('/api/meta/config', (req, res) => {
      if (process.env.META_APP_ID) return res.status(400).json({ error: 'Настройки заданы через переменные окружения' });
      const b = req.body || {}; const cur = JSON.parse(q.meta.get('metaConfig')?.v || '{}');
      const next = { appId: String(b.appId ?? cur.appId ?? '').trim(), configId: String(b.configId ?? cur.configId ?? '').trim(), redirectUri: String(b.redirectUri ?? cur.redirectUri ?? '').trim(), graphVersion: /^v\d+\.\d+$/.test(b.graphVersion) ? b.graphVersion : (cur.graphVersion || 'v26.0') };
      q.setMeta.run('metaConfig', JSON.stringify(next)); if (b.appSecret) setSecret('metaAppSecret', String(b.appSecret).trim());
      log('info', 'meta', 'Настройки Meta-приложения сохранены (секрет зашифрован)', req.user); res.json({ ok: true });
    });
    app.get('/api/meta/oauth/start', (req, res) => {
      const w = get('workspaces', req.query.ws); const c = cfg();
      if (!w) return res.status(404).send('workspace not found');
      if (!c.appId || !c.appSecret || !c.redirectUri) return res.redirect('/#social?meta=error&msg=' + encodeURIComponent('Не настроено Meta-приложение (App ID / App Secret / Redirect URI)'));
      const state = crypto.randomBytes(16).toString('hex'); states.set(state, { ws: w.id, user: req.user, exp: Date.now() + 10 * 60e3 });
      const u = new URL(`https://www.facebook.com/${c.graphVersion}/dialog/oauth`);
      u.searchParams.set('client_id', c.appId); u.searchParams.set('redirect_uri', c.redirectUri); u.searchParams.set('state', state); u.searchParams.set('response_type', 'code');
      if (c.configId) u.searchParams.set('config_id', c.configId); else u.searchParams.set('scope', S.PERMISSIONS[w.platform].join(','));
      log('info', 'meta', 'OAuth: переход к Facebook Login (' + w.title + ')', req.user); res.redirect(u.toString());
    });
    app.post('/api/meta/ws/:id/select', async (req, res) => {
      const w = wsOr404(req, res); if (!w) return; const p = (w.connection.candidates || []).find(x => x.id === req.body?.pageId);
      if (!p) return res.status(400).json({ error: 'Страница не найдена' });
      if (w.platform === 'instagram' && !p.ig) return res.status(400).json({ error: 'К этой странице не привязан профессиональный аккаунт Instagram' });
      Object.assign(w.connection, { pageId: p.id, pageName: p.name, category: p.category, picture: p.picture, igUserId: p.ig?.id || null, igUsername: p.ig?.username || null, status: 'connected', lastError: null });
      saveWs(w); log('info', 'meta', `Подключено: ${w.title} → ${p.name}`, req.user); await check(w).catch(() => {}); res.json(get('workspaces', w.id));
    });
    async function check(w) {
      const ut = getSecret('usertoken:' + w.id); const c = cfg(); if (!ut) throw Object.assign(new Error('Нет токена — подключите заново'), { code: 'no_token' });
      try {
        const perms = await graph('GET', '/me/permissions', {}, ut);
        const granted = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);
        let debug = null; try { debug = (await graph('GET', '/debug_token', { input_token: ut }, `${c.appId}|${c.appSecret}`)).data; } catch {}
        Object.assign(w.connection, { permissions: granted, missingPermissions: S.PERMISSIONS[w.platform].filter(p => !granted.includes(p)), tokenValid: debug ? !!debug.is_valid : null,
          tokenExpires: debug?.expires_at ? new Date(debug.expires_at * 1000).toISOString() : null, rateLimit: perms.__rate, checkedAt: core.now() });
        if (debug && !debug.is_valid) w.connection.status = 'error';
      } catch (e) { w.connection.lastError = errInfo(e); w.connection.rateLimit = e.rate; if (e.code === 190) w.connection.status = 'error'; saveWs(w); throw e; }
      saveWs(w); return w;
    }
    app.post('/api/meta/ws/:id/check', async (req, res) => { const w = wsOr404(req, res); if (!w) return;
      try { res.json(await check(w)); } catch (e) { log('error', 'meta', `Проверка прав (${w.title}): ${e.message}`, req.user); res.status(502).json({ error: e.message, details: errInfo(e) }); } });
    app.post('/api/meta/ws/:id/disconnect', (req, res) => { const w = wsOr404(req, res); if (!w) return;
      setSecret('usertoken:' + w.id, null); if (w.connection.pageId && !list('workspaces').some(x => x.id !== w.id && x.connection.pageId === w.connection.pageId)) setSecret('pagetoken:' + w.connection.pageId, null);
      w.connection = S.seedWorkspaces().find(x => x.id === w.id).connection; saveWs(w); log('info', 'meta', 'Отключено: ' + w.title, req.user); res.json(w); });
    app.post('/api/meta/ws/:id/insights', async (req, res) => {
      const w = wsOr404(req, res); if (!w) return; const tok = tokenFor(w);
      if (w.connection.status !== 'connected' || !tok) return res.status(400).json({ error: 'Не подключено' });
      const actual = {}, errors = [];
      const tryG = async (label, fn) => { try { await fn(); } catch (e) { errors.push({ label, ...errInfo(e) }); } };
      if (w.platform === 'facebook') {
        await tryG('page', async () => { const r = await graph('GET', '/' + w.connection.pageId, { fields: 'fan_count,followers_count,name,link' }, tok); actual.followers = r.followers_count ?? null; actual.fans = r.fan_count ?? null; actual.link = r.link; });
        await tryG('insights', async () => { const r = await graph('GET', `/${w.connection.pageId}/insights`, { metric: 'page_impressions_unique,page_post_engagements', period: 'day' }, tok); actual.insights = r.data; });
      } else {
        await tryG('profile', async () => { const r = await graph('GET', '/' + w.connection.igUserId, { fields: 'followers_count,media_count,username' }, tok); actual.followers = r.followers_count ?? null; actual.mediaCount = r.media_count ?? null; });
        await tryG('insights', async () => { const r = await graph('GET', `/${w.connection.igUserId}/insights`, { metric: 'reach,views,accounts_engaged', period: 'day', metric_type: 'total_value' }, tok); actual.insights = r.data; });
        await tryG('geo', async () => { const r = await graph('GET', `/${w.connection.igUserId}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', breakdown: 'country' }, tok); actual.geo = r.data; });
      }
      w.analytics = { actual, errors, fetchedAt: core.now() }; saveWs(w); log(errors.length ? 'warn' : 'info', 'meta', `Аналитика обновлена (${w.title})${errors.length ? ', ошибок: ' + errors.length : ''}`, req.user); res.json(w.analytics);
    });
    // ---- Community: sync comments + reply after approval ----
    app.post('/api/meta/ws/:id/comments/sync', async (req, res) => {
      const w = wsOr404(req, res); if (!w) return; const tok = tokenFor(w); if (w.connection.status !== 'connected' || !tok) return res.status(400).json({ error: 'Не подключено' });
      try {
        let items = [];
        if (w.platform === 'facebook') { const r = await graph('GET', `/${w.connection.pageId}/posts`, { fields: 'id,message,comments.limit(25){id,message,from,created_time}', limit: 10 }, tok);
          for (const p of r.data || []) for (const c of p.comments?.data || []) items.push({ extId: c.id, postId: p.id, text: c.message, author: c.from?.name || '', at: c.created_time }); }
        else { const r = await graph('GET', `/${w.connection.igUserId}/media`, { fields: 'id,caption,comments.limit(25){id,text,username,timestamp}', limit: 10 }, tok);
          for (const p of r.data || []) for (const c of p.comments?.data || []) items.push({ extId: c.id, postId: p.id, text: c.text, author: c.username || '', at: c.timestamp }); }
        const have = new Set(list('comments').map(c => c.extId)); let n = 0;
        for (const it of items) if (!have.has(it.extId)) { put('comments', { id: core.uid(), workspaceId: w.id, platform: w.platform, status: 'new', createdAt: core.now(), ...it }); n++; }
        log('info', 'community', `Комментарии синхронизированы (${w.title}): новых ${n}`, req.user); res.json({ added: n });
      } catch (e) { w.connection.lastError = errInfo(e); saveWs(w); log('error', 'community', e.message, req.user); res.status(502).json({ error: e.message, details: errInfo(e) }); }
    });
    app.post('/api/comments/:id/reply', async (req, res) => {
      const c = get('comments', req.params.id); if (!c) return res.status(404).json({ error: 'not found' });
      if (c.status !== 'approved' || !c.draft) return res.status(400).json({ error: 'Ответ должен быть утверждён' });
      if (c.demo) return res.status(400).json({ error: 'Демо-комментарий нельзя отправить' });
      const w = get('workspaces', c.workspaceId); const tok = w && tokenFor(w); if (!tok) return res.status(400).json({ error: 'Не подключено' });
      try { const r = await graph('POST', w.platform === 'facebook' ? `/${c.extId}/comments` : `/${c.extId}/replies`, { message: c.draft }, tok);
        Object.assign(c, { status: 'replied', replyId: r.id, repliedAt: core.now() }); put('comments', c); log('info', 'community', 'Ответ опубликован', req.user); res.json(c);
      } catch (e) { c.lastError = errInfo(e); put('comments', c); log('error', 'community', e.message, req.user); res.status(502).json({ error: e.message, details: errInfo(e) }); }
    });
    // ---- Publishing ----
    app.post('/api/queue/:id/publish', async (req, res) => {
      const it = get('queue', req.params.id); if (!it) return res.status(404).json({ error: 'not found' });
      try { res.json(await publish(it, req.user)); } catch (e) { res.status(400).json({ error: e.message, details: e.details || null, item: get('queue', it.id) }); }
    });
  };

  // Returns reason string if item cannot be published now, else null.
  function blockReason(it) {
    if (it.demo) return 'Демо-данные не публикуются';
    if (!['approved', 'retry'].includes(it.status)) return 'Нужно утверждение';
    if (!['facebook', 'instagram'].includes(it.platform)) return 'Платформа не подключена (API в разработке)';
    const w = list('workspaces').find(x => x.channelId === it.channelId);
    if (!w || w.connection.status !== 'connected') return 'Не подключено';
    if (it.platform === 'instagram' && !it.mediaUrl) return 'Instagram требует изображение или видео';
    return null;
  }
  async function publish(it, user) {
    const reason = blockReason(it); if (reason) throw new Error(reason);
    const data = Object.fromEntries(['queue', 'episodes'].map(c => [c, list(c)]));
    const issues = S.guardrails(it, data); if (issues.length) { const e = new Error(issues[0]); e.details = issues; throw e; }
    const w = list('workspaces').find(x => x.channelId === it.channelId); const tok = tokenFor(w);
    it.history = it.history || []; it.attempts = (it.attempts || 0) + 1;
    try {
      let result;
      if (it.platform === 'facebook') {
        const pg = w.connection.pageId;
        if (it.format === 'photo' && it.mediaUrl) result = await graph('POST', `/${pg}/photos`, { url: it.mediaUrl, caption: it.text }, tok);
        else if (['video', 'reel'].includes(it.format) && it.mediaUrl) result = await graph('POST', `/${pg}/videos`, { file_url: it.mediaUrl, description: it.text }, tok);
        else result = await graph('POST', `/${pg}/feed`, Object.assign({ message: it.text }, it.utmLink ? { link: it.utmLink } : {}), tok);
      } else {
        const ig = w.connection.igUserId; let params;
        if (it.format === 'reel') params = { media_type: 'REELS', video_url: it.mediaUrl, caption: it.text };
        else if (it.format === 'story') params = it.mediaType === 'video' ? { media_type: 'STORIES', video_url: it.mediaUrl } : { media_type: 'STORIES', image_url: it.mediaUrl };
        else if (it.format === 'carousel' && (it.mediaUrls || []).length >= 2) {
          const kids = []; for (const u of it.mediaUrls.slice(0, 10)) kids.push((await graph('POST', `/${ig}/media`, { image_url: u, is_carousel_item: 'true' }, tok)).id);
          params = { media_type: 'CAROUSEL', children: kids.join(','), caption: it.text };
        } else params = { image_url: it.mediaUrl, caption: it.text };
        const cont = await graph('POST', `/${ig}/media`, params, tok);
        for (let i = 0; i < 30; i++) { const st = await graph('GET', '/' + cont.id, { fields: 'status_code' }, tok); if (st.status_code === 'FINISHED') break; if (st.status_code === 'ERROR') throw new Error('Instagram: ошибка обработки медиа'); await new Promise(r => setTimeout(r, 5000)); }
        result = await graph('POST', `/${ig}/media_publish`, { creation_id: cont.id }, tok);
      }
      Object.assign(it, { status: 'published', publishedAt: core.now(), externalId: result.id || result.post_id, lastError: null, nextRetryAt: null });
      it.history.push({ at: core.now(), event: 'published', externalId: it.externalId, user: user || 'scheduler' });
      put('queue', it); log('info', 'publishing', `Опубликовано: ${it.title} → ${w.title}`, user); return it;
    } catch (e) {
      const info = errInfo(e); const final = it.attempts >= 5;
      Object.assign(it, { status: final ? 'failed' : 'retry', lastError: info, nextRetryAt: final ? null : new Date(Date.now() + S.backoffMs(it.attempts) * (e.rateLimited ? 4 : 1)).toISOString() });
      it.history.push({ at: core.now(), event: final ? 'failed' : 'retry_scheduled', error: info.message, code: info.code, user: user || 'scheduler' });
      put('queue', it); log('error', 'publishing', `Ошибка публикации «${it.title}»: ${e.message}${final ? '' : ' — повтор ' + it.nextRetryAt}`, user);
      const err = new Error(e.message); err.details = info; throw err;
    }
  }
  // Called from the scheduler tick.
  async function tick() {
    const ws = list('workspaces'); const now = new Date();
    for (const it of list('queue')) {
      const w = ws.find(x => x.channelId === it.channelId);
      const due = (it.status === 'approved' && w?.settings.autopublish && it.scheduledAt && new Date(it.scheduledAt) <= now) || (it.status === 'retry' && it.nextRetryAt && new Date(it.nextRetryAt) <= now);
      if (due && !blockReason(it)) await publish(it).catch(() => {});
    }
  }
  return { mountProtected, tick };
};
