// Agent runner (server only). Real work only; no simulated progress.
// An agent with status 'working' takes its queued tasks one by one. Each handler either does a real action
// (report, queue processing, comment drafts, Ollama draft, OpenCode run) or marks the task 'blocked' with the reason.
'use strict';
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
module.exports = function createRunner(ctx) {
  const { get, put, list, log, core, meta, dataDir } = ctx;
  const busy = new Map(); // agentId -> { taskId, abort }
  const ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
  const addLog = (a, level, msg) => { a.actionLog = [{ at: core.now(), level, msg }, ...(a.actionLog || [])].slice(0, 40); log(level, 'agent:' + a.id, msg); };
  const ollamaCfg = () => { const it = get('integrations', 'ollama') || {}; return { url: (it.url || 'http://127.0.0.1:11434').replace(/\/$/, '').replace('localhost', '127.0.0.1'), model: it.model || 'qwen3:8b' }; };
  async function ollamaStatus() {
    const { url, model } = ollamaCfg();
    try { const r = await fetch(url + '/api/tags', { signal: AbortSignal.timeout(3000) }); if (!r.ok) return { ok: false, error: 'HTTP ' + r.status, url, model };
      const names = ((await r.json()).models || []).map(m => m.name); return { ok: names.some(n => n === model || n.startsWith(model + ':') || n.split(':')[0] === model.split(':')[0] && model.endsWith(':latest')) || names.includes(model), models: names, url, model, error: names.includes(model) ? null : `Модель ${model} не установлена (ollama pull ${model})` };
    } catch (e) { return { ok: false, error: 'Ollama недоступна: ' + (e.cause?.code || e.message), url, model }; }
  }
  async function ollamaDraft(prompt, signal) {
    const { url, model } = ollamaCfg();
    const r = await fetch(url + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
      body: JSON.stringify({ model, stream: false, think: false, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) throw new Error('Ollama HTTP ' + r.status); const j = await r.json(); return { text: String(j.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(), model };
  }
  function opencodePath() { try { return execFileSync('/bin/sh', ['-lc', 'command -v opencode'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).toString().trim() || null; } catch { return null; } }
  function runOpencode(task, signal) {
    return new Promise((resolve, reject) => {
      const bin = opencodePath(); if (!bin) return reject(Object.assign(new Error('OpenCode CLI не найден в PATH (в разработке: установите opencode)'), { blocked: true }));
      const dir = path.join(dataDir, 'opencode-sandbox', task.id); fs.mkdirSync(dir, { recursive: true });
      const env = { ...process.env, OPENCODE_PERMISSION: JSON.stringify({ edit: 'allow', bash: 'deny', webfetch: 'deny', external_directory: 'deny' }), OPENCODE_DISABLE_AUTOUPDATE: '1' };
      const p = spawn(bin, ['run', '--dir', dir, '--title', task.title.slice(0, 60), `${task.title}\n\n${task.description || ''}`], { cwd: dir, env, signal });
      let out = ''; p.stdout.on('data', d => out = (out + d).slice(-20000)); p.stderr.on('data', d => out = (out + d).slice(-20000));
      p.on('error', reject); p.on('close', c => c === 0 ? resolve({ text: out.trim(), dir }) : reject(new Error(`opencode завершился с кодом ${c}: ${out.slice(-500)}`)));
    });
  }
  const blocked = msg => Object.assign(new Error(msg), { blocked: true });
  const draftPrompt = (a, t) => `Ты агент «${a.name}» студии ${ctx.brand || 'MOONKATTY'}. Роль: ${a.role}.\nЗадача: ${t.title}\n${t.description || ''}\nПодготовь черновик результата (на русском, если не указано иное). Не выдумывай факты, цифры и источники; если данных не хватает — перечисли, что нужно уточнить. Результат пойдёт на утверждение человеку.`;
  const HANDLERS = {
    async analytics(a, t) { const data = Object.fromEntries(core.COLLECTIONS.map(c => [c, list(c)])); const rep = core.buildReport(data, 3); rep.trigger = 'agent'; put('reports', rep);
      return { status: 'done', result: `Отчёт сформирован: задач ${rep.totals.tasks}, выполнено за 3 дня ${rep.totals.doneInPeriod}, ошибок в журнале ${rep.totals.errorsInPeriod} (id ${rep.id})` }; },
    async publishing(a, t) { const q = list('queue'); const due = q.filter(x => x.status === 'approved' && (!x.scheduledAt || new Date(x.scheduledAt) <= new Date()));
      await meta.tick(); const conn = list('workspaces').filter(w => w.connection?.status === 'connected').length;
      return { status: 'done', result: `Очередь проверена: утверждено к публикации ${due.length}, подключённых страниц ${conn}. ${conn ? 'Публикация выполняется планировщиком при включённой автопубликации.' : 'Публикация невозможна: страницы Не подключены.'}` }; },
    async community(a, t) { let n = 0; for (const c of list('comments')) if (!c.draft && !c.demo && c.status !== 'replied') {
        c.draft = /\?/.test(c.text) ? `Thanks for your question, ${c.author}! We'll share details soon — follow for updates. 🐾` : `Thank you, ${c.author}! 🐾`; c.status = 'drafted'; c.draftBy = 'community-agent:template'; put('comments', c); n++; }
      return { status: 'done', result: n ? `Черновики ответов (шаблон, без ИИ): ${n}. Отправка — только после утверждения.` : 'Новых комментариев нет (страницы Не подключены или всё обработано).' }; },
    async content(a, t, signal) { return llmTask(a, t, signal); },
    async news(a, t, signal) { const r = await llmTask(a, t, signal); r.result = '⚠ Требуется фактчек человеком. ' + r.result; return r; }
  };
  async function llmTask(a, t, signal) {
    const st = await ollamaStatus(); if (!st.ok) throw blocked(st.error + ' — задача ожидает Ollama');
    const r = await ollamaDraft(draftPrompt(a, t), signal); return { status: 'waiting_approval', result: r.text, model: r.model };
  }
  async function runTask(a, t) {
    const ac = new AbortController(); busy.set(a.id, { taskId: t.id, abort: ac });
    Object.assign(t, { status: 'in_progress', startedAt: core.now(), blockedReason: null }); put('tasks', t);
    Object.assign(a, { status: 'working', currentTaskId: t.id, lastRunAt: core.now() }); addLog(a, 'info', 'Взята задача: ' + t.title); put('agents', a);
    try {
      let r;
      if (t.kind === 'code') { if (!t.codeApproved) throw blocked('Задача для OpenCode ждёт явного подтверждения (кнопка «Разрешить OpenCode»)');
        const o = await runOpencode(t, ac.signal); r = { status: 'waiting_approval', result: `OpenCode (песочница ${o.dir}):\n${o.text}` }; }
      else r = await (HANDLERS[a.id] || llmTask)(a, t, ac.signal);
      const cur = get('tasks', t.id); if (!cur || cur.status !== 'in_progress') return; // stopped meanwhile
      Object.assign(cur, { status: r.status, result: r.result, model: r.model || null, finishedAt: core.now() }); if (r.status === 'done') cur.completedAt = core.now(); put('tasks', cur);
      const ag = get('agents', a.id); Object.assign(ag, { lastResult: String(r.result).slice(0, 300), lastError: null }); addLog(ag, 'info', `Готово (${r.status}): ${t.title}`); put('agents', ag);
    } catch (e) {
      const cur = get('tasks', t.id); const ag = get('agents', a.id);
      if (ac.signal.aborted) { addLog(ag, 'warn', 'Остановлено: ' + t.title); put('agents', ag); return; }
      if (cur) { Object.assign(cur, e.blocked ? { status: 'blocked', blockedReason: e.message } : { status: 'failed', error: e.message }); put('tasks', cur); }
      Object.assign(ag, { lastError: e.message }); addLog(ag, e.blocked ? 'warn' : 'error', (e.blocked ? 'Заблокировано: ' : 'Ошибка: ') + e.message); put('agents', ag);
    } finally {
      busy.delete(a.id); const ag = get('agents', a.id); if (ag && ag.currentTaskId === t.id) { ag.currentTaskId = null; put('agents', ag); }
    }
  }
  function tick() {
    for (const a of list('agents')) {
      if (a.status !== 'working' || busy.has(a.id) || !a.enabled) continue;
      const q = list('tasks').filter(t => t.agentId === a.id && t.status === 'queued').sort((x, y) => (ORDER[x.priority] ?? 2) - (ORDER[y.priority] ?? 2));
      if (q.length) runTask(a, q[0]).catch(e => log('error', 'runner', e.message));
      else if (a.currentTaskId) { a.currentTaskId = null; put('agents', a); }
    }
  }
  function start(id, user) { const a = get('agents', id); if (!a) throw new Error('not found'); if (!a.enabled || a.inDevelopment) throw new Error('Агент выключен или в разработке');
    Object.assign(a, { status: 'working', startedAt: core.now(), startedBy: user }); addLog(a, 'info', 'Агент запущен (фоновый исполнитель)'); put('agents', a); tick(); return get('agents', id); }
  function stop(id, user) { const a = get('agents', id); if (!a) throw new Error('not found'); const b = busy.get(id);
    if (b) { b.abort.abort(); const t = get('tasks', b.taskId); if (t && t.status === 'in_progress') { t.status = 'queued'; put('tasks', t); } }
    Object.assign(a, { status: 'idle', currentTaskId: null }); addLog(a, 'info', 'Агент остановлен' + (b ? ', задача возвращена в очередь' : '')); put('agents', a); return a; }
  // after a restart: tasks left in_progress go back to the queue (called once the port is bound — single instance)
  function recover() { for (const t of list('tasks')) if (t.status === 'in_progress' && t.startedAt) { t.status = 'queued'; put('tasks', t); }
  for (const a of list('agents')) if (a.currentTaskId) { a.currentTaskId = null; put('agents', a); } }
  return { recover, tick, start, stop, ollamaStatus, opencodePath, busy };
};
