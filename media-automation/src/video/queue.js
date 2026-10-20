'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { JsonStore } = require('../store');
/**
 * Persistent render queue with concurrency limit. worker: async (job.payload) => result.
 * On construction, jobs left 'running' by a crash are reset to 'queued' (restart recovery).
 */
class RenderQueue extends EventEmitter {
  constructor({ statePath, worker, concurrency = 1, maxAttempts = 2 }) {
    super(); if (!statePath || !worker) throw new Error('statePath and worker required');
    Object.assign(this, { worker, concurrency, maxAttempts }); this.store = new JsonStore(statePath); this.active = 0; this.maxActiveSeen = 0; this._idle = [];
    const jobs = this.store.get('jobs', []); let recovered = 0;
    for (const j of jobs) if (j.status === 'running') { j.status = 'queued'; j.recovered = (j.recovered || 0) + 1; recovered++; }
    this.store.set('jobs', jobs); this.recovered = recovered;
  }
  jobs() { return this.store.get('jobs', []); }
  job(id) { return this.jobs().find(j => j.id === id) || null; }
  _patch(id, p) { this.store.update('jobs', js => js.map(j => j.id === id ? { ...j, ...p } : j), []); }
  add(payload, { id } = {}) {
    const job = { id: id || crypto.randomUUID(), payload, status: 'queued', attempts: 0, createdAt: new Date().toISOString() };
    if (this.job(job.id)) return this.job(job.id); // idempotent
    this.store.update('jobs', js => [...js, job], []); return job;
  }
  start() { this.running = true; this._pump(); return this; }
  stop() { this.running = false; }
  _pump() {
    if (!this.running) return;
    while (this.active < this.concurrency) {
      const next = this.jobs().find(j => j.status === 'queued'); if (!next) break;
      this.active++; this.maxActiveSeen = Math.max(this.maxActiveSeen, this.active);
      this._patch(next.id, { status: 'running', attempts: next.attempts + 1, startedAt: new Date().toISOString() });
      this._exec(next.id).finally(() => { this.active--; this._pump(); });
    }
    if (this.active === 0 && !this.jobs().some(j => j.status === 'queued')) { const w = this._idle; this._idle = []; w.forEach(f => f()); }
  }
  async _exec(id) {
    const j = this.job(id);
    try { const result = await this.worker(j.payload, j); this._patch(id, { status: 'done', result, finishedAt: new Date().toISOString(), error: null }); this.emit('done', this.job(id)); }
    catch (e) { const failed = j.attempts >= this.maxAttempts; this._patch(id, { status: failed ? 'failed' : 'queued', error: e.message }); this.emit(failed ? 'failed' : 'retry', this.job(id)); }
  }
  onIdle() { return new Promise(r => { this._idle.push(r); this._pump(); }); }
}
module.exports = { RenderQueue };
