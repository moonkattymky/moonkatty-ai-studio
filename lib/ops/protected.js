// Ops endpoints mounted AFTER the main /api auth middleware (owner session or desktop app-token only).
'use strict';
const os = require('os'), fs = require('fs'), path = require('path');
const SC = require('./security-center.js');
module.exports = function mountProtected(app, ctx) {
  const { nodes, flags, q, get, put, list, log, sec, core, runner, db, dataDir, checkPassword, security, backups, costs, rm, update, version, env } = ctx;
  const bad = (res, e) => res.status(e.status || 400).json({ error: e.message });
  // ---------- Security Center ----------
  if (security) {
    const { caps, confirm, audit } = security;
    // action audit log: every state-changing /api call (no bodies, path redacted)
    app.use('/api', (req, res, next) => { if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
      const t0 = Date.now(); res.on('finish', () => { try { audit.append({ user: req.user || null, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, action: SC.classify({ path: req.originalUrl.split('?')[0], method: req.method, body: req.body }) || undefined, ms: Date.now() - t0 }); } catch {} }); next(); });
    // second-step confirmation
    app.post('/api/ops/confirm', (req, res) => { const { action, password } = req.body || {};
      if (!['restore', 'reset', 'publish', 'code-exec', 'integration-url', 'permissions', 'cost-override', 'unload-models'].includes(action)) return res.status(400).json({ error: 'Неизвестное действие' });
      if (!checkPassword(req.user, String(password || ''))) { log('warn', 'security', 'Подтверждение отклонено (неверный пароль): ' + action, req.user); return res.status(403).json({ error: 'Неверный пароль' }); }
      res.json(confirm.issue(req.user, action)); });
    app.use('/api', (req, res, next) => { const action = SC.classify({ path: req.originalUrl.split('?')[0], method: req.method, body: req.body });
      if (!action) return next(); const tok = req.headers['x-studio-confirm'];
      if (tok && confirm.consume(String(tok), req.user, action)) { log('info', 'security', 'Опасная операция подтверждена: ' + action, req.user); return next(); }
      res.status(428).json({ error: 'Требуется подтверждение паролем', confirmRequired: true, action }); });
    // integration URL allowlist (writes + test of stored URL)
    app.use('/api/integrations', (req, res, next) => {
      if (['PUT', 'POST'].includes(req.method) && req.body && typeof req.body === 'object' && 'url' in req.body && !/\/test$/.test(req.path)) { const r = SC.checkIntegrationUrl(req.body.url, env); if (!r.ok) return res.status(400).json({ error: r.error, code: r.code }); }
      const m = /^\/([^/]+)\/test$/.exec(req.path); if (req.method === 'POST' && m && m[1] !== 'opencode') { const it = get('integrations', m[1]); if (it) { const r = SC.checkIntegrationUrl(it.url, env); if (!r.ok) { log('warn', 'security', `Проверка ${it.id} заблокирована: ${r.error}`, req.user); return res.status(400).json({ error: r.error, code: r.code }); } } }
      next(); });
    app.get('/api/ops/security/audit', (req, res) => res.json(SC.securityAudit({ env, list, q, dataDir, sec, caps, port: env.PORT })));
    app.get('/api/ops/permissions', (req, res) => res.json({ stored: caps.load(), effective: Object.fromEntries(list('agents').map(a => [a.id, caps.effective(a.id)])) }));
    app.put('/api/ops/permissions', (req, res) => { try { const v = caps.save(req.body); log('info', 'security', 'Права агентов изменены', req.user); res.json(v); } catch (e) { bad(res, e); } });
    app.get('/api/ops/audit', (req, res) => res.json({ verify: audit.verify(), entries: audit.read(Math.min(500, +req.query.limit || 100)).reverse() }));
    app.post('/api/ops/tasks/:id/approve-plan', (req, res) => { const t = get('tasks', req.params.id); if (!t || t.status !== 'waiting_plan_approval') return res.status(409).json({ error: 'Задача не ждёт проверки плана' });
      Object.assign(t, { status: 'queued', planApprovedBy: req.user, planApprovedAt: core.now() }); put('tasks', t); log('info', 'security', 'План LLM утверждён: ' + t.title, req.user); res.json(t); });
  }
  // ---------- Resource Manager ----------
  if (rm) {
    app.get('/api/ops/resources', (req, res) => res.json(rm.status()));
    // Manual unload of Ollama models: explicit owner action only (password confirmation with Security Center, else body.confirm === 'UNLOAD').
    app.post('/api/ops/resources/unload-ollama', async (req, res) => { if (!security && req.body?.confirm !== 'UNLOAD') return res.status(400).json({ error: 'confirm: "UNLOAD" обязателен' });
      await rm.refresh(); const r = await rm.unloadAll(); log('info', 'resources', `Выгрузка моделей Ollama по команде владельца: ${r.length}`, req.user); res.json({ unloaded: r }); });
  }
  // ---------- Backup & Recovery ----------
  if (backups) {
    app.get('/api/ops/backups', (req, res) => res.json(backups.list()));
    app.post('/api/ops/backups', (req, res) => { try { res.status(201).json(backups.create({ passphrase: req.body?.passphrase, note: req.body?.note })); } catch (e) { log('error', 'backup', 'Ops-бэкап: ' + e.message); bad(res, e); } });
    app.post('/api/ops/backups/:id/verify', (req, res) => { try { res.json(backups.verify(req.params.id)); } catch (e) { bad(res, e); } });
    app.post('/api/ops/backups/:id/test-restore', (req, res) => { try { const r = backups.testRestore(req.params.id, { passphrase: req.body?.passphrase }); log(r.ok ? 'info' : 'error', 'backup', `Тест восстановления ${req.params.id}: ${r.ok ? 'OK' : 'ошибка'}`, req.user); res.json(r); } catch (e) { bad(res, e); } });
  }
  // ---------- Cost Controller ----------
  if (costs) {
    app.get('/api/ops/costs', (req, res) => res.json(costs.summary()));
    app.put('/api/ops/costs/budgets', (req, res) => { try { const b = costs.setBudgets(req.body); log('info', 'costs', 'Бюджеты изменены', req.user); res.json(b); } catch (e) { bad(res, e); } });
    app.post('/api/ops/costs/check', (req, res) => { try { res.json(costs.authorize(String(req.body?.service || ''), +req.body?.usd || 0, { user: req.user })); } catch (e) { bad(res, e); } });
    // explicit over-budget confirmation (with Security Center it additionally requires the password confirm token)
    app.post('/api/ops/costs/override', (req, res) => { try { res.json(costs.authorize(String(req.body?.service || ''), +req.body?.usd || 0, { confirmed: true, user: req.user, purpose: req.body?.purpose })); } catch (e) { bad(res, e); } });
    app.post('/api/ops/costs/record', (req, res) => { try { res.status(201).json(costs.record(String(req.body?.service || ''), +req.body?.usd, { user: req.user, purpose: req.body?.purpose, ref: req.body?.ref })); } catch (e) { bad(res, e); } });
  }
  // ---------- Operations Dashboard ----------
  if (flags.dashboard) {
    const wdFile = path.join(dataDir, 'ops', 'watchdog-state.json');
    app.get('/api/ops/update/status', (req, res) => res.json({ version, schema: update.schemaCheck(db) }));
    app.get('/api/ops/dashboard', async (req, res) => {
      let wd = null; try { const s = JSON.parse(fs.readFileSync(wdFile, 'utf8')); wd = { lastCycleAt: s.lastCycleAt, checks: s.checks, alerts: (s.alerts || []).slice(-20).reverse(), breakers: s.breakers }; } catch {}
      const tasks = list('tasks'); const nowMs = Date.now();
      const current = tasks.filter(t => t.status === 'in_progress').map(t => ({ id: t.id, title: t.title, agentId: t.agentId, startedAt: t.startedAt, minutes: t.startedAt ? Math.round((nowMs - Date.parse(t.startedAt)) / 60000) : null }));
      const logs = list('logs');
      let ollama = null; try { ollama = await runner.ollamaStatus(); } catch (e) { ollama = { ok: false, error: e.message }; }
      res.json({ nodes: nodes ? nodes.status() : null,  at: new Date().toISOString(), version, flags,
        components: { server: { ok: true, pid: process.pid, uptimeSec: Math.round(process.uptime()) }, scheduler: { lastTick: q.meta.get('lastTick')?.v || null }, ollama, opencode: { enabled: runner.opencodeEnabled() }, watchdog: wd ? { lastCycleAt: wd.lastCycleAt, checks: wd.checks, breakers: wd.breakers } : null },
        tasks: { current, stuck: current.filter(t => t.minutes >= 60), waitingApproval: tasks.filter(t => t.status === 'waiting_approval').length, waitingPlan: tasks.filter(t => t.status === 'waiting_plan_approval').map(t => ({ id: t.id, title: t.title, agentId: t.agentId })), blocked: tasks.filter(t => t.status === 'blocked').length },
        errors: logs.filter(l => l.level === 'error').slice(-15).reverse().map(l => ({ at: l.at, source: l.source, message: sec.redact(l.message).slice(0, 240) })),
        load: { loadavg: os.loadavg(), cpus: os.cpus().length, memTotal: os.totalmem(), memFree: os.freemem(), memory: ctx.memory ? ctx.memory() : null, resources: rm ? rm.status() : null },
        backups: { ops: backups ? backups.list().slice(0, 10) : null, lastLegacy: q.meta.get('lastBackup')?.v || null },
        costs: costs ? costs.summary() : null,
        notifications: [...(wd ? wd.alerts : []).map(a => ({ at: a.at, level: a.level, source: 'watchdog:' + a.check, message: a.detail })), ...logs.filter(l => l.level === 'warn').slice(-10).reverse().map(l => ({ at: l.at, level: 'warn', source: l.source, message: sec.redact(l.message).slice(0, 200) }))].slice(0, 25),
        permissions: security ? Object.fromEntries(list('agents').map(a => [a.id, security.caps.effective(a.id)])) : null,
        audit: security ? security.audit.verify() : null });
    });
  }
  // ---------- Node Manager (owner session only; nodes use their own API/listener) ----------
  if (nodes) {
    app.get('/api/ops/nodes', (req, res) => res.json({ ...nodes.status(), roles: nodes.ROLES, fingerprint: (() => { try { return require('./nodes.js').fingerprintOf(fs.readFileSync(path.join(dataDir, 'ops', 'nodes-tls.crt'), 'utf8')); } catch { return null; } })() }));
    app.post('/api/ops/nodes', (req, res) => { try { const r = nodes.registerNode(req.body || {}); log('info', 'nodes', 'Зарегистрирован узел ' + r.id, req.user); res.json({ ...r, note: 'Токен показан один раз' }); } catch (e) { bad(res, e); } });
    app.post('/api/ops/nodes/:id/revoke', (req, res) => { try { res.json(nodes.revokeNode(req.params.id)); } catch (e) { bad(res, e); } });
    app.post('/api/ops/nodes/jobs', (req, res) => { try { res.json(nodes.submit(req.body || {})); } catch (e) { bad(res, e); } });
    app.post('/api/ops/nodes/jobs/:id/:act', (req, res) => { try { if (!['cancel', 'retry'].includes(req.params.act)) return res.status(404).end(); res.json(nodes[req.params.act](req.params.id)); } catch (e) { bad(res, e); } });
    app.get('/api/ops/nodes/route', (req, res) => res.json(nodes.route({ capability: String(req.query.capability || ''), requires: {} })));
  }
};
