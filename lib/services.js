// Stable in-process service API (shared with feat/media-automation). Names agreed with the parent plan:
//   jobsApi.createJob({type, agent, input, timeoutSec, maxAttempts}) -> {jobId}
//   jobsApi.getJob(jobId) / cancelJob(jobId) / listJobs({status})
//   statuses (public): queued | running | needs_approval | succeeded | failed | cancelled
//   blenderService.detectBlender() -> {path, version, pythonOk}
//   blenderService.runTemplate({template, params, projectId}) -> {versionDir, blendPath, pngPath?, glbPath?, log}
//   host3d.renderSegment({script, audioPath, durationSec, aspect, outPath}) -> {videoPath} | null   (STUB: job type 'render_segment' reserved)
// Heavy work (Blender, Ollama) is serialized process-wide by lib/heavy-lock.js.
'use strict';
const fs = require('fs'), path = require('path'), SP = require('./scene-params.js'), VR = require('./video-render.js'), { withHeavy } = require('./heavy-lock.js');
const PUBLIC = { queued: 'queued', running: 'running', waiting_confirmation: 'needs_approval', waiting_approval: 'needs_approval', done: 'succeeded', failed: 'failed', blocked: 'failed', cancelled: 'cancelled', rejected: 'cancelled' };
// type -> defaults for the optional ops fields (feat/studio-operations)
const TYPES = {
  design3d: { resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true },          // full pipeline: OpenCode agent + Blender
  blender_template: { resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true },  // vetted template only (new version dir each run)
  opencode_task: { resourceClass: 'llm', requiresNode: 'mac-mini', safeToRetry: false, stub: 'opencode_task: зарезервировано (отдельные задачи OpenCode вне 3D-конвейера), не реализовано в 1.2.0' },
  render_segment: { resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true, stub: 'render_segment: зарезервировано для feat/media-automation (Host3D.renderSegment), не реализовано в 1.2.0' },
  // feat/media-automation INTEGRATION.md §10. Fixed ops fields; runs under the global heavy lock (never overlaps Blender/Ollama).
  video_render: { resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true, fixed: true, exclusive: true }
};
const RC = ['gpu_heavy', 'llm', 'light'];
const G3D = require('./feature-gate.js');
module.exports = function createServices({ jobs, design3d, runner, blender, ws, get, put, core, log, mediaRoot }) {
  if (mediaRoot) fs.mkdirSync(mediaRoot, { recursive: true, mode: 0o700 });
  const running = new Map(); // blender_template jobs: jobId -> AbortController
  const pub = j => j && { jobId: j.id, type: j.kind === '3d' ? 'design3d' : j.kind, resourceClass: j.resourceClass, requiresNode: j.requiresNode, idempotencyKey: j.idempotencyKey, safeToRetry: j.safeToRetry, status: PUBLIC[j.status] || j.status, internalStatus: j.status, stage: j.stage, attempt: j.attempt, maxAttempts: j.maxAttempts,
    error: j.error, blocked: j.status === 'blocked', artifacts: j.artifacts, taskId: j.taskId, createdAt: j.createdAt, updatedAt: j.updatedAt };
  const jobsApi = {
    createJob({ type, agent = 'design3d', input = {}, timeoutSec, maxAttempts, resourceClass, requiresNode, idempotencyKey, safeToRetry } = {}) {
      const def = TYPES[type]; if (!def) throw new Error('Неизвестный тип задания: ' + type);
      if (G3D.is3dType(type)) G3D.assert3dAllowed('jobsApi.createJob:' + type); // shared 3D gate (any internal caller too)
      if (resourceClass != null && !RC.includes(resourceClass)) throw new Error('resourceClass: ' + RC.join('|'));
      if (requiresNode != null && !/^[A-Za-z0-9._-]{1,64}$/.test(requiresNode)) throw new Error('requiresNode: имя узла');
      let vin;
      if (type === 'video_render') { const v = VR.validateInput(input); if (!v.ok) throw new Error('video_render: ' + v.errors.join('; ')); vin = v.input;
        if (resourceClass != null && resourceClass !== def.resourceClass) throw new Error('video_render: resourceClass только gpu_heavy');
        if (requiresNode != null && requiresNode !== def.requiresNode) throw new Error('video_render: requiresNode только mac-mini');
        if (safeToRetry != null && safeToRetry !== true) throw new Error('video_render: safeToRetry только true');
        const k = VR.idempotencyKey(vin); if (idempotencyKey != null && idempotencyKey !== k) throw new Error('video_render: idempotencyKey должен быть <runId>:<preset> (' + k + ')'); idempotencyKey = k; }
      if (idempotencyKey != null) { if (!/^[\x21-\x7e]{1,128}$/.test(idempotencyKey)) throw new Error('idempotencyKey: 1–128 печатных символов'); const ex = jobs.byKey(idempotencyKey); if (ex) return { jobId: ex.id, existing: true }; }
      const kind = type === 'design3d' ? '3d' : type;
      const t = put('tasks', { id: core.uid(), kind, title: String(input.text || input.title || type).slice(0, 120), description: String(input.text || '').slice(0, 1000), agentId: G3D.is3dType(type) ? (type === 'design3d' ? agent : 'design3d') : (agent && agent !== 'design3d' ? agent : 'video'), priority: 'normal', status: type === 'design3d' ? 'queued' : 'in_progress', project: 'main', schedule: { type: 'none' }, createdAt: core.now(), source: 'api' });
      const j = jobs.create(t.id, kind, type === 'design3d' ? 'preflight' : type);
      const patch = { resourceClass: resourceClass || def.resourceClass, requiresNode: requiresNode === undefined ? def.requiresNode : requiresNode, idempotencyKey: idempotencyKey || null, safeToRetry: safeToRetry === undefined ? def.safeToRetry : !!safeToRetry, input: vin ? vin : type === 'blender_template' ? { template: input.template || 'scene_basic', params: input.params || {}, projectId: input.projectId || null } : { text: String(input.text || '').slice(0, 1000) } };
      if (Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 5) patch.maxAttempts = maxAttempts;
      if (Number.isFinite(timeoutSec) && timeoutSec > 0) patch.checkpoint = { timeoutSec: Math.min(timeoutSec, 6 * 3600) };
      if (def.stub) { Object.assign(patch, { status: 'failed', error: def.stub }); Object.assign(t, { status: 'blocked', blockedReason: def.stub }); put('tasks', t); }
      jobs.update(j.id, patch);
      if (type === 'design3d') { const a = get('agents', agent); if (a && a.status !== 'working' && a.enabled) runner.start(agent, 'api'); else runner.tick(); }
      if (type === 'blender_template') startTemplateJob(j.id);
      if (type === 'video_render') startVideoJob(j.id);
      log('info', 'jobs', `Создано задание ${type}: ${t.title}`); return { jobId: j.id };
    },
    getJob: id => pub(jobs.get(id)),
    cancelJob(id) { const j = jobs.get(id); if (!j) return null; const rc = running.get(id); if (rc) rc.abort(); const t = get('tasks', j.taskId); if (t && !['done', 'cancelled'].includes(t.status)) { t.status = 'cancelled'; put('tasks', t); }
      design3d.cancelJob(id); runner.cancelTask(j.taskId); return pub(jobs.get(id)); },
    listJobs({ status, limit = 100 } = {}) { return jobs.list(limit).map(pub).filter(j => !status || j.status === status || j.internalStatus === status); },
    PUBLIC_STATUSES: ['queued', 'running', 'needs_approval', 'succeeded', 'failed', 'cancelled']
  };
  const blenderService = {
    async detectBlender() { const b = await blender.detect((get('integrations', 'blender') || {}).path); return { path: b.bin || null, version: b.version || null, pythonOk: !!b.ok, engines: b.engines || [], error: b.error || null }; },
    async runTemplate({ template = 'scene_basic', params = {}, projectId, signal, timeoutSec } = {}) {
      G3D.assert3dAllowed('services.blender.runTemplate');
      if (template !== 'scene_basic') throw new Error('Неизвестный шаблон: ' + template);
      const v = SP.validate(params); if (!v.ok) throw new Error('Параметры не прошли проверку: ' + v.errors.join('; '));
      const b = await blender.detect((get('integrations', 'blender') || {}).path); if (!b.ok) throw new Error(b.error);
      const ver = ws.newVersion(projectId || 'p_api'); const pf = path.join(ver.dir, 'logs', 'params.validated.json'); fs.writeFileSync(pf, JSON.stringify(v.params));
      const o = { signal, timeoutMs: (timeoutSec || 900) * 1000 };
      await blender.runTemplate(b.bin, template, 'build', pf, ver.dir, o); const r = await blender.runTemplate(b.bin, template, 'render', pf, ver.dir, o);
      const at = f => fs.existsSync(path.join(ver.dir, f)) ? path.join(ver.dir, f) : undefined;
      return { versionDir: ver.dir, version: ver.version, blendPath: path.join(ver.dir, 'scene.blend'), pngPath: at('renders/preview.png'), glbPath: at('exports/scene.glb'), log: path.join(ver.dir, 'logs', 'render-blender.log'), files: r.files };
    }
  };
  // blender_template job runner (no OpenCode). Each run writes a NEW version dir, so a retry/resume is idempotent.
  function startTemplateJob(id) {
    const j = jobs.get(id); if (!j || running.has(id)) return; const ac = new AbortController(); running.set(id, ac);
    jobs.update(id, { status: 'running', attempt: j.attempt + 1 }); jobs.event(id, 'info', 'blender_template', 'Запуск шаблона ' + j.input.template);
    blenderService.runTemplate({ ...j.input, signal: ac.signal, timeoutSec: j.checkpoint.timeoutSec })
      .then(r => { const arts = r.files.concat('scene.blend').map(f => design3d.artifact(r.versionDir, f)); jobs.update(id, { status: 'waiting_approval', artifacts: arts, checkpoint: { ...j.checkpoint, vdir: r.versionDir, version: r.version, projectId: j.input.projectId || 'p_api' } });
        jobs.event(id, 'info', 'blender_template', `Готово: ${r.versionDir} (${arts.length} файлов)`); const t = get('tasks', j.taskId); if (t) { Object.assign(t, { status: 'waiting_approval', result: r.versionDir, jobId: id }); put('tasks', t); } })
      .catch(e => { const c = jobs.get(id).status === 'cancelled'; if (!c) jobs.update(id, { status: 'failed', error: e.message }); jobs.event(id, c ? 'warn' : 'error', 'blender_template', c ? 'Отменено' : 'Ошибка: ' + e.message);
        const t = get('tasks', j.taskId); if (t && t.status === 'in_progress') { Object.assign(t, { status: c ? 'cancelled' : 'failed', error: e.message }); put('tasks', t); } })
      .finally(() => running.delete(id));
  }
  // video_render: queued until it holds the global heavy lock (strictly one heavy job at a time: no overlap with
  // other video_render, Blender (design3d/blender_template) or Ollama). Result artifacts are schema-checked.
  function startVideoJob(id) {
    const j = jobs.get(id); if (!j || running.has(id)) return; const ac = new AbortController(); running.set(id, ac);
    jobs.event(id, 'info', 'video_render', 'В очереди тяжёлых заданий (ожидание блокировки GPU/памяти)');
    withHeavy('video_render:' + id, async () => {
      if (jobs.get(id).status === 'cancelled') return;
      jobs.update(id, { status: 'running', attempt: jobs.get(id).attempt + 1 }); jobs.event(id, 'info', 'video_render', `Рендер ${j.input.preset}: run ${j.input.runId}, ${j.input.episodeRef}`);
      const r = await VR.getExecutor()({ ...j.input, jobId: id, outDir: mediaRoot, signal: ac.signal });
      if (!mediaRoot) throw new Error('video_render: рабочая папка media не настроена');
      const v = VR.validateArtifacts(r && r.artifacts, mediaRoot); if (!v.ok) throw new Error('video_render: неверный результат: ' + v.errors.join('; '));
      jobs.update(id, { status: 'done', artifacts: v.artifacts }); jobs.event(id, 'info', 'video_render', 'Готово: ' + v.artifacts.length + ' файла');
      const t = get('tasks', j.taskId); if (t) { Object.assign(t, { status: 'done', jobId: id }); put('tasks', t); }
    }, ac.signal)
      .catch(e => { const c = jobs.get(id).status === 'cancelled' || e.cancelled; if (c) jobs.update(id, { status: 'cancelled' }); else jobs.update(id, { status: 'failed', error: e.message });
        jobs.event(id, c ? 'warn' : 'error', 'video_render', c ? 'Отменено' : 'Ошибка: ' + e.message);
        const t = get('tasks', j.taskId); if (t && t.status === 'in_progress') { Object.assign(t, { status: c ? 'cancelled' : 'failed', error: e.message }); put('tasks', t); } })
      .finally(() => running.delete(id));
  }
  // after restart: queued blender_template jobs (were running) are re-run when safeToRetry, else marked failed
  function resume() { for (const j of jobs.list(500)) if (['blender_template', 'video_render'].includes(j.kind) && j.status === 'queued') { if (j.safeToRetry) (j.kind === 'video_render' ? startVideoJob : startTemplateJob)(j.id); else jobs.update(j.id, { status: 'failed', error: 'Прервано перезапуском; задание помечено safeToRetry=false' }); } }
  const host3d = { async renderSegment() { return null; } }; // reserved stub for feat/media-automation
  return { jobsApi, blenderService, host3d, PUBLIC, TYPES, resume, startVideoJob, videoRender: VR, heavyStatus: require('./heavy-lock.js').status };
};
