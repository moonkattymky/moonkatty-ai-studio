// Resource Manager: admission control for heavy tasks (Ollama / Blender / FFmpeg) on a Mac mini with 24 GB unified memory.
// No arbitrary GB limits: heavy-class footprints are "unmeasured" until calibrated with scripts/ops/loadtest.mjs
// (limit = measured peak × 1.2). Until then: at most ONE heavy task at a time. Heavy tasks never start when
// memory pressure is not green or swap is growing. Light tasks: concurrency limit only.
'use strict';
const fs = require('fs'), path = require('path');
const GB = 1024 ** 3, MB = 1024 ** 2;
const HEAVY = ['llm-large', 'render', 'video'];
const PROFILE = {
  light: { memGB: 0.5, max: 4 }, urgentExtraLight: 2,
  heavyMaxPerClass: 1, minAvailableGB: 2, swapGrowthMaxMB: +(process.env.OPS_SWAP_GROWTH_MAX_MB || 256)
};
const COMPONENT = { 'llm-large': 'ollama', render: 'blender', video: 'ffmpeg' };
const AGENT_CLASS = { design3d: 'render', video: 'video', news: 'llm-large', content: 'llm-large', director: 'llm-large' };
function classOf(task) {
  if (task.resourceClass && (task.resourceClass === 'light' || HEAVY.includes(task.resourceClass))) return task.resourceClass;
  if (task.kind === 'render') return 'render'; if (task.kind === 'video') return 'video';
  return AGENT_CLASS[task.agentId] || 'light';
}
const ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
function validateCalibration(c) {
  if (!c || typeof c !== 'object' || !c.classes || typeof c.classes !== 'object') throw new Error('calibration: нет classes');
  const out = { measuredAt: String(c.measuredAt || ''), machine: String(c.machine || '').slice(0, 120), source: String(c.source || 'loadtest').slice(0, 60), classes: {} };
  for (const [k, v] of Object.entries(c.classes)) { if (!HEAVY.includes(k)) continue; const peak = +v.peakGB, lim = +v.limitGB;
    if (!(peak > 0 && peak < 64 && lim >= peak && lim < 80)) throw new Error('calibration: неверные значения ' + k); out.classes[k] = { peakGB: peak, limitGB: lim }; }
  if (c.combos && typeof c.combos === 'object') out.combos = Object.fromEntries(Object.entries(c.combos).map(([k, v]) => [String(k).slice(0, 60), { safe: v.safe === true }]));
  return out;
}
function createResourceManager({ profile = PROFILE, ollamaUrl = 'http://127.0.0.1:11434', fetchFn = globalThis.fetch, memInfo, tmpRoot, now = Date.now,
  unloadOllama = false, calibrationFile, log = () => {} } = {}) {
  const running = new Map(); // taskId → { cls, memGB, at }
  const cache = { availableGB: null, totalGB: null, pressure: null, ollamaLoaded: [], ollamaGB: 0, refreshedAt: 0 };
  const swapHist = []; let calibration = null; let unloading = null;
  const loadCalibration = () => { if (!calibrationFile) return; try { calibration = validateCalibration(JSON.parse(fs.readFileSync(calibrationFile, 'utf8'))); } catch (e) { if (e.code !== 'ENOENT') log('warn', 'resources', 'Калибровка не загружена: ' + e.message); calibration = null; } };
  loadCalibration();
  const limitOf = cls => calibration?.classes?.[cls]?.limitGB ?? null;
  const calibrated = () => HEAVY.every(c => limitOf(c) != null);
  const count = cls => [...running.values()].filter(r => r.cls === cls).length;
  const heavyCount = () => [...running.values()].filter(r => HEAVY.includes(r.cls)).length;
  const swapGrowthMB = () => swapHist.length < 2 ? 0 : Math.max(0, (swapHist[swapHist.length - 1].v - Math.min(...swapHist.map(h => h.v))) / MB);
  function decide(task) {
    const cls = classOf(task); const urgent = task.priority === 'urgent';
    if (cls === 'light') { const max = profile.light.max + (urgent ? profile.urgentExtraLight : 0);
      return count('light') >= max ? { ok: false, cls, reason: `лимит параллельности light: ${max}` } : { ok: true, cls, memGB: profile.light.memGB }; }
    if (cache.pressure && cache.pressure !== 'green') return { ok: false, cls, reason: `давление памяти: ${cache.pressure} — тяжёлые задачи не запускаются` };
    if (swapGrowthMB() > profile.swapGrowthMaxMB) return { ok: false, cls, reason: `swap растёт (+${swapGrowthMB().toFixed(0)} МБ за 5 мин)` };
    if (count(cls) >= profile.heavyMaxPerClass) return { ok: false, cls, reason: `уже выполняется задача ${cls}` };
    const lim = limitOf(cls);
    if (!calibrated() || lim == null || cache.availableGB == null) {
      if (heavyCount() >= 1) return { ok: false, cls, reason: 'калибровка не выполнена — не более 1 тяжёлой задачи одновременно (scripts/ops/loadtest.mjs)' };
      return { ok: true, cls, memGB: lim, footprint: lim == null ? 'unmeasured' : lim };
    }
    // calibrated: real available memory minus footprints of heavy tasks admitted recently (not yet visible in vm_stat)
    const pending = [...running.values()].filter(r => HEAVY.includes(r.cls) && now() - r.at < 60000).reduce((a, r) => a + (r.memGB || 0), 0);
    if (cache.availableGB - pending - lim < profile.minAvailableGB) {
      const d = { ok: false, cls, reason: `мало памяти: доступно ${cache.availableGB.toFixed(1)} ГБ, нужно ${lim} + резерв ${profile.minAvailableGB}` };
      if (cls !== 'llm-large' && cache.ollamaGB > 0 && !count('llm-large')) d.needUnload = true; return d;
    }
    return { ok: true, cls, memGB: lim, footprint: lim };
  }
  function admit(task) {
    const d = decide(task);
    if (d.ok) running.set(task.id, { cls: d.cls, memGB: d.memGB, at: now() });
    else if (d.needUnload && unloadOllama && !unloading) unloading = unloadAll().finally(() => { unloading = null; }); // only with explicit opt-in
    return d;
  }
  const release = task => running.delete(task.id || task);
  function renderQueue(tasks) { return tasks.filter(t => t.status === 'queued' && ['render', 'video'].includes(classOf(t)))
    .sort((a, b) => (ORDER[a.priority] ?? 2) - (ORDER[b.priority] ?? 2) || String(a.createdAt).localeCompare(String(b.createdAt))); }
  async function ollamaPs() {
    const r = await fetchFn(ollamaUrl + '/api/ps', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    return ((await r.json()).models || []).map(m => ({ name: m.name || m.model, sizeGB: +((m.size_vram || m.size || 0) / GB).toFixed(2), expiresAt: m.expires_at }));
  }
  async function unloadAll() {
    const out = [];
    for (const m of cache.ollamaLoaded) {
      try { const r = await fetchFn(ollamaUrl + '/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(15000) });
        out.push({ model: m.name, ok: r.ok }); log('info', 'resources', `Ollama: выгрузка модели ${m.name} (keep_alive:0) — ${r.ok ? 'OK' : 'HTTP ' + r.status}`);
      } catch (e) { out.push({ model: m.name, ok: false, error: e.name }); }
    }
    await refresh(); return out;
  }
  async function refresh() {
    loadCalibration();
    try { if (memInfo) { const m = await memInfo(); cache.availableGB = m.available / GB; cache.totalGB = m.total / GB; cache.pressure = m.pressure || null; cache.memory = m.stats || null;
      if (m.swapUsed != null) { swapHist.push({ t: now(), v: m.swapUsed }); while (swapHist.length && now() - swapHist[0].t > 5 * 60000) swapHist.shift(); } } } catch {}
    try { cache.ollamaLoaded = await ollamaPs(); cache.ollamaGB = cache.ollamaLoaded.reduce((a, m) => a + m.sizeGB, 0); } catch { cache.ollamaLoaded = []; cache.ollamaGB = 0; }
    cache.refreshedAt = now(); return status();
  }
  // ---- temp dirs: only our own root, only dirs carrying our marker ----
  const MARK = '.mk-ops-tmp';
  function tempDir(taskId) {
    if (!tmpRoot) throw new Error('tmpRoot не задан'); const id = String(taskId).replace(/[^\w-]/g, '_').slice(0, 80) || 'task';
    const d = path.join(tmpRoot, id); fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(d, MARK), JSON.stringify({ taskId, createdAt: now() })); return d;
  }
  const dirSize = d => { let n = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isSymbolicLink()) continue; n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size; } return n; };
  function cleanupTemp({ quotaGB = 20, ttlHours = 48, active = [...running.keys()] } = {}) {
    if (!tmpRoot || !fs.existsSync(tmpRoot)) return { removed: [], usedGB: 0 };
    const root = fs.realpathSync(tmpRoot); const removed = []; const act = new Set(active.map(x => String(x).replace(/[^\w-]/g, '_')));
    const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink()).map(e => path.join(root, e.name))
      .filter(d => fs.realpathSync(d).startsWith(root + path.sep) && fs.existsSync(path.join(d, MARK)) && !act.has(path.basename(d)))
      .map(d => { let m = {}; try { m = JSON.parse(fs.readFileSync(path.join(d, MARK), 'utf8')); } catch {} return { d, createdAt: m.createdAt || 0, size: dirSize(d) }; })
      .sort((a, b) => a.createdAt - b.createdAt);
    let used = dirs.reduce((a, x) => a + x.size, 0);
    for (const x of dirs) { const old = now() - x.createdAt > ttlHours * 3600000; if (old || used > quotaGB * GB) { fs.rmSync(x.d, { recursive: true, force: true }); used -= x.size; removed.push(path.basename(x.d)); } }
    return { removed, usedGB: +(used / GB).toFixed(2) };
  }
  function status() {
    return { mode: calibrated() ? 'calibrated' : 'uncalibrated (max 1 heavy)', running: [...running.entries()].map(([id, r]) => ({ taskId: id, ...r })),
      availableGB: cache.availableGB == null ? null : +cache.availableGB.toFixed(2), totalGB: cache.totalGB == null ? null : +cache.totalGB.toFixed(1), pressure: cache.pressure, swapGrowthMB: +swapGrowthMB().toFixed(1),
      footprints: Object.fromEntries(HEAVY.map(c => [c, limitOf(c) == null ? 'unmeasured' : { limitGB: limitOf(c), peakGB: calibration.classes[c].peakGB, component: COMPONENT[c] }])),
      calibration: calibration ? { measuredAt: calibration.measuredAt, machine: calibration.machine, combos: calibration.combos || null } : null,
      ollama: { loaded: cache.ollamaLoaded, totalGB: +cache.ollamaGB.toFixed(2), autoUnload: !!unloadOllama }, refreshedAt: cache.refreshedAt ? new Date(cache.refreshedAt).toISOString() : null };
  }
  return { admit, release, decide, classOf, renderQueue, refresh, unloadAll, ollamaPs, tempDir, cleanupTemp, status, running, cache, setCalibration: c => { calibration = validateCalibration(c); return calibration; } };
}
module.exports = { createResourceManager, classOf, validateCalibration, PROFILE, HEAVY, COMPONENT };
