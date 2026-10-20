// Bounded retries with exponential backoff + circuit breaker. No infinite restarts.
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function backoffDelay(attempt, { baseMs = 1000, maxMs = 60000, factor = 2 } = {}) {
  return Math.min(maxMs, baseMs * Math.pow(factor, Math.max(0, attempt)));
}
async function retry(fn, { retries = 3, baseMs = 500, maxMs = 30000, factor = 2, sleepFn = sleep } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(i); } catch (e) { last = e; if (i < retries) await sleepFn(backoffDelay(i, { baseMs, maxMs, factor })); }
  }
  throw last;
}
// States: closed (actions allowed) → open after `threshold` failures within `windowMs` (actions refused until `cooldownMs`)
// → half-open (one trial). `maxTrips` caps how many times it may re-open; after that it stays open until manual reset.
class CircuitBreaker {
  constructor(name, { threshold = 3, windowMs = 15 * 60000, cooldownMs = 30 * 60000, maxTrips = 3, now = Date.now, state } = {}) {
    Object.assign(this, { name, threshold, windowMs, cooldownMs, maxTrips, now });
    this.s = Object.assign({ state: 'closed', failures: [], openedAt: null, trips: 0, locked: false }, state || {});
  }
  get state() {
    if (this.s.state === 'open' && !this.s.locked && this.now() - this.s.openedAt >= this.cooldownMs) this.s.state = 'half-open';
    return this.s.state;
  }
  canAttempt() { return this.state !== 'open'; }
  success() { this.s.failures = []; if (this.s.state === 'half-open') this.s.state = 'closed'; }
  failure() {
    const t = this.now(); this.s.failures = this.s.failures.filter(x => t - x < this.windowMs); this.s.failures.push(t);
    if (this.state === 'half-open' || this.s.failures.length >= this.threshold) {
      this.s.state = 'open'; this.s.openedAt = t; this.s.trips++; this.s.failures = [];
      if (this.s.trips >= this.maxTrips) this.s.locked = true;
      return true; // tripped
    }
    return false;
  }
  reset() { this.s = { state: 'closed', failures: [], openedAt: null, trips: 0, locked: false }; }
  toJSON() { return { ...this.s, state: this.state }; }
}
module.exports = { backoffDelay, retry, CircuitBreaker, sleep };
