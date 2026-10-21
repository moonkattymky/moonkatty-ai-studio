/* MOONKATTY AI STUDIO — frontend. Two modes:
   server  — Node/Express + SQLite backend (/api)
   browser — standalone demo, data in localStorage (GitHub Pages) */
'use strict';
const C = window.MKCore;
let MODE = 'browser', USER = null, DB = {}, SYS = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = d => d ? new Date(d).toLocaleString(i18n.locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtSize = n => n > 1e9 ? (n / 1e9).toFixed(1) + ' ГБ' : n > 1e6 ? (n / 1e6).toFixed(1) + ' МБ' : (n / 1e3).toFixed(0) + ' КБ';
const DEV = (t = 'в разработке') => `<span class="badge b-dev b-none">${t}</span>`;

// ================= Data layer =================
const LS = 'mk-studio-v1';
const local = {
  load() { try { return JSON.parse(localStorage.getItem(LS)) || null; } catch { return null; } },
  save(d) { localStorage.setItem(LS, JSON.stringify(d)); },
  meta(k, v) { const m = JSON.parse(localStorage.getItem(LS + '-meta') || '{}'); if (v === undefined) return m[k]; m[k] = v; localStorage.setItem(LS + '-meta', JSON.stringify(m)); }
};
let LD = null;
function ldInit() { LD = local.load(); if (!LD) { LD = C.seed(); LD.logs.push({ id: C.uid(), at: C.now(), level: 'info', source: 'system', message: 'Браузерный режим: начальные данные загружены' }); local.save(LD); } for (const c of C.COLLECTIONS) LD[c] = LD[c] || []; const miss = C.missingSeed(LD); for (const c in miss) LD[c].push(...miss[c]); local.save(LD); }
function llog(level, source, message) { LD.logs.push({ id: C.uid(), at: C.now(), level, source, message, user: USER }); if (LD.logs.length > 2000) LD.logs.splice(0, LD.logs.length - 2000); }
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

async function localRoute(method, path, body) {
  const [, , col, id, act] = path.split('/');
  const ok = x => { local.save(LD); return x; };
  if (col === 'auth') {
    const u = local.meta('user');
    if (id === 'status') return { needsSetup: !u, user: sessionStorage.getItem('mk-user') };
    if (id === 'setup') { if (u) throw new Error('Пользователь уже создан'); if (!body.username || (body.password || '').length < 8) throw new Error('Логин и пароль (мин. 8 символов) обязательны');
      const salt = C.uid(); local.meta('user', { name: body.username, salt, hash: await sha(salt + body.password) }); sessionStorage.setItem('mk-user', body.username); return { ok: true, user: body.username }; }
    if (id === 'login') { if (!u || u.name !== body.username || (await sha(u.salt + body.password)) !== u.hash) throw new Error('Неверный логин или пароль'); sessionStorage.setItem('mk-user', u.name); return { ok: true, user: u.name }; }
    if (id === 'logout') { sessionStorage.removeItem('mk-user'); return { ok: true }; }
    if (id === 'password') { if ((await sha(u.salt + body.oldPassword)) !== u.hash) throw new Error('Старый пароль неверен'); if ((body.newPassword || '').length < 8) throw new Error('Новый пароль: мин. 8 символов');
      u.salt = C.uid(); u.hash = await sha(u.salt + body.newPassword); local.meta('user', u); llog('info', 'auth', 'Пароль изменён'); return ok({ ok: true }); }
  }
  if (col === 'opencode') { // browser demo: no Keychain → feature unavailable, password is never stored in localStorage
    if (method === 'GET') return { url: 'http://127.0.0.1:4096', username: 'opencode', hasPassword: false, keychain: { available: false, reason: 'Браузерный режим: Keychain недоступна. Пароль OpenCode можно сохранить только в приложении на Mac.' }, lastTest: null, status: 'Не подключено' };
    throw new Error('Не подключено: в браузерном режиме пароль OpenCode не сохраняется'); }
  if (col === 'system') return { mode: 'browser', userAgent: navigator.userAgent, storageBytes: (localStorage.getItem(LS) || '').length, counts: Object.fromEntries(C.COLLECTIONS.map(c => [c, LD[c].length])), lastSchedulerTick: local.meta('lastTick') || null };
  if (col === 'backup') return { app: 'moonkatty-ai-studio', version: 1, exportedAt: C.now(), data: LD };
  if (col === 'restore') { const d = body?.data; if (!d) throw new Error('Неверный файл резервной копии'); for (const c of C.COLLECTIONS) if (Array.isArray(d[c])) LD[c] = d[c]; llog('info', 'backup', 'Данные восстановлены из резервной копии'); return ok({ ok: true }); }
  if (col === 'reset') { LD = C.seed(); llog('info', 'system', 'Данные сброшены к начальным'); return ok({ ok: true }); }
  if (col === 'reports' && id === 'generate') { const r = C.buildReport(LD, +body?.periodDays || 3); r.trigger = 'manual'; LD.reports.push(r); llog('info', 'analytics', 'Сформирован отчёт за ' + r.periodDays + ' дн.'); return ok(r); }
  if (col === 'integrations' && act === 'test') {
    const it = LD.integrations.find(x => x.id === id); const url = it.url.replace(/\/$/, '') + (it.testPath || '/'); const t0 = Date.now(); let r;
    try { const res = await fetch(url, { signal: AbortSignal.timeout(5000) }); const tx = await res.text(); let detail = tx.slice(0, 300);
      if (id === 'ollama' && res.ok) try { detail = 'Модели: ' + (JSON.parse(tx).models || []).map(m => m.name).join(', '); } catch {}
      r = { ok: res.ok, status: res.status, ms: Date.now() - t0, url, detail, at: C.now(), via: 'browser' };
    } catch (e) { r = { ok: false, status: null, ms: Date.now() - t0, url, detail: (e.name || 'Error') + ' — запрос из браузера (возможны CORS / mixed content с https-страницы)', at: C.now(), via: 'browser' }; }
    it.lastTest = r; llog(r.ok ? 'info' : 'error', 'integration:' + id, `Проверка ${it.name} (${url}): ${r.ok ? 'OK' : 'ошибка — ' + r.detail}`); return ok(r);
  }
  if (col === 'director' && id === 'chat') {
    const text = String(body.text || '').trim(); LD.chat.push({ id: C.uid(), role: 'user', text, at: C.now() });
    let plan, llmError = null; try { plan = await browserLlm(text); } catch (e) { llmError = e.message; plan = C.rulePlan(text); }
    const created = plan.tasks.map(t => { const o = { id: C.uid(), title: t.title, description: t.description || '', agentId: t.agentId, priority: t.priority || 'normal', status: 'queued', project: /новост|news/i.test(text) ? 'news' : 'main', schedule: { type: 'none' }, createdAt: C.now(), source: 'director' }; LD.tasks.push(o); return o; });
    const msg = { id: C.uid(), role: 'director', at: C.now(), planner: plan.planner, llmError, text: plan.summary, taskIds: created.map(t => t.id) }; LD.chat.push(msg);
    llog('info', 'director', `Запрос разобран (${plan.planner}), задач: ${created.length}`); return ok({ message: msg, tasks: created });
  }
  if (col === 'files' && id === 'upload') {
    const f = body; if (f.size > 3e6) throw new Error('В браузерном режиме файлы до 3 МБ (localStorage). Большие файлы — в серверном режиме.');
    const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
    const o = { id: C.uid(), name: f.name, size: f.size, mime: f.type, url, project: 'main', createdAt: C.now() }; LD.files.push(o); llog('info', 'files', 'Загружен файл ' + f.name); return ok(o);
  }
  if (col === 'backups') return [];
  if (col === 'meta') { if (id === 'config') return method === 'GET' ? { appId: '', hasSecret: false, redirectUri: '', graphVersion: 'v26.0', source: 'browser', browser: true } : (() => { throw new Error('Требуется сервер на Mac: OAuth и токены Meta работают только на сервере'); })();
    throw new Error('Требуется сервер на Mac: OAuth и токены Meta работают только на сервере'); }
  if (col === 'demo' && id === 'remove') { let n = 0; for (const c of C.COLLECTIONS) { const before = LD[c].length; LD[c] = LD[c].filter(o => !o.demo); n += before - LD[c].length; } llog('info', 'system', 'Демо-данные удалены: ' + n); return ok({ removed: n }); }
  if (col === 'queue' && act === 'publish') { const it = LD.queue.find(x => x.id === id); throw new Error(it?.demo ? 'Демо-данные не публикуются' : 'Требуется сервер на Mac и подключённый аккаунт'); }
  if (col === 'comments' && act === 'reply') throw new Error('Требуется сервер на Mac и подключённый аккаунт');
  if (col === 'queue' && method === 'PUT' && body.status === 'approved') { const cur = LD.queue.find(x => x.id === id); const cand = Object.assign({}, cur, body);
    const issues = [...MKSocial.guardrails(cand, LD), ...MKSocial.dailyCheck(cand, LD.queue, LD.workspaces)]; if (issues.length) { llog('warn', 'publishing', `Утверждение заблокировано «${cur.title}»: ${issues.join('; ')}`); local.save(LD); throw new Error(issues.join('; ')); } }
  if (col === 'queue' && method === 'PUT' && body.status) { const cur = LD.queue.find(x => x.id === id); if (cur && body.status !== cur.status) body.history = [...(cur.history || []), { at: C.now(), event: body.status, user: USER }]; }
  if (!C.COLLECTIONS.includes(col)) throw new Error('Не поддерживается в браузерном режиме');
  const arr = LD[col];
  if (method === 'GET') return id ? arr.find(x => x.id === id) : arr;
  if (method === 'POST') { const o = Object.assign({}, body, { id: body.id || C.uid(), createdAt: C.now() }); if (col === 'tasks' && o.schedule && o.schedule.type !== 'none') o.nextRunAt = C.nextRun(o.schedule); arr.push(o); if (col !== 'logs') llog('info', col, 'Создано: ' + (o.title || o.name || o.id)); return ok(o); }
  if (method === 'PUT') { const o = arr.find(x => x.id === id); if (!o) throw new Error('not found'); Object.assign(o, body, { updatedAt: C.now() });
    if (col === 'tasks') { if (body.status === 'done' && !o.completedAt) o.completedAt = C.now(); if ('schedule' in body) o.nextRunAt = C.nextRun(o.schedule); }
    if (col !== 'logs') llog('info', col, `Изменено: ${o.title || o.name || o.id} (${Object.keys(body).join(', ')})`); return ok(o); }
  if (method === 'DELETE') { const i = arr.findIndex(x => x.id === id); if (i >= 0) { arr.splice(i, 1); llog('info', col, 'Удалено: ' + id); } return ok({ ok: i >= 0 }); }
}
async function browserLlm(text) {
  const it = LD.integrations.find(x => x.id === 'ollama'); if (!it?.lastTest?.ok) throw new Error('Ollama не подключена');
  const agents = LD.agents.filter(a => a.enabled).map(a => `${a.id}: ${a.role}`).join('\n'); const model = it.model || 'qwen3:8b';
  const prompt = `Ты Director студии MOONKATTY. Разбей запрос на задачи для агентов. Агенты:\n${agents}\nОтветь ТОЛЬКО JSON: {"summary":"...","tasks":[{"title":"...","agentId":"...","priority":"low|normal|high|urgent","description":"..."}]}\nЗапрос: ${text}`;
  const r = await fetch(it.url.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt }] }) });
  const j = JSON.parse((await r.json()).message.content); const ids = new Set(LD.agents.map(a => a.id));
  return { planner: 'llm:' + model, summary: j.summary || '', tasks: (j.tasks || []).map(t => ({ ...t, agentId: ids.has(t.agentId) ? t.agentId : 'director' })) };
}
function localTick() {
  for (const ch of C.schedulerTick(LD.tasks)) { Object.assign(LD.tasks.find(t => t.id === ch.id), ch.changes); if (ch.log) llog(ch.log.level, ch.log.source, ch.log.message); }
  const last = local.meta('lastAutoReport'); if (!last || Date.now() - new Date(last) >= 3 * 86400000) { const r = C.buildReport(LD, 3); r.trigger = 'auto'; LD.reports.push(r); local.meta('lastAutoReport', r.createdAt); llog('info', 'analytics', 'Автоматический отчёт за 3 дня сформирован'); }
  local.meta('lastTick', C.now()); local.save(LD);
}
const safeUrl = u => /^https?:\/\//i.test(String(u || '')) ? esc(u) : '#'; // no javascript:/data: links
async function api(method, path, body, confirmTok) {
  if (MODE === 'browser') return localRoute(method, path, body);
  const isFile = typeof File !== 'undefined' && body instanceof File;
  const r = await fetch(path + (isFile ? `?name=${encodeURIComponent(body.name)}` : ''), { method, credentials: 'same-origin',
    headers: Object.assign({ 'x-studio-request': '1' }, confirmTok ? { 'x-studio-confirm': confirmTok } : {}, isFile ? { 'content-type': body.type || 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}), body: isFile ? body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !path.startsWith('/api/auth')) { showAuth(); throw new Error('Требуется вход'); }
  if (r.status === 428 && j.confirmRequired && !confirmTok) { // Security Center: second step — password re-entry for dangerous operations
    const pw = prompt(`Опасная операция «${j.action}». Введите пароль для подтверждения:`); if (!pw) throw new Error('Операция отменена');
    const c = await api('POST', '/api/ops/confirm', { action: j.action, password: pw }); return api(method, path, body, c.confirmToken); }
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j;
}
async function loadAll() { const cols = C.COLLECTIONS; const res = await Promise.all([...cols.map(c => api('GET', '/api/' + c)), api('GET', '/api/system').catch(() => null)]); cols.forEach((c, i) => DB[c] = res[i]); SYS = res[cols.length]; }
async function act(fn, okMsg) { try { const r = await fn(); if (okMsg) toast(okMsg); await loadAll(); render(); return r; } catch (e) { toast('Ошибка: ' + e.message, true); } }
function toast(m, err) { const d = document.createElement('div'); d.textContent = i18n.tr(m); if (err) d.style.borderColor = '#ef4444'; $('#toast').append(d); setTimeout(() => d.remove(), 3500); }

// ================= Helpers =================
const agentName = id => (DB.agents.find(a => a.id === id) || {}).name || 'не назначен';
const STATUS = { queued: ['В очереди', 'b-blue'], in_progress: ['Выполняется', 'b-pur'], waiting_approval: ['Ждёт утверждения', 'b-warn'], done: ['Готово', 'b-ok'], failed: ['Ошибка', 'b-err'], blocked: ['Заблокировано', 'b-warn'], cancelled: ['Отменено', ''] };
const PRIO = { low: ['Низкий', ''], normal: ['Обычный', 'b-blue'], high: ['Высокий', 'b-warn'], urgent: ['Срочно', 'b-err'] };
const stBadge = s => `<span class="badge ${(STATUS[s] || ['', ''])[1]}">${(STATUS[s] || [s])[0]}</span>`;
const prBadge = p => `<span class="badge b-none ${(PRIO[p] || ['', ''])[1]}">${(PRIO[p] || [p])[0]}</span>`;
const agentStatus = a => a.inDevelopment ? DEV() : !a.enabled ? '<span class="badge">Выключен</span>' : a.status === 'working' ? '<span class="badge b-pur">working</span>' : a.status === 'error' ? '<span class="badge b-err">error</span>' : '<span class="badge b-ok">idle</span>';
const schedText = s => !s || s.type === 'none' ? '—' : s.type === 'every_days' ? `каждые ${s.days} дн.` : `cron: ${esc(s.cron)}`;
const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const svcBadge = it => !it.lastTest ? '<span class="badge">Не подключено</span>' : it.lastTest.ok ? '<span class="badge b-ok">Подключено</span>' : '<span class="badge b-err">Не подключено</span>';
const fileById = id => DB.files.find(f => f.id === id);
const chName = id => (DB.channels.find(c => c.id === id) || {}).name || '—';
const PST = { draft: ['Черновик', ''], pending: ['На утверждении', 'b-warn'], approved: ['Утверждено', 'b-ok'], rejected: ['Отклонено', 'b-err'], published: ['Опубликовано', 'b-blue'] };
const postBadge = s => `<span class="badge ${(PST[s] || ['', ''])[1]}">${(PST[s] || [s])[0]}</span>`;
function download(name, obj) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); a.download = name; a.click(); }

function modal(html, onSubmit) {
  const m = $('#modal'); m.innerHTML = `<form class="box">${html}<div class="acts"><button type="button" class="btn ghost" data-close>Отмена</button>${onSubmit ? '<button class="btn primary">Сохранить</button>' : ''}</div></form>`;
  m.classList.remove('hidden'); const f = m.querySelector('form');
  m.querySelector('[data-close]').onclick = () => m.classList.add('hidden');
  f.onsubmit = async e => { e.preventDefault(); if (onSubmit) { const fd = Object.fromEntries(new FormData(f)); m.classList.add('hidden'); if ((await onSubmit(fd, f)) === false) m.classList.remove('hidden'); } };
  return f;
}
const confirmDo = (text, fn) => { modal(`<h2>Подтвердите</h2><p>${esc(text)}</p>`, async () => { await fn(); }); $('#modal .btn.primary').textContent = 'Да'; };

// ================= Navigation =================
const NAV = [
  ['dashboard', '◈', 'Dashboard'], ['agents', '✦', 'AI Agents'], ['news', '◉', 'MOONKATTY NEWS'], ['project', '☾', 'MOONKATTY PROJECT'],
  ['video', '▶', 'Video Production'], ['studio3d', '⬡', '3D Studio'], ['social', '◎', 'Social Media'], ['pr', '✶', 'PR & Marketing'],
  ['calendar', '▦', 'Calendar'], ['analytics', '▤', 'Analytics'], ['reports', '▧', 'Reports'], ['files', '▣', 'Files & Projects'],
  ['logs', '›_', 'Terminal & Logs'], ['settings', '⚙', 'Settings']
];
let ROUTE = 'dashboard'; const SUB = {};
function navTo(r) { location.hash = r; }
window.addEventListener('hashchange', () => { ROUTE = location.hash.slice(1).split('?')[0] || 'dashboard'; $('#sidebar').classList.remove('open'); render(); });
function renderNav() { $('#nav').innerHTML = NAV.map(([k, i, l]) => `<a href="#${k}" class="${k === ROUTE ? 'active' : ''}"><i>${i}</i>${l}</a>`).join(''); }
function render() {
  if (!DB.agents) return;
  const n = NAV.find(x => x[0] === ROUTE) || NAV[0]; ROUTE = n[0]; renderNav(); $('#pageTitle').textContent = n[2];
  renderPills(); const v = $('#view'); if (typeof VIEWS[ROUTE] !== 'function') { v.innerHTML = `<div class="card"><b>Раздел «${esc(n[2])}» недоступен</b> <span class="mut">(нет представления для маршрута ${esc(ROUTE)})</span></div>`; console.error('no view for route', ROUTE); return; } v.innerHTML = VIEWS[ROUTE](); (BIND[ROUTE] || (() => {}))(v); bindCommon(v); updateBell();
  if (!$('#chatDrawer').classList.contains('hidden')) renderChat();
}
function bindCommon(root) {
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => navTo(b.dataset.go));
  root.querySelectorAll('[data-task-edit]').forEach(b => b.onclick = () => taskForm(DB.tasks.find(t => t.id === b.dataset.taskEdit)));
  root.querySelectorAll('[data-task-new]').forEach(b => b.onclick = () => taskForm(null, { agentId: b.dataset.taskNew || '', project: b.dataset.project || 'main' }));
  root.querySelectorAll('[data-task-del]').forEach(b => b.onclick = () => confirmDo('Удалить задачу?', () => act(() => api('DELETE', '/api/tasks/' + b.dataset.taskDel), 'Задача удалена')));
  root.querySelectorAll('[data-task-status]').forEach(s => s.onchange = () => setTaskStatus(s.dataset.taskStatus, s.value));
  root.querySelectorAll('[data-code-ok]').forEach(b => b.onclick = () => MODE !== 'server' ? toast('Требуется сервер на Mac', true) : confirmDo('Разрешить OpenCode выполнить эту задачу? Он работает только в отдельной папке-песочнице (data/opencode-sandbox), без доступа к shell и вебу.', () => act(() => api('POST', `/api/tasks/${b.dataset.codeOk}/approve-code`), 'Запуск OpenCode разрешён')));
  root.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { SUB[ROUTE] = b.dataset.tab; render(); });
  root.querySelectorAll('[data-test]').forEach(b => b.onclick = () => testIntegration(b.dataset.test, b));
}
async function setTaskStatus(id, status) {
  const t = DB.tasks.find(x => x.id === id);
  await act(async () => {
    await api('PUT', '/api/tasks/' + id, { status });
    const a = DB.agents.find(x => x.id === t.agentId);
    if (a && status === 'in_progress') await api('PUT', '/api/agents/' + a.id, { status: 'working', currentTaskId: id });
    if (a && status !== 'in_progress' && a.currentTaskId === id) await api('PUT', '/api/agents/' + a.id, { status: status === 'failed' ? 'error' : 'idle', currentTaskId: null });
  }, 'Статус обновлён');
}
async function testIntegration(id, btn) { if (btn) { btn.disabled = true; btn.textContent = 'Проверка…'; } const r = await act(() => api('POST', `/api/integrations/${id}/test`)); if (r) toast(r.ok ? 'Подключено ✓' : 'Нет соединения: ' + r.detail, !r.ok); }

function taskForm(t, defaults = {}) {
  t = t || Object.assign({ title: '', description: '', agentId: '', priority: 'normal', status: 'queued', project: 'main', schedule: { type: 'none' } }, defaults);
  const s = t.schedule || { type: 'none' };
  const f = modal(`<h2>${t.id ? 'Редактировать задачу' : 'Новая задача'}</h2>
    <label>Название</label><input name="title" required value="${esc(t.title)}">
    <label>Описание</label><textarea name="description" rows="3">${esc(t.description)}</textarea>
    <div class="grid g2" style="gap:8px"><div><label>Агент</label><select name="agentId"><option value="">— не назначен —</option>${opts(DB.agents.map(a => [a.id, a.name + (a.inDevelopment ? ' (в разработке)' : '')]), t.agentId)}</select></div>
    <div><label>Проект</label><select name="project">${opts(DB.projects.map(p => [p.id, p.name]), t.project)}</select></div>
    <div><label>Приоритет</label><select name="priority">${opts(Object.entries(PRIO).map(([k, v]) => [k, v[0]]), t.priority)}</select></div>
    <div><label>Статус</label><select name="status">${opts(Object.entries(STATUS).map(([k, v]) => [k, v[0]]), t.status)}</select></div>
    <div><label>Срок</label><input type="datetime-local" name="dueAt" value="${t.dueAt ? new Date(new Date(t.dueAt) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ''}"></div>
    <div><label>Расписание</label><select name="stype">${opts([['none', 'Без повтора'], ['every_days', 'Каждые N дней'], ['cron', 'Cron (m h dom mon dow)']], s.type)}</select></div></div>
    <div id="sxD"><label>Каждые N дней</label><input name="days" type="number" min="1" value="${s.days || 3}"></div>
    <div id="sxC"><label>Cron</label><input name="cron" placeholder="0 9 * * 1" value="${esc(s.cron || '')}"></div>
    <label class="row small" style="gap:8px"><input type="checkbox" name="kind" value="code" ${t.kind === 'code' ? 'checked' : ''} style="width:auto"> Задача для OpenCode (код) — запуск только после отдельного подтверждения, в песочнице</label>
    <p class="small mut">${MODE === 'server' ? 'Расписание ставит задачу в очередь; запущенный агент берёт задачи из очереди в фоне (сервер работает и при закрытом окне).' : 'Браузерный режим: фоновое выполнение задач агентами требует сервер на Mac.'}</p>`,
    async fd => {
      const schedule = fd.stype === 'every_days' ? { type: 'every_days', days: +fd.days || 1 } : fd.stype === 'cron' ? { type: 'cron', cron: fd.cron.trim() } : { type: 'none' };
      if (schedule.type === 'cron' && !C.validCron(schedule.cron)) { toast('Неверное cron-выражение', true); return false; }
      const body = { title: fd.title, description: fd.description, agentId: fd.agentId || null, project: fd.project, priority: fd.priority, status: fd.status, kind: fd.kind === 'code' ? 'code' : null, dueAt: fd.dueAt ? new Date(fd.dueAt).toISOString() : null };
      if (!t.id || JSON.stringify(schedule) !== JSON.stringify(t.schedule || { type: 'none' })) body.schedule = schedule;
      await act(() => t.id ? api('PUT', '/api/tasks/' + t.id, body) : api('POST', '/api/tasks', body), t.id ? 'Задача сохранена' : 'Задача создана');
    });
  const sx = () => { f.querySelector('#sxD').style.display = f.stype.value === 'every_days' ? '' : 'none'; f.querySelector('#sxC').style.display = f.stype.value === 'cron' ? '' : 'none'; };
  f.stype.onchange = sx; sx();
}
function taskTable(tasks, empty = 'Задач нет') {
  if (!tasks.length) return `<div class="empty">${empty}</div>`;
  const order = { urgent: 0, high: 1, normal: 2, low: 3 };
  tasks = [...tasks].sort((a, b) => ((order[a.priority] ?? 2) - (order[b.priority] ?? 2)) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  return `<div class="tbl-wrap"><table><tr><th>Задача</th><th>Агент</th><th>Приоритет</th><th>Статус</th><th>Расписание</th><th></th></tr>${tasks.map(t => `<tr>
    <td><b>${esc(t.title)}</b>${t.source === 'director' ? ' <span class="badge b-gold b-none">Director</span>' : ''}<div class="small mut">${esc((t.description || '').slice(0, 120))}</div>${t.kind === 'code' ? `<div class="small"><span class="badge b-pur b-none">OpenCode</span> ${t.codeApproved ? 'запуск разрешён' : `<button class="btn sm" data-code-ok="${t.id}">Разрешить OpenCode</button>`}</div>` : ''}${t.blockedReason && t.status === 'blocked' ? `<div class="small" style="color:#fbbf24">⚠ ${esc(t.blockedReason)}</div>` : ''}${t.error && t.status === 'failed' ? `<div class="small" style="color:var(--err)">${esc(t.error)}</div>` : ''}${t.result ? `<details class="small"><summary>Результат${t.model ? ' · ' + esc(t.model) : ''}</summary><pre class="box" data-notr style="white-space:pre-wrap">${esc(t.result)}</pre></details>` : ''}${t.dueAt ? `<div class="small mut">Срок: ${fmt(t.dueAt)}</div>` : ''}</td>
    <td>${esc(agentName(t.agentId))}</td><td>${prBadge(t.priority)}</td>
    <td><select data-task-status="${t.id}" style="width:auto">${opts(Object.entries(STATUS).map(([k, v]) => [k, v[0]]), t.status)}</select></td>
    <td class="small">${schedText(t.schedule)}${t.nextRunAt ? `<div class="mut">след.: ${fmt(t.nextRunAt)}</div>` : ''}</td>
    <td><div class="row"><button class="btn sm" data-task-edit="${t.id}">Изм.</button><button class="btn sm danger" data-task-del="${t.id}" aria-label="Удалить">✕</button></div></td></tr>`).join('')}</table></div>`;
}

// ================= Views =================
const VIEWS = {}, BIND = {};
VIEWS.dashboard = () => {
  const T = DB.tasks, running = T.filter(t => t.status === 'in_progress'), done = T.filter(t => t.status === 'done'), pend = T.filter(t => ['queued', 'waiting_approval'].includes(t.status));
  const dir = DB.agents.find(a => a.id === 'director'); const lastMsg = [...DB.chat].reverse().find(m => m.role === 'director');
  const upcoming = DB.posts.filter(p => p.scheduledAt && new Date(p.scheduledAt) > new Date()).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 5);
  const errs = DB.logs.filter(l => l.level !== 'info').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  return `<div class="grid g4">
    <div class="card"><div class="stat-l">Выполняются</div><div class="stat">${running.length}</div></div>
    <div class="card"><div class="stat-l">В ожидании</div><div class="stat">${pend.length}</div></div>
    <div class="card"><div class="stat-l">Готово</div><div class="stat">${done.length}</div></div>
    <div class="card"><div class="stat-l">Ошибки в журнале</div><div class="stat">${DB.logs.filter(l => l.level === 'error').length}</div></div></div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><h3><span><img src="logo.svg" alt="" style="width:20px;vertical-align:middle"> Director</span>${agentStatus(dir)}</h3>
      <p class="mut small" style="margin-top:0">${esc(dir.role)}</p>
      ${lastMsg ? `<div class="small"><span class="mut">Последний ответ (${fmt(lastMsg.at)}):</span> ${esc(lastMsg.text)}</div>` : '<div class="small mut">Запросов ещё не было.</div>'}
      <form id="dashChat" class="row" style="margin-top:10px"><input name="text" class="sp" placeholder="Подготовь сегодняшний выпуск новостей на 15 минут на трёх языках" required><button class="btn primary">Отправить</button></form></div>
    <div class="card"><h3>Статус сервисов <button class="btn sm" data-go="settings">Настроить</button></h3>
      ${DB.integrations.map(i => `<div class="list-item"><b style="min-width:100px">${esc(i.name)}</b><span class="sp small mut">${esc(i.url)}</span>${svcBadge(i)}<button class="btn sm" data-test="${i.id}">Проверить</button></div>`).join('')}
      <div class="list-item"><b style="min-width:100px">Backend</b><span class="sp small mut">${MODE === 'server' ? 'Node + SQLite' : 'браузерный режим (localStorage)'}</span><span class="badge ${MODE === 'server' ? 'b-ok' : 'b-warn'}">${MODE === 'server' ? 'Работает' : 'Демо'}</span></div></div>
    <div class="card"><h3>Активные агенты <button class="btn sm" data-go="agents">Все агенты</button></h3>
      ${DB.agents.filter(a => a.enabled && !a.inDevelopment).map(a => { const ct = DB.tasks.find(t => t.id === a.currentTaskId); const q = DB.tasks.filter(t => t.agentId === a.id && t.status === 'queued').length;
        return `<div class="list-item"><div class="avatar">${esc(a.name.slice(0, 3))}</div><div class="sp"><b>${esc(a.name)}</b><div class="small mut">${ct ? 'Сейчас: ' + esc(ct.title) : 'Нет текущей задачи'} · в очереди: ${q}</div></div>${agentStatus(a)}</div>`; }).join('')}</div>
    <div class="card"><h3>Ближайшие публикации <button class="btn sm" data-go="social">Social</button></h3>
      ${upcoming.length ? upcoming.map(p => `<div class="list-item"><span class="sp">${esc(p.title)}<div class="small mut">${esc(chName(p.channelId))} · ${fmt(p.scheduledAt)}</div></span>${postBadge(p.status)}</div>`).join('') : '<div class="empty">Запланированных публикаций нет</div>'}</div>
    <div class="card"><h3>Ошибки и предупреждения <button class="btn sm" data-go="logs">Журнал</button></h3>
      ${errs.length ? errs.map(l => `<div class="list-item small"><span class="badge ${l.level === 'error' ? 'b-err' : 'b-warn'}">${l.level}</span><span class="sp">${esc(l.message)}</span><span class="mut">${fmt(l.at)}</span></div>`).join('') : '<div class="empty">Ошибок нет</div>'}</div>
    <div class="card"><h3>Соцсети — статистика</h3>
      ${DB.channels.map(c => `<div class="list-item"><span class="sp">${esc(c.name)}</span><span class="badge">Не подключено</span></div>`).join('')}
      <p class="small mut">Цифры появятся только после подключения API платформ (${DEV()}). Никаких выдуманных просмотров.</p></div>
  </div>`;
};
BIND.dashboard = v => { v.querySelector('#dashChat').onsubmit = async e => { e.preventDefault(); const t = e.target.text.value; e.target.reset(); openChat(); await sendChat(t); }; };

VIEWS.agents = () => {
  const tab = SUB.agents || 'cards';
  return `<div class="tabs"><button data-tab="cards" class="${tab === 'cards' ? 'active' : ''}">Агенты</button><button data-tab="queue" class="${tab === 'queue' ? 'active' : ''}">Очередь задач (${DB.tasks.length})</button></div>
  ${tab === 'queue' ? `<div class="row" style="margin-bottom:12px"><button class="btn primary" data-task-new="">+ Новая задача</button><span class="sp"></span><select id="qf" style="width:auto">${opts([['', 'Все статусы'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]])], SUB.qf || '')}</select></div>
    <div class="card">${taskTable(DB.tasks.filter(t => !SUB.qf || t.status === SUB.qf))}</div>` :
  `<div class="devbox" style="margin-bottom:16px">${MODE === 'server' ? '«Старт» включает фоновый исполнитель на сервере: агент берёт задачи из очереди и выполняет реальные действия (отчёты, проверка очереди публикаций, черновики ответов, черновики через Ollama qwen3:8b, OpenCode — с подтверждением). Если действие невозможно (например, Ollama недоступна), задача получает статус «Заблокировано» с причиной. Сервер продолжает работу при закрытом окне.' : 'Браузерный режим: фоновое выполнение задач агентами требует сервер на Mac; «Старт» только отмечает взятую задачу.'}</div>
  <div class="grid g3">${DB.agents.map(a => { const ct = DB.tasks.find(t => t.id === a.currentTaskId); const mine = DB.tasks.filter(t => t.agentId === a.id);
    const hist = mine.filter(t => t.status === 'done').sort((x, y) => (y.completedAt || '').localeCompare(x.completedAt || '')).slice(0, 3);
    return `<div class="card"><div class="agent-head">${avatar(a)}<div class="sp"><b>${esc(a.name)}</b><div class="small mut">${esc(a.role)}</div></div>${agentStatus(a)}</div>
      <div class="small"><span class="mut">Текущая задача:</span> ${ct ? esc(ct.title) : '—'}</div>
      <div class="small"><span class="mut">Назначено:</span> ${mine.filter(t => !['done', 'cancelled'].includes(t.status)).length} · <span class="mut">выполнено:</span> ${mine.filter(t => t.status === 'done').length}</div>
      <div class="small mut" style="margin-top:6px">История: ${hist.length ? hist.map(t => esc(t.title)).join('; ') : 'пусто'}</div>
      <div class="small"><span class="mut">Последний запуск:</span> ${a.lastRunAt ? fmt(a.lastRunAt) : '—'}</div>
      ${a.lastResult ? `<div class="small"><span class="mut">Результат:</span> <span data-notr>${esc(a.lastResult)}</span></div>` : ''}${a.lastError ? `<div class="small" style="color:#fbbf24">⚠ ${esc(a.lastError)}</div>` : ''}
      ${(a.actionLog || []).length ? `<details class="small"><summary>Журнал действий (${a.actionLog.length})</summary>${a.actionLog.slice(0, 12).map(l => `<div class="${l.level === 'error' ? 'err' : 'mut'}">${fmt(l.at)} · ${esc(l.msg)}</div>`).join('')}</details>` : ''}
      <div class="row" style="margin-top:12px">${a.inDevelopment ? `<button class="btn sm" disabled>Старт</button>${DEV()}` : `
        <button class="btn sm primary" data-start="${a.id}" ${!a.enabled || a.status === 'working' ? 'disabled' : ''}>Старт</button>
        <button class="btn sm" data-stop="${a.id}" ${a.status !== 'working' ? 'disabled' : ''}>Стоп</button>
        <button class="btn sm" data-assign="${a.id}" ${!a.enabled ? 'disabled' : ''}>Назначить задачу</button>
        <span class="sp"></span><button class="btn sm ghost" data-toggle="${a.id}">${a.enabled ? 'Выключить' : 'Включить'}</button>`}</div></div>`; }).join('')}</div>`}`;
};
BIND.agents = v => {
  const qf = v.querySelector('#qf'); if (qf) qf.onchange = () => { SUB.qf = qf.value; render(); };
  v.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => { const a = DB.agents.find(x => x.id === b.dataset.toggle); act(() => api('PUT', '/api/agents/' + a.id, { enabled: !a.enabled, status: 'idle' }), a.enabled ? 'Агент выключен' : 'Агент включён'); });
  if (MODE === 'server') {
    v.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => act(() => api('POST', `/api/agents/${b.dataset.stop}/stop`), 'Агент остановлен'));
    v.querySelectorAll('[data-start]').forEach(b => b.onclick = () => act(() => api('POST', `/api/agents/${b.dataset.start}/start`), 'Агент запущен: берёт задачи из очереди в фоне'));
  } else {
  v.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => { const a = DB.agents.find(x => x.id === b.dataset.stop);
    act(async () => { if (a.currentTaskId) await api('PUT', '/api/tasks/' + a.currentTaskId, { status: 'queued' }); await api('PUT', '/api/agents/' + a.id, { status: 'idle', currentTaskId: null }); }, 'Агент остановлен, задача возвращена в очередь'); });
  v.querySelectorAll('[data-start]').forEach(b => b.onclick = () => { const a = DB.agents.find(x => x.id === b.dataset.start);
    const order = { urgent: 0, high: 1, normal: 2, low: 3 }; const q = DB.tasks.filter(t => t.agentId === a.id && t.status === 'queued').sort((x, y) => (order[x.priority] ?? 2) - (order[y.priority] ?? 2));
    if (!q.length) return toast('У агента нет задач в очереди — назначьте задачу', true);
    act(async () => { await api('PUT', '/api/tasks/' + q[0].id, { status: 'in_progress' }); await api('PUT', '/api/agents/' + a.id, { status: 'working', currentTaskId: q[0].id }); }, 'Взята задача: ' + q[0].title); });
  }
  v.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => { const a = DB.agents.find(x => x.id === b.dataset.assign); const free = DB.tasks.filter(t => !['done', 'cancelled'].includes(t.status) && t.agentId !== a.id);
    modal(`<h2>Назначить задачу: ${esc(a.name)}</h2><label>Существующая задача</label><select name="tid"><option value="">— создать новую —</option>${opts(free.map(t => [t.id, t.title + ' (' + agentName(t.agentId) + ')']), '')}</select>`,
      fd => { if (!fd.tid) { setTimeout(() => taskForm(null, { agentId: a.id }), 0); return; } return act(() => api('PUT', '/api/tasks/' + fd.tid, { agentId: a.id }), 'Задача назначена'); }); });
};

function contentPlan(pid) {
  const p = DB.projects.find(x => x.id === pid); const plan = [...(p.plan || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return `<div class="card"><h3>Контент-план: ${esc(p.name)} <button class="btn sm primary" data-plan-add="${pid}">+ Пункт</button></h3>
    ${plan.length ? plan.map(i => `<div class="list-item"><span class="badge b-none b-pur">${esc(i.date || 'без даты')}</span><span class="sp">${esc(i.title)} <span class="small mut">${esc(i.format || '')}</span></span>
      <select data-plan-st="${pid}|${i.id}" style="width:auto">${opts([['idea', 'Идея'], ['planned', 'Запланировано'], ['in_work', 'В работе'], ['done', 'Готово']], i.status)}</select><button class="btn sm danger" data-plan-del="${pid}|${i.id}">✕</button></div>`).join('') : '<div class="empty">План пуст — добавьте первый пункт</div>'}</div>`;
}
function bindPlan(v) {
  const save = (pid, plan, m) => act(() => api('PUT', '/api/projects/' + pid, { plan }), m);
  v.querySelectorAll('[data-plan-add]').forEach(b => b.onclick = () => { const pid = b.dataset.planAdd;
    modal(`<h2>Пункт контент-плана</h2><label>Тема</label><input name="title" required><label>Дата</label><input type="date" name="date"><label>Формат</label><input name="format" placeholder="Выпуск 15 мин / Shorts / пост">`,
      fd => save(pid, [...(DB.projects.find(p => p.id === pid).plan || []), { id: C.uid(), ...fd, status: 'planned' }], 'Добавлено')); });
  v.querySelectorAll('[data-plan-st]').forEach(s => s.onchange = () => { const [pid, id] = s.dataset.planSt.split('|'); save(pid, DB.projects.find(p => p.id === pid).plan.map(i => i.id === id ? { ...i, status: s.value } : i), 'Обновлено'); });
  v.querySelectorAll('[data-plan-del]').forEach(b => b.onclick = () => { const [pid, id] = b.dataset.planDel.split('|'); save(pid, DB.projects.find(p => p.id === pid).plan.filter(i => i.id !== id), 'Удалено'); });
}

// ---- NEWS ----
const ST_CYCLE = ['todo', 'progress', 'done', 'error'], ST_L = { todo: 'не начато', progress: 'в работе', done: 'готово', error: 'ошибка' };
function mediaPlayer(f) { if (!f) return ''; const u = esc(f.url), k = f.mime + ' ' + f.name; return /audio|\.(mp3|wav|m4a|ogg)$/i.test(k) ? `<audio controls src="${u}" style="width:100%"></audio>` : /video|\.(mp4|mov|webm)$/i.test(k) ? `<video controls src="${u}" style="width:100%;max-height:320px;border-radius:8px"></video>` : `<a href="${u}" target="_blank">${esc(f.name)}</a>`; }
VIEWS.news = () => {
  const eps = DB.episodes.filter(e => e.project === 'news').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="newEp">+ Новый выпуск</button><button class="btn" data-task-new="news" data-project="news">+ Задача NEWS</button><span class="sp"></span>
    <button class="btn" disabled>Автопоиск новостей</button>${DEV()}</div>
  <div class="devbox" style="margin-bottom:14px">Этапы конвейера отмечаются вручную (нажмите на этап) или по итогам задач агентов. Автоматическое выполнение этапов (поиск, фактчек, перевод, TTS-озвучка, рендер, публикация) — <b>в разработке</b>. Плееры появляются, когда к версии прикреплён файл.</div>
  ${eps.length ? eps.map(e => `<div class="card" style="margin-bottom:14px"><h3><span>${esc(e.title)} <small>${e.durationMin ? e.durationMin + ' мин · ' : ''}${fmt(e.createdAt)}</small></span><span class="row"><button class="btn sm" data-ep-edit="${e.id}">Изм.</button><button class="btn sm danger" data-ep-del="${e.id}">✕</button></span></h3>
    ${e.sources?.length ? `<div class="small mut">Источники: ${e.sources.map(s => `<a href="${safeUrl(s)}" target="_blank" rel="noopener noreferrer">${esc(s.replace(/^https?:\/\//, '').slice(0, 40))}</a>`).join(', ')}</div>` : '<div class="small mut">Источники не указаны</div>'}
    ${C.LANGS.map(L => { const v = e.versions[L], m = (e.media || {})[L] || {}; const doneN = C.PIPELINE.filter(([k]) => v[k] === 'done').length;
      return `<div style="margin-top:12px"><div class="row"><b>${L}</b>${L === 'EN' ? '<span class="badge b-gold b-none">основной</span>' : ''}<div class="bar sp"><i style="width:${doneN / C.PIPELINE.length * 100}%"></i></div><span class="small mut">${doneN}/${C.PIPELINE.length}</span>
        <button class="btn sm" data-script="${e.id}|${L}">Сценарий</button><button class="btn sm" data-media="${e.id}|${L}">Файлы</button></div>
        <div class="pipe" style="margin-top:6px">${C.PIPELINE.map(([k, l]) => `<div class="stage s-${v[k]}" data-stage="${e.id}|${L}|${k}" title="Нажмите, чтобы сменить статус"><b>${l}</b>${ST_L[v[k]]}</div>`).join('')}</div>
        ${m.audio || m.video ? `<div class="grid g2" style="margin-top:8px">${mediaPlayer(fileById(m.audio))}${mediaPlayer(fileById(m.video))}</div>` : ''}</div>`; }).join('')}</div>`).join('') : '<div class="empty" style="margin-bottom:14px">Выпусков пока нет. Создайте выпуск или попросите Director: «Подготовь сегодняшний выпуск новостей на 15 минут на трёх языках».</div>'}
  <div class="grid">${contentPlan('news')}<div class="card"><h3>Задачи NEWS</h3>${taskTable(DB.tasks.filter(t => t.project === 'news'))}</div></div>`;
};
function epForm(e) {
  const isNew = !e; e = e || C.newEpisode({});
  modal(`<h2>${isNew ? 'Новый выпуск' : 'Выпуск'}</h2><label>Название</label><input name="title" required value="${esc(e.title)}"><label>Длительность, мин</label><input name="durationMin" type="number" min="1" value="${e.durationMin || 15}">
    <label>Источники (по одному URL в строке)</label><textarea name="sources" rows="4">${esc((e.sources || []).join('\n'))}</textarea>`,
    fd => { const body = { title: fd.title, durationMin: +fd.durationMin, sources: fd.sources.split('\n').map(s => s.trim()).filter(Boolean) };
      return act(() => isNew ? api('POST', '/api/episodes', { ...e, ...body }) : api('PUT', '/api/episodes/' + e.id, body), 'Сохранено'); });
}
BIND.news = v => {
  bindPlan(v); v.querySelector('#newEp').onclick = () => epForm();
  v.querySelectorAll('[data-ep-edit]').forEach(b => b.onclick = () => epForm(DB.episodes.find(e => e.id === b.dataset.epEdit)));
  v.querySelectorAll('[data-ep-del]').forEach(b => b.onclick = () => confirmDo('Удалить выпуск?', () => act(() => api('DELETE', '/api/episodes/' + b.dataset.epDel), 'Удалено')));
  v.querySelectorAll('[data-stage]').forEach(s => s.onclick = () => { const [id, L, k] = s.dataset.stage.split('|'); const e = DB.episodes.find(x => x.id === id);
    const versions = JSON.parse(JSON.stringify(e.versions)); versions[L][k] = ST_CYCLE[(ST_CYCLE.indexOf(versions[L][k]) + 1) % ST_CYCLE.length]; act(() => api('PUT', '/api/episodes/' + id, { versions })); });
  v.querySelectorAll('[data-script]').forEach(b => b.onclick = () => { const [id, L] = b.dataset.script.split('|'); const e = DB.episodes.find(x => x.id === id);
    modal(`<h2>Сценарий ${L}: ${esc(e.title)}</h2><textarea name="s" rows="14">${esc((e.scripts || {})[L] || '')}</textarea>`, fd => act(() => api('PUT', '/api/episodes/' + id, { scripts: { ...(e.scripts || {}), [L]: fd.s } }), 'Сценарий сохранён')); });
  v.querySelectorAll('[data-media]').forEach(b => b.onclick = () => { const [id, L] = b.dataset.media.split('|'); const e = DB.episodes.find(x => x.id === id); const m = (e.media || {})[L] || {};
    const fo = (re, sel) => `<option value="">— нет —</option>` + opts(DB.files.filter(f => re.test(f.mime + ' ' + f.name)).map(f => [f.id, f.name]), sel);
    modal(`<h2>Файлы ${L}: ${esc(e.title)}</h2><p class="small mut">Загрузите файлы в «Files & Projects», затем выберите здесь.</p><label>Аудио (озвучка)</label><select name="audio">${fo(/audio|mp3|wav|m4a|ogg/i, m.audio)}</select>
      <label>Видео</label><select name="video">${fo(/video|mp4|mov|webm/i, m.video)}</select><label>Субтитры</label><select name="subs">${fo(/srt|vtt/i, m.subs)}</select>`,
      fd => act(() => api('PUT', '/api/episodes/' + id, { media: { ...(e.media || {}), [L]: fd } }), 'Файлы привязаны')); });
};

// ---- PROJECT ----
VIEWS.project = () => {
  const sec = (title, agentId, note) => `<div class="card"><h3>${title} <button class="btn sm" data-task-new="${agentId}" data-project="main">+ Задача</button></h3><p class="small mut" style="margin-top:0">${note}</p>${taskTable(DB.tasks.filter(t => t.agentId === agentId), 'Задач нет')}</div>`;
  return `<div class="card" style="margin-bottom:16px"><div class="row"><img src="logo.svg" alt="" style="width:48px"><div class="sp"><b style="font-size:16px">MOONKATTY</b> <span class="gold">«9 Lives. One Moon.»</span>
    <div class="small mut">Игра: <a href="https://t.me/MoonKattyGameBot" target="_blank" rel="noopener">@MoonKattyGameBot</a> · Канал: <a href="https://t.me/moonkattymkty" target="_blank" rel="noopener">t.me/moonkattymkty</a> · Соцсети: @moonkattymky</div></div></div></div>
  <div class="grid g2">${sec('🎮 Игры', 'games', 'Telegram-игра @MoonKattyGameBot')}${sec('◎ $MKTY', 'mkty', '<span class="badge b-warn b-none">Токен не запущен</span> Будущий токен на Solana. Никаких цен и обещаний доходности.')}
    ${sec('✶ Бренд', 'social', 'Бренд-контент и публикации')}${contentPlan('main')}</div>`;
};
BIND.project = bindPlan;

// ---- VIDEO ----
VIEWS.video = () => {
  const eps = DB.episodes; const sel = eps.find(e => e.id === SUB.vep) || eps[0]; const fmtSel = SUB.vfmt || '16:9';
  const vids = DB.files.filter(f => /video|mp4|mov|webm/i.test(f.mime + f.name)), auds = DB.files.filter(f => /audio|mp3|wav|m4a|ogg/i.test(f.mime + f.name)), subs = DB.files.filter(f => /\.(srt|vtt)$/i.test(f.name));
  const rq = DB.tasks.filter(t => t.agentId === 'video' && !['done', 'cancelled'].includes(t.status)); const vf = sel && fileById(((sel.media || {}).EN || {}).video);
  return `<div class="grid g2"><div class="card"><h3>Предпросмотр <span class="row">${eps.length ? `<select id="vep" style="width:auto">${opts(eps.map(e => [e.id, e.title]), sel?.id)}</select>` : ''}
      <select id="vfmt" style="width:auto">${opts([['16:9', '16:9 YouTube'], ['9:16', '9:16 Shorts/TikTok']], fmtSel)}</select></span></h3>
    <div style="aspect-ratio:${fmtSel.replace(':', '/')};max-height:420px;margin:auto;background:#07080b;border:1px solid var(--line);border-radius:10px;display:grid;place-items:center;overflow:hidden">
      ${vf ? `<video controls src="${esc(vf.url)}" style="width:100%;height:100%;object-fit:contain"></video>` : '<span class="mut small" style="padding:10px;text-align:center">Нет видеофайла (прикрепите в MOONKATTY NEWS → Файлы, версия EN)</span>'}</div>
    <div class="row" style="margin-top:10px"><button class="btn" disabled>Рендер</button><button class="btn" disabled>Экспорт</button>${DEV('рендер/экспорт — в разработке')}</div></div>
  <div class="card"><h3>Очередь рендера <button class="btn sm" data-task-new="video">+ Задача VIDEO</button></h3>${taskTable(rq, 'Очередь пуста')}</div>
  <div class="card"><h3>Аудиодорожки</h3>${auds.length ? auds.map(f => `<div class="list-item"><span class="sp">${esc(f.name)}</span>${mediaPlayer(f)}</div>`).join('') : '<div class="empty">Нет аудиофайлов</div>'}</div>
  <div class="card"><h3>Субтитры и видео</h3>${[...subs, ...vids].length ? [...subs, ...vids].map(f => `<div class="list-item"><span class="sp">${esc(f.name)}</span><span class="small mut">${fmtSize(f.size)}</span><a class="btn sm" href="${esc(f.url)}" download="${esc(f.name)}">Скачать</a></div>`).join('') : '<div class="empty">Нет файлов</div>'}
    <p class="small mut">Автогенерация субтитров — ${DEV()}</p></div></div>`;
};
BIND.video = v => { const a = v.querySelector('#vep'), b = v.querySelector('#vfmt'); if (a) a.onchange = () => { SUB.vep = a.value; render(); }; b.onchange = () => { SUB.vfmt = b.value; render(); }; };

VIEWS.studio3d = () => `<div class="devbox" style="margin-bottom:16px">3D Studio и агент 3D DESIGN <b>запланированы</b>. Настройки ниже пока не работают и отключены.</div>
  <div class="grid g3">${[['Фон', ['Лунная база', 'Космос', 'Студия новостей']], ['Освещение', ['Мягкое', 'Неон', 'Драматичное']], ['Камера', ['Общий план', 'Крупный план', 'Облёт']], ['Анимация', ['Ведущий говорит', 'Жесты', 'Idle']], ['Голос ведущего', ['EN', 'RU', 'UK']]]
    .map(([n, o]) => `<div class="card"><h3>${n} <span class="badge b-dev b-none">Запланировано</span></h3><select disabled>${o.map(x => `<option>${x}</option>`).join('')}</select></div>`).join('')}</div>`;

// ---- SOCIAL ----
const toLocalInput = d => d ? new Date(new Date(d) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '';
function postForm(p) {
  const isNew = !p; p = p || { title: '', text: '', channelId: 'telegram', status: 'draft' };
  modal(`<h2>${isNew ? 'Новый пост' : 'Пост'}</h2><label>Заголовок</label><input name="title" required value="${esc(p.title)}"><label>Канал</label><select name="channelId">${opts(DB.channels.map(c => [c.id, c.name]), p.channelId)}</select>
    <label>Текст</label><textarea name="text" rows="5">${esc(p.text)}</textarea><label>Дата публикации</label><input type="datetime-local" name="scheduledAt" value="${toLocalInput(p.scheduledAt)}">`,
    fd => { const body = { ...fd, scheduledAt: fd.scheduledAt ? new Date(fd.scheduledAt).toISOString() : null }; return act(() => isNew ? api('POST', '/api/posts', { ...body, status: 'draft' }) : api('PUT', '/api/posts/' + p.id, body), 'Сохранено'); });
}
VIEWS.social = () => {
  const posts = [...DB.posts].sort((a, b) => (a.scheduledAt || 'z').localeCompare(b.scheduledAt || 'z'));
  return `<div class="grid g2"><div class="card"><h3>Каналы</h3>${DB.channels.map(c => `<div class="list-item"><b class="sp">${esc(c.name)} <span class="small mut">${esc(c.handle)}</span></b><span class="badge">Не подключено</span><button class="btn sm" disabled>Подключить</button></div>`).join('')}
    <p class="small mut">Подключение API платформ и автопубликация — ${DEV()}</p></div>
  <div class="card"><h3>Процесс утверждения</h3><p class="small mut" style="margin-top:0">Черновик → На утверждении → Утверждено / Отклонено → Опубликовано. Публикация пока выполняется вручную; после неё отметьте пост «Опубликовано».</p>
    <div class="row">${Object.keys(PST).map(k => `${postBadge(k)} <b>${DB.posts.filter(p => p.status === k).length}</b>`).join(' ')}</div></div></div>
  <div class="card" style="margin-top:16px"><h3>Публикации <button class="btn sm primary" id="newPost">+ Пост</button></h3>
    ${posts.length ? `<div class="tbl-wrap"><table><tr><th>Пост</th><th>Канал</th><th>Дата</th><th>Статус</th><th>Действия</th></tr>${posts.map(p => `<tr><td><b>${esc(p.title)}</b><div class="small mut">${esc((p.text || '').slice(0, 100))}</div></td><td>${esc(chName(p.channelId))}</td><td class="small">${fmt(p.scheduledAt)}</td><td>${postBadge(p.status)}</td>
      <td><div class="row">${p.status === 'draft' || p.status === 'rejected' ? `<button class="btn sm" data-pst="${p.id}|pending">На утверждение</button>` : ''}${p.status === 'pending' ? `<button class="btn sm primary" data-pst="${p.id}|approved">Утвердить</button><button class="btn sm danger" data-pst="${p.id}|rejected">Отклонить</button>` : ''}
      ${p.status === 'approved' ? `<button class="btn sm" disabled title="в разработке">Автопубликация</button><button class="btn sm" data-pst="${p.id}|published">Отметить опубликованным</button>` : ''}
      <button class="btn sm" data-pedit="${p.id}">Изм.</button><button class="btn sm danger" data-pdel="${p.id}">✕</button></div></td></tr>`).join('')}</table></div>` : '<div class="empty">Постов нет</div>'}</div>`;
};
BIND.social = v => { v.querySelector('#newPost').onclick = () => postForm();
  v.querySelectorAll('[data-pst]').forEach(b => b.onclick = () => { const [id, s] = b.dataset.pst.split('|'); act(() => api('PUT', '/api/posts/' + id, { status: s, [s + 'At']: C.now() }), 'Статус: ' + PST[s][0]); });
  v.querySelectorAll('[data-pedit]').forEach(b => b.onclick = () => postForm(DB.posts.find(p => p.id === b.dataset.pedit)));
  v.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => confirmDo('Удалить пост?', () => act(() => api('DELETE', '/api/posts/' + b.dataset.pdel), 'Удалено'))); };

// ---- PR ----
VIEWS.pr = () => `<div class="devbox" style="margin-bottom:14px">Запуск рекламы через рекламные кабинеты — <b>в разработке</b>. Здесь — учёт кампаний и результаты, которые вы вносите сами (никаких автоматических цифр).</div>
  <div class="grid g2"><div class="card"><h3>Кампании <button class="btn sm primary" id="newCamp">+ Кампания</button></h3>
  ${DB.campaigns.length ? DB.campaigns.map(c => `<div class="list-item"><div class="sp"><b>${esc(c.name)}</b> <span class="badge b-none">${esc(c.channel || '')}</span><div class="small mut">${esc(c.start || '')} — ${esc(c.end || '')} · бюджет: ${esc(c.budget || '—')}</div>${c.results ? `<div class="small">Результат: ${esc(c.results)}</div>` : ''}</div>
    <select data-cst="${c.id}" style="width:auto">${opts([['plan', 'План'], ['active', 'Активна'], ['done', 'Завершена']], c.status)}</select><button class="btn sm" data-cedit="${c.id}">Изм.</button><button class="btn sm danger" data-cdel="${c.id}">✕</button></div>`).join('') : '<div class="empty">Кампаний нет</div>'}</div>
  <div class="card"><h3>Задачи PR / MARKETING <button class="btn sm" data-task-new="pr">+ Задача</button></h3>${taskTable(DB.tasks.filter(t => ['pr', 'marketing'].includes(t.agentId)))}</div></div>`;
function campForm(c) { const isNew = !c; c = c || {}; modal(`<h2>Кампания</h2><label>Название</label><input name="name" required value="${esc(c.name || '')}"><label>Канал/площадка</label><input name="channel" value="${esc(c.channel || '')}">
  <div class="grid g2" style="gap:8px"><div><label>Начало</label><input type="date" name="start" value="${esc(c.start || '')}"></div><div><label>Конец</label><input type="date" name="end" value="${esc(c.end || '')}"></div></div>
  <label>Бюджет</label><input name="budget" value="${esc(c.budget || '')}"><label>Результаты (вносятся вручную)</label><textarea name="results" rows="3">${esc(c.results || '')}</textarea>`,
  fd => act(() => isNew ? api('POST', '/api/campaigns', { ...fd, status: 'plan' }) : api('PUT', '/api/campaigns/' + c.id, fd), 'Сохранено')); }
BIND.pr = v => { v.querySelector('#newCamp').onclick = () => campForm();
  v.querySelectorAll('[data-cedit]').forEach(b => b.onclick = () => campForm(DB.campaigns.find(c => c.id === b.dataset.cedit)));
  v.querySelectorAll('[data-cst]').forEach(s => s.onchange = () => act(() => api('PUT', '/api/campaigns/' + s.dataset.cst, { status: s.value }), 'Обновлено'));
  v.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => confirmDo('Удалить кампанию?', () => act(() => api('DELETE', '/api/campaigns/' + b.dataset.cdel), 'Удалено'))); };

// ---- CALENDAR ----
VIEWS.calendar = () => {
  const base = SUB.calm ? new Date(SUB.calm) : new Date(); base.setDate(1); const y = base.getFullYear(), m = base.getMonth();
  const start = new Date(y, m, 1 - ((new Date(y, m, 1).getDay() + 6) % 7)); const today = new Date().toDateString(); const days = [];
  const evs = [...DB.posts.filter(p => p.scheduledAt).map(p => ({ d: new Date(p.scheduledAt), t: chName(p.channelId) + ': ' + p.title, c: '' })),
    ...DB.tasks.filter(t => t.dueAt || t.nextRunAt).map(t => ({ d: new Date(t.dueAt || t.nextRunAt), t: t.title, c: 'task' })),
    ...DB.projects.flatMap(p => (p.plan || []).filter(i => i.date).map(i => ({ d: new Date(i.date + 'T12:00'), t: '📋 ' + i.title, c: '' })))];
  for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d); }
  return `<div class="row" style="margin-bottom:12px"><button class="btn sm" id="calPrev">‹</button><b style="min-width:150px;text-align:center">${base.toLocaleDateString(i18n.locale(), { month: 'long', year: 'numeric' })}</b><button class="btn sm" id="calNext">›</button><span class="sp"></span>
    <span class="small mut"><span class="badge b-pur b-none">публикации / план</span> <span class="badge b-blue b-none">задачи (срок / след. запуск)</span></span></div>
  <div class="cal">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<div class="small mut" style="text-align:center">${d}</div>`).join('')}
  ${days.map(d => `<div class="d ${d.getMonth() !== m ? 'other' : ''} ${d.toDateString() === today ? 'today' : ''}"><b>${d.getDate()}</b>${evs.filter(e => e.d.toDateString() === d.toDateString()).map(e => `<div class="ev ${e.c}" title="${esc(e.t)}">${esc(e.t)}</div>`).join('')}</div>`).join('')}</div>
  ${evs.length ? '' : '<div class="empty" style="margin-top:12px">Событий нет: добавьте пост с датой, задачу со сроком/расписанием или пункт контент-плана.</div>'}`;
};
BIND.calendar = v => { const sh = n => { const b = SUB.calm ? new Date(SUB.calm) : new Date(); b.setDate(1); b.setMonth(b.getMonth() + n); SUB.calm = b.toISOString(); render(); };
  v.querySelector('#calPrev').onclick = () => sh(-1); v.querySelector('#calNext').onclick = () => sh(1); };

// ---- ANALYTICS ----
VIEWS.analytics = () => {
  const r = C.buildReport(DB, 30); const bars = obj => { const e = Object.entries(obj); const mx = Math.max(1, ...e.map(x => x[1]));
    return e.length ? e.map(([k, n]) => `<div style="margin:6px 0"><div class="row small"><span class="sp">${esc((STATUS[k] || PRIO[k] || [k])[0])}</span><b>${n}</b></div><div class="bar"><i style="width:${n / mx * 100}%"></i></div></div>`).join('') : '<div class="empty">Нет данных</div>'; };
  return `<p class="small mut">Только реальные данные системы за 30 дней. Аналитика соцсетей появится после подключения API (${DEV()}).</p>
  <div class="grid g4"><div class="card"><div class="stat-l">Всего задач</div><div class="stat">${r.totals.tasks}</div></div><div class="card"><div class="stat-l">Создано за 30 дн.</div><div class="stat">${r.totals.createdInPeriod}</div></div>
  <div class="card"><div class="stat-l">Выполнено за 30 дн.</div><div class="stat">${r.totals.doneInPeriod}</div></div><div class="card"><div class="stat-l">Ошибок за 30 дн.</div><div class="stat">${r.totals.errorsInPeriod}</div></div></div>
  <div class="grid g3" style="margin-top:16px"><div class="card"><h3>Задачи по статусам</h3>${bars(r.tasksByStatus)}</div><div class="card"><h3>По приоритетам</h3>${bars(r.tasksByPriority)}</div>
  <div class="card"><h3>По агентам</h3>${Object.keys(r.perAgent).length ? Object.entries(r.perAgent).map(([n, x]) => `<div class="list-item small"><span class="sp">${esc(n)}</span>всего ${x.total} · готово ${x.done} · открыто ${x.open}</div>`).join('') : '<div class="empty">Нет данных</div>'}</div>
  <div class="card"><h3>Соцсети</h3>${DB.channels.map(c => `<div class="list-item small"><span class="sp">${esc(c.name)}</span><span class="badge">Не подключено</span></div>`).join('')}</div></div>`;
};

// ---- REPORTS ----
function reportHtml(r) {
  const T = r.totals; return r.empty ? '<div class="empty">За период нет данных (ни задач, ни событий журнала, ни выпусков).</div>' : `<table>
  ${[['Задач всего', T.tasks], ['Создано за период', T.createdInPeriod], ['Выполнено за период', T.doneInPeriod], ['С ошибкой за период', T.failedInPeriod], ['Открытых', T.open], ['Событий журнала за период', T.logsInPeriod], ['Ошибок в журнале', T.errorsInPeriod], ['Выпусков', T.episodes], ['Постов на утверждении', T.postsPendingApproval]].map(([a, b]) => `<tr><td>${a}</td><td><b>${b}</b></td></tr>`).join('')}</table>
  <h4>По агентам</h4>${Object.entries(r.perAgent).map(([n, x]) => `<div class="small">${esc(n)}: всего ${x.total}, готово ${x.done}, открыто ${x.open}</div>`).join('') || '<div class="small mut">—</div>'}
  <h4>Ошибки</h4>${r.errors.length ? r.errors.map(e => `<div class="small">${fmt(e.at)} [${esc(e.source)}] ${esc(e.message)}</div>`).join('') : '<div class="small mut">Ошибок нет</div>'}`;
}
VIEWS.reports = () => { const reps = [...DB.reports].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `<div class="row" style="margin-bottom:14px"><button class="btn primary" id="genRep">Сформировать отчёт за 3 дня</button><span class="small mut">Автоотчёт формируется каждые 3 дня (${MODE === 'server' ? 'сервером' : 'при открытой странице'}) только из реальных задач, журнала и выпусков.</span></div>
  ${reps.length ? reps.map(r => `<div class="card" style="margin-bottom:12px"><h3><span>Отчёт ${fmt(r.periodStart)} — ${fmt(r.periodEnd)} <span class="badge b-none ${r.trigger === 'auto' ? 'b-blue' : 'b-pur'}">${r.trigger === 'auto' ? 'авто' : 'вручную'}</span></span>
    <span class="row"><button class="btn sm" data-rdl="${r.id}">JSON</button><button class="btn sm danger" data-rdel="${r.id}">✕</button></span></h3>${reportHtml(r)}</div>`).join('') : '<div class="empty">Отчётов нет</div>'}`; };
BIND.reports = v => { v.querySelector('#genRep').onclick = () => act(() => api('POST', '/api/reports/generate', { periodDays: 3 }), 'Отчёт сформирован');
  v.querySelectorAll('[data-rdl]').forEach(b => b.onclick = () => download('report-' + b.dataset.rdl + '.json', DB.reports.find(r => r.id === b.dataset.rdl)));
  v.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => act(() => api('DELETE', '/api/reports/' + b.dataset.rdel), 'Удалено')); };

// ---- FILES ----
VIEWS.files = () => `<div class="card" style="margin-bottom:16px"><h3>Загрузка файлов</h3><div class="row"><input type="file" id="fileIn" multiple style="width:auto;max-width:100%"><button class="btn primary" id="upBtn">Загрузить</button></div>
  <p class="small mut">${MODE === 'server' ? 'Файлы хранятся на сервере (data/files), доступны только после входа.' : 'Браузерный режим: файлы до 3 МБ в localStorage.'} Аудио/видео затем привязываются к выпускам (MOONKATTY NEWS → Файлы).</p></div>
  <div class="grid g2"><div class="card"><h3>Файлы (${DB.files.length})</h3>${DB.files.length ? DB.files.map(f => `<div class="list-item"><span class="sp">${esc(f.name)} <span class="small mut">${fmtSize(f.size)} · ${fmt(f.createdAt)}</span></span><a class="btn sm" href="${esc(f.url)}" target="_blank" download="${esc(f.name)}">Открыть</a><button class="btn sm danger" data-fdel="${f.id}">✕</button></div>`).join('') : '<div class="empty">Файлов нет</div>'}</div>
  <div class="card"><h3>Проекты</h3>${DB.projects.map(p => `<div class="list-item"><div class="sp"><b>${esc(p.name)}</b><div class="small mut">${esc(p.description)}</div></div><span class="small mut">задач: ${DB.tasks.filter(t => t.project === p.id).length} · план: ${(p.plan || []).length}</span></div>`).join('')}</div></div>`;
BIND.files = v => { v.querySelector('#upBtn').onclick = async () => { const fs = [...v.querySelector('#fileIn').files]; if (!fs.length) return toast('Выберите файл', true); for (const f of fs) await act(() => api('POST', '/api/files/upload', f), 'Загружено: ' + f.name); };
  v.querySelectorAll('[data-fdel]').forEach(b => b.onclick = () => confirmDo('Удалить запись о файле?', () => act(() => api('DELETE', '/api/files/' + b.dataset.fdel), 'Удалено'))); };

// ---- LOGS ----
VIEWS.logs = () => { const lv = SUB.lv || ''; const logs = DB.logs.filter(l => !lv || l.level === lv).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 400);
  return `<div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>Мониторинг системы <button class="btn sm" id="sysRef">Обновить</button></h3><pre class="box" id="sysBox">${SYS ? esc(JSON.stringify(SYS, null, 2)) : 'Нажмите «Обновить»'}</pre></div>
  <div class="card"><h3>Терминал</h3><input disabled placeholder="$ команда…"><p class="small mut">Выполнение команд на Mac из браузера — ${DEV()} (сознательно отключено до настройки безопасного доступа).</p></div></div>
  <div class="row" style="margin-bottom:8px"><b>Журнал действий и ошибок</b><select id="lv" style="width:auto">${opts([['', 'Все уровни'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']], lv)}</select><span class="sp"></span><button class="btn sm" id="logDl">Экспорт JSON</button></div>
  <div class="term">${logs.length ? logs.map(l => `<div class="${l.level}">${esc(fmt(l.at))} [${l.level}] ${esc(l.source)}${l.user ? ' (' + esc(l.user) + ')' : ''}: ${esc(l.message)}</div>`).join('') : '<span class="mut">Журнал пуст</span>'}</div>`; };
BIND.logs = v => { v.querySelector('#lv').onchange = e => { SUB.lv = e.target.value; render(); }; v.querySelector('#logDl').onclick = () => download('logs.json', DB.logs);
  v.querySelector('#sysRef').onclick = async () => { try { SYS = await api('GET', '/api/system'); render(); } catch (e) { toast(e.message, true); } }; };

// ---- SETTINGS ----
VIEWS.settings = () => `<div class="grid g2"><div class="card" style="grid-column:1/-1"><h3>Интеграции (Mac mini)</h3>
  <p class="small mut" style="margin-top:0">${MODE === 'server' ? 'Проверка выполняется сервером (реальный HTTP-запрос, таймаут 5 с).' : 'Браузерный режим: проверка идёт прямо из браузера; с https-страницы запросы к http://localhost обычно блокируются (mixed content / CORS). Для реальной проверки запустите сервер на Mac.'}</p>
  ${DB.integrations.filter(i => i.id !== 'opencode').map(i => `<form class="list-item" data-int="${i.id}"><b style="min-width:100px">${esc(i.name)}</b><input name="url" value="${esc(i.url)}" style="flex:2;min-width:180px" aria-label="URL"><input name="testPath" value="${esc(i.testPath)}" style="flex:1;min-width:80px" title="путь проверки" aria-label="путь проверки">
    ${i.id === 'ollama' ? `<input name="model" value="${esc(i.model || 'qwen3:8b')}" style="flex:1;min-width:90px" title="модель" aria-label="модель">` : ''}<button class="btn sm">Сохранить</button><button type="button" class="btn sm primary" data-test="${i.id}">Тест</button>${svcBadge(i)}
    ${i.lastTest ? `<div class="small mut" style="width:100%">${fmt(i.lastTest.at)} · ${esc(i.lastTest.url)} · HTTP ${i.lastTest.status ?? '—'} · ${i.lastTest.ms} мс · ${esc(i.lastTest.detail)} (${i.lastTest.via})</div>` : ''}</form>`).join('')}</div>
  <div class="card" style="grid-column:1/-1" id="ocCard"><h3>OpenCode — доступ к серверу <span id="ocBadge" class="badge">Не подключено</span></h3>
    <p class="small mut" style="margin-top:0">Для <code>opencode serve</code> с <code>OPENCODE_SERVER_PASSWORD</code> (HTTP Basic Auth). Пароль хранится только в macOS Keychain и никогда не показывается и не попадает в базу, бэкапы и журналы.</p>
    <form id="ocForm" autocomplete="off"><div class="row" style="flex-wrap:wrap;gap:8px">
      <label style="flex:2;min-width:200px">URL сервера<input name="url" id="ocUrl" placeholder="http://127.0.0.1:4096" required></label>
      <label style="flex:1;min-width:120px">Логин<input name="username" id="ocUser" placeholder="opencode" autocomplete="off"></label>
      <label style="flex:1;min-width:160px">Пароль<input type="password" name="password" id="ocPw" autocomplete="new-password" placeholder="не задан" maxlength="256"></label></div>
      <div class="row" style="margin-top:10px;gap:8px"><button class="btn" id="ocSave">Сохранить</button><button type="button" class="btn primary" id="ocTest">Проверить подключение</button><button type="button" class="btn danger" id="ocClear">Удалить пароль</button></div>
      <p class="small mut" id="ocInfo"></p><p class="small" id="ocResult"></p></form></div>
  <div class="card"><h3>Резервное копирование</h3><div class="row"><button class="btn" id="bkExp">Экспорт JSON</button><label class="btn" style="margin:0;color:var(--text);font-size:13px">Импорт<input type="file" id="bkImp" accept=".json,application/json" hidden></label>${MODE === 'server' ? '<button class="btn" id="bkRun">Бэкап на сервере сейчас</button>' : ''}</div>
    <p class="small mut">${MODE === 'server' ? 'Сервер автоматически сохраняет копию раз в сутки в data/backups (хранятся 14 последних).' : 'Браузерный режим: автобэкап на сервере недоступен — используйте экспорт.'}</p><div id="bkList" class="small mut"></div></div>
  <div class="card"><h3>Учётная запись: ${esc(USER)}</h3><form id="pwForm"><label>Старый пароль</label><input type="password" name="oldPassword" required autocomplete="current-password"><label>Новый пароль</label><input type="password" name="newPassword" minlength="8" required autocomplete="new-password"><button class="btn" style="margin-top:10px">Сменить пароль</button></form></div>
  <div class="card"><h3>Уведомления</h3><p class="small">Ошибки показываются в колокольчике 🔔 (работает).</p><button class="btn" disabled>Включить web push</button> ${DEV()}</div>
  <div class="card"><h3>Режим работы</h3><p class="small">${MODE === 'server' ? 'Серверный режим: Node.js + SQLite.' : 'Браузерный демо-режим: данные хранятся только в этом браузере (localStorage).'}</p><button class="btn danger" id="resetBtn">Сбросить все данные</button></div></div>`;
BIND.settings = v => {
  bindOpencode(v);
  v.querySelectorAll('[data-int]').forEach(f => f.onsubmit = e => { e.preventDefault(); act(() => api('PUT', '/api/integrations/' + f.dataset.int, Object.fromEntries(new FormData(f))), 'Сохранено'); });
  v.querySelector('#bkExp').onclick = async () => download('moonkatty-studio-backup.json', await api('GET', '/api/backup'));
  v.querySelector('#bkImp').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); confirmDo('Восстановить данные из файла? Текущие данные будут заменены.', () => act(() => api('POST', '/api/restore', d), 'Данные восстановлены')); } catch { toast('Файл не является JSON', true); } };
  const run = v.querySelector('#bkRun'); if (run) { run.onclick = () => act(() => api('POST', '/api/backups/run'), 'Бэкап создан'); api('GET', '/api/backups').then(l => { const el = v.querySelector('#bkList'); if (el) el.textContent = l.length ? 'Копии на сервере: ' + l.slice(0, 5).join(', ') : 'Копий пока нет'; }).catch(() => {}); }
  v.querySelector('#pwForm').onsubmit = async e => { e.preventDefault(); try { await api('POST', '/api/auth/password', Object.fromEntries(new FormData(e.target))); toast('Пароль изменён'); e.target.reset(); } catch (er) { toast(er.message, true); } };
  v.querySelector('#resetBtn').onclick = () => confirmDo('Сбросить ВСЕ данные к начальным?', () => act(() => api('POST', '/api/reset', { confirm: 'RESET' }), 'Данные сброшены'));
};

async function bindOpencode(v) {
  const f = v.querySelector('#ocForm'); if (!f) return; const pw = v.querySelector('#ocPw'), info = v.querySelector('#ocInfo'), res = v.querySelector('#ocResult'), badge = v.querySelector('#ocBadge');
  const show = s => { v.querySelector('#ocUrl').value = s.url || ''; v.querySelector('#ocUser').value = s.username || 'opencode'; pw.value = '';
    pw.placeholder = s.hasPassword ? '•••••• сохранён в Keychain' : 'не задан';
    const off = !s.keychain?.available; badge.textContent = s.status || 'Не подключено'; badge.className = 'badge' + (s.status === 'Подключено' ? ' b-ok' : '');
    info.textContent = off ? 'Не подключено — ' + (s.keychain?.reason || 'Keychain недоступна') : 'Пароль: ' + (s.hasPassword ? 'сохранён в macOS Keychain' : 'не задан') + ' · разрешены только локальные адреса';
    [pw, v.querySelector('#ocClear')].forEach(x => x.disabled = off); if (off) pw.placeholder = 'недоступно без Keychain';
    if (s.lastTest) res.textContent = (s.lastTest.ok ? '✓ ' : '✗ ') + s.lastTest.detail; };
  try { show(await api('GET', '/api/opencode/auth')); } catch (e) { info.textContent = 'Не подключено — ' + e.message; }
  f.onsubmit = async e => { e.preventDefault(); const b = { url: f.url.value.trim(), username: f.username.value.trim() || 'opencode' }; if (pw.value) b.password = pw.value;
    try { show(await api('PUT', '/api/opencode/auth', b)); toast('Сохранено'); } catch (er) { toast('Ошибка: ' + er.message, true); } finally { pw.value = ''; } };
  v.querySelector('#ocClear').onclick = () => confirmDo('Удалить пароль OpenCode из Keychain?', async () => { try { show(await api('PUT', '/api/opencode/auth', { clearPassword: true })); toast('Пароль удалён'); } catch (er) { toast('Ошибка: ' + er.message, true); } });
  v.querySelector('#ocTest').onclick = async () => { const btn = v.querySelector('#ocTest'); btn.disabled = true; res.textContent = 'Проверка…';
    try { const r = await api('POST', '/api/opencode/test'); res.textContent = (r.ok ? '✓ ' : '✗ ') + r.detail; toast(r.ok ? 'Подключено ✓' : r.detail, !r.ok); show(await api('GET', '/api/opencode/auth')); }
    catch (er) { res.textContent = '✗ ' + er.message; } finally { btn.disabled = false; } };
}

// ================= Director chat =================
function openChat() { $('#chatDrawer').classList.remove('hidden'); renderChat(); }
function renderChat() {
  const d = $('#chatDrawer'); const ol = DB.integrations.find(i => i.id === 'ollama');
  d.innerHTML = `<div class="row" style="padding:14px;border-bottom:1px solid var(--line);padding-top:max(14px,env(safe-area-inset-top))"><img src="logo.svg" alt="" style="width:28px"><div class="sp"><b>Director</b><div class="small mut">Планировщик: ${ol?.lastTest?.ok ? 'LLM (Ollama ' + esc(ol.model || 'qwen3:8b') + ')' : 'правиловой (без ИИ) — Ollama не подключена'}</div></div><button class="icon-btn" id="chatClose" aria-label="Закрыть">✕</button></div>
  <div class="chat-log" id="chatLog">${DB.chat.length ? DB.chat.map(m => `<div class="msg ${m.role}">${esc(m.text)}${m.role === 'director' && m.at ? `<div class="small mut" style="margin-top:6px">${m.planner === 'rules' ? 'Правиловой планировщик (без ИИ)' : esc(m.planner)}${m.llmError ? ' · LLM недоступна: ' + esc(m.llmError) : ''}</div>
    ${(m.taskIds || []).map(id => { const t = DB.tasks.find(x => x.id === id); return t ? `<div class="small" style="margin-top:4px">• ${esc(t.title)} → <b>${esc(agentName(t.agentId))}</b> ${stBadge(t.status)}</div>` : '<div class="small mut">• (задача удалена)</div>'; }).join('')}` : ''}</div>`).join('') : '<div class="empty">Напишите задачу естественным языком. Director создаст задачи и назначит агентов; прогресс виден здесь и в AI Agents → Очередь задач.</div>'}</div>
  <form class="chat-in" id="chatForm"><textarea name="text" placeholder="Подготовь сегодняшний выпуск новостей на 15 минут на трёх языках" required></textarea><button class="btn primary" aria-label="Отправить">➤</button></form>`;
  d.querySelector('#chatClose').onclick = () => d.classList.add('hidden');
  const f = d.querySelector('#chatForm'); f.onsubmit = e => { e.preventDefault(); const t = f.text.value; if (t.trim()) sendChat(t); };
  f.text.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
  const l = d.querySelector('#chatLog'); l.scrollTop = l.scrollHeight;
}
async function sendChat(text) { DB.chat.push({ role: 'user', text }); DB.chat.push({ role: 'director', text: 'Разбираю запрос…' }); renderChat(); await act(() => api('POST', '/api/director/chat', { text }), 'Director создал задачи'); renderChat(); }

// ================= Notifications =================
function updateBell() { const seen = localStorage.getItem('mk-seen-err') || ''; const n = DB.logs.filter(l => l.level === 'error' && l.at > seen).length; const b = $('#bellCount'); b.textContent = n; b.classList.toggle('hidden', !n); }
function toggleNotif() { const p = $('#notifPanel'); if (!p.classList.contains('hidden')) return p.classList.add('hidden');
  const errs = DB.logs.filter(l => l.level !== 'info').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  p.innerHTML = `<b>Ошибки и предупреждения</b>${errs.length ? errs.map(l => `<div class="list-item small"><span class="badge ${l.level === 'error' ? 'b-err' : 'b-warn'}">${l.level}</span><span class="sp">${esc(l.message)}<div class="mut">${fmt(l.at)}</div></span></div>`).join('') : '<div class="empty">Нет уведомлений</div>'}`;
  p.classList.remove('hidden'); localStorage.setItem('mk-seen-err', C.now()); updateBell(); }

// ================= Auth & boot =================
async function showAuth() {
  const st = await api('GET', '/api/auth/status'); $('#app').classList.add('hidden'); const a = $('#auth'); a.classList.remove('hidden');
  a.innerHTML = `<form class="box"><img src="logo.svg" alt=""><h2 style="text-align:center;margin:0;letter-spacing:.06em">MOONKATTY AI STUDIO</h2><p class="small mut" style="text-align:center">${st.needsSetup ? 'Первый запуск: создайте администратора' : 'Вход'}${MODE === 'browser' ? '<br><span class="gold">Браузерный демо-режим: данные и пароль хранятся только в этом браузере</span>' : ''}</p>
    <label>Логин</label><input name="username" required autocomplete="username" value="${st.needsSetup ? 'igor' : ''}"><label>Пароль${st.needsSetup ? ' (мин. 8 символов)' : ''}</label><input name="password" type="password" required minlength="${st.needsSetup ? 8 : 1}" autocomplete="${st.needsSetup ? 'new-password' : 'current-password'}">
    <div class="row" style="margin-top:12px"><span class="small mut sp">Язык / Language</span><select id="langAuth" style="width:auto">${opts([['ru', 'RU'], ['en', 'EN'], ['uk', 'UK']], i18n.lang)}</select></div><button class="btn primary" style="width:100%;margin-top:16px">${st.needsSetup ? 'Создать и войти' : 'Войти'}</button><div id="authErr" class="small" style="color:var(--err);margin-top:8px"></div></form>`;
  a.querySelector('#langAuth').onchange = e => i18n.set(e.target.value);
  a.querySelector('form').onsubmit = async e => { e.preventDefault(); try { const r = await api('POST', st.needsSetup ? '/api/auth/setup' : '/api/auth/login', Object.fromEntries(new FormData(e.target))); USER = r.user; await start(); } catch (er) { a.querySelector('#authErr').textContent = er.message; } };
}
let started = false;
async function start() {
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#modeBadge').className = 'badge ' + (MODE === 'server' ? 'b-ok' : 'b-warn'); $('#modeBadge').textContent = MODE === 'server' ? 'Сервер · SQLite' : 'Браузерный режим';
  await loadAll(); ROUTE = location.hash.slice(1).split('?')[0] || 'dashboard'; render(); if (typeof metaReturnToast === 'function') metaReturnToast();
  if (started) return; started = true;
  setInterval(async () => { if (MODE === 'browser') localTick(); if (document.hidden || !$('#modal').classList.contains('hidden')) return;
    try { await loadAll(); if (!document.activeElement || !document.activeElement.matches('input,textarea,select')) render(); } catch {} }, 30000);
}
(async function boot() {
  i18n.start(); const ls = $('#langSel'); ls.value = i18n.lang; ls.onchange = () => i18n.set(ls.value);
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#chatBtn').onclick = () => $('#chatDrawer').classList.contains('hidden') ? openChat() : $('#chatDrawer').classList.add('hidden');
  $('#logoutSide').onclick = async () => { await api('POST', '/api/auth/logout'); location.reload(); }; $('#setBtn').onclick = () => navTo('settings');
  $('#bellBtn').onclick = toggleNotif;
  document.addEventListener('click', e => { if (!e.target.closest('#notifPanel,#bellBtn')) $('#notifPanel').classList.add('hidden'); });
  try { const r = await fetch('api/health', { cache: 'no-store' }); const j = await r.json(); MODE = j.mode === 'server' ? 'server' : 'browser'; } catch { MODE = 'browser'; }
  if (MODE === 'browser') { ldInit(); localTick(); }
  const st = await api('GET', '/api/auth/status'); if (st.user) { USER = st.user; await start(); } else showAuth();
})();

// ================= Concept-style dashboard =================
const AV = { news: 'av-news', social: 'av-social', games: 'av-games', pr: 'av-brand', director: 'av-news', video: 'av-social', mkty: 'av-brand', analytics: 'av-games', marketing: 'av-brand', design3d: 'av-games' };
function avatar(a) { return `<img class="av-img" src="img/${AV[a.id] || 'av-news'}.jpg" alt="" style="${a.enabled ? '' : 'filter:grayscale(1);opacity:.6'}">`; }
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function renderPills() {
  const it = id => DB.integrations.find(i => i.id === id); const cls = i => !i?.lastTest ? '' : i.lastTest.ok ? 'ok' : 'err';
  const st = MODE === 'server' ? (SYS?.dbSize != null ? fmtSize(SYS.dbSize) : '—') : fmtSize(SYS?.storageBytes || 0);
  $('#pills').innerHTML = `<span class="pill ok" data-go="logs"><i></i>${MODE === 'server' ? 'System Online' : 'Демо (браузер)'}</span>` +
    ['ollama', 'opencode', 'docker'].map(id => `<span class="pill ${cls(it(id))}" data-go="settings" title="${it(id)?.lastTest ? (it(id).lastTest.ok ? 'Подключено' : 'Не подключено') : 'Не проверялось — Не подключено'}"><i></i>${esc(it(id)?.name)}</span>`).join('') +
    `<span class="pill" data-go="files"><i style="background:#8b5cf6"></i>Storage ${st}</span>`;
  $('#pills').querySelectorAll('[data-go]').forEach(b => b.onclick = () => navTo(b.dataset.go));
}
VIEWS.dashboard = () => {
  const T = DB.tasks; const order = { urgent: 0, high: 1, normal: 2, low: 3 };
  const list = [...T].filter(t => t.status !== 'cancelled').sort((a, b) => (a.status === 'done') - (b.status === 'done') || (order[a.priority] ?? 2) - (order[b.priority] ?? 2)).slice(0, 9);
  const ep = [...DB.episodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const epV = ep && ep.versions.EN; const doneN = epV ? C.PIPELINE.filter(([k]) => epV[k] === 'done').length : 0; const curI = epV ? C.PIPELINE.findIndex(([k]) => epV[k] !== 'done') : -1;
  const vf = ep && fileById(((ep.media || {}).EN || {}).video);
  const upcoming = DB.posts.filter(p => p.scheduledAt && new Date(p.scheduledAt) > new Date() && p.status !== 'published').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 5);
  const calMode = SUB.dcal || 'week'; const today = new Date(); const days = [];
  if (calMode === 'week') { const s = new Date(today); s.setDate(today.getDate() - ((today.getDay() + 6) % 7)); for (let i = 0; i < 7; i++) { const d = new Date(s); d.setDate(s.getDate() + i); days.push(d); } }
  else { const s = new Date(today.getFullYear(), today.getMonth(), 1); s.setDate(1 - ((s.getDay() + 6) % 7)); for (let i = 0; i < 35; i++) { const d = new Date(s); d.setDate(s.getDate() + i); days.push(d); } }
  const evDates = [...DB.posts.map(p => p.scheduledAt), ...T.map(t => t.dueAt || t.nextRunAt)].filter(Boolean).map(d => new Date(d).toDateString());
  const S = SYS || {}; const M = S.memory && S.memory.total ? S.memory : null; // Activity-Monitor-compatible (vm_stat); old memFree ignored cache
  const memUsed = M ? M.used : S.memTotal ? S.memTotal - S.memFree : null; const memTot = M ? M.total : S.memTotal; const gib = n => n == null ? '—' : (n / 1024 ** 3).toFixed(2) + ' ГБ';
  const metric = (n, v, label) => `<div class="metric"><span class="mut">${n}</span>${v == null ? '<span class="small mut">Не подключено</span><span></span>' : `<div class="bar"><i style="width:${v}%"></i></div><b class="small">${label || v + '%'}</b>`}</div>`;
  const acts = [...DB.logs].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
  return `<div class="agent-row">${['director', 'news', 'video', 'social', 'games'].map(id => DB.agents.find(a => a.id === id)).filter(Boolean).map(a => { const ct = DB.tasks.find(t => t.id === a.currentTaskId);
    return `<div class="agent-mini" data-go="agents">${avatar(a)}<div style="min-width:0"><b>${esc(a.name)} Agent</b><div class="small mut" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ct ? esc(ct.title) : esc(a.role.split(':')[0])}</div>${agentStatus(a)}</div></div>`; }).join('')}</div>
  <div class="dash"><div class="col">
    <div class="card"><h3>Tasks <button class="btn sm primary" data-task-new="">+ New Task</button></h3>
      ${list.length ? list.map(t => `<label class="task-li ${t.status === 'done' ? 'done' : ''}"><input type="checkbox" data-done="${t.id}" ${t.status === 'done' ? 'checked' : ''}><span class="sp">${esc(t.title)}<div class="small mut">${esc(agentName(t.agentId))} · ${(STATUS[t.status] || [t.status])[0]}</div></span><span class="small mut">${t.dueAt ? fmt(t.dueAt).slice(-5) : ''}</span></label>`).join('') : '<div class="empty">Задач нет. Создайте задачу или напишите Director.</div>'}
      <button class="btn sm ghost" data-go="agents" style="margin-top:8px">Все задачи →</button></div>
    <div class="card"><h3><span><img src="img/av-news.jpg" alt="" style="width:22px;border-radius:6px;vertical-align:middle"> Director</span><span class="small mut">${DB.integrations.find(i => i.id === 'ollama')?.lastTest?.ok ? 'LLM' : 'правиловой планировщик'}</span></h3>
      <form id="dashChat" class="row"><input name="text" class="sp" placeholder="Подготовь сегодняшний выпуск новостей на 15 минут на трёх языках" required><button class="btn primary">➤</button></form></div>
  </div><div class="col">
    <div class="card"><h3>Content Pipeline ${ep ? `<small>${esc(ep.title)} · EN</small>` : ''}</h3>
      ${ep ? `<div class="stepper">${C.PIPELINE.map(([k, l], i) => `<div class="step ${epV[k] === 'done' ? 'done' : i === curI ? 'cur' : ''}">${i + 1} ${l}</div>`).join('')}</div>
      <div class="row"><div class="bar sp"><i style="width:${pct(doneN, C.PIPELINE.length)}%"></i></div><span class="small">Этап ${Math.min(doneN + 1, C.PIPELINE.length)}/${C.PIPELINE.length} · <b>${pct(doneN, C.PIPELINE.length)}%</b></span></div>` : '<div class="empty">Выпусков нет. <button class="btn sm" data-go="news">Создать выпуск</button></div>'}</div>
    <div class="card"><h3>Preview <span class="badge b-none">16:9</span></h3>
      <div class="preview">${vf ? `<video controls src="${esc(vf.url)}" style="width:100%;height:100%"></video>` : `<img src="img/preview.jpg" alt=""><div class="ov"><div><b>Видео ещё нет</b><br>Плеер появится, когда к выпуску (EN) будет прикреплён видеофайл.<br><span class="mut">Фон — концепт-арт, не результат рендера</span></div></div>`}</div></div>
  </div><div class="col">
    <div class="card"><h3>Upcoming Publications <button class="btn sm ghost" data-go="social">View all</button></h3>
      ${upcoming.length ? upcoming.map(p => `<div class="list-item"><span class="sp">${esc(p.title)}<div class="small mut">${esc(chName(p.channelId))} · ${fmt(p.scheduledAt)}</div></span>${postBadge(p.status)}</div>`).join('') : '<div class="empty">Запланированных публикаций нет</div>'}</div>
    <div class="card"><h3>Calendar <span class="seg"><button data-dcal="week" class="${calMode === 'week' ? 'on' : ''}">Week</button><button data-dcal="month" class="${calMode === 'month' ? 'on' : ''}">Month</button></span></h3>
      <div class="small mut" style="margin-bottom:6px">${today.toLocaleDateString(i18n.locale(), { month: 'long', year: 'numeric' })}</div>
      <div class="mini-cal">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(d => `<span class="mut">${d}</span>`).join('')}${days.map(d => `<div class="${d.toDateString() === today.toDateString() ? 't' : ''} ${evDates.includes(d.toDateString()) ? 'has' : ''}" style="${d.getMonth() !== today.getMonth() ? 'opacity:.4' : ''}">${d.getDate()}</div>`).join('')}</div>
      <button class="btn sm ghost" data-go="calendar" style="margin-top:8px">Открыть календарь →</button></div>
  </div></div>
  <div class="dash-bottom">
    <div class="card"><h3>System Status <button class="btn sm" data-go="settings">Details</button></h3>
      ${DB.integrations.map(i => `<div class="list-item small"><span class="sp">${esc(i.name)}${i.id === 'ollama' ? ` <span class="mut">(${esc(i.model || 'qwen3:8b')})</span>` : ''}</span>${svcBadge(i)}</div>`).join('')}
      <div class="list-item small"><span class="sp">Storage</span><span class="mut">${MODE === 'server' && S.disk ? fmtSize(S.disk.total - S.disk.free) + ' / ' + fmtSize(S.disk.total) : MODE === 'server' ? '—' : 'localStorage ' + fmtSize(S.storageBytes || 0)}</span></div></div>
    <div class="card"><h3>Performance <small>${MODE === 'server' ? 'сервер, live' : 'браузерный режим'}</small></h3>
      ${MODE === 'server' ? metric('CPU', S.cpuPct ?? null) + metric('RAM', memUsed != null ? pct(memUsed, memTot) : null, M ? `${pct(memUsed, memTot)}% · ${esc(M.pressure)}` : null) + (M ? `<div class="small mut" style="margin:-4px 0 6px">Pressure ${esc(M.pressure)} · App ${gib(M.app)} · Wired ${gib(M.wired)} · Compressed ${gib(M.compressed)} · Cached ${gib(M.cached)} · Swap ${gib(M.swapUsed || 0)}</div>` : '') + metric('GPU', null) + metric('Disk', S.disk ? pct(S.disk.total - S.disk.free, S.disk.total) : null) + metric('Network', null)
        : ['CPU', 'RAM', 'GPU', 'Disk', 'Network'].map(n => metric(n, null)).join('')}</div>
    <div class="card"><h3>Recent Activity <button class="btn sm ghost" data-go="logs">View all</button></h3>
      ${acts.length ? acts.map(l => `<div class="list-item small" style="padding:5px 0"><span class="mut">${new Date(l.at).toLocaleTimeString(i18n.locale(), { hour: '2-digit', minute: '2-digit' })}</span><span class="badge b-none ${l.level === 'error' ? 'b-err' : l.level === 'warn' ? 'b-warn' : 'b-ok'}">●</span><span class="sp" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.message)}</span></div>`).join('') : '<div class="empty">Активности нет</div>'}</div>
    <div class="card"><h3>Analytics</h3>${DB.channels.map(c => `<div class="list-item small"><span class="sp">${esc(c.name)}</span><span class="badge">Не подключено</span></div>`).join('')}
      <p class="small mut" style="margin-bottom:0">Без подключения API — никаких цифр (${DEV()}).</p></div>
  </div>`;
};
BIND.dashboard = v => {
  v.querySelector('#dashChat').onsubmit = async e => { e.preventDefault(); const t = e.target.text.value; e.target.reset(); openChat(); await sendChat(t); };
  v.querySelectorAll('[data-done]').forEach(c => c.onchange = () => setTaskStatus(c.dataset.done, c.checked ? 'done' : 'queued'));
  v.querySelectorAll('[data-dcal]').forEach(b => b.onclick = () => { SUB.dcal = b.dataset.dcal; render(); });
};
