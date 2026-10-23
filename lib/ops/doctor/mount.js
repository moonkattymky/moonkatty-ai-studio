// HTTP mount for System Doctor. Routes sit behind the studio session and CSRF
// checks because server.js mounts this after both middlewares.
'use strict';
const path = require('path');
const runs = require('./checks/index');
const { createActions, createBackup, FORBIDDEN } = require('./actions');
const { createSchedule, createRing, alertsFrom } = require('./schedule');
const report = require('./report');
const { cleanupOld } = require('./paths');
const { redact } = require('./redact');

function loadApprovals(ctx) {
  if (ctx.approvals && typeof ctx.approvals.request === 'function') return ctx.approvals;
  const { openStudioIntelligence } = require('../../../studio-intelligence/src');
  const si = openStudioIntelligence({ db: ctx.db, auditLog: ctx.log, now: () => new Date().toISOString() });
  return si.approval;
}

function mountDoctor(app, ctx) {
  const approvals = loadApprovals(ctx);
  const actions = createActions({ ...ctx, approvals });
  const history = createRing(288);
  let last = null;
  let schedule = null;
  const root = path.join(__dirname, '..', '..', '..');
  const base = () => ({ ...ctx, root, env: process.env });

  function remember(rep) {
    const alerts = rep.alerts || alertsFrom(rep.checks);
    const sample = { at: new Date().toISOString(), kind: rep.kind, ms: rep.ms, alerts, statuses: (rep.checks || []).map(c => ({ id: c.id, status: c.status })) };
    history.push(sample);
    last = { ...rep, alerts };
    return last;
  }

  const send = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) {
      const status = e.status || 400;
      if (ctx.log) ctx.log('warn', 'doctor', redact(e.message, ctx.sec), req.user);
      res.status(status).json({ error: redact(e.message, ctx.sec), code: e.code || 'ERROR' });
    }
  };

  app.get('/api/ops/doctor', send(async () => ({
    ok: true, last: last ? report.build(last, ctx.sec) : null, history: history.list(),
    pending: actions.pending(), forbidden: FORBIDDEN, platform: process.platform
  })));
  app.post('/api/ops/doctor/quick', send(async () => remember(await runs.quick(base()))));
  app.post('/api/ops/doctor/full', send(async () => remember(await runs.full(base()))));
  app.post('/api/ops/doctor/ollama', send(async () => remember({ kind: 'ollama', checks: [await require('./checks/ollama').generate({})] })));
  app.post('/api/ops/doctor/opencode', send(async () => remember({ kind: 'opencode', checks: [await require('./checks/opencode').check({ env: process.env })] })));
  app.post('/api/ops/doctor/blender', send(async () => remember({ kind: 'blender', checks: [await require('./checks/blender').check({ blender: ctx.blender })] })));
  app.post('/api/ops/doctor/db', send(async () => remember({ kind: 'db', checks: [require('./checks/db').integrityCopy({ ...base(), snapshot: require('../../db-backup').snapshot })] })));
  app.post('/api/ops/doctor/backup', send(async () => {
    const b = createBackup(base());
    return remember({ kind: 'backup', checks: [b] });
  }));
  app.get('/api/ops/doctor/backups', send(async () => {
    const fs = require('fs');
    const dir = ctx.backupDir;
    if (!dir || !fs.existsSync(dir)) return { backups: [] };
    const backups = fs.readdirSync(dir).filter(n => /\.(db|json)$/.test(n) && !n.endsWith('.sha256')).sort().reverse();
    return { backups };
  }));
  app.post('/api/ops/doctor/actions/request', send(async req => actions.request({ user: req.user, actionId: String(req.body?.actionId || ''), params: req.body?.params || {} })));
  app.post('/api/ops/doctor/actions/execute', send(async req => actions.execute({ user: req.user, approvalId: req.body?.approvalId, password: req.body?.password })));
  app.get('/api/ops/doctor/report', send(async () => report.build(last || { kind: 'empty', checks: [] }, ctx.sec)));
  app.get('/api/ops/doctor/report.md', async (req, res) => {
    const md = report.markdown(last || { kind: 'empty', checks: [] }, ctx.sec);
    res.type('text/markdown').send(md);
  });

  function arm() {
    if (schedule) return schedule;
    schedule = createSchedule({
      nightlyEnabled: process.env.STUDIO_DOCTOR_NIGHTLY === '1',
      onStartup: async () => { const r = await runs.startup(base()); remember(r); cleanupOld(); },
      onPeriodic: async () => remember(await runs.periodic(base())),
      onHourly: async () => remember(await runs.hourly(base())),
      onFull: async () => remember(await runs.full(base()))
    });
    schedule.arm();
    return schedule;
  }
  function stop() { if (schedule) schedule.stop(); }

  return { arm, stop, actions, history, remember };
}

module.exports = { mountDoctor };
