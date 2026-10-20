// Resource Manager: RAM-aware admission control for heavy tasks on a 24 GB unified-memory Mac mini.
// Pure, synchronous admit()/release() (called from runner.tick) + async background refresh of memory / Ollama /api/ps.
'use strict';
const fs = require('fs'), path = require('path');
const GB = 1024 ** 3;
const PROFILE_24GB = {
  totalGB: 24, reserveGB: 6,            // macOS + server + browser headroom; budget for tasks = 18 GB
  minAvailableGB: 2,                    // never admit if real available RAM would drop below this
  classes: {
    light:       { memGB: 0.5, max: 4 },
    'llm-large': { memGB: 10,  max: 1 }, // e.g. qwen3:14b/32b-q4 — accounted via Ollama /api/ps when loaded
    render:      { memGB: 8,   max: 1 }, // Blender
    video:       { memGB: 6,   max: 1 }  // ffmpeg / Video Factory
  },
  exclusive: [['llm-large', 'render']], // never together on 24 GB
  urgentExtraLight: 2                   // urgent light tasks may exceed light.max by this many
};
const HEAVY = new Set(['llm-large', 'render', 'video']);
const AGENT_CLASS = { design3d: 'render', video: 'video', news: 'llm-large', content: 'llm-large', director: 'llm-large' };
function classOf(task, profile = PROFILE_24GB) {
  if (task.resourceClass && profile.classes[task.resourceClass]) return task.resourceClass;
  if (task.kind === 'render') return 'render'; if (task.kind === 'video') return 'video';
  return AGENT_CLASS[task.agentId] || 'light';
}
const ORDER = { urgent: 0, high: 1, normal: 2, low: 3 };
function createResourceManager({ profile = PROFILE_24GB, ollamaUrl = 'http://127.0.0.1:11434', fetchFn = globalThis.fetch, memInfo, tmpRoot, now = Date.now,
  unloadOllama = false, log = () => {} } = {}) {
  const running = new Map();            // taskId → { cls, memGB, at }
  const cache = { availableGB: null, ollamaLoaded: [], ollamaGB: 0, refreshedAt: 0 };
  const budget = profile.totalGB - profile.reserveGB;
  const count = cls => [...running.values()].filter(r => r.cls === cls).length;
  const reservedGB = () => [...running.values()].reduce((a, r) => a + r.memGB, 0);
  let unloading = null;
  function decide(task) {
    const cls = classOf(task, profile); const c = profile.classes[cls]; const urgent = task.priority === 'urgent';
    const max = c.max + (cls === 'light' && urgent ? profile.urgentExtraLight : 0);
    if (count(cls) >= max) return { ok: false, cls, reason: `лимит параллельности ${cls}: ${max}` };
    for (const grp of profile.exclusive) if (grp.includes(cls) && grp.some(o => o !== cls && count(o) > 0)) return { ok: false, cls, reason: `${cls} несовместим с выполняемым ${grp.filter(o => o !== cls).join('/')}` };
    // LLM memory already resident in Ollama counts against the budget (unless this task is the LLM one using it)
    const ollamaGB = cls === 'llm-large' ? 0 : cache.ollamaGB;
    if (reservedGB() + c.memGB + ollamaGB > budget) {
      if (HEAVY.has(cls) && cache.ollamaGB > 0 && !count('llm-large')) return { ok: false, cls, reason: 'ожидание выгрузки моделей Ollama', needUnload: true };
      return { ok: false, cls, reason: `бюджет RAM: занято ${(reservedGB() + ollamaGB).toFixed(1)} + ${c.memGB} > ${budget} ГБ` };
    }
    if (HEAVY.has(cls) && cache.availableGB != null && cache.availableGB - c.memGB < profile.minAvailableGB) return { ok: false, cls, reason: `мало свободной RAM: ${cache.availableGB.toFixed(1)} ГБ` };
    return { ok: true, cls, memGB: c.memGB };
  }
  function admit(task) {
    const d = decide(task);
    if (d.ok) running.set(task.id, { cls: d.cls, memGB: d.memGB, at: now() });
    else if (d.needUnload && unloadOllama && !unloading) unloading = unloadAll().finally(() => { unloading = null; });
    return d;
  }
  const release = task => running.delete(task.id || task);
  // Render/video queue: urgent first, then priority, then FIFO. Light tasks are not queued here.
  function renderQueue(tasks) { return tasks.filter(t => t.status === 'queued' && ['render', 'video'].includes(classOf(t, profile)))
    .sort((a, b) => (ORDER[a.priority] ?? 2) - (ORDER[b.priority] ?? 2) || String(a.createdAt).localeCompare(String(b.createdAt))); }
  async function ollamaPs() {
    const r = await fetchFn(ollamaUrl + '/api/ps', { signal: AbortSignal.timeout(3000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
    const models = ((await r.json()).models || []).map(m => ({ name: m.name || m.model, sizeGB: +((m.size_vram || m.size || 0) / GB).toFixed(2), expiresAt: m.expires_at }));
    return models;
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
    try { if (memInfo) cache.availableGB = (await memInfo()).available / GB; } catch {}
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
  function status() { return { profile: { totalGB: profile.totalGB, budgetGB: budget }, running: [...running.entries()].map(([id, r]) => ({ taskId: id, ...r })), reservedGB: reservedGB(),
    availableGB: cache.availableGB == null ? null : +cache.availableGB.toFixed(2), ollama: { loaded: cache.ollamaLoaded, totalGB: +cache.ollamaGB.toFixed(2) }, refreshedAt: cache.refreshedAt ? new Date(cache.refreshedAt).toISOString() : null }; }
  return { admit, release, decide, classOf: t => classOf(t, profile), renderQueue, refresh, unloadAll, ollamaPs, tempDir, cleanupTemp, status, running, cache };
}
module.exports = { createResourceManager, classOf, PROFILE_24GB };
