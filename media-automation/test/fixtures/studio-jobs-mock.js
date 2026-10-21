'use strict';
/**
 * Contract-faithful MOCK of Studio services (feat/v1.2.0 docs/JOBS_API.md, "Job type video_render").
 * Not Studio code: re-implemented from the doc for tests only. Mirrors: fixed ops fields, server-computed
 * idempotencyKey <runId>:<preset>, strict input schema (400 on unknown), FIFO process-wide heavy lock
 * (withHeavy) shared by video_render/Blender/Ollama, artifact verification (one mp4/srt/jpg, absolute, inside
 * <dataDir>/media after realpath, ext=kind, size+sha256 recheck), stub failure when no executor.
 */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const err400 = m => { const e = new Error(m); e.status = 400; return e; };
function heavyLock() { let tail = Promise.resolve(); let holder = null; const waiting = []; const log = [];
  return { log, status: () => ({ holder, waiting: waiting.slice() }),
    withHeavy(label, fn) { waiting.push(label); const run = tail.then(async () => { waiting.splice(waiting.indexOf(label), 1); holder = label; log.push(['start', label]); try { return await fn(); } finally { log.push(['end', label]); holder = null; } }); tail = run.catch(() => {}); return run; } }; }
function createStudioMock({ dataDir }) {
  const lock = heavyLock(); const jobs = new Map(); let executor = null; const media = path.join(dataDir, 'media'); fs.mkdirSync(media, { recursive: true });
  const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  function verify(arts) { const kinds = ['mp4', 'srt', 'jpg']; if (!Array.isArray(arts) || arts.length !== 3 || kinds.some(k => arts.filter(a => a.kind === k).length !== 1)) throw new Error('artifacts must be exactly mp4+srt+jpg');
    const root = fs.realpathSync(media); for (const a of arts) { if (!path.isAbsolute(a.path)) throw new Error('path not absolute'); const rp = fs.realpathSync(a.path);
      if (!rp.startsWith(root + path.sep)) throw new Error('artifact outside media'); if (path.extname(rp).slice(1).toLowerCase() !== a.kind) throw new Error('ext != kind');
      if (fs.statSync(rp).size !== a.size || sha(rp) !== a.sha256) throw new Error('size/sha mismatch'); } }
  async function runVideo(j) {
    j.status = 'queued'; await lock.withHeavy('video_render:' + j.id, async () => { if (j.status === 'cancelled') return; j.status = 'running'; const ac = new AbortController(); j._ac = ac;
      try { if (!executor) throw new Error('video_render: Не подключено — executor not set');
        const r = await executor({ runId: j.input.runId, preset: j.input.preset, episodeRef: j.input.episodeRef, jobId: j.id, outDir: media, signal: ac.signal }); verify(r?.artifacts); j.artifacts = r.artifacts; j.status = 'done'; }
      catch (e) { if (e.cancelled) j.status = 'cancelled'; if (j.status !== 'cancelled') { j.status = 'failed'; j.error = e.message; j.artifacts = []; } } });
  }
  const jobsApi = {
    createJob(spec) { const { type, input = {} } = spec;
      if (type === 'video_render') {
        for (const [k, v] of Object.entries({ resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true })) if (spec[k] !== undefined && spec[k] !== v) throw err400(`${k} must be ${v}`);
        const extra = Object.keys(input).filter(k => !['runId', 'preset', 'episodeRef'].includes(k)); if (extra.length) throw err400('unknown input ' + extra);
        if (!RUN.test(input.runId || '') || input.runId.includes('..')) throw err400('bad runId'); if (!['youtube', 'shorts'].includes(input.preset)) throw err400('bad preset');
        if (!REF.test(input.episodeRef || '') || input.episodeRef.split('/').some(s => !s || s === '.' || s === '..')) throw err400('bad episodeRef');
        const key = `${input.runId}:${input.preset}`; if (spec.idempotencyKey && spec.idempotencyKey !== key) throw err400('idempotencyKey is server-computed');
        const ex = [...jobs.values()].find(j => j.idempotencyKey === key); if (ex) return { jobId: ex.id, existing: true };
        const j = { id: 'job_' + crypto.randomBytes(8).toString('hex'), type, input, idempotencyKey: key, resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true, status: 'queued', artifacts: [], createdAt: new Date().toISOString() };
        jobs.set(j.id, j); j._p = runVideo(j); return { jobId: j.id };
      }
      const j = { id: 'job_' + crypto.randomBytes(8).toString('hex'), type, input, idempotencyKey: null, resourceClass: spec.resourceClass || 'light', status: 'queued', artifacts: [] }; jobs.set(j.id, j);
      const work = async () => { j.status = 'running'; await new Promise(r => setTimeout(r, 5)); j.status = 'done'; j.result = { ok: true, input }; };
      j._p = (j.resourceClass === 'gpu_heavy' || j.resourceClass === 'llm') ? lock.withHeavy(type + ':' + j.id, work) : work(); return { jobId: j.id };
    },
    getJob(id) { const j = jobs.get(id); if (!j) return null; const { _p, _ac, status, ...rest } = j; const MAP = { done: 'succeeded', blocked: 'failed', waiting_confirmation: 'needs_approval', waiting_approval: 'needs_approval' }; return { ...rest, jobId: j.id, status: MAP[status] || status, internalStatus: status }; },
    cancelJob(id) { const j = jobs.get(id); if (j && !['done', 'failed'].includes(j.status)) { j.status = 'cancelled'; j._ac?.abort(); } return this.getJob(id); },
    listJobs({ status } = {}) { return [...jobs.values()].filter(j => !status || j.status === status).map(j => this.getJob(j.id)); },
    _wait: id => jobs.get(id)._p,
  };
  const videoRender = { setExecutor(fn) { if (typeof fn !== 'function') throw new Error('executor must be a function'); executor = fn; }, hasExecutor: () => !!executor };
  return { jobsApi, services: { jobsApi, videoRender, heavyStatus: lock.status }, lock };
}
module.exports = { createStudioMock };
