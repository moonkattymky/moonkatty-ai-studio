// Studio Operations wiring. Everything is OFF unless enabled:
//   STUDIO_OPS_RESOURCES=1  — Resource Manager admission in runner (+ OPS_RM_UNLOAD_OLLAMA=1 to unload models via keep_alive:0)
//   STUDIO_OPS_MOBILE=1     — /api/mobile/* + /api/ops/mobile-tokens
//   STUDIO_OPS_SECURITY=1   — Security Center (capabilities, confirmations, URL allowlist, audit log, LLM-plan approval, generic 500)
//   STUDIO_OPS_BACKUP=1     — Backup & Recovery API + daily ops backup
//   STUDIO_OPS_COSTS=1      — Cost Controller
//   STUDIO_OPS_DASHBOARD=1  — Operations Dashboard (/api/ops/dashboard + panel section)
//   STUDIO_OPS_MONEY=1      — Money ledger (actual/estimate/forecast), deals (sponsors/clients), monetization adapters (mocks); GET /api/ops/ledger
//   STUDIO_OPS_UPDATE=1     — Update Center (/api/ops/update-center/*): check signed GitHub releases, download+verify, manual install plan
//   STUDIO_OPS_NODES=1      — Distributed Node Manager (/api/ops/nodes; separate node API listener, 127.0.0.1 unless OPS_NODES_BIND=<LAN IP>)
// The Watchdog is a separate process (ops/watchdog.js); the server only reads its state file.
'use strict';
const path = require('path'), crypto = require('crypto');
const probes = require('./probes.js');
const { createResourceManager } = require('./resource-manager.js');
const SC = require('./security-center.js');
module.exports = function ops({ env = process.env, dataDir, log = () => {}, q }) {
  const opsDir = path.join(dataDir, 'ops');
  const on = k => env['STUDIO_OPS_' + k] === '1';
  const flags = { resources: on('RESOURCES'), mobile: on('MOBILE'), security: on('SECURITY'), backup: on('BACKUP'), costs: on('COSTS'), dashboard: on('DASHBOARD'), nodes: on('NODES'), money: on('MONEY'), update: on('UPDATE') };
  const rm = flags.resources ? createResourceManager({ ollamaUrl: (env.OPS_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''), memInfo: () => probes.memInfo(),
    tmpRoot: path.join(opsDir, 'tmp'), unloadOllama: env.OPS_RM_UNLOAD_OLLAMA === '1', calibrationFile: path.join(opsDir, 'calibration.json'), log }) : null;
  const security = flags.security && q ? { caps: SC.capsStore({ q }), confirm: SC.confirmer(), audit: SC.auditLog(path.join(opsDir, 'audit.jsonl'), { redact: s => require('../security.js').redact(s) }) } : null;
  const costs = flags.costs ? require('./costs.js').createCostController({ dir: opsDir, log }) : null;
  let lastDecision = new Map();
  const admit = rm ? t => { const d = rm.admit(t); const prev = lastDecision.get(t.id);
    if (!d.ok && prev !== d.reason) log('info', 'resources', `Задача ждёт ресурсов (${d.cls}): ${t.title} — ${d.reason}`); lastDecision.set(t.id, d.ok ? 'ok' : d.reason); if (lastDecision.size > 500) lastDecision = new Map(); return d; } : undefined;
  const release = rm ? t => rm.release(t) : undefined;
  const nodes = flags.nodes ? require('./nodes.js').createNodeManager({ dir: opsDir, log, notify: m => require('./notifier.js').makeNotifier(env, { log: x => log('warn', 'nodes', x) }).notify({ title: m.title, body: m.body, level: 'warn' }) }) : null;
  let nodeServer = null;
  const ledger = flags.money ? require('./ledger.js').createLedger({ dir: opsDir, log, costs, notify: m => require('./notifier.js').makeNotifier(env, { log: x => log('warn', 'money', x) }).notify({ title: m.title, body: m.body, level: 'warn' }) }) : null;
  if (ledger) { // Studio 5 (feat/studio-intelligence) resolveProject(projectId) when present; otherwise format check; unknown → 'unassigned'
    for (const p of ['../../studio-intelligence/src/projects.js', '../../studio-intelligence/src/index.js']) { try { const si = require(p); if (typeof si.resolveProject === 'function') { ledger.setResolver(pid => { const r = si.resolveProject(pid); return r && typeof r.then !== 'function' ? { projectId: pid, ...r, resolvedBy: 'studio-intelligence' } : null; }); break; } } catch {} } }
  const deals = ledger ? require('./deals.js').createDeals({ dir: opsDir, ledger }) : null;
  const timers = []; let backups = null;
  function start() {
    if (nodes) { timers.push(setInterval(() => { try { nodes.sweep(); } catch (e) { log('error', 'nodes', e.message); } }, 10000).unref());
      const host = env.OPS_NODES_BIND || '127.0.0.1'; const N = require('./nodes.js');
      try { const tls = N.ensureCert(opsDir); N.listen(nodes, { host, port: +(env.OPS_NODES_PORT || 8790), tls }).then(s => { nodeServer = s; log('info', 'nodes', `Node API (TLS) на ${host}:${env.OPS_NODES_PORT || 8790}, отпечаток ${tls.fingerprint}`); }).catch(e => log('error', 'nodes', 'Node API: ' + e.message));
      } catch (e) { log('error', 'nodes', 'Node API: ' + e.message); } }
    if (rm) { rm.refresh().catch(() => {});
      timers.push(setInterval(() => rm.refresh().catch(() => {}), +(env.OPS_RM_REFRESH_MS || 10000)).unref());
      const clean = () => { try { const r = rm.cleanupTemp({ quotaGB: +(env.OPS_TMP_QUOTA_GB || 20), ttlHours: +(env.OPS_TMP_TTL_HOURS || 48) }); if (r.removed.length) log('info', 'resources', `Очистка временных папок ops: ${r.removed.length}`); } catch (e) { log('warn', 'resources', 'Очистка tmp: ' + e.message); } };
      clean(); timers.push(setInterval(clean, 3600000).unref()); }
    if (backups) { const hours = +(env.OPS_BACKUP_INTERVAL_H || 24); const due = () => { const l = backups.list(); if (!l.length || Date.now() - Date.parse(l[0].createdAt) >= hours * 3600000) { try { backups.create({ note: 'auto' }); } catch (e) { log('error', 'backup', 'Авто ops-бэкап: ' + e.message); } } };
      timers.push(setInterval(due, 3600000).unref()); setTimeout(due, 60000).unref(); }
  }
  function mountMobile(app, ctx) { if (!flags.mobile) return null; return require('./mobile.js').mountMobile(app, { ...ctx, rm, nodes, env, watchdogStateFile: path.join(opsDir, 'watchdog-state.json') }); }
  function mountProtected(app, ctx) {
    if (flags.backup) backups = require('./backup.js').createBackupManager({ db: ctx.db, openDb: ctx.openDb, dataDir, filesDir: ctx.filesDir, version: ctx.version, keep: +(env.OPS_BACKUP_KEEP || 7),
      extraDirs: String(env.OPS_BACKUP_EXTRA_DIRS || '').split(',').map(s => s.trim()).filter(Boolean), log });
    const update = require('./update.js').createUpdateManager();
    const updateCenter = flags.update ? require('./update-center.js').createUpdateCenter({ dir: path.join(opsDir, 'update-center'), current: ctx.version, update, backups, db: ctx.db, nodes, env, exec: probes.run,
      healthUrl: env.OPS_UPDATE_HEALTH_URL || `http://127.0.0.1:${env.PORT || 8787}/api/health`, log }) : null;
    require('./protected.js')(app, { ...ctx, updateCenter, nodes, ledger, deals, flags, security, backups, costs, rm, env, dataDir, update });
  }
  // generic 500 (Security Center): no internal messages to the client; correlation id goes to the log
  const publicError = err => { if (!security) return null; const ref = crypto.randomBytes(4).toString('hex'); log('error', 'http', `[${ref}] ${err.message}`); return { error: 'Внутренняя ошибка сервера', ref }; };
  const status = () => ({ flags, resources: rm ? rm.status() : null });
  const runViaNode = nodes ? (a, t, sig) => nodes.runViaNode(a, t, sig) : undefined;
  return { flags, rm, ledger, deals, listEntries: ledger ? f => ledger.listEntries(f) : null, nodes, runViaNode, nodeBridge: nodes ? require('./jobs-adapter.js').createBridge(nodes) : null, admit, release, start, mountMobile, mountProtected, status, publicError,
    can: security ? (a, c, t) => security.caps.can(a, c, t) : undefined,
    wrapUntrusted: security ? SC.wrapUntrusted : undefined,
    guardPlannedTask: security ? SC.guardPlannedTask : (t => t),
    stop: () => { timers.forEach(clearInterval); if (nodeServer) nodeServer.close(); } };
};
