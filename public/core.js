/* MOONKATTY AI STUDIO — shared core (browser + Node). Seed data, cron, reports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MKCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLLECTIONS = ['workspaces', 'queue', 'utm', 'comments', 'agents', 'chat', 'campaigns', 'files', 'tasks', 'projects', 'episodes', 'channels', 'posts', 'logs', 'reports', 'integrations'];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const now = () => new Date().toISOString();

  function seed() {
    const t = now();
    const A = (id, name, role, extra = {}) => Object.assign({ id, name, role, enabled: true, status: 'idle', inDevelopment: false, createdAt: t }, extra);
    return {
      agents: [
        A('director', 'Director', 'Главный агент: разбирает запросы, распределяет задачи между агентами, контролирует очередь'),
        A('news', 'NEWS', 'Сбор новостей, фактчек, сценарии выпусков MOONKATTY NEWS'),
        A('video', 'VIDEO', 'Озвучка, субтитры, монтаж видео (EN/RU/UK)'),
        A('social', 'SOCIAL', 'Подготовка публикаций для YouTube, TikTok, Instagram, X, Telegram'),
        A('pr', 'PR', 'Пресс-релизы, коллаборации, работа с блогерами'),
        A('games', 'GAMES', 'Контент и задачи по Telegram-игре @MoonKattyGameBot'),
        A('mkty', 'MKTY', 'Материалы по будущему токену $MKTY на Solana (токен ещё не запущен)'),
        A('analytics', 'ANALYTICS', 'Отчёты по задачам и журналу системы'),
        A('marketing', 'MARKETING', 'Рекламные кампании и промо (без реальных запусков)'),
        A('content', 'CONTENT', 'Content Agent: адаптирует один материал под каждую платформу (длина, хэштеги, формат)'),
        A('publishing', 'PUBLISHING', 'Publishing Agent: очередь, расписание, публикация через официальные API, повторы при ошибках'),
        A('community', 'COMMUNITY', 'Community Agent: черновики ответов на комментарии (только с утверждением)'),
        A('design3d', '3D DESIGN', '3D-модели и сцены MOONKATTY: OpenCode-агент + Blender (headless)'),
        A('ceo', 'AI CEO', 'Берёт цель владельца, планирует день, назначает задачи существующим агентам, следит за сроками и пишет внутренний отчёт. Не публикует и не тратит'),
        A('creative', 'AI Creative Director', 'Оценка материала по доказательствам. Для новостей фактчек обязателен независимо от балла'),
        A('revenue', 'AI Revenue Director', 'Считает только подтверждённые выплаты и расходы. Без данных пишет НЕТ ДАННЫХ'),
        A('growth', 'AI Game Growth', 'Игроки, удержание и покупки из импорта. Код игры не меняет')
      ],
      projects: [
        { id: 'news', name: 'MOONKATTY NEWS', description: 'Новостные выпуски на EN/RU/UK', plan: [], createdAt: t },
        { id: 'main', name: 'MOONKATTY', description: 'Основной проект: игра @MoonKattyGameBot, бренд «9 Lives. One Moon.», будущий $MKTY', plan: [], createdAt: t }
      ],
      channels: [
        { id: 'yt-news', name: 'YouTube NEWS', platform: 'YouTube', handle: '', project: 'news', connected: false },
        { id: 'yt-main', name: 'YouTube main', platform: 'YouTube', handle: '@moonkattymky', project: 'main', connected: false },
        { id: 'tiktok', name: 'TikTok', platform: 'TikTok', handle: '@moonkattymky', project: 'main', connected: false },
        { id: 'x', name: 'X', platform: 'X', handle: '@moonkattymky', project: 'main', connected: false },
        { id: 'telegram', name: 'Telegram', platform: 'Telegram', handle: 't.me/moonkattymkty', project: 'main', connected: false },
        { id: 'fb-news', name: 'Facebook NEWS', platform: 'Facebook', handle: '', project: 'news', connected: false, workspace: 'news-fb' },
        { id: 'ig-news', name: 'Instagram NEWS', platform: 'Instagram', handle: '', project: 'news', connected: false, workspace: 'news-ig' },
        { id: 'fb-main', name: 'Facebook MOONKATTY', platform: 'Facebook', handle: '', project: 'main', connected: false, workspace: 'mk-fb' },
        { id: 'ig-main', name: 'Instagram MOONKATTY', platform: 'Instagram', handle: '', project: 'main', connected: false, workspace: 'mk-ig' }
      ],
      integrations: [
        { id: 'ollama', name: 'Ollama', url: 'http://localhost:11434', testPath: '/api/tags', note: 'Модель: qwen3:8b', lastTest: null },
        { id: 'opencode', name: 'OpenCode', url: 'http://127.0.0.1:4096', testPath: '/global/health', username: 'opencode', note: 'opencode serve', lastTest: null },
        { id: 'docker', name: 'Docker', url: 'http://localhost:2375', testPath: '/_ping', note: 'Docker Engine API (TCP должен быть явно включён)', lastTest: null },
        { id: 'openwebui', name: 'Open WebUI', url: 'http://localhost:3000', testPath: '/health', note: '', lastTest: null }
      ],
      workspaces: (typeof MKSocial !== 'undefined' ? MKSocial : require('./social.js')).seedWorkspaces(), queue: [], utm: [], comments: [], chat: [], campaigns: [], files: [], tasks: [], episodes: [], posts: [], logs: [], reports: []
    };
  }

  // --- cron (5 fields: m h dom mon dow) ---
  function fieldMatch(expr, val, min) {
    return expr.split(',').some(part => {
      let [range, step] = part.split('/'); step = step ? +step : 1;
      let lo, hi;
      if (range === '*') { lo = min; hi = 1e9; }
      else if (range.includes('-')) [lo, hi] = range.split('-').map(Number);
      else { lo = +range; hi = step > 1 ? 1e9 : lo; }
      return val >= lo && val <= hi && (val - lo) % step === 0;
    });
  }
  function validCron(expr) {
    const f = String(expr || '').trim().split(/\s+/);
    return f.length === 5 && f.every(x => /^(\*|\d+(-\d+)?)(\/\d+)?(,(\*|\d+(-\d+)?)(\/\d+)?)*$/.test(x));
  }
  function cronMatch(expr, d) {
    const [m, h, dom, mon, dow] = expr.trim().split(/\s+/);
    return fieldMatch(m, d.getMinutes(), 0) && fieldMatch(h, d.getHours(), 0) && fieldMatch(dom, d.getDate(), 1) &&
      fieldMatch(mon, d.getMonth() + 1, 1) && fieldMatch(dow, d.getDay(), 0);
  }
  function nextRun(schedule, from) {
    if (!schedule || schedule.type === 'none') return null;
    const base = new Date(from || Date.now());
    if (schedule.type === 'every_days') {
      const n = Math.max(1, +schedule.days || 1);
      return new Date(base.getTime() + n * 86400000).toISOString();
    }
    if (schedule.type === 'cron' && validCron(schedule.cron)) {
      const d = new Date(base); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
      for (let i = 0; i < 60 * 24 * 366; i++) { if (cronMatch(schedule.cron, d)) return d.toISOString(); d.setMinutes(d.getMinutes() + 1); }
    }
    return null;
  }

  // Scheduler tick: returns list of {task, changes} plus log entries. Pure function.
  function schedulerTick(tasks, at) {
    const t = at || new Date(); const out = [];
    for (const task of tasks) {
      const s = task.schedule;
      if (!s || s.type === 'none') continue;
      if (!task.nextRunAt) { out.push({ id: task.id, changes: { nextRunAt: nextRun(s, t) } }); continue; }
      if (new Date(task.nextRunAt) <= t) {
        out.push({ id: task.id, changes: { status: 'queued', lastRunAt: t.toISOString(), nextRunAt: nextRun(s, t), runs: (task.runs || 0) + 1 },
          log: { level: 'info', source: 'scheduler', message: `Задача «${task.title}» поставлена в очередь по расписанию` } });
      }
    }
    return out;
  }

  // Report from real data only.
  function buildReport(data, periodDays = 3, at) {
    const end = at ? new Date(at) : new Date(); const start = new Date(end.getTime() - periodDays * 86400000);
    const inP = x => x && new Date(x) >= start && new Date(x) <= end;
    const tasks = data.tasks || [], logs = data.logs || [];
    const by = (arr, k) => arr.reduce((a, x) => (a[x[k] || '—'] = (a[x[k] || '—'] || 0) + 1, a), {});
    const created = tasks.filter(x => inP(x.createdAt));
    const done = tasks.filter(x => x.status === 'done' && inP(x.completedAt));
    const failed = tasks.filter(x => x.status === 'failed' && inP(x.updatedAt));
    const plogs = logs.filter(x => inP(x.at));
    const errors = plogs.filter(x => x.level === 'error');
    const agentName = id => ((data.agents || []).find(a => a.id === id) || {}).name || id || 'не назначен';
    const perAgent = {};
    for (const x of tasks) { const n = agentName(x.agentId); perAgent[n] = perAgent[n] || { total: 0, done: 0, open: 0 }; perAgent[n].total++; x.status === 'done' ? perAgent[n].done++ : perAgent[n].open++; }
    const eps = data.episodes || [];
    return {
      id: uid(), createdAt: end.toISOString(), periodStart: start.toISOString(), periodEnd: end.toISOString(), periodDays,
      empty: tasks.length === 0 && plogs.length === 0 && eps.length === 0,
      totals: { tasks: tasks.length, createdInPeriod: created.length, doneInPeriod: done.length, failedInPeriod: failed.length,
        open: tasks.filter(x => !['done', 'cancelled'].includes(x.status)).length, logsInPeriod: plogs.length, errorsInPeriod: errors.length,
        episodes: eps.length, postsPendingApproval: (data.posts || []).filter(p => p.status === 'pending').length },
      tasksByStatus: by(tasks, 'status'), tasksByPriority: by(tasks, 'priority'), perAgent,
      errors: errors.slice(-20).map(e => ({ at: e.at, source: e.source, message: e.message }))
    };
  }

  const PIPELINE = [
    ['search', 'Поиск новостей', 'news'], ['factcheck', 'Проверка фактов', 'news'], ['script', 'Сценарий', 'news'], ['translate', 'Перевод', 'news'],
    ['voice', 'Озвучка', 'video'], ['visuals', 'Видеоряд', 'video'], ['edit', 'Монтаж', 'video'], ['review', 'Проверка', 'director'], ['publish', 'Публикация', 'social']
  ];
  const LANGS = ['EN', 'RU', 'UK'];

  // Transparent rule-based planner (used when no LLM is connected). Returns {summary, tasks:[{title,agentId,priority,description}]}
  function rulePlan(text) {
    const t = String(text || '').toLowerCase(); const tasks = [];
    const langs = []; if (/англ|english|\ben\b|трёх|трех|3 язык|три язык/.test(t)) langs.push('EN');
    if (/рус|russian|\bru\b|трёх|трех|3 язык|три язык/.test(t)) langs.push('RU'); if (/укр|ukrain|\buk\b|трёх|трех|3 язык|три язык/.test(t)) langs.push('UK');
    if (!langs.length) langs.push('EN');
    const mins = (t.match(/(\d+)\s*(мин|min)/) || [])[1];
    const L = langs.join('/'), dur = mins ? ` (${mins} мин)` : '';
    const add = (agentId, title, priority = 'normal', kind) => tasks.push(Object.assign({ agentId, title, priority, description: `Из запроса: «${text}»` }, kind ? { kind } : {}));
    let matched = false;
    if (/новост|news|выпуск/.test(t)) { matched = true;
      add('news', 'Поиск новостей для выпуска' + dur, 'high'); add('news', 'Проверка фактов', 'high'); add('news', 'Сценарий выпуска' + dur + ' — ' + L, 'high');
      if (langs.length > 1) add('news', 'Перевод сценария: ' + L);
      add('video', 'Озвучка ' + L); add('video', 'Видеоряд и монтаж' + dur); add('director', 'Проверка выпуска перед публикацией'); add('social', 'Подготовить публикацию выпуска (на утверждение)'); }
    if (/видео|ролик|shorts|tiktok|рилс|reels/.test(t) && !/новост/.test(t)) { matched = true; add('video', 'Сценарий и монтаж ролика' + dur); add('social', 'Пост с роликом (на утверждение)'); }
    if (/пост|соцсет|social|telegram|твит|\bx\b/.test(t) && !/новост/.test(t)) { matched = true; add('social', 'Подготовить посты для соцсетей (на утверждение)'); }
    if (/pr|пиар|пресс|блогер|реклам|маркет/.test(t)) { matched = true; add('pr', 'PR/маркетинг: ' + text.slice(0, 80)); }
    if (/игр|game|бот|@moonkattygamebot/.test(t)) { matched = true; add('games', 'Задача по игре: ' + text.slice(0, 80)); }
    if (/mkty|токен|token|solana/.test(t)) { matched = true; add('mkty', 'Материал по $MKTY (токен ещё не запущен): ' + text.slice(0, 60)); }
    if (/отчёт|отчет|аналит|report|статист/.test(t)) { matched = true; add('analytics', 'Сформировать отчёт'); }
    if (/3d|3д|blender|блендер|3-?d/.test(t)) { matched = true; add('design3d', '3D: ' + text.slice(0, 80), 'normal', '3d'); }
    if (!matched) add('director', 'Разобрать запрос: ' + text.slice(0, 100));
    return { planner: 'rules', summary: `Правиловой планировщик (без ИИ): создано задач — ${tasks.length}.`, tasks };
  }
  function newEpisode(fields) {
    const versions = {};
    for (const L of LANGS) { versions[L] = {}; for (const [k] of PIPELINE) versions[L][k] = 'todo'; }
    return Object.assign({ id: uid(), title: '', durationMin: 15, media: {}, project: 'news', sources: [], notes: '', versions, createdAt: now() }, fields);
  }

  // Insert seed items that are missing (for upgrades of existing databases).
  function missingSeed(data) { const s = seed(), out = {}; for (const c of ['agents', 'channels', 'workspaces', 'integrations']) { const ids = new Set((data[c] || []).map(x => x.id)); out[c] = s[c].filter(x => !ids.has(x.id)); } return out; }
  return { missingSeed, rulePlan, COLLECTIONS, uid, now, seed, validCron, cronMatch, nextRun, schedulerTick, buildReport, PIPELINE, LANGS, newEpisode };
});
