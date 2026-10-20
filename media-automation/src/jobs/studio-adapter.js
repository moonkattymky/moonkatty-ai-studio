'use strict';
const { waitForJob } = require('./port');
/**
 * StudioJobQueueAdapter — STUB adapter for the studio's SQLite heavy-job queue (tables jobs/job_events, owned by the other developer).
 * We never import their code or open their DB here. They inject a client implementing the contract:
 *   { createJob, getJob, cancelJob, listJobs }  (see port.js). Until then every call throws NotConnected.
 * Inline functions can NOT be shipped across; runExclusive(spec) only enqueues `spec` and waits for its result.
 */
class NotConnectedError extends Error { constructor() { super('Studio job queue not connected (adapter stub; contract draft)'); this.code = 'NOT_CONNECTED'; } }
class StudioJobQueueAdapter {
  constructor({ client = null, pollMs = 1000 } = {}) { this.client = client; this.pollMs = pollMs; }
  _c() { if (!this.client) throw new NotConnectedError(); return this.client; }
  async createJob(spec) { const { type, agent, input, timeoutSec, maxAttempts } = spec; return this._c().createJob({ type, agent, input, timeoutSec, maxAttempts }); }
  async getJob(id) { return this._c().getJob(id); }
  async cancelJob(id) { return this._c().cancelJob(id); }
  async listJobs(q) { return this._c().listJobs(q); }
  async runExclusive(spec, fn) {
    if (fn) throw new Error('studio queue cannot run inline functions; register a handler for type ' + spec.type + ' on the studio side');
    const { jobId } = await this.createJob(spec); return waitForJob(this, jobId, { pollMs: this.pollMs });
  }
}
module.exports = { StudioJobQueueAdapter, NotConnectedError };
