'use strict';
const crypto = require('crypto');
const { JsonStore } = require('../store');
const { TERMINAL, HEAVY_TYPES, waitForJob } = require('./port');
/**
 * LocalJobQueue — file-backed implementation of JobQueuePort for this module (until the studio SQLite queue is available).
 * - heavy job types are strictly serialized (one heavy job at a time: Blender, Ollama, renders never concurrent)
 * - before a render-type heavy job, `beforeHeavy(type)` hook runs (e.g. unload Ollama)
 * - per-job timeout, attempts, job_events log, restart recovery (running -> queued), needs_approval gate
 */
class LocalJobQueue {
  constructor({ statePath, lightConcurrency = 2, beforeHeavy = null, now = () => new Date().toISOString() }) {
    this.store = new JsonStore(statePath); Object.assign(this, { lightConcurrency, beforeHeavy, now });
    this.handlers = new Map(); this.inline = new Map(); this.activeHeavy = 0; this.activeLight = 0; this.maxHeavySeen = 0;
    const jobs = this.store.get('jobs', {}); for (const j of Object.values(jobs)) if (j.status === 'running') { j.status = 'queued'; this._ev(j, 'recovered'); }
    this.store.set('jobs', jobs);
  }
  _ev(job, event, data) { (job.events = job.events || []).push({ at: this.now(), event, data: data ?? null }); }
  _save(job) { this.store.update('jobs', js => ({ ...js, [job.jobId]: job }), {}); }
  registerHandler(type, fn) { this.handlers.set(type, fn); return this; }
  async createJob({ type, agent = null, input = {}, timeoutSec = 600, maxAttempts = 1, requiresApproval = false, idempotencyKey }) {
    if (!type) throw new Error('type required');
    if (idempotencyKey) { const ex = Object.values(this.store.get('jobs', {})).find(j => j.idempotencyKey === idempotencyKey && !['failed', 'cancelled'].includes(j.status)); if (ex) return { jobId: ex.jobId }; }
    const job = { jobId: crypto.randomUUID(), type, agent, input, timeoutSec, maxAttempts, attempts: 0, idempotencyKey: idempotencyKey || null,
      status: requiresApproval ? 'needs_approval' : 'queued', heavy: HEAVY_TYPES.has(type), result: null, error: null, createdAt: this.now(), updatedAt: this.now(), events: [] };
    this._ev(job, 'created'); this._save(job); setImmediate(() => this._pump()); return { jobId: job.jobId };
  }
  async getJob(id) { return this.store.get('jobs', {})[id] || null; }
  async listJobs({ status } = {}) { return Object.values(this.store.get('jobs', {})).filter(j => !status || j.status === status); }
  async cancelJob(id) { const j = await this.getJob(id); if (!j) throw new Error('no job'); if (!TERMINAL.has(j.status)) { j.status = 'cancelled'; j.updatedAt = this.now(); this._ev(j, 'cancelled'); this._save(j); } return j; }
  async approveJob(id, by) { const j = await this.getJob(id); if (j?.status !== 'needs_approval') throw new Error('not awaiting approval'); j.status = 'queued'; this._ev(j, 'approved', { by }); this._save(j); this._pump(); return j; }
  _pump() {
    const queued = Object.values(this.store.get('jobs', {})).filter(j => j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const j of queued) {
      const fn = this.inline.get(j.jobId) || this.handlers.get(j.type); if (!fn) continue;
      if (j.heavy) { if (this.activeHeavy >= 1) continue; this.activeHeavy++; this.maxHeavySeen = Math.max(this.maxHeavySeen, this.activeHeavy); }
      else { if (this.activeLight >= this.lightConcurrency) continue; this.activeLight++; }
      j.status = 'running'; j.attempts++; j.updatedAt = this.now(); this._ev(j, 'started', { attempt: j.attempts }); this._save(j);
      this._exec(j, fn).finally(() => { j.heavy ? this.activeHeavy-- : this.activeLight--; this._pump(); });
    }
  }
  async _exec(j, fn) {
    let timer;
    try {
      if (j.heavy && this.beforeHeavy) await this.beforeHeavy(j.type);
      const result = await Promise.race([fn(j.input, j), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${j.timeoutSec}s`)), j.timeoutSec * 1000); timer.unref?.(); })]);
      const cur = await this.getJob(j.jobId); if (cur.status === 'cancelled') return;
      Object.assign(cur, { status: 'succeeded', result: result ?? null, error: null, updatedAt: this.now() }); this._ev(cur, 'succeeded'); this._save(cur); this.inline.delete(j.jobId);
    } catch (e) {
      const cur = await this.getJob(j.jobId); if (cur.status === 'cancelled') return;
      const retry = cur.attempts < cur.maxAttempts; Object.assign(cur, { status: retry ? 'queued' : 'failed', error: e.message, updatedAt: this.now() });
      this._ev(cur, retry ? 'retry' : 'failed', { error: e.message }); this._save(cur); if (!retry) this.inline.delete(j.jobId);
    } finally { clearTimeout(timer); }
  }
  /** Enqueue with an inline function (in-process) and wait. */
  async runExclusive(spec, fn, waitOpts = { pollMs: 20 }) {
    const { jobId } = await this.createJob(spec); if (fn) this.inline.set(jobId, fn); this._pump(); return waitForJob(this, jobId, waitOpts);
  }
}
module.exports = { LocalJobQueue };
