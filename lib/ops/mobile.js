// Mobile Control Center API: /api/mobile/* with a separate scoped bearer token (only SHA-256 hashes are stored).
// A mobile token is accepted ONLY on /api/mobile/* — the main /api auth middleware does not know it, so generic
// /api/:col, /api/restore, /api/reset, /api/backup, settings etc. stay unreachable with it.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const SCOPES = ['read', 'tasks:control', 'materials:review', 'materials:publish', 'ops:read'];
const DEFAULT_SCOPES = ['read', 'tasks:control', 'materials:review', 'ops:read'];
const PREFIX = 'mkm_';
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
function tokenStore({ q }) {
  const load = () => { try { return JSON.parse(q.meta.get('mobileTokens')?.v || '[]'); } catch { return []; } };
  const save = l => q.setMeta.run('mobileTokens', JSON.stringify(l));
  function create({ label = 'iPhone', scopes = DEFAULT_SCOPES, ttlDays = 90, user }) {
    const sc = [...new Set(scopes)].filter(s => SCOPES.includes(s)); if (!sc.length) throw new Error('Нет допустимых scope');
    const token = PREFIX + crypto.randomBytes(32).toString('base64url'); const id = crypto.randomBytes(6).toString('hex');
    const rec = { id, hash: hash(token), label: String(label).slice(0, 60), scopes: sc, createdAt: new Date().toISOString(), createdBy: user || null,
      expiresAt: new Date(Date.now() + Math.min(365, Math.max(1, +ttlDays || 90)) * 86400000).toISOString(), lastUsedAt: null };
    save([...load(), rec]); return { token, ...view(rec) };
  }
  const view = r => ({ id: r.id, label: r.label, scopes: r.scopes, createdAt: r.createdAt, expiresAt: r.expiresAt, lastUsedAt: r.lastUsedAt });
  function verify(token) {
    if (!token || !String(token).startsWith(PREFIX)) return null; const h = Buffer.from(hash(token), 'hex'); const l = load();
    const r = l.find(x => { const b = Buffer.from(x.hash, 'hex'); return b.length === h.length && crypto.timingSafeEqual(b, h); });
    if (!r || Date.parse(r.expiresAt) < Date.now()) return null;
    if (!r.lastUsedAt || Date.now() - Date.parse(r.lastUsedAt) > 60000) { r.lastUsedAt = new Date().toISOString(); save(l); }
    return r;
  }
  const revoke = id => { const l = load(); const n = l.filter(x => x.id !== id); save(n); return l.length !== n.length; };
  return { create, verify, revoke, list: () => load().map(view) };
}
function mountMobile(app, { q, get, put, list, log, sec, core, S, runner, rm, filesDir, watchdogStateFile, ownerUser, env = process.env }) {
  const tokens = tokenStore({ q });
  const allowAgents = new Set(String(env.OPS_MOBILE_AGENTS || 'news,content,social,analytics,community,video').split(',').map(s => s.trim()).filter(Boolean));
  const bearer = req => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // auth: mobile token, or the owner's full session (so the desktop panel can use the same endpoints). Every route requires auth.
  function auth(req, res, next) {
    const r = tokens.verify(bearer(req));
    if (r) { req.mobile = { id: r.id, scopes: r.scopes, label: r.label }; req.user = 'mobile:' + r.label; return next(); }
    const u = ownerUser(req); if (u) { req.mobile = { id: 'session', scopes: SCOPES, label: 'session' }; req.user = u; return next(); }
    res.status(401).json({ error: 'auth required' });
  }
  const need = s => (req, res, next) => req.mobile.scopes.includes(s) ? next() : res.status(403).json({ error: 'scope required: ' + s });
  const R = require('express').Router();
  R.use(auth);
  const short = t => ({ id: t.id, title: String(t.title || '').slice(0, 140), agentId: t.agentId, status: t.status, priority: t.priority, kind: t.kind || null,
    resourceClass: rm ? rm.classOf(t) : null, startedAt: t.startedAt || null, blockedReason: t.blockedReason || null, error: t.error ? sec.redact(t.error).slice(0, 200) : null });
  const readWatchdog = () => { try { const s = JSON.parse(fs.readFileSync(watchdogStateFile, 'utf8')); return { lastCycleAt: s.lastCycleAt, checks: Object.fromEntries(Object.entries(s.checks || {}).map(([k, v]) => [k, { ok: v.ok, detail: v.detail, fails: v.fails, at: v.at }])), alerts: (s.alerts || []).slice(-20) }; } catch { return null; } };
  function summary() {
    const tasks = list('tasks'); const by = {}; for (const t of tasks) by[t.status] = (by[t.status] || 0) + 1;
    const nowMs = Date.now(); const stuck = tasks.filter(t => t.status === 'in_progress' && t.startedAt).map(t => ({ id: t.id, title: String(t.title).slice(0, 80), agentId: t.agentId, minutes: Math.round((nowMs - Date.parse(t.startedAt)) / 60000) })).sort((a, b) => b.minutes - a.minutes);
    const logs = list('logs'); const recentErr = logs.filter(l => l.level === 'error'); const last10 = recentErr.filter(l => nowMs - Date.parse(l.at) < 600000).length;
    const os = require('os');
    return { at: new Date().toISOString(), agents: list('agents').map(a => ({ id: a.id, name: a.name, status: a.status, enabled: a.enabled, controllable: allowAgents.has(a.id), currentTaskId: a.currentTaskId || null, lastError: a.lastError ? sec.redact(a.lastError).slice(0, 160) : null })),
      tasks: { byStatus: by, stuck, waitingApproval: by.waiting_approval || 0 },
      errors: { last10min: last10, recent: recentErr.slice(-10).reverse().map(l => ({ at: l.at, source: l.source, message: sec.redact(l.message).slice(0, 200) })) },
      system: { memTotal: os.totalmem(), memFree: os.freemem(), loadavg: os.loadavg(), uptimeSec: Math.round(process.uptime()), lastTick: q.meta.get('lastTick')?.v || null },
      resources: rm ? rm.status() : null, watchdog: readWatchdog() };
  }
  R.get('/summary', need('read'), (req, res) => res.json(summary()));
  R.get('/tasks', need('read'), (req, res) => { const s = req.query.status; res.json(list('tasks').filter(t => !s || t.status === s).slice(-200).reverse().map(short)); });
  // start/stop: only allow-listed agents; never OpenCode/code tasks; never approves code.
  const okTask = (req, res) => { const t = get('tasks', req.params.id); if (!t) { res.status(404).json({ error: 'not found' }); return null; }
    if (!allowAgents.has(t.agentId) || t.kind === 'code') { res.status(403).json({ error: 'Задача не разрешена для мобильного управления' }); return null; } return t; };
  R.post('/tasks/:id/start', need('tasks:control'), (req, res) => { const t = okTask(req, res); if (!t) return;
    if (!['failed', 'blocked', 'idle', 'cancelled', 'queued'].includes(t.status)) return res.status(409).json({ error: 'Нельзя запустить из статуса ' + t.status });
    Object.assign(t, { status: 'queued', blockedReason: null, error: null, updatedAt: core.now() }); put('tasks', t);
    const a = get('agents', t.agentId); let agent = null; if (a && a.status !== 'working') { try { agent = runner.start(a.id, req.user); } catch (e) { return res.status(400).json({ error: e.message }); } }
    log('info', 'mobile', `Мобильный запуск задачи: ${t.title}`, req.user); res.json({ task: short(get('tasks', t.id)), agentStarted: !!agent }); });
  R.post('/tasks/:id/stop', need('tasks:control'), (req, res) => { const t = okTask(req, res); if (!t) return;
    if (t.status === 'in_progress') { const b = runner.busy.get(t.agentId); if (b && b.taskId === t.id) runner.stop(t.agentId, req.user); }
    const cur = get('tasks', t.id); if (['queued', 'in_progress'].includes(cur.status)) { cur.status = 'cancelled'; cur.updatedAt = core.now(); put('tasks', cur); }
    log('info', 'mobile', `Мобильная остановка задачи: ${t.title}`, req.user); res.json({ task: short(get('tasks', t.id)) }); });
  R.post('/agents/:id/:action', need('tasks:control'), (req, res) => { if (!['start', 'stop'].includes(req.params.action)) return res.status(404).json({ error: 'not found' }); if (!allowAgents.has(req.params.id)) return res.status(403).json({ error: 'Агент не разрешён' });
    try { const a = runner[req.params.action](req.params.id, req.user); log('info', 'mobile', `Агент ${req.params.id}: ${req.params.action}`, req.user); res.json({ id: a.id, status: a.status }); } catch (e) { res.status(400).json({ error: e.message }); } });
  // media (read-only)
  R.get('/media', need('read'), (req, res) => res.json(list('files').slice(-100).reverse().map(f => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, project: f.project, createdAt: f.createdAt }))));
  R.get('/media/:id', need('read'), (req, res) => { const f = get('files', req.params.id); if (!f) return res.status(404).json({ error: 'not found' });
    const name = path.basename(String(f.url || '')); const p = path.join(filesDir, name); if (!name || path.dirname(p) !== filesDir || !fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
    res.setHeader('Cache-Control', 'private, no-store'); sec.filesHeaders({ path: '/' + name }, res, () => res.sendFile(p, { dotfiles: 'deny' })); });
  // materials: tasks waiting approval + publication queue pending approval
  R.get('/materials', need('read'), (req, res) => res.json({
    tasks: list('tasks').filter(t => t.status === 'waiting_approval').map(t => ({ ...short(t), result: sec.redact(String(t.result || '')).slice(0, 2000) })),
    queue: list('queue').filter(x => x.status === 'pending_approval').map(x => ({ id: x.id, title: x.title, channelId: x.channelId, scheduledAt: x.scheduledAt || null, text: String(x.text || x.caption || '').slice(0, 2000), demo: !!x.demo })) }));
  R.post('/materials/task/:id/:decision', need('materials:review'), (req, res) => { if (!['approve', 'reject'].includes(req.params.decision)) return res.status(404).json({ error: 'not found' }); const t = get('tasks', req.params.id);
    if (!t || t.status !== 'waiting_approval') return res.status(409).json({ error: 'Не ожидает утверждения' });
    const ok = req.params.decision === 'approve'; Object.assign(t, { status: ok ? 'done' : 'rejected', reviewedBy: req.user, reviewedAt: core.now(), reviewNote: String(req.body?.note || '').slice(0, 500) }); if (ok) t.completedAt = core.now();
    put('tasks', t); log('info', 'mobile', `Материал ${ok ? 'утверждён' : 'отклонён'}: ${t.title}`, req.user); res.json(short(t)); });
  // Queue approval may lead to scheduled publishing → separate scope (not in default token) + the same guardrails as the panel.
  R.post('/materials/queue/:id/:decision', need('materials:review'), (req, res) => { if (!['approve', 'reject'].includes(req.params.decision)) return res.status(404).json({ error: 'not found' }); const it = get('queue', req.params.id);
    if (!it || it.status !== 'pending_approval') return res.status(409).json({ error: 'Не ожидает утверждения' });
    if (req.params.decision === 'approve') { if (!req.mobile.scopes.includes('materials:publish')) return res.status(403).json({ error: 'scope required: materials:publish' });
      const cand = Object.assign({}, it, { status: 'approved' }); const data = { queue: list('queue'), episodes: list('episodes') };
      const issues = [...S.guardrails(cand, data), ...S.dailyCheck(cand, data.queue, list('workspaces'))]; if (issues.length) return res.status(400).json({ error: issues.join('; '), issues }); }
    const st = req.params.decision === 'approve' ? 'approved' : 'rejected';
    Object.assign(it, { status: st, history: [...(it.history || []), { at: core.now(), event: st, user: req.user }], updatedAt: core.now() }); put('queue', it);
    log('info', 'mobile', `Публикация ${st}: ${it.title}`, req.user); res.json({ id: it.id, status: it.status }); });
  R.get('/notifications', need('read'), (req, res) => { const w = readWatchdog();
    const logs = list('logs').filter(l => l.level === 'error' || l.level === 'warn').slice(-30).reverse().map(l => ({ at: l.at, level: l.level, source: l.source, message: sec.redact(l.message).slice(0, 200) }));
    res.json({ watchdog: w ? w.alerts.slice().reverse() : [], logs }); });
  R.get('/me', (req, res) => res.json({ user: req.user, scopes: req.mobile.scopes, label: req.mobile.label }));
  R.use((req, res) => res.status(404).json({ error: 'not found' }));
  app.use('/api/mobile', R);
  // token management — mounted AFTER the main auth middleware (owner session/app token only, never a mobile token)
  function mountAdmin() {
    app.get('/api/ops/mobile-tokens', (req, res) => res.json(tokens.list()));
    app.post('/api/ops/mobile-tokens', (req, res) => { if (String(req.user || '').startsWith('mobile:')) return res.status(403).end();
      try { const t = tokens.create({ ...(req.body || {}), user: req.user }); log('info', 'mobile', `Создан мобильный токен «${t.label}» (${t.scopes.join(',')})`, req.user); res.status(201).json(t); } catch (e) { res.status(400).json({ error: e.message }); } });
    app.delete('/api/ops/mobile-tokens/:id', (req, res) => { const ok = tokens.revoke(req.params.id); if (ok) log('info', 'mobile', 'Мобильный токен отозван: ' + req.params.id, req.user); res.json({ ok }); });
  }
  return { tokens, mountAdmin, summary };
}
module.exports = { mountMobile, tokenStore, SCOPES, DEFAULT_SCOPES, hash };
