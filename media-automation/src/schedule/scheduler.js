'use strict';
const { JsonStore } = require('../store');
const { parts, zonedToUtc, localDate } = require('./tz');
/**
 * Plan: { id, label, action, times:['09:00','19:00'], days?:[0..6] (local weekday, 0=Sun), tz?, paused?, payload? }
 * Each slot (plan, local date, time) runs at most once ever (persisted) -> no repeats across restarts.
 * Missed slots (downtime) run once if within catchUpMin, otherwise recorded as 'missed'.
 * autoPublish defaults to false and is passed to handlers; handlers must route output to the Approval Center when false.
 */
class Scheduler {
  constructor({ statePath, handlers = {}, tz = 'Asia/Jerusalem', catchUpMin = 30, now = () => Date.now() }) {
    this.store = new JsonStore(statePath); Object.assign(this, { handlers, tz, catchUpMin, now });
    if (!this.store.get('settings')) this.store.set('settings', { autoPublish: false, paused: false });
  }
  settings() { return this.store.get('settings'); }
  setAutoPublish(on, by) { if (!by) throw new Error('owner required'); return this.store.update('settings', s => ({ ...s, autoPublish: !!on, autoPublishBy: by, autoPublishAt: new Date(this.now()).toISOString() })); }
  pauseAll() { return this.store.update('settings', s => ({ ...s, paused: true })); }
  resumeAll() { return this.store.update('settings', s => ({ ...s, paused: false })); }
  upsertPlan(p) { if (!p.id || !p.action || !p.times?.length) throw new Error('plan needs id, action, times'); p.times.forEach(t => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('bad time ' + t); });
    this.store.update('plans', ps => ({ ...ps, [p.id]: { paused: false, tz: this.tz, ...ps[p.id], ...p } }), {}); return this.plan(p.id); }
  plan(id) { return this.store.get('plans', {})[id] || null; }
  plans() { return Object.values(this.store.get('plans', {})); }
  pause(id) { const p = this.plan(id); p.paused = true; return this.upsertPlan(p); }
  resume(id) { const p = this.plan(id); p.paused = false; return this.upsertPlan(p); }
  runs() { return this.store.get('runs', {}); }
  /** Slots for a plan between [fromMs, toMs]. */
  slots(plan, fromMs, toMs) {
    const tz = plan.tz || this.tz; const out = [];
    for (let day = fromMs - 864e5; day <= toMs + 864e5; day += 864e5) {
      const p = parts(day, tz); const date = localDate(day, tz);
      if (plan.days && !plan.days.includes(p.wd)) continue;
      for (const t of plan.times) { const [h, mi] = t.split(':').map(Number); const at = zonedToUtc(p.y, p.m, p.d, h, mi, tz);
        if (at >= fromMs && at <= toMs) out.push({ key: `${plan.id}|${date}|${t}`, at, local: `${date} ${t} ${tz}` }); }
    }
    return [...new Map(out.map(s => [s.key, s])).values()].sort((a, b) => a.at - b.at);
  }
  nextRuns(n = 5) {
    const now = this.now(); return this.plans().filter(p => !p.paused).flatMap(p => this.slots(p, now, now + 8 * 864e5).slice(0, n).map(s => ({ plan: p.id, ...s }))).sort((a, b) => a.at - b.at).slice(0, n);
  }
  /** Execute due slots. Safe to call repeatedly / after restart. */
  async tick() {
    const now = this.now(); const s = this.settings(); const results = []; const win = this.catchUpMin * 60e3;
    const from = Math.min(this.store.get('lastTick', now), now) - win;
    for (const plan of this.plans()) {
      for (const slot of this.slots(plan, from, now)) {
        if (this.runs()[slot.key]) continue;
        const late = now - slot.at > win; let rec;
        if (late) rec = { status: 'missed' };
        else if (s.paused || plan.paused) continue; // wait; runs on resume if still within window
        else {
          this.store.update('runs', r => ({ ...r, [slot.key]: { status: 'running', startedAt: new Date(now).toISOString() } }), {});
          const h = this.handlers[plan.action];
          try { if (!h) throw new Error('no handler for ' + plan.action); const out = await h({ plan, slot, autoPublish: s.autoPublish === true });
            rec = { status: 'done', result: out ?? null, autoPublish: s.autoPublish === true }; }
          catch (e) { rec = { status: 'failed', error: e.message }; }
        }
        rec.local = slot.local; rec.at = new Date(slot.at).toISOString(); this.store.update('runs', r => ({ ...r, [slot.key]: rec }), {}); results.push({ key: slot.key, ...rec });
      }
    }
    this.store.set('lastTick', now); return results;
  }
  start(intervalMs = 30e3) { this.timer = setInterval(() => this.tick().catch(() => {}), intervalMs); this.tick().catch(() => {}); return this; }
  stop() { clearInterval(this.timer); }
}
/** Default MOONKATTY plans (owner can edit). All produce drafts for approval unless autoPublish is enabled. */
const DEFAULT_PLANS = [
  { id: 'news-video-morning', label: 'MOONKATTY NEWS — morning video issue', action: 'news_video_issue', times: ['09:00'] },
  { id: 'news-video-evening', label: 'MOONKATTY NEWS — evening video issue', action: 'news_video_issue', times: ['19:00'] },
  { id: 'news-text', label: 'MOONKATTY NEWS — text posts (X with image, Telegram)', action: 'news_text_post', times: ['08:00', '11:00', '14:00', '17:00', '21:00'] },
  { id: 'project-plan', label: 'MOONKATTY PROJECT — content plan (separate channel)', action: 'project_post', times: ['12:00'], days: [0, 2, 4] },
];
module.exports = { Scheduler, DEFAULT_PLANS };
