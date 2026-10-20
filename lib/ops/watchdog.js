// System Watchdog: health checks + bounded recovery actions (exponential backoff + circuit breaker) + owner notifications.
// Runs as a SEPARATE process (ops/watchdog.js, launchd example in deploy/). Read-only by default: restarts / kills are opt-in.
'use strict';
const os = require('os');
const { CircuitBreaker, backoffDelay } = require('./backoff.js');
const probes = require('./probes.js');
const GB = 1024 ** 3;
const path = require('path');
// Same default as the desktop app (desktop/main.js); repo checkout → ./data next to server.js.
const defaultDataDir = () => process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'MOONKATTY AI STUDIO') : path.join(__dirname, '..', '..', 'data');
function config(env = process.env) {
  const n = (k, d) => (env[k] !== undefined && env[k] !== '' ? +env[k] : d);
  return {
    serverUrl: (env.OPS_SERVER_URL || 'http://127.0.0.1:8787').replace(/\/$/, ''),
    ollamaUrl: (env.OPS_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    opencodeUrl: env.OPS_OPENCODE_URL ? env.OPS_OPENCODE_URL.replace(/\/$/, '') : null, // optional; 401 = alive (Basic Auth on)
    token: env.OPS_WATCHDOG_TOKEN || '',            // mobile token with scope ops:read → /api/mobile/summary
    intervalMs: n('OPS_WATCHDOG_INTERVAL_MS', 60000),
    tickStaleSec: n('OPS_TICK_STALE_SEC', 90),
    stuckTaskMin: n('OPS_STUCK_TASK_MIN', 60),
    minFreeRamGB: n('OPS_MIN_FREE_RAM_GB', 2), minFreeDiskGB: n('OPS_MIN_FREE_DISK_GB', 20),
    errorRateMax: n('OPS_ERROR_RATE_MAX', 20),      // error log lines per 10 min
    failAfter: n('OPS_FAIL_AFTER', 2),              // consecutive failures before alert/action
    watchProcs: String(env.OPS_WATCH_PROCS || 'blender,ffmpeg,opencode').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    hungProcSec: n('OPS_HUNG_PROC_SEC', 4 * 3600), hungProcMinCpu: n('OPS_HUNG_PROC_MIN_CPU', 1),
    restart: env.OPS_WATCHDOG_RESTART === '1', killHung: env.OPS_WATCHDOG_KILL_HUNG === '1',
    serverLabel: env.OPS_SERVER_LAUNCHD_LABEL || 'com.moonkatty.aistudio.server', ollamaLabel: env.OPS_OLLAMA_LAUNCHD_LABEL || '',
    dataDir: env.OPS_DATA_DIR || env.STUDIO_DATA_DIR || defaultDataDir()
  };
}
async function httpCheck(fetchFn, url, { headers = {}, timeout = 5000, aliveStatuses = [] } = {}) {
  const t0 = Date.now();
  try { const r = await fetchFn(url, { headers, signal: AbortSignal.timeout(timeout) }); let body = null; try { body = await r.json(); } catch {}
    return { ok: r.ok || aliveStatuses.includes(r.status), status: r.status, ms: Date.now() - t0, body };
  } catch (e) { return { ok: false, status: null, ms: Date.now() - t0, error: String(e.cause?.code || e.cause?.message || e.message || e.name) }; }
}
function createWatchdog({ cfg = config(), fetchFn = globalThis.fetch, exec = probes.run, now = Date.now, store, notifier, platform = process.platform,
  memInfo = () => probes.memInfo({ platform, exec }), diskInfo = () => probes.diskInfo(cfg.dataDir), processes = () => probes.processes({ exec }),
  kill = (pid, sig) => process.kill(pid, sig), uid = () => process.getuid?.() ?? 501, log = () => {} } = {}) {
  const st = Object.assign({ checks: {}, breakers: {}, alerts: [], actions: [], cycles: 0 }, store ? store.load() : {});
  const breakers = {}; const br = name => breakers[name] || (breakers[name] = new CircuitBreaker(name, { now, state: st.breakers[name] }));
  const user = os.userInfo().username;
  const checks = {
    async server() { const r = await httpCheck(fetchFn, cfg.serverUrl + '/api/health'); if (!r.ok) return { ok: false, detail: r.error || 'HTTP ' + r.status };
      const age = r.body?.lastTick ? (now() - new Date(r.body.lastTick)) / 1000 : null;
      if (age == null || age > cfg.tickStaleSec) return { ok: false, detail: `scheduler tick устарел (${age == null ? 'нет' : Math.round(age) + ' с'})`, tickStale: true, version: r.body?.version };
      return { ok: true, detail: `v${r.body?.version}, tick ${Math.round(age)} с` }; },
    async ollama() { const r = await httpCheck(fetchFn, cfg.ollamaUrl + '/api/tags'); return r.ok ? { ok: true, detail: (r.body?.models || []).length + ' моделей' } : { ok: false, detail: r.error || 'HTTP ' + r.status }; },
    async opencode() { if (!cfg.opencodeUrl) return { ok: true, skipped: true, detail: 'не настроен' };
      const r = await httpCheck(fetchFn, cfg.opencodeUrl + '/global/health', { aliveStatuses: [401, 403] }); return { ok: r.ok, detail: r.error || 'HTTP ' + r.status }; },
    async memory() { const m = await memInfo(); const free = m.available / GB; return { ok: free >= cfg.minFreeRamGB, detail: `свободно ${free.toFixed(1)} ГБ из ${(m.total / GB).toFixed(0)}`, availableGB: +free.toFixed(2) }; },
    async disk() { const d = diskInfo(); const free = d.free / GB; return { ok: free >= cfg.minFreeDiskGB, detail: `свободно ${free.toFixed(0)} ГБ`, freeGB: +free.toFixed(1) }; },
    async processes() { let list; try { list = await processes(); } catch (e) { return { ok: true, skipped: true, detail: 'ps недоступен: ' + e.message }; }
      const watched = list.filter(p => p.user === user && cfg.watchProcs.some(n => p.comm.toLowerCase().split('/').pop().startsWith(n)));
      const hung = watched.filter(p => p.etimeSec > cfg.hungProcSec && p.cpu < cfg.hungProcMinCpu);
      return { ok: !hung.length, detail: `${watched.length} наблюдаемых, зависших ${hung.length}`, blender: watched.filter(p => /blender/i.test(p.comm)).length,
        hung: hung.map(p => ({ pid: p.pid, comm: p.comm.split('/').pop(), etimeSec: p.etimeSec, cpu: p.cpu })) }; },
    async queue() { if (!cfg.token) return { ok: true, skipped: true, detail: 'OPS_WATCHDOG_TOKEN не задан' };
      const r = await httpCheck(fetchFn, cfg.serverUrl + '/api/mobile/summary', { headers: { authorization: 'Bearer ' + cfg.token } });
      if (!r.ok) return { ok: false, detail: 'summary: ' + (r.error || 'HTTP ' + r.status) };
      const stuck = (r.body.tasks?.stuck || []).filter(t => t.minutes >= cfg.stuckTaskMin); const errs = r.body.errors?.last10min ?? 0;
      return { ok: !stuck.length && errs <= cfg.errorRateMax, detail: `зависших задач ${stuck.length}, ошибок за 10 мин ${errs}`, stuck, errorRate: errs }; }
  };
  const record = (arr, x) => { arr.push(x); while (arr.length > 200) arr.shift(); };
  async function act(name, fn, why) {
    const b = br(name); if (!b.canAttempt()) { return { skipped: 'circuit-open', breaker: b.toJSON() }; }
    const prev = st.actions.filter(a => a.name === name && now() - Date.parse(a.at) < 3600000).length; const wait = backoffDelay(prev, { baseMs: 60000, maxMs: 30 * 60000 });
    const last = st.actions.filter(a => a.name === name).pop(); if (last && now() - Date.parse(last.at) < wait) return { skipped: 'backoff', waitMs: wait - (now() - Date.parse(last.at)) };
    let ok = false, error = null; try { await fn(); ok = true; } catch (e) { error = e.message; }
    record(st.actions, { at: new Date(now()).toISOString(), name, why, ok, error });
    if (!ok) { if (b.failure() && notifier) await notifier.notify({ key: 'breaker:' + name, level: 'critical', title: `Watchdog: авто-восстановление «${name}» остановлено`, body: 'Circuit breaker открыт. Нужна ручная проверка на Mac mini.' }); }
    return { ok, error };
  }
  async function cycle() {
    st.cycles++; const out = {};
    for (const [name, fn] of Object.entries(checks)) {
      let r; try { r = await fn(); } catch (e) { r = { ok: false, detail: 'check error: ' + e.message }; }
      const prev = st.checks[name] || { fails: 0 }; const fails = r.ok ? 0 : (prev.fails || 0) + 1;
      st.checks[name] = { ...r, fails, at: new Date(now()).toISOString() }; out[name] = st.checks[name];
      if (!r.ok && fails === cfg.failAfter) { record(st.alerts, { at: st.checks[name].at, check: name, level: 'error', detail: r.detail });
        if (notifier) await notifier.notify({ key: 'down:' + name, level: 'warn', title: `MOONKATTY: проблема — ${name}`, body: r.detail }); }
      if (r.ok && prev.fails >= cfg.failAfter) { record(st.alerts, { at: st.checks[name].at, check: name, level: 'info', detail: 'восстановлено' }); br('restart:' + name).success();
        if (notifier) await notifier.notify({ key: 'up:' + name + ':' + st.cycles, level: 'info', title: `MOONKATTY: восстановлено — ${name}`, body: r.detail }); }
    }
    // recovery actions (opt-in)
    if (cfg.restart && out.server.fails >= cfg.failAfter) out.server.action = await act('restart:server', () => exec('/bin/launchctl', ['kickstart', '-k', `gui/${uid()}/${cfg.serverLabel}`], 20000), out.server.detail);
    if (cfg.restart && cfg.ollamaLabel && out.ollama.fails >= cfg.failAfter) out.ollama.action = await act('restart:ollama', () => exec('/bin/launchctl', ['kickstart', '-k', `gui/${uid()}/${cfg.ollamaLabel}`], 20000), out.ollama.detail);
    if (cfg.killHung && out.processes.hung?.length) for (const p of out.processes.hung) out.processes.action = await act('kill:' + p.comm, async () => kill(p.pid, 'SIGTERM'), `pid ${p.pid} ${p.etimeSec}s`);
    for (const [k, b] of Object.entries(breakers)) st.breakers[k] = b.toJSON();
    st.lastCycleAt = new Date(now()).toISOString(); if (store) store.save(st); return out;
  }
  return { cycle, state: st, checks, breaker: br, config: cfg };
}
module.exports = { createWatchdog, config, httpCheck };
