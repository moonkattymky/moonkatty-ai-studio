'use strict';
const { waitForJob } = require('./port');
/**
 * StudioJobQueueAdapter — STUB adapter for the studio's SQLite heavy-job queue (tables jobs/job_events, owned by the other developer).
 * We never import their code or open their DB here. They inject a client implementing the contract:
 *   { createJob, getJob, cancelJob, listJobs }  (see port.js). Until then every call throws NotConnected.
 * Inline functions can NOT be shipped across; runExclusive(spec) only enqueues `spec` and waits for its result.
 */
/** Job types in Studio docs/JOBS_API.md (feat/v1.2.0 @00b63fc). 'video_render' is only PROPOSED. */
const STUDIO_TYPES = ['design3d', 'blender_template', 'opencode_task', 'render_segment']; // + 'video_render' when executor registered (a991e93)
const PUBLIC = new Set(['queued', 'running', 'needs_approval', 'succeeded', 'failed', 'cancelled']);
const INTERNAL_MAP = { waiting_confirmation: 'needs_approval', waiting_approval: 'needs_approval', blocked: 'queued', done: 'succeeded', rejected: 'cancelled' };
class NotConnectedError extends Error { constructor() { super('Studio job queue not connected (adapter stub; contract draft)'); this.code = 'NOT_CONNECTED'; } }
class StudioJobQueueAdapter {
  constructor({ client = null, pollMs = 1000, supportedTypes = STUDIO_TYPES, videoRender = null } = {}) { this.client = client; this.pollMs = pollMs; this._types = supportedTypes; this.videoRender = videoRender; }
  /** video_render is listed only when the Studio videoRender service has an executor registered (feature-detect). */
  get supportedTypes() { const v = this.videoRender; const has = !!v && (typeof v.hasExecutor === 'function' ? v.hasExecutor() : !!v.executor); return has ? [...this._types, 'video_render'] : [...this._types]; }
  _c() { if (!this.client) throw new NotConnectedError(); return this.client; }
  /** Aligned with feat/v1.2.0 docs/JOBS_API.md (00b63fc): jobsApi.createJob({type, agent, input, timeoutSec, maxAttempts, resourceClass, requiresNode, idempotencyKey, safeToRetry}) -> {jobId, existing?} */
  async createJob(spec) {
    const { type, agent, input, timeoutSec, maxAttempts, resourceClass, requiresNode, idempotencyKey, safeToRetry } = spec;
    if (idempotencyKey && String(idempotencyKey).length > 128) throw new Error('idempotencyKey must be <=128 chars (Studio JOBS_API)');
    const body = { type, agent, input, timeoutSec, maxAttempts };
    for (const [k, v] of Object.entries({ resourceClass, requiresNode, idempotencyKey, safeToRetry })) if (v !== undefined) body[k] = v;
    return this._c().createJob(body);
  }
  /** Normalizes Studio job record: jobId|id, public status (publicStatus|status), artifacts. */
  async getJob(id) {
    const j = await this._c().getJob(id); if (!j) return null;
    const status = PUBLIC.has(j.publicStatus) ? j.publicStatus : PUBLIC.has(j.status) ? j.status : INTERNAL_MAP[j.status] || j.status;
    const result = j.result ?? (j.artifacts ? { artifacts: j.artifacts, videoPath: (j.artifacts.find(a => a.kind === 'mp4' || /\.(mp4|mov|webm)$/i.test(a.path || '')) || {}).path } : undefined);
    return { ...j, jobId: j.jobId || j.id, status, result };
  }
  async cancelJob(id) { return this._c().cancelJob(id); }
  async listJobs(q) { return this._c().listJobs(q); }
  async runExclusive(spec, fn) {
    if (fn) throw new Error('studio queue cannot run inline functions; register a handler for type ' + spec.type + ' on the studio side');
    const { jobId } = await this.createJob(spec); return waitForJob(this, jobId, { pollMs: this.pollMs });
  }
}
/**
 * Studio host3d (v1.2.0): render_segment is reserved and currently created as `failed` ("не реализовано").
 * StudioHost3D maps that to null (no cat yet) instead of failing the episode.
 */
class StudioHost3D {
  constructor({ adapter, agent = 'media-automation', timeoutSec = 1800 }) { Object.assign(this, { adapter, agent, timeoutSec }); this.name = 'studio-host3d'; }
  async renderSegment(req) {
    try { const r = await this.adapter.runExclusive({ type: 'render_segment', agent: this.agent, input: req, timeoutSec: this.timeoutSec, maxAttempts: 1, resourceClass: 'gpu_heavy', requiresNode: 'mac-mini', safeToRetry: true });
      return r && r.videoPath ? { videoPath: r.videoPath } : null; }
    catch (e) { if (e.code === 'NOT_CONNECTED' || e.job?.status === 'failed') return null; throw e; }
  }
}
module.exports = { STUDIO_TYPES, StudioJobQueueAdapter, StudioHost3D, NotConnectedError, INTERNAL_MAP };
