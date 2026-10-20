'use strict';
/**
 * JobQueuePort — mirrors the heavy-job queue contract of the other developer (draft):
 *   createJob({ type, agent, input, timeoutSec, maxAttempts }) -> { jobId }
 *   getJob(jobId) -> Job | null        Job: { jobId, type, agent, input, status, attempts, maxAttempts, timeoutSec, result, error, createdAt, updatedAt }
 *   cancelJob(jobId) -> Job
 *   listJobs({ status }) -> Job[]
 *   statuses: queued | running | needs_approval | succeeded | failed | cancelled
 * Our helper on top of the port:
 *   runExclusive(spec, fn?) -> result  — enqueue and wait for terminal status.
 */
const STATUSES = ['queued', 'running', 'needs_approval', 'succeeded', 'failed', 'cancelled'];
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const HEAVY_TYPES = new Set(['render_segment', 'llm_generate', 'video_render', 'blender_template', 'design3d']);
/** Studio resourceClass (JOBS_API.md): gpu_heavy | llm | light */
const RESOURCE_CLASS = { render_segment: 'gpu_heavy', blender_template: 'gpu_heavy', design3d: 'gpu_heavy', video_render: 'gpu_heavy', llm_generate: 'llm' };
async function waitForJob(port, jobId, { pollMs = 500, timeoutMs = 3600e3 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const j = await port.getJob(jobId); if (!j) throw new Error(`job ${jobId} vanished`);
    if (TERMINAL.has(j.status)) { if (j.status === 'succeeded') return j.result; const e = new Error(`job ${jobId} ${j.status}: ${j.error || ''}`); e.job = j; throw e; }
    if (Date.now() - t0 > timeoutMs) throw new Error(`job ${jobId} wait timeout`);
    await new Promise(r => setTimeout(r, pollMs));
  }
}
module.exports = { STATUSES, TERMINAL, HEAVY_TYPES, RESOURCE_CLASS, waitForJob };
