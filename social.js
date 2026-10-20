/* MOONKATTY AI STUDIO — Social / Meta shared logic (browser + Node):
   workspaces, platform limits, variant adaptation, guardrails, dedup, UTM, daily limits. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MKSocial = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COUNTRIES = ['US', 'CA', 'GB', 'AU'];
  function seedWorkspaces() {
    const base = (id, brand, platform, extra) => Object.assign({
      id, brand, platform, channelId: { 'news-fb': 'fb-news', 'news-ig': 'ig-news', 'mk-fb': 'fb-main', 'mk-ig': 'ig-main' }[id],
      connection: { status: 'not_connected', pageId: null, pageName: null, igUserId: null, igUsername: null, permissions: [], missingPermissions: [], lastError: null, rateLimit: null, checkedAt: null },
      settings: { language: 'en', countries: brand === 'news' ? [...COUNTRIES] : [], manualApproval: true, autopublish: false, slots: ['08:00', '12:00', '16:00', '20:00'] },
      audiencePlan: [], monetization: {}, plan: [], createdAt: new Date().toISOString()
    }, extra);
    return [
      base('news-fb', 'news', 'facebook', { title: 'MOONKATTY NEWS — Facebook', limits: { postsPerDay: 15, minPostsPerDay: 8, videosPerDay: 2 }, formats: ['post', 'photo', 'link', 'video'],
        planText: ['8–15 новостных постов в день', 'до 2 видео в день', 'фото-новости со ссылкой на источник', 'обсуждения и опросы'] }),
      base('news-ig', 'news', 'instagram', { title: 'MOONKATTY NEWS — Instagram', limits: { postsPerDay: 5, minPostsPerDay: 3, reelsPerDay: 2 }, formats: ['photo', 'carousel', 'reel', 'story'],
        planText: ['3–5 новостных постов в день', 'до 2 Reels в день', 'Stories', 'карусели с главными событиями'] }),
      base('mk-fb', 'main', 'facebook', { title: 'MOONKATTY — Facebook', limits: { postsPerDay: 5, videosPerDay: 2 }, formats: ['post', 'photo', 'link', 'video'],
        planText: ['новости игры и анонсы обновлений', 'игровые ролики и трейлеры', 'бренд-посты', 'ссылки на moonkatty.com и Telegram (с UTM)'] }),
      base('mk-ig', 'main', 'instagram', { title: 'MOONKATTY — Instagram', limits: { postsPerDay: 3, reelsPerDay: 2 }, formats: ['photo', 'carousel', 'reel', 'story'],
        planText: ['игровой контент', 'Reels и трейлеры', 'закулисье разработки', 'анонсы и ивенты'] })
    ];
  }

  // Platform constraints (public platform docs; captions/limits may change — editable in code in one place).
  const PLATFORMS = {
    youtube:   { name: 'YouTube',   text: 5000, title: 100, hashtags: 15, aspect: { video: '16:9', short: '9:16' }, link: true },
    tiktok:    { name: 'TikTok',    text: 2200, hashtags: 10, aspect: { video: '9:16' }, link: false },
    x:         { name: 'X',         text: 280, hashtags: 3, aspect: { photo: '16:9', video: '16:9' }, link: true, linkLen: 23 },
    telegram:  { name: 'Telegram',  text: 4096, textWithMedia: 1024, hashtags: 5, aspect: { photo: 'any', video: 'any' }, link: true },
    facebook:  { name: 'Facebook',  text: 63206, recommended: 500, hashtags: 5, aspect: { photo: '1.91:1 / 1:1', video: '16:9 / 1:1', reel: '9:16' }, link: true },
    instagram: { name: 'Instagram', text: 2200, hashtags: 30, recommendedHashtags: 10, aspect: { photo: '4:5 / 1:1', carousel: '4:5 / 1:1 (2–10)', reel: '9:16', story: '9:16' }, link: false }
  };
  const CHANNEL_PLATFORM = { 'yt-news': 'youtube', 'yt-main': 'youtube', tiktok: 'tiktok', x: 'x', telegram: 'telegram', 'fb-news': 'facebook', 'ig-news': 'instagram', 'fb-main': 'facebook', 'ig-main': 'instagram' };

  function utmUrl(url, source, campaign, content) {
    try { const u = new URL(url); u.searchParams.set('utm_source', source); u.searchParams.set('utm_medium', 'social'); u.searchParams.set('utm_campaign', campaign || 'moonkatty');
      if (content) u.searchParams.set('utm_content', content); return u.toString(); } catch { return url; }
  }
  const cut = (s, n) => s.length <= n ? s : s.slice(0, Math.max(0, n - 1)).replace(/\s+\S*$/, '') + '…';
  // One source material -> adapted variant for a platform/channel.
  function adapt(src, channelId) {
    const pf = CHANNEL_PLATFORM[channelId] || 'telegram', L = PLATFORMS[pf];
    const tags = (src.hashtags || []).map(h => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).slice(0, L.recommendedHashtags || L.hashtags);
    const campaign = src.campaign || (src.brand === 'news' ? 'moonkatty_news' : 'moonkatty');
    const link = src.link ? utmUrl(src.link, pf, campaign, src.id) : '';
    const attribution = src.sourceUrl ? (pf === 'instagram' ? `Source: ${hostOf(src.sourceUrl)}` : `Source: ${src.sourceUrl}`) : '';
    const linkLine = link ? (L.link ? link : 'Link in bio') : '';
    const tail = [attribution, linkLine, tags.join(' ')].filter(Boolean).join('\n');
    let limit = L.text; if (pf === 'telegram' && src.mediaUrl) limit = L.textWithMedia;
    let body = [src.title, src.text].filter(Boolean).join('\n\n');
    const tailLen = pf === 'x' && link ? tail.length - link.length + L.linkLen : tail.length;
    body = cut(body, Math.max(20, limit - tailLen - 2));
    const text = [body, tail].filter(Boolean).join('\n\n');
    const format = pickFormat(src, pf);
    return { platform: pf, channelId, text, length: pf === 'x' && link ? text.length - link.length + L.linkLen : text.length, limit, format,
      aspect: (L.aspect[format] || L.aspect.photo || L.aspect.video || 'any'), utmLink: link || null, ytTitle: pf === 'youtube' ? cut(src.title || '', L.title) : undefined,
      warnings: [!L.link && src.link ? 'Ссылки в подписи некликабельны — используйте ссылку в профиле' : null, pf === 'instagram' && !src.mediaUrl ? 'Instagram требует изображение или видео' : null,
        pf === 'tiktok' && src.mediaType !== 'video' ? 'TikTok требует видео' : null, pf === 'youtube' && src.mediaType !== 'video' ? 'YouTube требует видео' : null].filter(Boolean) };
  }
  function pickFormat(src, pf) {
    const mt = src.mediaType || 'none';
    if (pf === 'instagram') return src.igFormat || (mt === 'video' ? 'reel' : mt === 'carousel' ? 'carousel' : 'photo');
    if (pf === 'facebook') return mt === 'video' ? 'video' : mt === 'image' || mt === 'carousel' ? 'photo' : src.link ? 'link' : 'post';
    if (pf === 'youtube') return src.vertical ? 'short' : 'video';
    return mt === 'video' ? 'video' : mt === 'image' ? 'photo' : 'post';
  }
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

  // Title similarity (token Jaccard) for dedup.
  const toks = s => new Set(String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2));
  function similarity(a, b) { const A = toks(a), B = toks(b); if (!A.size || !B.size) return 0; let i = 0; A.forEach(x => B.has(x) && i++); return i / (A.size + B.size - i); }
  const normUrl = u => { try { const x = new URL(u); [...x.searchParams.keys()].filter(k => k.startsWith('utm_')).forEach(k => x.searchParams.delete(k)); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, '') + x.search; } catch { return String(u || ''); } };
  function findDuplicates(item, queue, days = 7) {
    const since = Date.now() - days * 86400000;
    return queue.filter(q => q.id !== item.id && q.materialId !== item.materialId && q.channelId === item.channelId && new Date(q.createdAt).getTime() >= since && !['rejected'].includes(q.status) &&
      ((item.sourceUrl && q.sourceUrl && normUrl(item.sourceUrl) === normUrl(q.sourceUrl)) || similarity(item.title, q.title) >= 0.7));
  }
  const RIGHTS = ['own', 'licensed', 'generated'];
  // Guardrails before approval/publish. Returns list of blocking issues (strings, RU source for i18n).
  function guardrails(item, ctx) {
    const issues = [];
    if (item.brand === 'news' || item.kind === 'news') {
      const ep = item.episodeId && (ctx.episodes || []).find(e => e.id === item.episodeId);
      const fc = ep ? Object.values(ep.versions || {}).some(v => v.factcheck === 'done') : item.factCheck === 'passed';
      if (!fc) issues.push('Новость не проверена: этап «Проверка фактов» не пройден');
      if (!item.sourceUrl) issues.push('Нет ссылки на источник (атрибуция обязательна)');
    }
    if (item.mediaUrl && !RIGHTS.includes(item.imageRights)) issues.push('Не указаны права на изображение (своё / лицензия / сгенерировано)');
    if (findDuplicates(item, ctx.queue || []).length) issues.push('Возможный дубликат (совпадает URL или заголовок)');
    if (item.length > item.limit) issues.push('Текст длиннее лимита платформы');
    if (item.platform === 'instagram' && !item.mediaUrl) issues.push('Instagram требует изображение или видео');
    return issues;
  }
  // Daily limits per workspace / channel.
  function dailyCheck(item, queue, workspaces) {
    const ws = workspaces.find(w => w.channelId === item.channelId); if (!ws || !item.scheduledAt) return [];
    const day = item.scheduledAt.slice(0, 10); const same = queue.filter(q => q.id !== item.id && q.channelId === item.channelId && (q.scheduledAt || '').slice(0, 10) === day && !['rejected', 'failed'].includes(q.status));
    const out = [];
    if (same.length + 1 > ws.limits.postsPerDay) out.push(`Лимит постов в день превышен (${ws.limits.postsPerDay})`);
    const isVid = f => ['video', 'reel'].includes(f);
    const vmax = ws.limits.videosPerDay ?? ws.limits.reelsPerDay;
    if (vmax != null && isVid(item.format) && same.filter(q => isVid(q.format)).length + 1 > vmax) out.push(`Лимит видео/Reels в день превышен (${vmax})`);
    return out;
  }
  function backoffMs(attempt) { return Math.min(6 * 3600e3, 60e3 * Math.pow(2, attempt)); }
  const MONETIZATION = {
    facebook: [['instream', 'Реклама в видео (in-stream) и Reels'], ['branded', 'Брендированный контент'], ['stars', 'Звёзды (Stars)'], ['subscriptions', 'Платные подписки'], ['affiliate', 'Партнёрские ссылки']],
    instagram: [['reels_ads', 'Бонусы/реклама в Reels'], ['branded', 'Брендированный контент'], ['gifts', 'Подарки (Gifts)'], ['subscriptions', 'Платные подписки'], ['affiliate', 'Партнёрские ссылки']]
  };
  const PERMISSIONS = {
    facebook: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'read_insights', 'pages_read_user_content', 'pages_manage_engagement', 'business_management'],
    instagram: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement', 'business_management']
  };
  return { COUNTRIES, seedWorkspaces, PLATFORMS, CHANNEL_PLATFORM, utmUrl, adapt, similarity, findDuplicates, guardrails, dailyCheck, backoffMs, RIGHTS, MONETIZATION, PERMISSIONS, hostOf };
});
