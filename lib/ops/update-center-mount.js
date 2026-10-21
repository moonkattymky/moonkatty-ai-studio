// v1.3.0-test: Update Center routes, mounted by server.js AFTER the /api auth middleware (owner session / desktop app-token) and
// after sec.csrfCheck (Origin + X-Studio-Request). Only when STUDIO_OPS_UPDATE=1 — otherwise nothing is mounted (404).
// Self-contained: no ops stack (no security center / ledger / costs / watchdog / nodes). Install actions keep the owner
// password step-up (approve). Auto-install stays off unless all four OPS_UPDATE_* readiness flags are '1'.
'use strict';
const path = require('path');
function mountUpdateCenter(app, { CFG, dataDir, db, openDb, log, checkPassword, version, env = process.env, dbSchemaVersion, port }) {
  if (env.STUDIO_OPS_UPDATE !== '1') return null;
  const AI = require('./app-identity.js'); const UCm = require('./update-center.js');
  // identity: Info.plist of the running bundle wins; source checkout → the flavor's appId (CFG); STUDIO_FLAVOR must agree with it
  const identity = AI.resolveIdentity({ env: { ...env, STUDIO_APP_BUNDLE_ID: env.STUDIO_APP_BUNDLE_ID || CFG.appId, STUDIO_FLAVOR: CFG.flavor } });
  if (!identity.known) log('warn', 'update', 'Update Center: идентичность приложения не определена — установка заблокирована: ' + identity.problems.join('; '));
  const update = require('./update.js').createUpdateManager({ supportedSchema: dbSchemaVersion });
  const backups = require('./update-backup.js').createUpdateBackups({ db, openDb, dir: path.join(dataDir, 'ops', 'update-center', 'backups') });
  const U = UCm.createUpdateCenter({ dir: path.join(dataDir, 'ops', 'update-center'), current: version, identity, update, backups, db, nodes: null, env,
    healthUrl: `http://127.0.0.1:${port || identity.defaultPort || CFG.defaultPort}/api/health`, log });
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
  app.post('/api/ops/update-center/:tag/approve', h(req => { if (!checkPassword || !checkPassword(req.user, String(req.body?.password || ''))) throw Object.assign(new Error('Неверный пароль владельца'), { status: 403 }); return U.approve(tag(req), { user: req.user }); }));
  app.post('/api/ops/update-center/:tag/auto-install', h(req => { if (!checkPassword || !checkPassword(req.user, String(req.body?.password || ''))) throw Object.assign(new Error('Неверный пароль владельца'), { status: 403 }); return U.autoInstall(tag(req), { dryRun: req.body?.dryRun !== false }); }));
  app.post('/api/ops/update-center/rollback', h(() => U.rollback({ dryRun: true }))); // HTTP never executes a rollback
  app.get('/api/ops/update-center/health', h(() => U.healthCheck()));
  return U;
}
module.exports = { mountUpdateCenter };
