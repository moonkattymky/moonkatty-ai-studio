'use strict';
/**
 * JobsApiQueue — queue backend on top of Studio's in-process jobsApi (feat/v1.2.0 docs/JOBS_API.md).
 * BEHIND A FLAG, DEFAULT OFF: selectJobQueue() returns the existing LocalJobQueue unless MA_JOBS_BACKEND=jobsapi
 * AND a jobsApi client is injected. The local queue is untouched and remains the default/fallback.
 *
 * PROVISIONAL (not confirmed by Studio): job type names and resource classes. Both are configurable via
 * `typeMap` / `resourceClasses` (or MA_JOBS_TYPE_MAP / MA_JOBS_RESOURCE_CLASS JSON env). Defaults below are our proposal.
 * Rules enforced here:
 *  - idempotency: video_render key is SERVER-ASSIGNED (<runId>:<preset>), never sent; other types: client key, 1..128 printable ASCII.
 *  - Registered in Studio @322023f: design3d, blender_template, opencode_task, render_segment, video_render.
 *    PROPOSED (not registered yet): news_collect/news_script (llm), tts (gpu_heavy), publish_dry_run (light, no network).
 *  - publish_dry_run jobs are dry-run only: input.dryRun is forced true, any live flag -> rejected before submit.
 *  - tts and video render are heavy: resourceClass 'gpu_heavy' => Studio's shared heavy lock (withHeavy) serializes them
 *    with Blender and Ollama.
 */
const { waitForJob } = require('./port');
const { StudioJobQueueAdapter } = require('./studio-adapter');
const PROVISIONAL = true;
const REGISTERED = new Set(['design3d', 'blender_template', 'opencode_task', 'render_segment', 'video_render']);
const DEFAULT_TYPE_MAP = { video_render: 'video_render', tts: 'tts', publish_dry_run: 'publish_dry_run', render_segment: 'render_segment', news_collect: 'news_collect', news_script: 'news_script' };
const DEFAULT_RESOURCE = { video_render: 'gpu_heavy', tts: 'gpu_heavy', render_segment: 'gpu_heavy', news_collect: 'llm', news_script: 'llm', publish_dry_run: 'light' };
const HEAVY_LOCK_TYPES = new Set(['video_render', 'tts']);
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
class JobsApiQueue {
  constructor({ jobsApi, videoRender = null, env = process.env, typeMap, resourceClasses, agent = 'media-automation', pollMs = 1000, requiresNode = 'mac-mini' }) {
    if (!jobsApi) throw new Error('JobsApiQueue: jobsApi required');
    this.adapter = new StudioJobQueueAdapter({ client: jobsApi, pollMs, videoRender });
    this.typeMap = { ...DEFAULT_TYPE_MAP, ...json(env.MA_JOBS_TYPE_MAP, {}), ...(typeMap || {}) };
    this.resourceClasses = { ...DEFAULT_RESOURCE, ...json(env.MA_JOBS_RESOURCE_CLASS, {}), ...(resourceClasses || {}) };
    for (const t of HEAVY_LOCK_TYPES) if (this.resourceClasses[t] !== 'gpu_heavy') throw new Error(`${t} must use the shared heavy lock (resourceClass gpu_heavy)`);
    Object.assign(this, { agent, pollMs, requiresNode }); this.backend = 'jobsapi'; this.provisional = PROVISIONAL;
  }
  spec(kind, input = {}, { timeoutSec = 1800, maxAttempts } = {}) {
    const type = this.typeMap[kind]; if (!type) throw new Error('JobsApiQueue: unmapped job kind ' + kind);
    let inp = input;
    if (input && input.idempotencyKey === undefined) void 0;
    if (kind === 'publish_dry_run') { if (input.live === true || input.dryRun === false || input.mode === 'LIVE') throw new Error('publish_dry_run is dry-run only'); inp = { ...input, dryRun: true }; }
    let key = inp.idempotencyKey; if ('idempotencyKey' in inp) { inp = { ...inp }; delete inp.idempotencyKey; }
    const s = { type, agent: this.agent, input: inp, timeoutSec, resourceClass: this.resourceClasses[kind] };
    if (maxAttempts) s.maxAttempts = maxAttempts;
    if (s.resourceClass === 'gpu_heavy') { s.requiresNode = this.requiresNode; s.safeToRetry = true; }
    if (kind !== 'video_render' && key != null) { if (!/^[\x20-\x7E]{1,128}$/.test(String(key))) throw new Error('idempotencyKey must be 1..128 printable ASCII'); s.idempotencyKey = String(key); }
    return s; /* video_render: no idempotencyKey (server-assigned) */
  }
  async submit(kind, input, opts) { return this.adapter.createJob(this.spec(kind, input, opts)); }
  async run(kind, input, opts) { const { jobId } = await this.submit(kind, input, opts); const j = await waitForJob(this.adapter, jobId, { pollMs: this.pollMs, timeoutMs: (opts?.timeoutSec || 1800) * 1000 + 60e3 }); void j; return this.adapter.getJob(jobId); } /* full normalized job record */
  getJob(id) { return this.adapter.getJob(id); } cancelJob(id) { return this.adapter.cancelJob(id); } listJobs(q) { return this.adapter.listJobs(q); }
}
/** Flag gate. Default: the existing local queue. */
function selectJobQueue({ env = process.env, local, jobsApi = null, videoRender = null, ...rest } = {}) {
  if (env.MA_JOBS_BACKEND === 'jobsapi') { if (!jobsApi) return { queue: local, backend: 'local', reason: 'MA_JOBS_BACKEND=jobsapi but no jobsApi injected -> local fallback' };
    return { queue: new JobsApiQueue({ jobsApi, videoRender, env, ...rest }), backend: 'jobsapi', reason: 'flag on' }; }
  return { queue: local, backend: 'local', reason: 'flag off (default)' };
}
module.exports = { REGISTERED, JobsApiQueue, selectJobQueue, DEFAULT_TYPE_MAP, DEFAULT_RESOURCE, HEAVY_LOCK_TYPES, PROVISIONAL };
