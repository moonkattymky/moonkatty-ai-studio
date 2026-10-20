// Adapter between Grok #1 Studio jobs (feat/v1.2.0: runner.js jobs + job_events) and the distributed node queue.
// Tolerates absence of his fields/branch: missing fields get safe defaults (NOT safe to retry, light, local).
// Contract: docs/ops/NODE_API_CONTRACT.md
'use strict';
const STATUSES = ['queued', 'running', 'needs_approval', 'succeeded', 'failed', 'cancelled'];
const LOCAL_ONLY_TYPES = new Set(['opencode_task', 'blender_template', 'render_segment']); // never sent to other machines
// our Resource Manager classes ↔ Grok #1 resourceClass
const TO_STUDIO = { 'llm-large': 'llm', render: 'gpu_heavy', video: 'gpu_heavy', light: 'light' };
const FROM_STUDIO = { llm: 'llm-large', gpu_heavy: 'render', light: 'light' };
const toStudioClass = c => TO_STUDIO[c] || 'light';
const fromStudioClass = c => FROM_STUDIO[c] || 'light';
// Studio job → node job (or {local:true, reason})
function toNodeJob(job) {
  if (!job || typeof job !== 'object' || !job.type) throw new Error('job.type required');
  const resourceClass = ['gpu_heavy', 'llm', 'light'].includes(job.resourceClass) ? job.resourceClass : 'light';
  const requiresNode = job.requiresNode || (LOCAL_ONLY_TYPES.has(job.type) || resourceClass !== 'light' ? 'mac-mini' : null);
  if (LOCAL_ONLY_TYPES.has(job.type) || requiresNode === 'mac-mini') return { local: true, reason: LOCAL_ONLY_TYPES.has(job.type) ? `тип ${job.type} выполняется только на Mac mini` : 'requiresNode=mac-mini' };
  let input = job.input; if (typeof input === 'string') { try { input = JSON.parse(input); } catch { input = { text: input }; } }
  return { local: false, job: { type: job.type, capability: (input && input.capability) || job.type, input: input || {}, resourceClass, requiresNode,
    idempotencyKey: job.idempotencyKey || null, safeToRetry: job.safeToRetry === true, maxAttempts: Math.max(1, Math.min(10, job.maxAttempts | 0 || 1)),
    timeoutSec: Math.max(10, Math.min(86400, job.timeoutSec | 0 || 900)), studioJobId: job.id || null, files: Array.isArray(job.files) ? job.files : [] } };
}
// node job status → Studio status (+artifacts in {path, sha256, kind})
const STATUS_MAP = { queued: 'queued', leased: 'running', running: 'running', needs_approval: 'needs_approval', succeeded: 'succeeded', failed: 'failed', cancelled: 'cancelled' };
function toStudioUpdate(nj) {
  return { status: STATUS_MAP[nj.status] || 'failed', attempt: nj.attempt, heartbeatAt: nj.heartbeatAt || null, error: nj.error || null, updatedAt: nj.updatedAt,
    artifacts: (nj.artifacts || []).map(a => ({ name: a.name || a.sha256, path: `ops-node-files/${a.sha256}`, size: a.size ?? null, sha256: a.sha256, kind: a.kind || 'file' })), node: nj.nodeId || null };
}
// Bridge for Grok #1 executor: dispatch(job) → {local:true,reason} | {nodeJobId}; poll(nodeJobId) → Studio update fields; cancel(nodeJobId).
function createBridge(nodes) {
  return {
    dispatch(job) { const r = nodes.submit(job); return r.local ? { local: true, reason: r.reason } : { nodeJobId: r.jobId, duplicate: !!r.duplicate }; },
    poll(id) { const j = nodes._state.jobs[id]; if (!j) return null; return toStudioUpdate(j); },
    cancel(id) { return toStudioUpdate(nodes.cancel(id)); },
    wait: (id, signal) => nodes.waitFor(id, signal).then(toStudioUpdate),
  };
}
module.exports = { createBridge, toNodeJob, toStudioUpdate, toStudioClass, fromStudioClass, STATUSES, LOCAL_ONLY_TYPES };
