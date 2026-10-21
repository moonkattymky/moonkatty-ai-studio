'use strict';
/** FB: native scheduled_publish_time (10 min..75 days). IG: no native scheduling -> our own scheduler, gated by the publishing quota. */
const { META } = require('./capabilities');
const FB = META.facebook.limits;
function fbScheduleFields(atMs, nowMs = Date.now()) {
  const d = (atMs - nowMs) / 1000; if (!(d >= FB.scheduleMinSec && d <= FB.scheduleMaxSec)) throw new Error(`FB schedule must be 10 min..75 days ahead (got ${Math.round(d)}s)`);
  return { published: false, scheduled_publish_time: Math.floor(atMs / 1000) };
}
function fbReelScheduleFields(atMs, nowMs = Date.now()) { const f = fbScheduleFields(atMs, nowMs); return { video_state: 'SCHEDULED', scheduled_publish_time: f.scheduled_publish_time }; }
/** IG own scheduler: decides which planned IG posts are due now, respecting a rolling-24h quota. */
class IgScheduler {
  constructor({ quotaTotal = META.instagram.limits.apiPostsPer24h.defaultUsed, now = () => Date.now() } = {}) { Object.assign(this, { quotaTotal, now }); this.published = []; this.plan = []; }
  /** Live quota from GET /{ig}/content_publishing_limit?fields=quota_usage,config (passed in; no network here). */
  applyQuota({ quota_usage, config } = {}) { if (config?.quota_total) this.quotaTotal = config.quota_total; this.remoteUsage = quota_usage ?? null; }
  add({ id, atMs }) { if (this.plan.some(p => p.id === id)) return false; this.plan.push({ id, atMs, status: 'scheduled' }); return true; }
  used() { const cut = this.now() - 86400e3; this.published = this.published.filter(t => t > cut); return Math.max(this.published.length, this.remoteUsage ?? 0); }
  due() { const out = []; for (const p of this.plan.filter(p => p.status === 'scheduled' && p.atMs <= this.now()).sort((a, b) => a.atMs - b.atMs)) {
      if (this.used() + out.length >= this.quotaTotal) { p.status = 'deferred_quota'; continue; } out.push(p); } return out; }
  markPublished(id) { const p = this.plan.find(x => x.id === id); if (p) p.status = 'published'; this.published.push(this.now()); }
}
module.exports = { fbScheduleFields, fbReelScheduleFields, IgScheduler };
