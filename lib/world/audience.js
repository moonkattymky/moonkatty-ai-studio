// Million Audience Mission. Counts come only from a Platform Read API (getAnalytics, getPlatformStatus).
// The two YouTube channels stay separate. Mock snapshots are DEMO and are not real progress.
'use strict';
const ND = 'НЕТ ДАННЫХ';
const DAY = 86400000;
function num(v, demo) {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v)) return ND;
  if (demo) return { demo: true, real: false, value: null, label: 'DEMO ' + v };
  return { demo: false, real: true, value: v, label: String(v) };
}
function rate(part, whole, demo) {
  if (part == null || whole == null || whole <= 0) return ND;
  const pct = Math.round(part / whole * 1000) / 10;
  return num(pct, demo);
}
function growth(points, now) {
  const real = (points || []).filter(p => p && p.demo !== true && typeof p.followers === 'number' && p.at)
    .map(p => ({ t: new Date(p.at).getTime(), followers: p.followers })).filter(p => !Number.isNaN(p.t)).sort((a, b) => a.t - b.t);
  const end = now.getTime();
  const latest = [...real].reverse().find(p => p.t <= end);
  const delta = ms => {
    if (!latest) return ND;
    const prev = [...real].reverse().find(p => p.t <= end - ms && p.t !== latest.t);
    if (!prev) return ND;
    return { subscribers: latest.followers - prev.followers, from: prev.followers, to: latest.followers, real: true };
  };
  return { daily: delta(DAY), weekly: delta(7 * DAY), monthly: delta(30 * DAY) };
}
function milestones(goalList, count, demo) {
  return (goalList || [1000, 10000, 100000, 500000, 1000000]).map(at => {
    if (count == null || demo) return { at, reached: ND, demo: demo && count != null ? (count >= at ? 'DEMO пройдено' : 'DEMO не пройдено') : ND };
    return { at, reached: count >= at, demo: ND };
  });
}
function channelView(api, spec, opts) {
  const { demoDefault, history, now, milestonesList, goal } = opts;
  const id = spec.id;
  const confirmedCents = typeof opts.confirmedFor === 'function' ? opts.confirmedFor(id) : null;
  const base = { id, name: spec.name, separate: true, revenue: confirmedCents == null ? ND : { cents: confirmedCents, label: '$' + (confirmedCents / 100).toFixed(2), note: 'только подтверждённая выплата' } };
  if (!api || typeof api.getAnalytics !== 'function') return Object.assign(base, empty(goal, milestonesList));
  let analytics, status;
  try { analytics = api.getAnalytics(id, {}); status = api.getPlatformStatus(id); } catch { return Object.assign(base, empty(goal, milestonesList)); }
  const demo = demoDefault || (analytics && analytics.dataMode === 'mock') || (status && status.dataMode === 'mock');
  const totals = analytics && analytics.totals || null;
  const unavailable = new Set((analytics && analytics.unavailable) || []);
  if (!totals || unavailable.has('followers') || totals.followers == null) return Object.assign(base, empty(goal, milestonesList), { status: demo ? 'DEMO' : ND, dataMode: demo ? 'mock' : 'absent' });
  const followers = totals.followers;
  const realCount = demo ? null : followers;
  const likes = unavailable.has('likes') ? null : totals.likes;
  const comments = unavailable.has('comments') ? null : totals.comments;
  const shares = unavailable.has('shares') ? null : totals.shares;
  const reach = unavailable.has('reach') ? null : totals.reach;
  const engagement = likes == null || comments == null || shares == null || reach == null ? ND : rate(likes + comments + shares, reach, demo);
  const own = (history || []).filter(p => p.id === id);
  return Object.assign(base, {
    dataMode: demo ? 'mock' : 'real',
    subscribers: num(followers, demo),
    progress: realCount == null ? ND : { percent: Math.floor(realCount * 100 / goal), label: Math.floor(realCount * 100 / goal) + '%' },
    milestones: milestones(milestonesList, followers, demo),
    growth: growth(own, now),
    retention: ND,
    reach: reach == null ? ND : num(reach, demo),
    engagement,
    clickThrough: ND,
    formats: ND,
    status: status ? { mode: status.mode || ND, connected: status.connected === true, dataMode: demo ? 'mock' : 'real' } : ND,
    recommendations: recommend(spec.name, demo),
    viewsAreSubscribers: false,
    viewsAreRevenue: false
  });
}
function empty(goal, milestonesList) {
  return { dataMode: 'absent', subscribers: ND, progress: ND, milestones: milestones(milestonesList, null, false), growth: { daily: ND, weekly: ND, monthly: ND }, retention: ND, reach: ND, engagement: ND, clickThrough: ND, formats: ND, status: ND, recommendations: ['НЕТ ДАННЫХ. Счётчик подписчиков не подключён.'], viewsAreSubscribers: false, viewsAreRevenue: false };
}
function recommend(name, demo) {
  const head = demo ? 'DEMO, не реальные подписчики. ' : '';
  return [head + name + ': только органические форматы, которые уже смотрят.', 'Не покупать подписчиков, не использовать ботов, не рассылать спам и не обходить правила площадки.'];
}
function report(opts) {
  const channels = (opts.channels || []).map(spec => channelView(opts.api, spec, opts));
  const youtube = channels.filter(c => c.id === 'youtube-news' || c.id === 'youtube-project');
  return {
    goal: opts.goal,
    mergeYoutube: false,
    youtubeMerged: false,
    youtube: youtube.map(c => ({ id: c.id, name: c.name, subscribers: c.subscribers })),
    channels,
    experiments: opts.experiments || []
  };
}
function planExperiment(body, realData) {
  const hypothesis = String(body.hypothesis || '').trim();
  const metric = String(body.metric || '').trim();
  const durationDays = Number(body.durationDays);
  const platformId = String(body.platformId || '');
  if (!hypothesis || !metric || !platformId) return { error: 'нужны hypothesis, metric и platformId' };
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 90) return { error: 'durationDays: 1–90' };
  if (['followers_bought', 'views', 'reach'].includes(metric)) return { error: 'эта метрика не цель', code: 'forbidden' };
  return { hypothesis: hypothesis.slice(0, 500), metric, durationDays, platformId, evaluation: realData ? { from: 'read-api', real: true } : ND, publishes: false };
}
module.exports = { ND, growth, milestones, report, planExperiment, recommend };
