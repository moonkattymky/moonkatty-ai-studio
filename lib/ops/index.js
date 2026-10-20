// Studio Operations wiring. Everything is OFF unless enabled:
//   STUDIO_OPS_RESOURCES=1  — Resource Manager admission in runner (+ OPS_RM_UNLOAD_OLLAMA=1 to unload models via keep_alive:0)
//   STUDIO_OPS_MOBILE=1     — /api/mobile/* + /api/ops/mobile-tokens
// The Watchdog is a separate process (ops/watchdog.js); the server only reads its state file for the mobile summary.
'use strict';
const path = require('path');
const probes = require('./probes.js');
const { createResourceManager } = require('./resource-manager.js');
module.exports = function ops({ env = process.env, dataDir, log = () => {} }) {
  const opsDir = path.join(dataDir, 'ops');
  const flags = { resources: env.STUDIO_OPS_RESOURCES === '1', mobile: env.STUDIO_OPS_MOBILE === '1' };
  const rm = flags.resources ? createResourceManager({ ollamaUrl: (env.OPS_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''), memInfo: () => probes.memInfo(),
    tmpRoot: path.join(opsDir, 'tmp'), unloadOllama: env.OPS_RM_UNLOAD_OLLAMA === '1', log }) : null;
  let lastDecision = new Map();
  const admit = rm ? t => { const d = rm.admit(t); const prev = lastDecision.get(t.id);
    if (!d.ok && prev !== d.reason) log('info', 'resources', `Задача ждёт ресурсов (${d.cls}): ${t.title} — ${d.reason}`); lastDecision.set(t.id, d.ok ? 'ok' : d.reason); if (lastDecision.size > 500) lastDecision = new Map(); return d; } : undefined;
  const release = rm ? t => rm.release(t) : undefined;
  const timers = [];
  function start() {
    if (!rm) return; rm.refresh().catch(() => {});
    timers.push(setInterval(() => rm.refresh().catch(() => {}), +(env.OPS_RM_REFRESH_MS || 10000)).unref());
    const clean = () => { try { const r = rm.cleanupTemp({ quotaGB: +(env.OPS_TMP_QUOTA_GB || 20), ttlHours: +(env.OPS_TMP_TTL_HOURS || 48) }); if (r.removed.length) log('info', 'resources', `Очистка временных папок ops: ${r.removed.length}`); } catch (e) { log('warn', 'resources', 'Очистка tmp: ' + e.message); } };
    clean(); timers.push(setInterval(clean, 3600000).unref());
  }
  function mountMobile(app, ctx) { if (!flags.mobile) return null; return require('./mobile.js').mountMobile(app, { ...ctx, rm, env, watchdogStateFile: path.join(opsDir, 'watchdog-state.json') }); }
  const status = () => ({ flags, resources: rm ? rm.status() : null });
  return { flags, rm, admit, release, start, mountMobile, status, stop: () => timers.forEach(clearInterval) };
};
