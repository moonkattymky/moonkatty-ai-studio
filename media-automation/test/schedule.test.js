'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const path = require('path');
const { Scheduler, DEFAULT_PLANS, zonedToUtc, parts } = require('../src/schedule');
const { tmp } = require('./helpers');
const at = iso => Date.parse(iso);
const mk = (sp, clock, handlers) => new Scheduler({ statePath: sp, handlers, now: () => clock.t });

test('tz conversion Asia/Jerusalem incl. DST (IDT +3 in Oct, IST +2 in Dec)', () => {
  assert.equal(new Date(zonedToUtc(2026, 10, 21, 9, 0, 'Asia/Jerusalem')).toISOString(), '2026-10-21T06:00:00.000Z');
  assert.equal(new Date(zonedToUtc(2026, 12, 21, 9, 0, 'Asia/Jerusalem')).toISOString(), '2026-12-21T07:00:00.000Z');
  assert.equal(parts(at('2026-10-21T06:00:00Z'), 'Asia/Jerusalem').h, 9);
});
test('2 daily news issues fire at local 09:00/19:00, once each, autoPublish OFF by default', async () => {
  const sp = path.join(tmp(), 's.json'); const clock = { t: at('2026-10-21T05:50:00Z') }; const calls = [];
  const s = mk(sp, clock, { news_video_issue: async ctx => { calls.push([ctx.slot.local, ctx.autoPublish]); return 'draft'; }, news_text_post: async () => 'ok', project_post: async () => 'ok' });
  DEFAULT_PLANS.forEach(p => s.upsertPlan(p));
  assert.equal(s.settings().autoPublish, false);
  await s.tick(); assert.equal(calls.length, 0);
  clock.t = at('2026-10-21T06:00:30Z'); await s.tick(); await s.tick(); assert.deepEqual(calls, [['2026-10-21 09:00 Asia/Jerusalem', false]]);
  clock.t = at('2026-10-21T16:01:00Z'); await s.tick(); assert.equal(calls.length, 2); assert.equal(calls[1][0], '2026-10-21 19:00 Asia/Jerusalem');
  const n = s.nextRuns(3); assert.ok(n.every(x => x.at > clock.t));
});
test('restart: no repeats, short downtime catches up once, long downtime marks missed', async () => {
  const sp = path.join(tmp(), 's.json'); const clock = { t: at('2026-10-21T05:59:00Z') }; let n = 0; const h = { news_video_issue: async () => { n++; } };
  let s = mk(sp, clock, h); s.upsertPlan(DEFAULT_PLANS[0]); s.upsertPlan(DEFAULT_PLANS[1]); await s.tick();
  clock.t = at('2026-10-21T06:20:00Z'); s = mk(sp, clock, h); await s.tick(); assert.equal(n, 1, 'caught up within 30 min');
  s = mk(sp, clock, h); await s.tick(); assert.equal(n, 1, 'no repeat after restart');
  clock.t = at('2026-10-21T18:00:00Z'); s = mk(sp, clock, h); const r = await s.tick(); assert.equal(n, 1); assert.equal(r[0].status, 'missed');
});
test('pause/resume plan and global; project plan only on its weekdays; owner toggle for autoPublish', async () => {
  const sp = path.join(tmp(), 's.json'); const clock = { t: at('2026-10-21T08:59:00Z') }; const ran = [];
  const s = mk(sp, clock, { project_post: async c => { ran.push(c.slot.local); return c.autoPublish; } });
  s.upsertPlan(DEFAULT_PLANS[3]); // Sun/Tue/Thu 12:00 ; 2026-10-21 is Wednesday
  clock.t = at('2026-10-21T09:00:30Z'); await s.tick(); assert.equal(ran.length, 0, 'Wednesday skipped');
  s.pause('project-plan'); clock.t = at('2026-10-22T09:00:30Z'); await s.tick(); assert.equal(ran.length, 0, 'paused');
  s.resume('project-plan'); await s.tick(); assert.deepEqual(ran, ['2026-10-22 12:00 Asia/Jerusalem'], 'resumed within catch-up window');
  assert.throws(() => s.setAutoPublish(true)); s.setAutoPublish(true, 'igor'); assert.equal(s.settings().autoPublish, true);
  s.pauseAll(); clock.t = at('2026-10-25T10:00:10Z') /* after DST end: 12:00 IST = 10:00Z */; assert.deepEqual(await s.tick(), []); s.resumeAll(); const r = await s.tick(); assert.equal(r[0].result, true);
});
test('handler failure recorded, not retried endlessly', async () => {
  const clock = { t: at('2026-10-21T06:00:05Z') }; const s = mk(path.join(tmp(), 's.json'), clock, { news_video_issue: async () => { throw new Error('render failed'); } });
  s.upsertPlan(DEFAULT_PLANS[0]); const [r] = await s.tick(); assert.equal(r.status, 'failed'); assert.deepEqual(await s.tick(), []);
});
