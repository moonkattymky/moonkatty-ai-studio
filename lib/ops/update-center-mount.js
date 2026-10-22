// v1.3.0-test: Update Center routes, mounted by server.js AFTER the /api auth middleware (owner session / desktop app-token) and
// after sec.csrfCheck (Origin + X-Studio-Request). Only when STUDIO_OPS_UPDATE=1 — otherwise nothing is mounted (404).
// Self-contained: no ops stack (no security center / ledger / costs / watchdog / nodes). Install actions keep the owner
// password step-up (approve). Auto-install stays off unless all four OPS_UPDATE_* readiness flags are '1'.
'use strict';
const path = require('path');
function mountUpdateCenter(app, { CFG, dataDir, db, openDb, log, checkPassword, version, env = process.env, dbSchemaVersion, port, core, sec, sessionUser, dbFile, exec }) {
  if (env.STUDIO_OPS_UPDATE !== '1') return null;
  const AI = require('./app-identity.js'); const UCm = require('./update-center.js');
  // identity: Info.plist of the running bundle wins; source checkout → the flavor's appId (CFG); STUDIO_FLAVOR must agree with it
  const identity = AI.resolveIdentity({ env: { ...env, STUDIO_APP_BUNDLE_ID: env.STUDIO_APP_BUNDLE_ID || CFG.appId, STUDIO_FLAVOR: CFG.flavor } });
  if (!identity.known) log('warn', 'update', 'Update Center: идентичность приложения не определена — установка заблокирована: ' + identity.problems.join('; '));
  const update = require('./update.js').createUpdateManager({ supportedSchema: dbSchemaVersion });
  const backups = require('./update-backup.js').createUpdateBackups({ db, openDb, dir: path.join(dataDir, 'ops', 'update-center', 'backups'), dataDir, dbFile });
  const ucDir = path.join(dataDir, 'ops', 'update-center'), healthUrl = `http://127.0.0.1:${port || identity.defaultPort || CFG.defaultPort}/api/health`;
  // E2E-UC: owner approval = the existing Approval Center (world_approvals via lib/world/permissions.js, same table/rules, core untouched)
  const approvals = core && sec ? createApprovalsAdapter({ db, core, sec }) : null;
  // macOS: real installer (exec = child_process wrapper); elsewhere none → install BLOCKED (download/verify/backup still work)
  const installer = process.platform === 'darwin' && exec ? require('./update-installer.js').createMacInstaller({ exec, stagingDir: path.join(ucDir, 'staging'), identity, healthCheck: o => U.healthCheck(o) }) : null;
  const U = UCm.createUpdateCenter({ dir: ucDir, current: version, identity, update, backups, db, nodes: null, env, healthUrl, log, approvals, installer, exec });
  if (app.locals) app.locals.updateCenterExecutor = (p, ctx) => U.executeInstall(p, ctx);
  const channel = req => ['x-studio-app-token', 'authorization', 'x-api-key'].some(k => k in (req.headers || {})) ? 'app' : (typeof sessionUser === 'function' && sessionUser(req) === req.user ? 'session' : 'unverified');
  const bad = (res, e) => res.status(e.status || 400).json({ error: e.message });
  const h = fn => async (req, res) => { try { res.json(await fn(req)); } catch (e) { log('warn', 'update', e.message, req.user); res.status(e.status || (e.code === 'NOT_FOUND' ? 404 : 400)).json({ error: e.message, code: e.code }); } };
  const tag = req => { const t = String(req.params.tag || ''); if (!/^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(t)) throw Object.assign(new Error('bad tag'), { status: 400 }); return t; };
  app.get('/api/ops/update-center', h(() => U.status()));
  app.post('/api/ops/update-center/check', h(() => U.check()));
  app.post('/api/ops/update-center/:tag/download', (req, res) => { let t; try { t = tag(req); } catch (e) { return bad(res, e); }
    try { U.prepareDownload(t); } catch (e) { return res.status(e.code === 'NOT_FOUND' ? 404 : 400).json({ error: e.message, code: e.code }); }
    U.download(t).catch(e => log('warn', 'update', `Загрузка ${t}: ${e.message}`)); res.status(202).json({ started: true, tag: t }); });
  app.post('/api/ops/update-center/:tag/clean', h(req => U.cleanTemp(tag(req))));
  app.post('/api/ops/update-center/backup', h(() => U.preBackup({})));
  app.get('/api/ops/update-center/:tag/plan', h(req => U.installPlan(tag(req))));
  // E2E-UC: the legacy password-only approve is superseded by Approval Center (approvalId ↔ params hash, owner session only).
  app.post('/api/ops/update-center/:tag/approve', (req, res) => res.status(403).json({ error: 'Согласие на установку — только через Approval Center: POST /api/ops/update-center/<tag>/install-request, затем владелец подтверждает в Approval Center', code: 'use_approval_center' }));
  // install-request: anyone authenticated (incl. agents) may only CREATE a pending request; nothing installs until the owner approves it in
  // Approval Center (/api/world/approvals/:id, verified session + password). A body flag such as confirm:true is ignored.
  app.post('/api/ops/update-center/:tag/install-request', h(req => U.requestInstall(tag(req), { actor: String(req.user || '') + '@' + channel(req) })));
  app.get('/api/ops/update-center/history', h(() => ({ history: U.status().history, install: U.status().install })));
  app.post('/api/ops/update-center/:tag/auto-install', h(req => { if (!checkPassword || !checkPassword(req.user, String(req.body?.password || ''))) throw Object.assign(new Error('Неверный пароль владельца'), { status: 403 }); return U.autoInstall(tag(req), { dryRun: req.body?.dryRun !== false }); }));
  app.post('/api/ops/update-center/rollback', h(() => U.rollback({ dryRun: true }))); // HTTP never executes a rollback
  app.get('/api/ops/update-center/health', h(() => U.healthCheck()));
  return U;
}
// Approval Center adapter: create requests with the SAME permissions module (params hash, TTL, requested_by) and verify at
// execution time that the row is approved, consumed (single use, done by Approval Center before calling the executor) and bound to
// exactly these params. Read-only on world_approvals except P.request (insert of a pending row).
function createApprovalsAdapter({ db, core, sec }) {
  const P = require('../world/permissions.js').createPermissions({ db, core, sec });
  const get = db.prepare('SELECT id, action, status, consumed_at, params_hash, decided_by FROM world_approvals WHERE id = ?');
  return { request: ({ action, params, actor, detail }) => P.request({ action, params, actor, detail }),
    verifyConsumed(id, action, params) { const r = get.get(String(id)); return !!(r && r.action === action && r.status === 'approved' && r.consumed_at && r.decided_by && r.params_hash === P.paramsHash(params)); },
    paramsHash: P.paramsHash };
}
module.exports = { mountUpdateCenter, createApprovalsAdapter };
