// World Class inside the existing server: mission, CEO, QC, revenue, growth, permissions.
// Does not call the social publisher, Meta, or any platform API.
'use strict';
const mission = require('./mission');
const schema = require('./schema');
const perms = require('./permissions');
const qcMod = require('./qc');
const revenue = require('./revenue');
const growth = require('./growth');
const ceo = require('./ceo');
const memoryAdapter = require('./memory-adapter');
const platformRead = require('./platform-read');
const audience = require('./audience');
const ND = 'НЕТ ДАННЫХ';

module.exports = function createWorld(ctx) {
  const { db, q, get, put, list, log, core, runner, CFG, sec } = ctx;
  let deps = { ...(ctx.approvalDeps || {}) }; // injected by lib/world/wiring.js: { checkPassword, executors }
  schema.migrate(db);
  const P = perms.createPermissions({ db, core, sec });
  const ledgerIns = db.prepare('INSERT INTO world_ledger (id, at, booked_on, stream, platform, kind, amount_cents, currency, payout_id, payout_confirmed, state, confirmation_source, demo, source, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const ledgerAll = db.prepare('SELECT * FROM world_ledger ORDER BY booked_on, rowid');
  const ledgerByPayout = db.prepare('SELECT * FROM world_ledger WHERE platform = ? AND payout_id = ?');
  const mem = memoryAdapter.openMemory({ db, log, now: () => core.now() });
  const readApi = platformRead.openPlatformRead();
  const apprAll = db.prepare('SELECT * FROM world_approvals ORDER BY at DESC, rowid DESC LIMIT 100');
  const apprGet = db.prepare('SELECT * FROM world_approvals WHERE id = ?');
  const apprSet = db.prepare('UPDATE world_approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?');
  let loaded = null;

  function meta(k, v) { if (v === undefined) { const r = q.meta.get(k); return r ? JSON.parse(r.v) : null; } q.setMeta.run(k, JSON.stringify(v)); return v; }
  function attach(m) {
    const snap = m ? mission.snapshot(m, core.now()) : null;
    for (const a of list('agents')) { a.mission = snap; a.missionError = m ? null : 'mission_missing'; put('agents', a); }
    if (snap) meta('worldMission', snap);
    return snap;
  }
  function limits() { const d = loaded && loaded.data || {}; return { pass: d.qc_pass_score || 70, maxRegenerations: d.qc_max_regenerations || 3, goals: d.monthly_goals_usd || [1000, 5000, 10000, 20000] }; }
  function rows() { return ledgerAll.all(); }
  function savings() { return meta('worldSavings') || { item: (loaded && loaded.data.savings_item) || 'Mac Studio', target_usd: null }; }
  function players() { const g = meta('worldGrowth'); const n = g && g.metrics && g.metrics.new_players; return typeof n === 'number' ? n : null; }
  function finance() { return revenue.report(rows(), { goals: limits().goals, savings: savings(), newPlayers: players() }); }
  function principal(user) { const id = String(user || 'owner').slice(0, 64); return { id, role: 'owner', user: id }; }
  function rememberMission(m) {
    if (!m) return;
    try { memoryAdapter.putRecord(mem, { principal: principal('owner'), versionPolicy: 'bump', record: { namespace: 'moonkatty_shared', kind: 'mission', title: String(m.title).slice(0, 300), body: String(m.version), status: 'approved', sourcePath: 'config/mission.yaml', sourceRecordId: 'world-class', idempotencyKey: 'world-class:mission', payload: { sha256: m.sha256, version: m.version, recordKind: 'mission' } } }); }
    catch (e) { log('error', 'mission', 'Память: ' + e.message); }
  }
  function rememberTask(t, user) {
    const projectId = t.agentId === 'news' || t.project === 'news' ? 'moonkatty_news:episodes' : (t.agentId === 'growth' || t.agentId === 'games' ? 'moonkatty_project:games' : 'moonkatty_shared');
    const resolved = mem.resolveProject(projectId);
    try { memoryAdapter.putRecord(mem, { principal: principal(user), versionPolicy: 'replay', record: { namespace: resolved.namespace || 'moonkatty_shared', kind: 'task', title: String(t.title || 'task').slice(0, 300), body: String(t.description || '').slice(0, 4000), status: 'draft', sourcePath: null, sourceRecordId: String(t.id).slice(0, 64), idempotencyKey: ('world-class:task:' + t.id).slice(0, 400), payload: { projectId, agentId: t.agentId, dueAt: t.dueAt || null, recordKind: 'task' } } }); }
    catch (e) { log('error', 'ceo', 'Память задачи: ' + e.message); }
  }
  function rememberAudience() {
    const d = loaded && loaded.data; if (!d || !Array.isArray(d.audience_channels)) return;
    try { memoryAdapter.putRecord(mem, { principal: principal('owner'), versionPolicy: 'bump', record: { namespace: 'moonkatty_shared', kind: 'goal', title: 'Million Audience', body: String(d.audience_goal_subscribers), status: 'approved', sourcePath: 'config/mission.yaml', sourceRecordId: 'audience', idempotencyKey: 'world-class:audience', payload: { recordKind: 'goal', goal: d.audience_goal_subscribers, channels: d.audience_channels, mergeYoutube: false } } }); }
    catch (e) { log('error', 'audience', e.message); }
  }
  function confirmedFor(id) {
    const hit = rows().filter(r => revenue.isCash(r) && r.platform === id && (r.currency || 'USD') === 'USD');
    if (!hit.length) return null; return hit.reduce((s, r) => s + r.amount_cents, 0);
  }
  function audienceNow() {
    const d = loaded && loaded.data || {};
    return audience.report({ api: readApi.api, channels: d.audience_channels || [], goal: d.audience_goal_subscribers || 1000000, milestonesList: d.audience_milestones, demoDefault: readApi.path === 'fixture-demo', history: meta('worldAudienceReal') || [], now: new Date(), experiments: meta('worldExperiments') || [], confirmedFor });
  }
  function boot() {
    try { loaded = mission.load(); attach(loaded); rememberMission(loaded); rememberAudience(); log('info', 'mission', `Миссия ${loaded.id} ${loaded.version} загружена (${mem.path})`); }
    catch (e) { loaded = null; attach(null); log('error', 'mission', e.message); }
    const done = (title, text) => ({ status: 'done', result: text });
    const view = () => platformRead.summarize(readApi);
    runner.register('ceo', (a, t) => { const g = P.gate('internal_reports', { actor: a.id, confirm: true, detail: t.title }); if (g.decision !== 'allow') return { status: 'blocked', result: g.decision }; const r = ceo.review(list('tasks'), new Date()); const p = view(); return done(t.title, `Незавершено ${r.unfinished}, просрочено ${r.overdue.length}. Площадок в чтении: ${p.platforms.length}. ${r.note}`); });
    runner.register('revenue', () => done('revenue', textMoney()));
    runner.register('growth', () => done('growth', JSON.stringify(growth.present(meta('worldGrowth')))));
    runner.register('marketing', () => { const p = view(); const a = audienceNow(); return done('marketing', `Только чтение (${p.source}). Каналов аудитории ${a.channels.length}. YouTube не складывается. Публикации нет.`); });
    runner.register('creative', (a, t) => { const s = qcMod.score(t.qc || {}, limits()); return { status: s.verdict === 'pass' ? 'done' : 'waiting_approval', result: JSON.stringify(s) }; });
  }
  function textMoney() { const r = finance(); const est = r.estimates && r.estimates.month; const acc = r.accrued && r.accrued.month; return `Выручка месяца (кэш): ${r.month === ND ? ND : r.month.label}. Начислено: ${acc === ND ? ND : acc.label}. Не подтверждено: ${est === ND ? ND : est.label}. Просмотры не входят.`; }
  function onAgentStart(a) {
    try { loaded = mission.load(); a.mission = mission.snapshot(loaded, core.now()); a.missionError = null; meta('worldMission', a.mission); rememberMission(loaded); }
    catch (e) { a.mission = null; a.missionError = e.code || e.message; }
  }
  function recover() { try { loaded = mission.load(); attach(loaded); rememberMission(loaded); rememberAudience(); } catch (e) { loaded = null; log('error', 'mission', 'Перезапуск: ' + e.message); } }
  function commandCenter() {
    const rep = finance();
    const news = list('episodes').length;
    const newsTasks = list('tasks').filter(t => t.agentId === 'news' && !['done', 'cancelled'].includes(t.status)).length;
    const reading = platformRead.summarize(readApi);
    let missionMemory = [], goalMemory = [];
    try { missionMemory = memoryAdapter.listRecords(mem, { principal: principal('owner'), namespace: 'moonkatty_shared', kind: 'mission', limit: 5 }); } catch (e) { missionMemory = []; }
    try { goalMemory = memoryAdapter.listRecords(mem, { principal: principal('owner'), namespace: 'moonkatty_shared', kind: 'goal', limit: 5 }); } catch (e) { goalMemory = []; }
    return {
      mission: meta('worldMission'),
      revenue: rep, recommendations: rep.recommendations,
      approvals: apprAll.all().filter(a => a.status === 'pending'),
      savings: rep.savings,
      growth: growth.present(meta('worldGrowth')),
      platforms: revenue.platformsFrom(rows(), list('channels')),
      readPlatforms: reading.platforms,
      readApi: { source: reading.source, version: reading.version || null, demo: !!reading.demo, publish: false, viewsAreRevenue: false },
      memory: { path: mem.path, mission: missionMemory.map(x => ({ id: x.id, kind: x.kind, version: x.version })), audience: goalMemory.map(x => ({ id: x.id, kind: x.kind, version: x.version, goal: x.payload && x.payload.goal })) },
      audience: audienceNow(),
      directors: { ceo: { readOnly: true, publishes: false, audience: true }, marketing: { readOnly: true, publishes: false, source: reading.source, audience: true }, creative: { readOnly: true, publishes: false, audience: true }, revenue: { readOnly: true, publishes: false, states: ['confirmed', 'accrued', 'estimate'], audience: true } },
      news: { separate: true, episodes: news, openTasks: newsTasks, note: news ? 'Выпуски студии, без новой новостной системы' : ND },
      publishing: { touched: false, testDisabled: !!CFG.IS_TEST },
      ceo: Object.assign(ceo.review(list('tasks'), new Date()), { goal: (meta('worldCeo') || {}).goal || null, summary: (meta('worldCeo') || {}).summary || null }),
      viewsAreRevenue: false
    };
  }
  function mount(app) {
    const wrap = fn => (req, res) => { try { if (!loaded) return res.status(503).json({ error: 'Миссия не загружена', code: 'mission_missing' }); fn(req, res); } catch (e) { log('error', 'world', sec.redact(e.message)); res.status(e.status || 500).json({ error: sec.redact(e.message || 'Ошибка'), code: e.code }); } };
    app.get('/api/world/mission', wrap((req, res) => res.json(meta('worldMission'))));
    app.get('/api/world/command-center', wrap((req, res) => res.json(commandCenter())));
    app.get('/api/world/journal', wrap((req, res) => { P.gate('analysis', { actor: req.user, confirm: true, detail: 'journal' }); res.json(P.list(100)); }));
    app.get('/api/world/approvals', wrap((req, res) => res.json(apprAll.all())));
    app.post('/api/world/experiments', wrap((req, res) => {
      const g = P.gate('drafts', { actor: req.user, confirm: true, detail: 'experiment' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const real = audienceNow().channels.some(c => c.dataMode === 'real');
      const plan = audience.planExperiment(req.body || {}, real);
      if (plan.error) { const e = new Error(plan.error); e.status = plan.code === 'forbidden' ? 403 : 400; e.code = plan.code; throw e; }
      const all = meta('worldExperiments') || []; all.unshift(Object.assign({ id: core.uid(), at: core.now() }, plan)); meta('worldExperiments', all.slice(0, 30));
      res.status(201).json(all[0]);
    }));
    app.post('/api/world/goals', wrap((req, res) => {
      const g = P.gate('analysis', { actor: req.user, confirm: true, detail: 'goals' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const text = String(req.body?.text || '').slice(0, 2000); meta('worldCeo', Object.assign(meta('worldCeo') || {}, { goal: text, at: core.now() }));
      log('info', 'ceo', 'Цель владельца записана', req.user); res.json({ ok: true, goal: text });
    }));
    app.post('/api/world/plan', wrap((req, res) => {
      const g = P.gate('analysis', { actor: req.user, confirm: true, detail: 'daily plan' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const goal = String((req.body && req.body.goal) || (meta('worldCeo') || {}).goal || '');
      const built = ceo.build({ goal, now: new Date(), tasks: list('tasks') });
      const created = [];
      if (!built.already) {
        const extra = core.rulePlan(goal).tasks.map(t => Object.assign({}, t, { priority: t.priority || 'normal', status: 'queued', schedule: { type: 'none' }, source: 'ceo', worldDay: built.day, dueAt: built.day + 'T23:59:59.000Z', kind: 'world', project: /новост|news/i.test(goal) ? 'news' : 'main', description: t.description || goal }));
        for (const t of built.tasks.concat(extra)) { const saved = put('tasks', Object.assign({ id: core.uid(), createdAt: core.now() }, t)); created.push(saved); rememberTask(saved, req.user); }
      }
      meta('worldCeo', Object.assign(meta('worldCeo') || {}, { goal, day: built.day, summary: built.summary, at: core.now() }));
      log('info', 'ceo', built.already ? 'План на сегодня уже есть' : 'План дня: задач ' + created.length, req.user);
      res.json({ ok: true, already: !!built.already, summary: built.summary, tasks: created, open: built.open || [] });
    }));
    app.post('/api/world/qc', wrap((req, res) => {
      const g = P.gate('qc', { actor: req.user, confirm: true, detail: 'qc' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const s = qcMod.score(req.body || {}, limits());
      if (s.next === 'rework') put('tasks', { id: core.uid(), title: 'Доработка после QC (' + s.total + '/100)', description: s.findings.concat(s.checks.weak).join('; ').slice(0, 1000), agentId: req.body?.kind === 'news' ? 'news' : 'creative', priority: 'high', status: 'queued', project: req.body?.kind === 'news' ? 'news' : 'main', schedule: { type: 'none' }, source: 'qc', createdAt: core.now(), qc: Object.assign({}, req.body, { regeneration: s.regeneration + 1 }) });
      log('info', 'qc', `QC ${s.total}/100 ${s.verdict}`, req.user); res.json(s);
    }));
    app.post('/api/world/import', wrap((req, res) => {
      if (req.body && (req.body.fabricated === true || req.body.kind === 'views')) { P.gate('fake_financials', { actor: req.user, detail: 'import rejected' }); return res.status(403).json({ error: 'Просмотры и выдуманные суммы запрещены', code: 'fake_financials' }); }
      const g = P.gate('analysis', { actor: req.user, confirm: true, detail: 'ledger import' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const parsed = revenue.parseImport(req.body || {}); if (parsed.error) { if (parsed.code === 'fake_financials') P.gate('fake_financials', { actor: req.user, detail: 'import rejected' }); const e = new Error(parsed.error); e.status = parsed.code === 'fake_financials' ? 403 : 400; e.code = parsed.code; throw e; }
      const known = new Set(list('channels').map(c => c.id));
      for (const r of parsed.rows) if (r.platform && !known.has(r.platform)) { const e = new Error('Площадки нет в данных студии: ' + r.platform); e.status = 400; throw e; }
      let imported = 0, duplicates = 0;
      for (const r of parsed.rows) {
        if (r.payout_id) { const prev = ledgerByPayout.get(r.platform, r.payout_id); if (prev) { if (!revenue.samePayout(prev, r)) { const e = new Error('Выплата с этим payout_id уже есть и отличается'); e.status = 409; e.code = 'duplicate_payout'; throw e; } duplicates++; continue; } }
        ledgerIns.run(core.uid(), core.now(), r.booked_on, r.stream, r.platform, r.kind, r.amount_cents, r.currency, r.payout_id, r.payout_confirmed, r.state, r.confirmation_source, r.demo, r.source, sec.redact(r.note)); imported++;
      }
      log('info', 'revenue', 'Импорт записей: ' + imported + ', повторов: ' + duplicates, req.user); res.status(201).json({ ok: true, imported, duplicates });
    }));
    app.post('/api/world/growth/import', wrap((req, res) => {
      const g = P.gate('analysis', { actor: req.user, confirm: true, detail: 'growth import' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const n = growth.normalize(req.body || {}); if (n.error) { const e = new Error(n.error); e.status = 400; throw e; }
      const prev = meta('worldGrowth') || { history: [] }; const entry = { metrics: n.metrics, demo: n.demo, source: 'import', at: core.now() };
      meta('worldGrowth', { metrics: entry.metrics, demo: entry.demo, source: entry.source, at: entry.at, history: [entry, ...(prev.history || [])].slice(0, 30) });
      log('info', 'growth', 'Импорт метрик игры' + (n.demo ? ' (DEMO)' : ''), req.user); res.status(201).json(growth.present(meta('worldGrowth')));
    }));
    app.post('/api/world/proposal', wrap((req, res) => {
      const g = P.gate('drafts', { actor: req.user, confirm: true, detail: 'proposal' }); if (g.decision !== 'allow') return res.status(403).json(g);
      const rep = finance();
      const text = 'Черновик коммерческого предложения. Не отправлено.\nФакт выручки месяца: ' + (rep.month === ND ? ND : rep.month.label) + '.\n' + (rep.recommendations[0] || ND);
      const all = meta('worldProposals') || []; all.unshift({ id: core.uid(), at: core.now(), status: 'draft', text }); meta('worldProposals', all.slice(0, 20));
      res.status(201).json(all[0]);
    }));
    app.post('/api/world/action', wrap((req, res) => act(req, res, String(req.body?.action || ''), req.body?.approvalId, req.body?.detail)));
    app.post('/api/world/approvals/:id', wrap((req, res) => {
      // Check order (accurate errors): existence -> decided/consumed -> expired -> self -> channel -> lockout -> password.
      const row = apprGet.get(req.params.id); if (!row) return res.status(404).json({ error: 'not found', code: 'not_found' });
      if (row.consumed_at) return res.status(409).json({ error: 'подтверждение уже использовано', code: 'consumed' });
      if (row.status === 'expired' || (row.status === 'pending' && P.expired(row))) { if (row.status === 'pending') apprSet.run('expired', req.user, core.now(), row.id); return res.status(409).json({ error: 'срок подтверждения истёк', code: 'expired' }); }
      if (row.status !== 'pending') return res.status(409).json({ error: 'уже решено', code: 'already_decided', status: row.status });
      let stepup = false;
      if (req.body?.decision === 'approve') {
        const deny = (code, msg, why, st = 403) => { P.write({ actor: req.user, action: row.action, tier: row.tier, decision: 'deny', detail: 'approve: ' + why }); return res.status(st).json({ error: msg, code }); };
        if (typeof deps.checkPassword !== 'function' || typeof deps.sessionUser !== 'function') return res.status(503).json({ error: 'Approval Center не подключён (lib/world/wiring.js)', code: 'not_wired', status: 'not_wired' });
        const me = reqPrincipal(req);
        if (!row.requested_by) return deny('self_approval', 'Запрос без автора нельзя подтвердить', 'no requester');
        if (row.requested_by === me) { // owner self-approval: only own verified-session request, <=15 min old (kill switch: stepUpAllowed())
          const fresh = Date.parse(core.now()) - Date.parse(row.at) <= STEPUP_MS;
          if (!stepUpAllowed() || !me.endsWith('@session') || !fresh) return deny('self_approval', 'Нельзя подтвердить собственный запрос', 'self-approval' + (stepUpAllowed() && !fresh ? ' (step-up window passed)' : ''));
          stepup = true;
        } else if (String(row.requested_by).split('@')[0] === req.user && !String(row.requested_by).endsWith('@app')) return deny('self_approval', 'Нельзя подтвердить собственный запрос', 'self-approval (same user)');
        if (reqChannel(req) !== 'session') return deny('owner_session_required', 'Подтверждение только из проверенной сессии владельца (не app token)', 'channel ' + reqChannel(req));
        const blk = pwBlock(req);
        if (blk) { res.setHeader('Retry-After', String(Math.ceil(blk.retryAfterMs / 1000))); return deny(blk.code, blk.code === 'locked' ? 'Слишком много неверных паролей, вход временно заблокирован' : 'Подождите перед следующей попыткой', blk.code, 429); }
        if (!req.body?.password) return deny('owner_reauth', 'Нужен пароль владельца', 'owner re-auth missing'); // no guess made: not counted
        if (!deps.checkPassword(req.user, String(req.body?.password || ''))) { pwFail(req); return deny('owner_reauth', 'Неверный пароль владельца', 'owner re-auth failed'); }
        pwOk(req);
      }
      if (req.body?.decision === 'reject') { apprSet.run('rejected', req.user, core.now(), row.id); P.write({ actor: req.user, action: row.action, tier: row.tier, decision: 'reject', detail: row.detail }); return res.json({ ok: true, status: 'rejected' }); }
      if (req.body?.decision !== 'approve') return res.status(400).json({ error: 'decision: approve или reject' });
      apprSet.run('approved', req.user, core.now(), row.id);
      P.write({ actor: req.user, action: row.action, tier: 'owner', decision: stepup ? 'owner_self_approval' : 'allow', detail: (stepup ? 'owner self-approved (session+fresh password) ' : 'owner approved ') + row.action + ' ' + row.id });
      execApproval(row, reqPrincipal(req)).then(r => r.code === 'payload_mismatch' ? res.status(409).json({ ok: false, status: 'invalidated', error: 'payload не совпадает с подтверждённым', ...r }) : res.json({ ok: true, status: 'approved', ...r }), e => res.status(500).json({ ok: false, status: 'approved', execStatus: 'failed', executed: false, error: e.message }));
    }));
    app.get('/api/world/approvals/:id', wrap((req, res) => { const row = apprGet.get(req.params.id); if (!row) return res.status(404).json({ error: 'not found' }); res.json(apprView(row)); }));
    app.post('/api/world/savings', wrap((req, res) => {
      const target = req.body?.target_usd;
      if (target != null && (typeof target !== 'number' || !Number.isFinite(target) || target < 0)) return res.status(400).json({ error: 'target_usd' });
      const params = { kind: 'savings', target_usd: target == null ? null : target };
      const who = reqPrincipal(req);
      const g = P.gate('critical_settings', { actor: who, approvalId: req.body?.approvalId, params, detail: 'savings ' + target });
      if (g.reason === 'consumed' || g.reason === 'expired') return res.status(409).json({ error: g.reason === 'consumed' ? 'подтверждение уже использовано' : 'срок подтверждения истёк', code: g.reason });
      if (g.decision === 'needs_owner') { const id = P.request({ action: 'critical_settings', detail: 'savings target ' + target, params, actor: who }); return res.status(403).json({ error: 'Нужно подтверждение владельца', code: 'needs_owner', approvalId: id, reason: g.reason }); }
      if (g.decision !== 'allow') return res.status(403).json({ error: 'Запрещено', code: g.decision });
      if (g.approvalId && !P.consume(g.approvalId)) return res.status(409).json({ error: 'подтверждение уже использовано', code: 'consumed' });
      meta('worldSavings', { item: 'Mac Studio', target_usd: target == null ? null : target }); res.json(meta('worldSavings'));
    }));
  }
  function act(req, res, action, approvalId, detail) {
    const params = { detail: detail == null ? null : String(detail) };
    const who = reqPrincipal(req);
    const g = P.gate(action, { actor: who, approvalId, params, detail: String(detail || action) });
    if (g.reason === 'consumed' || g.reason === 'expired') return res.status(409).json({ error: g.reason === 'consumed' ? 'подтверждение уже использовано' : 'срок подтверждения истёк', code: g.reason });
    if (g.decision === 'needs_owner') { const id = P.request({ action, tier: g.tier, detail: String(detail || ''), params, actor: who }); return res.status(403).json({ error: 'Нужно подтверждение владельца', code: 'needs_owner', approvalId: id, tier: g.tier, reason: g.reason }); }
    if (g.decision === 'deny') return res.status(403).json({ error: 'Запрещено', code: 'forbidden', tier: g.tier });
    if (g.approvalId && !P.consume(g.approvalId)) return res.status(409).json({ error: 'подтверждение уже использовано', code: 'consumed' });
    if (['paid_ads', 'spending', 'editorial_publication', 'mass_mailing', 'outreach_new_clients', 'contracts', 'payment_settings'].includes(action))
      return res.json({ ok: true, executed: false, note: 'Подтверждение записано. Внешний вызов не выполняется.' });
    res.json({ ok: true, executed: true, tier: g.tier });
  }
  // Approval Center (step 2c): approval executes the queued action through injected executors (lib/world/wiring.js).
  // No executor -> exec_status 'not_wired' (id stays approved and unconsumed); never a fake success.
  const apprExec = db.prepare('UPDATE world_approvals SET exec_status = ?, exec_result = ?, exec_at = ? WHERE id = ?');
  function apprView(r) { return { id: r.id, action: r.action, status: r.status, requestedBy: r.requested_by, decidedBy: r.decided_by, decidedAt: r.decided_at, expiresAt: r.expires_at, consumed: !!r.consumed_at, consumedAt: r.consumed_at, execStatus: r.exec_status || null, execResult: r.exec_result ? JSON.parse(r.exec_result) : null, execAt: r.exec_at || null }; }
  async function execApproval(row, actor) {
    let payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch {}
    const fn = deps.executors && deps.executors[row.action];
    const fin = (st, result, executed) => { apprExec.run(st, JSON.stringify(result || null).slice(0, 4000), core.now(), row.id); P.write({ actor, action: row.action, tier: 'owner', decision: st, detail: 'approval ' + row.id + ': ' + st });
      log(st === 'failed' ? 'warn' : 'info', 'approval', `Подтверждение ${row.action}: ${st}`, actor); return { executed, execStatus: st, result: result || null, approval: apprView(apprGet.get(row.id)) }; };
    if (!row.params_hash || P.paramsHash(payload) !== row.params_hash) { // F1: tampered payload burns the id (consumed + invalidated), so nothing can use it later
      P.consume(row.id); apprSet.run('invalidated', row.decided_by || actor, core.now(), row.id);
      return { ...fin('invalidated', { error: 'payload не совпадает с хэшем, сохранённым при запросе', code: 'payload_mismatch' }, false), code: 'payload_mismatch' }; }
    if (typeof fn !== 'function') return fin('not_wired', { note: 'Исполнитель не подключён (lib/world/wiring.js). Действие не выполнялось.' }, false);
    if (!P.consume(row.id)) return fin('failed', { error: 'approval already used' }, false);
    try { const r = await fn(payload, { approvalId: row.id, actor, requestedBy: row.requested_by }) || {};
      const executed = r.executed === true; return fin(executed ? 'executed' : (r.status || 'not_executed'), r, executed); }
    catch (e) { return fin('failed', { error: e.message }, false); }
  }
  function applySavings(p) { if (!p || p.kind !== 'savings' || (p.target_usd != null && (typeof p.target_usd !== 'number' || p.target_usd < 0))) throw new Error('payload savings неверен'); return meta('worldSavings', { item: 'Mac Studio', target_usd: p.target_usd == null ? null : p.target_usd }); }
  function exportLedger() { return rows(); }
  function replaceLedger(list) {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    for (const r of list) if (r && r.payout_id) { const k = r.platform + '\0' + r.payout_id; if (seen.has(k)) { const e = new Error('В копии повторяется выплата'); e.status = 400; throw e; } seen.add(k); }
    db.prepare('DELETE FROM world_ledger').run();
    for (const r of list) ledgerIns.run(r.id || core.uid(), r.at || core.now(), r.booked_on, r.stream, r.platform, r.kind, r.amount_cents, r.currency || 'USD', r.payout_id || null, r.payout_confirmed ? 1 : 0, r.state || 'estimate', r.confirmation_source || '', r.demo ? 1 : 0, r.source || 'restore', r.note || '');
  }
  // principal = user + auth channel. 'app' = loopback desktop app token (automation), 'session' = password login cookie.
  // N1: channel is derived from the REAL auth state, never from header shape. Any request carrying a valid app token
  // is 'app' (even if it also sends a cookie); 'session' only when the cookie validates against the server's session
  // store (read-only lookup injected by wiring.js) and no app token header is present. Anything else is 'unverified'.
  function reqChannel(req) {
    const H = req.headers || {}; const hasTok = ['x-studio-app-token', 'authorization', 'x-api-key'].some(k => k in H); // presence, not value: empty/whitespace token still counts
    if (hasTok) return 'app'; // mixed credentials (token/Authorization + cookie) are never a session // valid or not: a token-bearing request is never treated as an owner session
    if (typeof deps.sessionUser === 'function') { const u = deps.sessionUser(req); return u && u === req.user ? 'session' : 'unverified'; }
    return 'unverified';
  }
  // N3: principal = user identity + channel. requester != approver compares this full string, so the same user in the
  // same channel can never approve their own request (self-approval of own browser requests stays DISABLED).
  function reqPrincipal(req) { return String(req.user || '') + '@' + reqChannel(req); }
  // N2: world-local approve-password limiter (no shared login limiter is exported: server.js keeps its own `fails` Map).
  // Owner self-approval (decided by owner Igor, 22.10.2026): allowed ONLY for a request the owner created in a verified
  // browser session, approved from a verified session with a fresh password, within 15 min of the request, bound to the
  // stored params hash, single-use; journal decision 'owner_self_approval'. Never for app/agent-token requests.
  // Kill switch: config/mission.yaml `allowOwnerSelfApproval: false` or env MK_WORLD_OWNER_SELF_APPROVAL=0.
  const TEST_ENV = process.env.NODE_ENV === 'test', tenv = k => (TEST_ENV && +process.env[k]) || 0; // timing overrides honoured only in NODE_ENV=test
  const STEPUP_MS = tenv('MK_WORLD_SELF_APPROVAL_WINDOW_MS') || 15 * 60 * 1000;
  function stepUpAllowed() { if (process.env.MK_WORLD_OWNER_SELF_APPROVAL === '0') return false; return !(loaded && loaded.data && loaded.data.allowOwnerSelfApproval === false); }
  // N2 (persistent, per user, survives restart and new sessions): progressive delay between failures, then lockout.
  const LOCK_N = 5, LOCK_MS = tenv('MK_WORLD_PW_LOCK_MS') || 15 * 60 * 1000, DELAY_MS = tenv('MK_WORLD_PW_DELAY_MS') || 1000, DELAY_MAX = 30000;
  const pwGet = db.prepare('SELECT user, fails, locked_until, next_at FROM world_auth_fails WHERE user = ?');
  const pwPut = db.prepare('INSERT INTO world_auth_fails (user, fails, locked_until, next_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user) DO UPDATE SET fails = excluded.fails, locked_until = excluded.locked_until, next_at = excluded.next_at, updated_at = excluded.updated_at');
  const pwDel = db.prepare('DELETE FROM world_auth_fails WHERE user = ?');
  // -> null | { code: 'locked'|'throttled', retryAfterMs }
  const pwKey = req => req.user + '|' + (req.socket?.remoteAddress || 'unknown'); // server-side peer address only, no X-Forwarded-For
  // Safe reset: a successful main login (session issued after the lockout started) clears it. A new session needs the password,
  // so this cannot be used to bypass the limiter.
  function loginAfter(req, r) { const iat = typeof deps.sessionIssuedAt === 'function' ? deps.sessionIssuedAt(req) : null; const since = r.locked_until ? r.locked_until - LOCK_MS : 0; return !!(iat && since && iat > since); }
  function pwBlock(req) { const user = pwKey(req); const r = pwGet.get(user); if (!r) return null; const now = Date.now();
    if (r.locked_until && r.locked_until > now && loginAfter(req, r)) { pwDel.run(user); return null; }
    if (r.locked_until && r.locked_until > now) return { code: 'locked', retryAfterMs: r.locked_until - now };
    if (r.locked_until && r.locked_until <= now) { pwDel.run(user); return null; } // lockout expired: safe recovery
    if (r.next_at && r.next_at > now) return { code: 'throttled', retryAfterMs: r.next_at - now };
    return null; }
  function pwFail(req) { const user = pwKey(req); const r = pwGet.get(user) || { fails: 0 }; const n = r.fails + 1, now = Date.now();
    if (n >= LOCK_N) pwPut.run(user, n, now + LOCK_MS, 0, core.now()); else pwPut.run(user, n, 0, now + Math.min(DELAY_MS * 2 ** (n - 1), DELAY_MAX), core.now()); }
  function pwOk(req) { const user = pwKey(req); pwDel.run(user); }
  function setDeps(d) { deps = { ...deps, ...(d || {}) }; }
  return { boot, recover, onAgentStart, mount, exportLedger, replaceLedger, setDeps, applySavings, OWNER_ACTIONS: P.OWNER };
};
