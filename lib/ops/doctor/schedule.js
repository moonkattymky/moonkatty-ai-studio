// Startup, 5-minute lightweight samples, hourly probes, optional nightly full check.
'use strict';

function createRing(max = 288) {
  const items = [];
  return {
    push(x) { items.push(x); while (items.length > max) items.shift(); },
    list() { return items.slice(); },
    size() { return items.length; }
  };
}

function alertsFrom(checks) {
  return (checks || []).filter(c => c && (c.status === 'WARN' || c.status === 'FAIL')).map(c => ({ id: c.id, status: c.status, summary: c.summary }));
}

function shouldRunNightly(date, enabled, lastDay) {
  if (!enabled) return false;
  if (date.getHours() !== 3) return false;
  const day = date.toISOString().slice(0, 10);
  return lastDay !== day;
}

function createSchedule({ onStartup, onPeriodic, onHourly, onFull, nightlyEnabled, now }) {
  const timers = [];
  let lastNight = null;
  let running = false;
  const clock = now || (() => new Date());
  async function guard(fn) {
    if (running || typeof fn !== 'function') return;
    running = true;
    try { await fn(); } catch { /* the check records its own failure */ } finally { running = false; }
  }
  function arm() {
    timers.push(setTimeout(() => guard(onStartup), 30000));
    timers.push(setInterval(() => guard(onPeriodic), 5 * 60 * 1000));
    timers.push(setInterval(() => guard(onHourly), 60 * 60 * 1000));
    timers.push(setInterval(() => guard(async () => {
      const d = clock();
      if (!shouldRunNightly(d, nightlyEnabled, lastNight)) return;
      lastNight = d.toISOString().slice(0, 10);
      if (onFull) await onFull();
    }), 15 * 60 * 1000));
    for (const t of timers) if (t.unref) t.unref();
    return { armed: true };
  }
  function stop() {
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    timers.length = 0;
  }
  return { arm, stop };
}

module.exports = { createRing, alertsFrom, shouldRunNightly, createSchedule };
