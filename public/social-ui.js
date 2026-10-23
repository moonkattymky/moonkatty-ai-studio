/* MOONKATTY AI STUDIO — Social Media module UI: FB/IG workspaces, unified publishing queue,
   analytics (actual vs forecast), monetization, Community agent. Extends VIEWS/BIND from app.js. */
'use strict';
const SX = window.MKSocial;
const LEGACY_SOCIAL = VIEWS.social, LEGACY_SOCIAL_BIND = BIND.social;
const PF_ICON = { facebook: '<span class="pf fb">f</span>', instagram: '<span class="pf ig">◎</span>', youtube: '<span class="pf yt">▶</span>', tiktok: '<span class="pf tt">♪</span>', x: '<span class="pf xx">X</span>', telegram: '<span class="pf tg">➤</span>' };
const COVER = { 'news-fb': 'cover-news-fb', 'news-ig': 'cover-news-ig', 'mk-fb': 'cover-mk-fb', 'mk-ig': 'cover-mk-ig' };
const CREATE_URL = { facebook: 'https://www.facebook.com/pages/create', instagram: 'https://www.instagram.com/accounts/emailsignup/' };
const QST = { pending_approval: ['На утверждении', 'b-warn'], approved: ['Утверждено', 'b-ok'], rejected: ['Отклонено', 'b-err'], scheduled: ['Запланировано', 'b-blue'], published: ['Опубликовано', 'b-blue'], retry: ['Повтор', 'b-warn'], failed: ['Ошибка', 'b-err'] };
const qBadge = s => `<span class="badge ${(QST[s] || ['', ''])[1]}">${(QST[s] || [s])[0]}</span>`;
const DEMO = o => o && o.demo ? '<span class="badge b-dev b-none">ДЕМО</span>' : '';
const wsById = id => DB.workspaces.find(w => w.id === id);
const wsByChannel = cid => DB.workspaces.find(w => w.channelId === cid);
const connBadge = w => w.connection.status === 'connected' ? '<span class="badge b-ok">Подключено</span>' : w.connection.status === 'select_page' ? '<span class="badge b-warn">Выберите страницу</span>' : w.connection.status === 'error' ? '<span class="badge b-err">Ошибка подключения</span>' : '<span class="badge">Не подключено</span>';
const brandName = b => b === 'news' ? 'MOONKATTY NEWS' : 'MOONKATTY';
const projFor = b => DB.projects.find(p => p.id === (b === 'news' ? 'news' : 'main'));

function publishReason(it) {
  if (it.demo) return 'Демо-данные не публикуются';
  if (MODE !== 'server') return 'Требуется сервер на Mac и подключённый аккаунт';
  if (!['facebook', 'instagram'].includes(it.platform)) return 'Платформа не подключена (API в разработке)';
  const w = wsByChannel(it.channelId); if (!w || w.connection.status !== 'connected') return 'Не подключено';
  if (!['approved', 'retry'].includes(it.status)) return 'Нужно утверждение';
  return null;
}
function liveIssues(it) { return [...SX.guardrails(it, DB), ...SX.dailyCheck(it, DB.queue, DB.workspaces)]; }

function metaReturnToast() {
  const m = location.hash.match(/meta=(ok|error)(?:&msg=([^&]*))?/); if (!m) return;
  toast(m[1] === 'ok' ? 'Meta: авторизация выполнена — выберите страницу' : 'Meta: ошибка — ' + decodeURIComponent(m[2] || ''), m[1] !== 'ok');
  history.replaceState(null, '', '#social');
}

// ================= Main Social view =================
VIEWS.social = () => {
  const tab = SUB.social || 'pages';
  const tabs = [['pages', 'Страницы FB / IG'], ['queue', `Единая очередь (${DB.queue.length})`], ['analytics', 'Аналитика'], ['community', 'Community'], ['posts', 'Посты (вручную)'],
    ...DB.workspaces.map(w => ['ws:' + w.id, w.title])];
  const sel = tabs.find(t => t[0] === tab) ? tab : 'pages';
  return `<div id="pubDesk" class="card" style="margin-bottom:14px"><h3>Telegram и YouTube</h3><p class="small mut">Проверка…</p></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === sel ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin:-6px 0 14px"><span class="small mut sp">${MODE === 'server' ? 'Подключение через официальный Meta OAuth (Facebook Login for Business, Graph API).' : 'Браузерный демо-режим: OAuth и публикация требуют сервер на Mac.'}</span>
      <button class="btn sm" id="demoLoad">Загрузить демо-данные</button><button class="btn sm danger" id="demoDel">Удалить демо-данные</button></div>
    ${sel === 'pages' ? viewPages() : sel === 'queue' ? viewQueue() : sel === 'analytics' ? viewAnalytics() : sel === 'community' ? viewCommunity() : sel === 'posts' ? LEGACY_SOCIAL() : viewWorkspace(wsById(sel.slice(3)))}`;
};
function paintPublishDesk(v, j) {
  const desk = v.querySelector('#pubDesk'); if (!desk) return;
  const t = j && j.telegram || { status: 'Не подключено', blocker: 'нет данных' };
  const y = j && j.youtube || { status: 'Не подключено', blocker: '' };
  desk.innerHTML = `<h3>Telegram и YouTube</h3><p class="small"><b>Telegram</b> <span class="badge">${esc(t.status || 'Не подключено')}</span> ${esc(t.blocker || '')}</p><p class="small"><b>YouTube</b> <span class="badge">${esc(y.status || 'Не подключено')}</span> ${esc(y.blocker || '')}</p><p class="small mut">${esc(j && j.reason || '')}</p><div class="row"><button class="btn sm" id="tgCheck" type="button">Проверить бота Telegram</button><button class="btn sm" id="ytClient" type="button">Сохранить OAuth-клиент YouTube</button></div>`;
  const tg = v.querySelector('#tgCheck'); if (tg) tg.onclick = () => modal('<h2>Токен бота Telegram</h2><p class="small mut">Это токен от @BotFather, не пароль аккаунта. Без macOS Keychain он не сохраняется.</p><label>Токен</label><input name="token" autocomplete="off"><label>Канал (необязательно)</label><input name="channel" placeholder="@channel">', fd => api('POST', '/api/publish/telegram', fd).then(r => { toast(r.connected ? 'Подключено' : 'Не подключено', !r.connected); paintPublishDesk(v, { ...j, telegram: { ...t, ...r, blocker: r.blocker || '' } }); }).catch(e => toast(e.message, true)));
  const yt = v.querySelector('#ytClient'); if (yt) yt.onclick = () => modal('<h2>OAuth-клиент YouTube</h2><p class="small mut">Пароль Google не нужен. Канал останется «Не подключено», пока владелец не войдёт в браузере на Mac.</p><label>client_id</label><input name="client_id" autocomplete="off"><label>client_secret (необязательно)</label><input name="client_secret" type="password" autocomplete="off">', fd => api('POST', '/api/publish/youtube/client', fd).then(r => { toast(r.status || 'Не подключено', !r.connected); paintPublishDesk(v, { ...j, youtube: { ...y, ...r } }); }).catch(e => toast(e.message, true)));
}
BIND.social = v => {
  const tab = SUB.social || 'pages';
  if (MODE === 'browser') paintPublishDesk(v, { telegram: { status: 'Не подключено', blocker: 'Браузерный режим: Keychain недоступна, токен не сохраняется.' }, youtube: { status: 'Не подключено', blocker: 'Браузерный режим: Keychain недоступна.' }, reason: '' });
  else api('GET', '/api/publish/connectors').then(j => paintPublishDesk(v, j)).catch(e => paintPublishDesk(v, { telegram: { status: 'Не подключено', blocker: e.message }, youtube: { status: 'Не подключено', blocker: '' }, reason: '' }));
  v.querySelector('#demoLoad').onclick = loadDemo;
  v.querySelector('#demoDel').onclick = () => confirmDo('Удалить все демо-данные?', () => act(() => api('POST', '/api/demo/remove'), 'Демо-данные удалены'));
  v.querySelectorAll('[data-open-ws]').forEach(b => b.onclick = () => { SUB.social = 'ws:' + b.dataset.openWs; render(); });
  if (tab === 'posts') LEGACY_SOCIAL_BIND(v);
  bindQueue(v); bindWorkspace(v); bindBottom(v); bindCommunity(v); bindUtm(v); bindPlan(v);
};

function pagePreview(w, big) {
  const c = w.connection, connected = c.status === 'connected';
  const name = connected ? (w.platform === 'instagram' ? (c.igUsername ? '@' + c.igUsername : c.pageName) : c.pageName) : brandName(w.brand);
  const handle = connected ? (c.pageName || '') : (w.brand === 'news' ? '@moonkattynews' : '@moonkatty');
  return `<div class="pv"><div class="pv-label">${connected ? 'Подключённая страница' : 'Предпросмотр — страница ещё не создана'}</div>
    <img class="pv-cover" src="img/${COVER[w.id]}.jpg" alt="">
    <div class="pv-body"><img class="pv-av" src="${connected && c.picture ? esc(c.picture) : 'img/' + (w.brand === 'news' ? 'av-news' : 'av-games') + '.jpg'}" alt="">
      <div><b>${esc(name)}</b><div class="small mut">${esc(handle)}${handle ? ' · ' : ''}${w.brand === 'news' ? 'News & Media' : 'Games'}</div></div></div>
    ${w.platform === 'instagram' ? `<div class="pv-counts"><div><b>0</b><span>публикаций</span></div><div><b>0</b><span>подписчиков</span></div><div><b>0</b><span>подписок</span></div></div><div class="pv-note">нули — макет предпросмотра, не статистика</div>` : ''}
    </div>`;
}
function viewPages() {
  return `<div class="ws-grid">${DB.workspaces.map(w => `<div class="ws-col ${w.platform}">
    <div class="ws-head">${PF_ICON[w.platform]}<b class="sp">${w.platform === 'facebook' ? 'Facebook' : 'Instagram'}</b>
      <a class="btn sm ${w.platform === 'instagram' ? 'ig-btn' : 'primary'}" href="${CREATE_URL[w.platform]}" target="_blank" rel="noopener">+ Создать страницу</a></div>
    <div class="small"><b>${esc(brandName(w.brand))}</b> · <span class="mut">Подготовка страницы для запуска</span></div>
    <div class="row" style="margin:6px 0">${connBadge(w)}<span class="small mut">${w.connection.pageName ? esc(w.connection.pageName) : ''}</span></div>
    ${pagePreview(w)}
    <div class="card" style="padding:12px;margin-top:10px"><h3 style="margin-bottom:6px">План публикаций</h3>${w.planText.map(t => `<div class="small" style="padding:3px 0">✓ ${esc(t)}</div>`).join('')}
      <div class="small mut" style="margin-top:6px">В очереди: ${DB.queue.filter(q => q.channelId === w.channelId && !['published', 'rejected'].includes(q.status)).length}</div></div>
    <button class="btn ${w.platform === 'instagram' ? 'ig-btn' : 'primary'}" style="width:100%;margin-top:10px" data-open-ws="${w.id}">Настроить и запустить</button></div>`).join('')}</div>
  ${bottomRow()}`;
}

// ---- Bottom row: audience strategy (target plan), forecast, monetization, AI agents ----
function bottomRow() {
  const brand = SUB.sbrand || 'news'; const p = projFor(brand);
  const plan = p.audiencePlan || []; const fc = p.forecast || [];
  const mx = Math.max(1, ...fc.map(x => +x.cpm || 0));
  const agents = ['news', 'content', 'publishing', 'analytics', 'community'].map(id => DB.agents.find(a => a.id === id)).filter(Boolean);
  return `<div class="row" style="margin:18px 0 10px"><b>Бренд:</b><span class="seg"><button data-sbrand="news" class="${brand === 'news' ? 'on' : ''}">MOONKATTY NEWS</button><button data-sbrand="main" class="${brand === 'main' ? 'on' : ''}">MOONKATTY</button></span></div>
  <div class="bottom4">
    <div class="card"><h3>Стратегия аудитории <button class="btn sm" id="audEdit">Изм.</button></h3><div class="small mut" style="margin-top:-6px">ЦЕЛЬ (план), не фактические данные</div>
      <div class="row" style="align-items:flex-start;margin-top:8px"><img src="img/world-map.jpg" alt="" style="width:46%;border-radius:8px;opacity:.85">
      <div class="sp">${plan.length ? plan.map(x => `<div class="row small" style="padding:2px 0"><span class="sp">${esc(x.country)}</span><b>${esc(x.share)}%</b></div>`).join('') : '<div class="empty small">План не задан</div>'}</div></div></div>
    <div class="card"><h3>Аналитика (прогноз) <button class="btn sm" id="fcEdit">Изм.</button></h3><div class="small mut" style="margin-top:-6px">Оценка CPM (USD), вводится вручную с источником — не фактический доход</div>
      ${fc.length ? `<div class="fc">${fc.map(x => `<div class="fc-bar" title="${esc(x.source || '')}"><b>${esc(x.cpm)}</b><i style="height:${(+x.cpm || 0) / mx * 90}px"></i><span>${esc(x.country)}</span></div>`).join('')}</div>
        <div class="small mut">Источники: ${[...new Set(fc.map(x => x.source).filter(Boolean))].map(esc).join('; ') || '—'}</div>` : '<div class="empty">нет данных</div>'}</div>
    <div class="card"><h3>Монетизация</h3>${monetList(DB.workspaces.find(w => w.brand === brand && w.platform === 'facebook'), true)}</div>
    <div class="card ai-card"><h3>ИИ-Агенты</h3><div class="row" style="align-items:flex-start"><img src="img/agent-bot.jpg" alt="" style="width:96px;border-radius:10px">
      <div class="sp">${agents.map(a => `<label class="small row" style="margin:3px 0"><input type="checkbox" data-agent-on="${a.id}" ${a.enabled ? 'checked' : ''} style="width:auto;accent-color:#7c3aed"> ${esc(a.name)}</label>`).join('')}</div></div>
      <button class="btn primary" style="width:100%;margin-top:10px" id="runAgents">Запустить ИИ-Агентов</button>
      <div class="small mut" style="margin-top:6px">Создаёт реальные задачи в очереди агентов; автономное выполнение — в разработке.</div></div>
  </div>`;
}
function monetList(w, compact) {
  const progs = SX.MONETIZATION[w ? w.platform : 'facebook'];
  return progs.map(([k, l]) => { const m = (w && w.monetization || {})[k];
    return `<div class="list-item small"><span class="sp">${esc(l)}</span>${m && m.confirmed ? `<span class="badge b-ok" title="${esc(m.note || '')}">Подтверждено вручную ${fmt(m.at)}</span>` : '<span class="badge">Не подтверждено</span>'}
      ${compact ? '' : `<button class="btn sm" data-monet="${w.id}|${k}">${m && m.confirmed ? 'Снять' : 'Отметить проверенным'}</button>`}</div>`; }).join('') +
    `<div class="small mut" style="margin-top:6px">Доступность программ подтверждается только в Meta Business Suite / Professional Dashboard аккаунта. Автопроверка через API — в разработке.</div>`;
}
function bindBottom(v) {
  v.querySelectorAll('[data-sbrand]').forEach(b => b.onclick = () => { SUB.sbrand = b.dataset.sbrand; render(); });
  const brand = SUB.sbrand || 'news'; const p = projFor(brand);
  const ae = v.querySelector('#audEdit'); if (ae) ae.onclick = () => modal(`<h2>Стратегия аудитории (цель)</h2><p class="small mut">Строка: Страна; доля %. Это план, а не данные.</p><textarea name="t" rows="8">${esc((p.audiencePlan || []).map(x => x.country + '; ' + x.share).join('\n') || (brand === 'news' ? 'США; 40\nКанада; 20\nВеликобритания; 25\nАвстралия; 15' : ''))}</textarea>`,
    fd => act(() => api('PUT', '/api/projects/' + p.id, { audiencePlan: fd.t.split('\n').map(l => l.split(';')).filter(x => x[0].trim()).map(([c, s]) => ({ country: c.trim(), share: +String(s || 0).trim() || 0 })) }), 'Сохранено'));
  const fe = v.querySelector('#fcEdit'); if (fe) fe.onclick = () => modal(`<h2>Прогноз CPM (оценка)</h2><p class="small mut">Строка: Страна; CPM USD; источник оценки. Без источника не сохраняется.</p><textarea name="t" rows="8">${esc((p.forecast || []).map(x => [x.country, x.cpm, x.source].join('; ')).join('\n'))}</textarea>`,
    fd => { const rows = fd.t.split('\n').map(l => l.split(';').map(s => s.trim())).filter(x => x[0]); if (rows.some(r => !r[2] || isNaN(+r[1]))) { toast('Для каждой строки нужны число CPM и источник', true); return false; }
      return act(() => api('PUT', '/api/projects/' + p.id, { forecast: rows.map(([country, cpm, source]) => ({ country, cpm: +cpm, source })) }), 'Сохранено'); });
  v.querySelectorAll('[data-agent-on]').forEach(c => c.onchange = () => act(() => api('PUT', '/api/agents/' + c.dataset.agentOn, { enabled: c.checked, status: 'idle' })));
  const ra = v.querySelector('#runAgents'); if (ra) ra.onclick = () => runAgents(brand);
  v.querySelectorAll('[data-monet]').forEach(b => b.onclick = () => { const [wid, k] = b.dataset.monet.split('|'); const w = wsById(wid); const m = (w.monetization || {})[k];
    if (m && m.confirmed) return act(() => api('PUT', '/api/workspaces/' + wid, { monetization: { ...w.monetization, [k]: { confirmed: false } } }), 'Обновлено');
    modal(`<h2>Подтверждение программы</h2><p class="small">Отмечайте только если программа действительно активна для этого аккаунта (проверено в Meta Business Suite).</p><label>Где проверено / примечание</label><input name="note" required>`,
      fd => act(() => api('PUT', '/api/workspaces/' + wid, { monetization: { ...(w.monetization || {}), [k]: { confirmed: true, note: fd.note, at: C.now(), by: USER } } }), 'Сохранено')); });
}
async function runAgents(brand) {
  const on = id => DB.agents.find(a => a.id === id)?.enabled;
  const T = [['news', 'Собрать и проверить новости для ' + brandName(brand)], ['content', 'Адаптировать материалы под платформы (' + brandName(brand) + ')'], ['publishing', 'Сформировать расписание публикаций (' + brandName(brand) + ')'],
    ['analytics', 'Отчёт по соцсетям ' + brandName(brand)], ['community', 'Подготовить черновики ответов на комментарии (на утверждение)']].filter(([a]) => on(a));
  if (!T.length) return toast('Нет включённых агентов', true);
  await act(async () => { for (const [agentId, title] of T) await api('POST', '/api/tasks', { title, agentId, priority: 'normal', status: 'queued', project: brand === 'news' ? 'news' : 'main', schedule: { type: 'none' }, source: 'social' }); }, 'Задачи агентам созданы: ' + T.length);
}

// ================= Unified publishing queue =================
function queueRows(items) {
  if (!items.length) return '<div class="empty">Очередь пуста. Создайте материал — Content Agent подготовит варианты для каждой платформы.</div>';
  const groups = {}; for (const it of items) (groups[it.materialId] = groups[it.materialId] || []).push(it);
  return Object.values(groups).sort((a, b) => (b[0].createdAt || '').localeCompare(a[0].createdAt || '')).map(g => { const m = g[0];
    return `<div class="card" style="margin-bottom:12px"><h3><span>${DEMO(m)} ${esc(m.title)} <small>${esc(brandName(m.brand))} · ${fmt(m.createdAt)}</small></span>
      <span class="row">${m.brand === 'news' ? (m.factCheck === 'passed' ? '<span class="badge b-ok">Фактчек пройден</span>' : `<button class="btn sm" data-fc="${m.materialId}">Отметить: фактчек пройден</button>`) : ''}
      <button class="btn sm danger" data-mdel="${m.materialId}">✕</button></span></h3>
      ${m.sourceUrl ? `<div class="small mut">Источник: <a href="${safeUrl(m.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(SX.hostOf(m.sourceUrl))}</a></div>` : ''}
      <div class="tbl-wrap"><table><tr><th>Канал</th><th>Формат</th><th>Длина</th><th>Время</th><th>Статус</th><th>Проверки</th><th>Действия</th></tr>${g.map(it => { const iss = liveIssues(it); const why = publishReason(it);
        return `<tr><td>${PF_ICON[it.platform] || ''} ${esc(chName(it.channelId))}</td><td class="small">${esc(it.format)}<div class="mut">${esc(it.aspect)}</div></td>
        <td class="small" style="color:${it.length > it.limit ? 'var(--err)' : ''}">${it.length}/${it.limit}</td><td class="small">${fmt(it.scheduledAt)}</td><td>${qBadge(it.status)}${it.lastError ? `<div class="small" style="color:var(--err)">${esc(it.lastError.message)}${it.nextRetryAt ? ' · ' + fmt(it.nextRetryAt) : ''}</div>` : ''}</td>
        <td class="small">${iss.length ? iss.map(x => `<div style="color:#fbbf24">⚠ ${esc(x)}</div>`).join('') : '<span style="color:#4ade80">✓ OK</span>'}${(it.warnings || []).map(x => `<div class="mut">• ${esc(x)}</div>`).join('')}</td>
        <td><div class="row"><button class="btn sm" data-qprev="${it.id}">Предпросмотр</button>
          ${['pending_approval', 'rejected'].includes(it.status) ? `<button class="btn sm primary" data-qst="${it.id}|approved">Утвердить</button>` : ''}${it.status === 'pending_approval' ? `<button class="btn sm danger" data-qst="${it.id}|rejected">Отклонить</button>` : ''}
          <button class="btn sm" data-qpub="${it.id}" ${why ? 'disabled' : ''} title="${esc(why || '')}">Опубликовать</button>${why ? `<span class="small mut">${esc(why)}</span>` : ''}
          <button class="btn sm ghost" data-qhist="${it.id}">История</button></div></td></tr>`; }).join('')}</table></div></div>`; }).join('');
}
function viewQueue() {
  const f = SUB.qch || ''; const items = DB.queue.filter(q => !f || q.channelId === f);
  return `<div class="row" style="margin-bottom:12px"><button class="btn primary" id="newMat">+ Материал</button><select id="qch" style="width:auto">${opts([['', 'Все каналы'], ...DB.channels.map(c => [c.id, c.name])], f)}</select>
    <span class="sp"></span><span class="small mut">Ручное утверждение включено для всех каналов. Автопубликация — отдельный переключатель в настройках страницы (по умолчанию выкл.).</span></div>
    <div class="devbox" style="margin-bottom:12px">Публикация идёт только через официальные API подключённых аккаунтов. YouTube, TikTok, X, Telegram — API в разработке: кнопка неактивна с причиной. Ошибки публикации повторяются с нарастающей задержкой (до 5 попыток).</div>
    ${queueRows(items)}`;
}
function materialForm(brand) {
  const eps = DB.episodes; const chs = DB.channels;
  modal(`<h2>Новый материал → варианты для платформ</h2>
    <div class="grid g2" style="gap:8px"><div><label>Бренд</label><select name="brand">${opts([['news', 'MOONKATTY NEWS'], ['main', 'MOONKATTY']], brand || 'news')}</select></div>
    <div><label>Тип</label><select name="kind">${opts([['news', 'Новость'], ['game', 'Новость игры'], ['update', 'Анонс обновления'], ['trailer', 'Reels / трейлер'], ['brand', 'Бренд-пост']], 'news')}</select></div></div>
    <label>Заголовок</label><input name="title" required><label>Текст</label><textarea name="text" rows="4"></textarea>
    <div class="grid g2" style="gap:8px"><div><label>Ссылка (UTM добавится автоматически)</label><input name="link" placeholder="https://moonkatty.com/"></div><div><label>Источник новости (URL)</label><input name="sourceUrl" placeholder="https://…"></div>
    <div><label>Выпуск (для фактчека)</label><select name="episodeId"><option value="">—</option>${opts(eps.map(e => [e.id, e.title]), '')}</select></div><div><label>Хэштеги (через пробел)</label><input name="hashtags" placeholder="moonkatty news"></div>
    <div><label>Медиа URL (публичный https)</label><input name="mediaUrl"></div><div><label>Тип медиа</label><select name="mediaType">${opts([['none', 'Нет'], ['image', 'Изображение'], ['video', 'Видео'], ['carousel', 'Карусель']], 'none')}</select></div>
    <div><label>Права на изображение</label><select name="imageRights">${opts([['', '— не указано —'], ['own', 'Своё'], ['licensed', 'Лицензия'], ['generated', 'Сгенерировано']], '')}</select></div>
    <div><label>Формат Instagram</label><select name="igFormat">${opts([['', 'Авто'], ['photo', 'Пост'], ['carousel', 'Карусель'], ['reel', 'Reels'], ['story', 'Stories']], '')}</select></div>
    <div><label>Время публикации</label><input type="datetime-local" name="scheduledAt"></div></div>
    <label>Каналы</label><div class="row">${chs.map(c => `<label class="small row" style="margin:2px 8px 2px 0"><input type="checkbox" name="ch_${c.id}" style="width:auto" ${['fb-news', 'ig-news'].includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>`,
    fd => { const chosen = chs.filter(c => fd['ch_' + c.id]).map(c => c.id); if (!chosen.length) { toast('Выберите хотя бы один канал', true); return false; }
      return createMaterial({ brand: fd.brand, kind: fd.kind, title: fd.title, text: fd.text, link: fd.link.trim() || (fd.brand === 'main' ? 'https://moonkatty.com/' : ''), sourceUrl: fd.sourceUrl.trim(), episodeId: fd.episodeId || null,
        hashtags: fd.hashtags.split(/\s+/).filter(Boolean), mediaUrl: fd.mediaUrl.trim(), mediaType: fd.mediaType, imageRights: fd.imageRights, igFormat: fd.igFormat || null,
        scheduledAt: fd.scheduledAt ? new Date(fd.scheduledAt).toISOString() : null }, chosen); });
}
async function createMaterial(src, channels, demo) {
  const materialId = C.uid(); src.id = materialId;
  return act(async () => { for (const cid of channels) { const v = SX.adapt(src, cid);
    await api('POST', '/api/queue', { ...src, ...v, id: undefined, materialId, status: 'pending_approval', factCheck: 'pending', attempts: 0, history: [{ at: C.now(), event: 'created', user: USER || 'demo' }], demo: !!demo });
    if (v.utmLink) await api('POST', '/api/utm', { url: v.utmLink, base: src.link, source: v.platform, campaign: src.brand === 'news' ? 'moonkatty_news' : 'moonkatty', materialId, brand: src.brand, demo: !!demo }); } },
    demo ? null : 'Варианты созданы: ' + channels.length);
}
function bindQueue(v) {
  const nm = v.querySelector('#newMat'); if (nm) nm.onclick = () => materialForm(SUB.sbrand);
  const qc = v.querySelector('#qch'); if (qc) qc.onchange = () => { SUB.qch = qc.value; render(); };
  v.querySelectorAll('[data-qst]').forEach(b => b.onclick = () => { const [id, s] = b.dataset.qst.split('|'); act(() => api('PUT', '/api/queue/' + id, { status: s }), 'Статус: ' + QST[s][0]); });
  v.querySelectorAll('[data-qpub]').forEach(b => b.onclick = () => act(() => api('POST', `/api/queue/${b.dataset.qpub}/publish`), 'Опубликовано'));
  v.querySelectorAll('[data-fc]').forEach(b => b.onclick = () => confirmDo('Подтверждаете, что факты проверены человеком? Отметка сохраняется в истории.', () => act(async () => {
    for (const it of DB.queue.filter(q => q.materialId === b.dataset.fc)) await api('PUT', '/api/queue/' + it.id, { factCheck: 'passed', factCheckBy: USER, factCheckAt: C.now(), history: [...(it.history || []), { at: C.now(), event: 'factcheck_passed', user: USER }] }); }, 'Фактчек отмечен')));
  v.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => confirmDo('Удалить материал и все варианты?', () => act(async () => { for (const it of DB.queue.filter(q => q.materialId === b.dataset.mdel)) await api('DELETE', '/api/queue/' + it.id); }, 'Удалено')));
  v.querySelectorAll('[data-qprev]').forEach(b => b.onclick = () => { const it = DB.queue.find(q => q.id === b.dataset.qprev);
    modal(`<h2>${PF_ICON[it.platform] || ''} ${esc(chName(it.channelId))} — ${esc(it.format)} ${DEMO(it)}</h2><div class="small mut">${it.length}/${it.limit} · ${esc(it.aspect)}</div>
      ${it.mediaUrl && it.mediaType === 'image' ? `<img src="${esc(it.mediaUrl)}" alt="" style="max-width:100%;border-radius:8px;margin:8px 0">` : ''}<pre class="box" data-notr>${esc(it.text)}</pre>
      <label>Изменить текст варианта</label><textarea name="text" rows="6" data-notr>${esc(it.text)}</textarea>`,
      fd => act(() => api('PUT', '/api/queue/' + it.id, { text: fd.text, length: fd.text.length }), 'Сохранено')); });
  v.querySelectorAll('[data-qhist]').forEach(b => b.onclick = () => { const it = DB.queue.find(q => q.id === b.dataset.qhist);
    modal(`<h2>История публикации</h2>${(it.history || []).map(h => `<div class="small list-item"><span class="mut">${fmt(h.at)}</span><span class="sp">${esc(h.event)}${h.error ? ' — ' + esc(h.error) : ''}${h.externalId ? ' · id ' + esc(h.externalId) : ''}</span><span class="mut">${esc(h.user || '')}</span></div>`).join('') || '<div class="empty">Пусто</div>'}`); });
}

// ================= Workspace detail =================
function viewWorkspace(w) {
  if (!w) return '<div class="empty">—</div>';
  const c = w.connection, s = w.settings, server = MODE === 'server', connected = c.status === 'connected';
  const perms = SX.PERMISSIONS[w.platform];
  return `<div class="grid g2">
  <div class="card"><h3><span>${PF_ICON[w.platform]} ${esc(w.title)}</span>${connBadge(w)}</h3>
    ${pagePreview(w)}
    <div class="row" style="margin-top:12px">
      <a class="btn sm" href="${CREATE_URL[w.platform]}" target="_blank" rel="noopener">+ Создать страницу</a>
      ${server ? `<a class="btn sm primary" href="/api/meta/oauth/start?ws=${w.id}">${connected ? 'Переподключить' : 'Подключить через Facebook'}</a>` : `<button class="btn sm primary" disabled>Подключить через Facebook</button><span class="small mut">Требуется сервер на Mac</span>`}
      <button class="btn sm" data-wcheck="${w.id}" ${server && c.status !== 'not_connected' ? '' : 'disabled'}>Проверить права</button>
      <button class="btn sm danger" data-wdisc="${w.id}" ${server && c.status !== 'not_connected' ? '' : 'disabled'}>Отключить</button></div>
    ${c.status === 'select_page' ? `<label>Выберите страницу</label><div class="row"><select id="pageSel" class="sp">${opts((c.candidates || []).map(p => [p.id, p.name + (p.ig ? ' (IG: @' + p.ig.username + ')' : w.platform === 'instagram' ? ' — нет IG' : '')]), '')}</select><button class="btn sm primary" data-wselect="${w.id}">Выбрать</button></div>` : ''}
    <h4 style="margin:14px 0 6px">Разрешения</h4><div class="row">${perms.map(p => `<span class="badge b-none ${c.permissions.includes(p) ? 'b-ok' : c.checkedAt ? 'b-err' : ''}" data-notr>${p}</span>`).join('')}</div>
    <div class="small mut" style="margin-top:6px">${c.checkedAt ? `Проверено: ${fmt(c.checkedAt)}${c.tokenExpires ? ' · токен до ' + fmt(c.tokenExpires) : ''}${c.missingPermissions.length ? ' · не хватает: ' + c.missingPermissions.join(', ') : ''}` : 'Права ещё не проверялись (me/permissions, debug_token)'}</div>
    ${c.lastError ? `<div class="devbox" style="margin-top:8px;border-color:#ef444466;color:#fca5a5">Ошибка API: ${esc(c.lastError.message)}${c.lastError.code ? ' (код ' + esc(c.lastError.code) + ')' : ''}${c.lastError.rateLimited ? ' — превышен лимит запросов' : ''} · ${fmt(c.lastError.at)}</div>` : ''}
    ${c.rateLimit && (c.rateLimit.appUsage || c.rateLimit.bucUsage) ? `<div class="small mut" style="margin-top:6px" data-notr>Rate limit: ${esc(c.rateLimit.appUsage || '')} ${esc(c.rateLimit.bucUsage || '')}</div>` : ''}</div>
  <div class="card"><h3>Настройки публикации</h3><form id="wsSet">
    <div class="grid g2" style="gap:8px"><div><label>Язык</label><select name="language">${opts([['en', 'English'], ['ru', 'Русский'], ['uk', 'Українська']], s.language)}</select></div>
    <div><label>Страны (цель)</label><input name="countries" value="${esc(s.countries.join(', '))}" placeholder="US, CA, GB, AU"></div>
    <div><label>Постов в день (макс.)</label><input type="number" min="1" name="postsPerDay" value="${w.limits.postsPerDay}"></div>
    <div><label>${w.platform === 'instagram' ? 'Reels в день (макс.)' : 'Видео в день (макс.)'}</label><input type="number" min="0" name="vids" value="${w.limits.videosPerDay ?? w.limits.reelsPerDay ?? 0}"></div></div>
    <label>Слоты расписания (ЧЧ:ММ через запятую)</label><input name="slots" value="${esc(s.slots.join(', '))}">
    <label class="row small" style="margin-top:10px"><input type="checkbox" name="manualApproval" ${s.manualApproval ? 'checked' : ''} style="width:auto"> Ручное утверждение публикаций</label>
    <label class="row small"><input type="checkbox" name="autopublish" ${s.autopublish ? 'checked' : ''} ${connected ? '' : 'disabled'} style="width:auto"> Автопубликация утверждённых по расписанию ${connected ? '' : '— недоступно: Не подключено'}</label>
    <div class="small mut">Форматы: ${w.formats.join(', ')} · адаптация: ${Object.entries(SX.PLATFORMS[w.platform].aspect).map(([k, a]) => k + ' ' + a).join(', ')} · подпись до ${SX.PLATFORMS[w.platform].text} симв.</div>
    <button class="btn primary" style="margin-top:10px">Сохранить</button></form></div>
  <div class="card"><h3>Аналитика <button class="btn sm" data-wins="${w.id}" ${server && connected ? '' : 'disabled'}>Обновить из API</button></h3>${analyticsBlock(w)}</div>
  <div class="card"><h3>Монетизация</h3>${monetList(w)}</div>
  <div class="card" style="grid-column:1/-1"><h3>Очередь контента <button class="btn sm primary" id="newMat">+ Материал</button></h3>${queueRows(DB.queue.filter(q => q.channelId === w.channelId))}</div>
  ${contentPlan(w.brand === 'news' ? 'news' : 'main')}
  ${w.brand === 'main' ? utmBlock() : `<div class="card"><h3>Правила NEWS</h3><div class="small">✓ Только новости, прошедшие этап «Проверка фактов»<br>✓ Обязательная ссылка на источник и атрибуция<br>✓ Права на изображение: своё / лицензия / сгенерировано<br>✓ Защита от дублей: URL и похожесть заголовка (7 дней)<br>✓ Язык: English · страны: US / CA / UK / AU<br>✓ Лимиты: ${w.platform === 'facebook' ? '8–15 постов и до 2 видео в день' : '3–5 постов, до 2 Reels в день, Stories, карусели'}</div></div>`}
  </div>`;
}
function analyticsBlock(w) {
  const a = w.analytics; const conn = w.connection.status === 'connected';
  const row = (l, v) => `<div class="list-item small"><span class="sp">${l}</span>${v}</div>`;
  const NC = '<span class="badge">Не подключено</span>';
  const act_ = a && a.actual && conn;
  return `<div class="small mut" style="margin-bottom:4px">Факт (из Graph API)${a?.fetchedAt ? ' · ' + fmt(a.fetchedAt) : ''}</div>
    ${row('Подписчики', act_ && a.actual.followers != null ? '<b>' + a.actual.followers + '</b>' : NC)}${row('Просмотры / охват', act_ && a.actual.insights ? '<b>' + esc(a.actual.insights.map(m => m.name + ': ' + JSON.stringify((m.total_value || m.values?.slice(-1)[0] || {}).value ?? '—')).join(', ')) + '</b>' : NC)}
    ${row('Вовлечённость', NC)}${row('География аудитории', act_ && a.actual.geo ? '<b>есть</b>' : NC)}${row('Переходы на сайт (UTM)', NC)}${row('Доход', NC)}
    ${a?.errors?.length ? `<div class="small" style="color:var(--err)">${a.errors.map(e => esc(e.label + ': ' + e.message)).join('<br>')}</div>` : ''}
    <div class="small mut" style="margin-top:6px">Прогнозы — отдельно, в блоке «Аналитика (прогноз)», и никогда не смешиваются с фактом.</div>`;
}
function bindWorkspace(v) {
  const f = v.querySelector('#wsSet'); if (f) f.onsubmit = e => { e.preventDefault(); const w = wsById((SUB.social || '').slice(3)); const fd = Object.fromEntries(new FormData(f));
    const limits = { ...w.limits, postsPerDay: Math.max(1, +fd.postsPerDay || 1) }; if (w.platform === 'instagram') limits.reelsPerDay = +fd.vids || 0; else limits.videosPerDay = +fd.vids || 0;
    act(() => api('PUT', '/api/workspaces/' + w.id, { limits, settings: { ...w.settings, language: fd.language, countries: fd.countries.split(/[,\s]+/).filter(Boolean).map(x => x.toUpperCase()), slots: fd.slots.split(/[,\s]+/).filter(x => /^\d{1,2}:\d{2}$/.test(x)),
      manualApproval: !!fd.manualApproval, autopublish: !!fd.autopublish && w.connection.status === 'connected' } }), 'Сохранено'); };
  v.querySelectorAll('[data-wcheck]').forEach(b => b.onclick = () => act(() => api('POST', `/api/meta/ws/${b.dataset.wcheck}/check`), 'Права проверены'));
  v.querySelectorAll('[data-wdisc]').forEach(b => b.onclick = () => confirmDo('Отключить аккаунт? Токены будут удалены с сервера.', () => act(() => api('POST', `/api/meta/ws/${b.dataset.wdisc}/disconnect`), 'Отключено')));
  v.querySelectorAll('[data-wselect]').forEach(b => b.onclick = () => act(() => api('POST', `/api/meta/ws/${b.dataset.wselect}/select`, { pageId: v.querySelector('#pageSel').value }), 'Страница подключена'));
  v.querySelectorAll('[data-wins]').forEach(b => b.onclick = () => act(() => api('POST', `/api/meta/ws/${b.dataset.wins}/insights`), 'Аналитика обновлена'));
}

// ================= UTM (main brand) =================
function utmBlock() {
  const items = DB.utm.filter(u => u.brand !== 'news').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 15);
  return `<div class="card"><h3>UTM-ссылки (сайт и Telegram)</h3><form id="utmForm" class="grid g2" style="gap:8px">
    <div><label>Адрес</label><select name="base">${opts([['https://moonkatty.com/', 'moonkatty.com'], ['https://t.me/moonkattymkty', 't.me/moonkattymkty']], '')}</select></div>
    <div><label>Источник</label><select name="source">${opts(['facebook', 'instagram', 'youtube', 'tiktok', 'x', 'telegram'].map(x => [x, x]), 'facebook')}</select></div>
    <div><label>Кампания</label><input name="campaign" value="moonkatty"></div><div style="align-self:end"><button class="btn primary">Создать ссылку</button></div></form>
    ${items.length ? items.map(u => `<div class="list-item small"><span class="sp" style="word-break:break-all" data-notr>${DEMO(u)} ${esc(u.url)}</span><span class="mut">Клики: </span><span class="badge">Не подключено</span><button class="btn sm" data-copy="${esc(u.url)}">Копировать</button></div>`).join('') : '<div class="empty small">Ссылок пока нет</div>'}
    <div class="small mut">Генерация UTM работает. Подсчёт кликов требует веб-аналитики сайта — Не подключено.</div></div>`;
}
function bindUtm(v) {
  const f = v.querySelector('#utmForm'); if (f) f.onsubmit = e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(f)); const url = SX.utmUrl(fd.base, fd.source, fd.campaign.trim() || 'moonkatty');
    act(() => api('POST', '/api/utm', { url, base: fd.base, source: fd.source, campaign: fd.campaign, brand: 'main' }), 'UTM-ссылка создана'); };
  v.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Скопировано'); } catch { toast('Не удалось скопировать', true); } });
}

// ================= Analytics per brand =================
function viewAnalytics() {
  return ['news', 'main'].map(brand => { const ws = DB.workspaces.filter(w => w.brand === brand); const q = DB.queue.filter(x => x.brand === brand && !x.demo);
    const by = s => q.filter(x => x.status === s).length; const p = projFor(brand);
    return `<h3 style="margin:8px 0">${brandName(brand)}</h3><div class="grid g4" style="margin-bottom:12px">
      <div class="card"><div class="stat-l">В очереди (реальные)</div><div class="stat">${q.filter(x => !['published', 'rejected'].includes(x.status)).length}</div></div>
      <div class="card"><div class="stat-l">Опубликовано</div><div class="stat">${by('published')}</div></div><div class="card"><div class="stat-l">Ошибки публикации</div><div class="stat">${by('failed') + by('retry')}</div></div>
      <div class="card"><div class="stat-l">UTM-ссылок создано</div><div class="stat">${DB.utm.filter(u => u.brand === brand && !u.demo).length}</div></div></div>
    <div class="grid g2" style="margin-bottom:18px">${ws.map(w => `<div class="card"><h3>${PF_ICON[w.platform]} ${esc(w.title)} ${connBadge(w)}</h3>${analyticsBlock(w)}</div>`).join('')}
      <div class="card"><h3>Прогноз (оценка, не факт)</h3>${(p.forecast || []).length ? (p.forecast).map(x => `<div class="list-item small"><span class="sp">${esc(x.country)}</span>CPM ~${esc(x.cpm)} USD <span class="mut">(${esc(x.source)})</span></div>`).join('') : '<div class="empty">нет данных</div>'}</div>
      <div class="card"><h3>Эффективность постов</h3>${q.filter(x => x.status === 'published').length ? q.filter(x => x.status === 'published').map(x => `<div class="list-item small"><span class="sp">${esc(x.title)}</span>${esc(chName(x.channelId))} · <span class="badge">метрики: Не подключено</span></div>`).join('') : '<div class="empty">Нет опубликованных постов</div>'}</div></div>`; }).join('');
}

// ================= Community agent =================
function viewCommunity() {
  const items = [...DB.comments].sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  const server = MODE === 'server';
  return `<div class="row" style="margin-bottom:12px">${DB.workspaces.map(w => `<button class="btn sm" data-csync="${w.id}" ${server && w.connection.status === 'connected' ? '' : 'disabled'}>Синхронизировать: ${esc(w.title)}</button>`).join('')}</div>
    <div class="devbox" style="margin-bottom:12px">Community Agent готовит черновики ответов (шаблон без ИИ, или LLM после подключения Ollama — в разработке). Ответ отправляется только после вашего утверждения и только при подключённом аккаунте.</div>
    ${items.length ? items.map(c => `<div class="card" style="margin-bottom:10px"><div class="row"><b>${esc(c.author)}</b>${DEMO(c)}<span class="small mut">${esc((wsById(c.workspaceId) || {}).title || '')} · ${fmt(c.at)}</span><span class="sp"></span>${qBadge(c.status === 'new' ? 'pending_approval' : c.status)}</div>
      <div data-notr style="margin:6px 0">${esc(c.text)}</div>${c.draft ? `<pre class="box" data-notr>${esc(c.draft)}</pre>` : ''}
      <div class="row"><button class="btn sm" data-cdraft="${c.id}">${c.draft ? 'Изменить черновик' : 'Черновик ответа'}</button>${c.draft && c.status !== 'approved' && c.status !== 'replied' ? `<button class="btn sm primary" data-capprove="${c.id}">Утвердить</button>` : ''}
      ${(() => { const why = c.demo ? 'Демо-данные не публикуются' : !server ? 'Требуется сервер на Mac и подключённый аккаунт' : c.status !== 'approved' ? 'Нужно утверждение' : null; return `<button class="btn sm" data-creply="${c.id}" ${why ? 'disabled' : ''}>Отправить ответ</button>${why ? `<span class="small mut">${why}</span>` : ''}`; })()}
      <button class="btn sm danger" data-cdel="${c.id}">✕</button></div></div>`).join('') : '<div class="empty">Комментариев нет. Они появятся после подключения страниц и синхронизации.</div>'}`;
}
function bindCommunity(v) {
  v.querySelectorAll('[data-csync]').forEach(b => b.onclick = () => act(() => api('POST', `/api/meta/ws/${b.dataset.csync}/comments/sync`), 'Синхронизировано'));
  v.querySelectorAll('[data-cdraft]').forEach(b => b.onclick = () => { const c = DB.comments.find(x => x.id === b.dataset.cdraft);
    const tpl = c.draft || (/\?/.test(c.text) ? `Thanks for your question, ${c.author}! We'll share details soon — follow for updates. 🐾` : `Thank you, ${c.author}! 🐾 9 Lives. One Moon.`);
    modal(`<h2>Черновик ответа</h2><div class="small mut" data-notr>${esc(c.text)}</div><label>Ответ (шаблон Community Agent, без ИИ)</label><textarea name="d" rows="4" data-notr>${esc(tpl)}</textarea>`,
      fd => act(() => api('PUT', '/api/comments/' + c.id, { draft: fd.d, status: 'drafted' }), 'Черновик сохранён')); });
  v.querySelectorAll('[data-capprove]').forEach(b => b.onclick = () => act(() => api('PUT', '/api/comments/' + b.dataset.capprove, { status: 'approved' }), 'Утверждено'));
  v.querySelectorAll('[data-creply]').forEach(b => b.onclick = () => act(() => api('POST', `/api/comments/${b.dataset.creply}/reply`), 'Ответ отправлен'));
  v.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => act(() => api('DELETE', '/api/comments/' + b.dataset.cdel), 'Удалено'));
}

// ================= Demo data (clearly labelled, removable) =================
async function loadDemo() {
  if (DB.queue.some(q => q.demo)) return toast('Демо-данные уже загружены', true);
  const soon = h => new Date(Date.now() + h * 3600e3).toISOString();
  await createMaterial({ brand: 'news', kind: 'news', title: '[ДЕМО] Bitcoin ETF inflows hit weekly high', text: 'Demo text — not a real news item.', link: '', sourceUrl: 'https://example.com/demo-news-1', hashtags: ['crypto', 'news'], mediaUrl: 'https://example.com/demo.jpg', mediaType: 'image', imageRights: '', scheduledAt: soon(3) }, ['fb-news', 'ig-news', 'x', 'telegram'], true);
  await createMaterial({ brand: 'main', kind: 'update', title: '[ДЕМО] MOONKATTY game update announcement', text: 'Demo text — new levels are coming.', link: 'https://moonkatty.com/', sourceUrl: '', hashtags: ['moonkatty', 'gaming'], mediaUrl: 'https://example.com/demo-trailer.mp4', mediaType: 'video', imageRights: 'own', igFormat: 'reel', scheduledAt: soon(5) }, ['fb-main', 'ig-main', 'yt-main', 'tiktok', 'telegram'], true);
  await act(async () => { await api('POST', '/api/comments', { workspaceId: 'mk-fb', platform: 'facebook', author: 'Demo User', text: '[ДЕМО] When is the next update?', at: C.now(), status: 'new', demo: true }); }, 'Демо-данные загружены (помечены «ДЕМО»)');
}

// ================= Settings: Meta app =================
const SETTINGS_BASE = VIEWS.settings, SETTINGS_BASE_BIND = BIND.settings;
VIEWS.settings = () => SETTINGS_BASE() + `<div class="card" style="margin-top:16px"><h3>Meta-приложение (Facebook / Instagram)</h3>
  <p class="small mut" style="margin-top:0">App Secret хранится на сервере в зашифрованном виде (AES-256-GCM) и никогда не возвращается в браузер. Можно задать через переменные окружения META_APP_ID / META_APP_SECRET / META_REDIRECT_URI. Инструкция: docs/CONNECT_META.md.</p>
  ${MODE === 'server' ? `<form id="metaCfg" class="grid g2" style="gap:8px"><div><label>App ID</label><input name="appId"></div><div><label>App Secret</label><input name="appSecret" type="password" placeholder="не изменяется, если пусто" autocomplete="off"></div>
    <div><label>Redirect URI</label><input name="redirectUri" placeholder="https://<mac>.<tailnet>.ts.net/api/meta/oauth/callback"></div><div><label>Configuration ID (Facebook Login for Business, опционально)</label><input name="configId"></div>
    <div><label>Версия Graph API</label><input name="graphVersion" placeholder="v26.0"></div><div style="align-self:end"><button class="btn primary">Сохранить</button> <span id="metaCfgState" class="small mut"></span></div></form>`
  : '<div class="devbox">Требуется сервер на Mac: OAuth и токены Meta работают только на сервере</div>'}</div>`;
BIND.settings = v => {
  SETTINGS_BASE_BIND(v); const f = v.querySelector('#metaCfg'); if (!f) return;
  api('GET', '/api/meta/config').then(c => { ['appId', 'redirectUri', 'configId', 'graphVersion'].forEach(k => f[k].value = c[k] || ''); v.querySelector('#metaCfgState').textContent = i18n.tr(c.hasSecret ? 'Секрет сохранён' : 'Секрет не задан') + (c.source === 'env' ? ' · env' : '');
    if (c.source === 'env') [...f.elements].forEach(e => e.disabled = true); }).catch(() => {});
  f.onsubmit = e => { e.preventDefault(); act(() => api('PUT', '/api/meta/config', Object.fromEntries(new FormData(f))), 'Сохранено'); };
};
