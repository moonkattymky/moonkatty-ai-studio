/** Browser-side helpers for the Horizons AI player. Reads window.MoonGame; does not patch the game. */

export const SAVE_KEY = 'moonkatty-new-horizons-v02';

export async function readProbe(page) {
  return page.evaluate(() => {
    const g = window.MoonGame;
    const core = window.MoonCore;
    if (!g || !g.player || !g.state) return null;
    const p = g.player;
    const s = g.state;
    let quest = null;
    try { quest = core && core.quest(s); } catch { quest = null; }
    const targetId = quest && quest.targets && quest.targets[0];
    const point = targetId && core && core.POINTS && core.POINTS[targetId];
    const dialogs = [...document.querySelectorAll('dialog[open]')].map(d => d.id || d.className);
    const errorEl = document.querySelector('#error');
    return {
      x: p.x, z: p.z, alt: p.alt, yaw: p.yaw, fuel: p.fuel,
      speed: p.speed || 0, blocked: !!p.blocked,
      camYaw: g.camYaw, running: !!g.running,
      chapter: s.chapter, crystals: s.crystals, metal: s.metal, energy: s.energy,
      productionAt: s.productionAt || 0,
      recorder: !!s.recorder,
      questId: quest && quest.id, questTitle: quest && quest.title,
      target: point ? { id: targetId, x: point[0], z: point[1] } : null,
      dialogs,
      errorText: errorEl && !errorEl.hidden ? (errorEl.textContent || '').slice(0, 300) : '',
      quality: g.renderer && g.renderer.quality,
      webgl: !!(g.renderer && g.renderer.gl),
      canvas: (() => {
        const c = document.querySelector('#world');
        return c ? { w: c.width, h: c.height, clientW: c.clientWidth, clientH: c.clientHeight } : null;
      })()
    };
  });
}

export async function closeDialogs(page) {
  await page.evaluate(() => {
    if (window.MoonCinema && window.MoonCinema.playing) {
      try { window.MoonCinema.skip(); } catch { /* skip is best-effort */ }
    }
    document.querySelectorAll('dialog[open]').forEach(d => {
      try { d.close(); } catch { d.removeAttribute('open'); }
    });
  });
}

export async function startExpedition(page) {
  await page.waitForFunction(() => window.MoonGame && window.MoonCore && document.querySelector('#begin'), null, { timeout: 120000 });
  await page.waitForFunction(() => window.MoonCinema || document.documentElement.classList.contains('mk-ready'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(250);
  const boot = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      now: performance.now(),
      responseEnd: nav ? nav.responseEnd : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      loadEvent: nav ? nav.loadEventEnd : null,
      moonBuild: window.MoonBuild || null,
      scripts: document.scripts.length
    };
  });
  await page.locator('#begin').click({ timeout: 15000 });
  await page.waitForTimeout(500);
  const skippedCinema = await page.evaluate(() => {
    if (window.MoonCinema && window.MoonCinema.playing) {
      window.MoonCinema.skip();
      return true;
    }
    return false;
  });
  await page.waitForFunction(
    () => window.MoonGame && window.MoonGame.running && !(window.MoonCinema && window.MoonCinema.playing),
    null,
    { timeout: 20000 }
  );
  await page.waitForTimeout(600);
  await closeDialogs(page);
  await page.waitForTimeout(200);
  return { boot, skippedCinema };
}

const MOVE_KEYS = ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export async function releaseMove(page) {
  for (const key of MOVE_KEYS) {
    await page.keyboard.up(key).catch(() => {});
  }
}

/** Camera-relative WASD. ix>0 is D, iz>0 is S, matching game.js frame(). */
export function keysFor(dx, dz, camYaw) {
  const ix = Math.cos(camYaw) * dx - Math.sin(camYaw) * dz;
  const iz = Math.sin(camYaw) * dx + Math.cos(camYaw) * dz;
  const keys = [];
  if (ix > 0.2) keys.push('d');
  else if (ix < -0.2) keys.push('a');
  if (iz > 0.2) keys.push('s');
  else if (iz < -0.2) keys.push('w');
  if (!keys.length) keys.push(Math.abs(ix) >= Math.abs(iz) ? (ix >= 0 ? 'd' : 'a') : (iz >= 0 ? 's' : 'w'));
  return keys;
}

export async function holdKeys(page, keys, ms) {
  await releaseMove(page);
  for (const key of keys) await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await releaseMove(page);
}

export async function dismissOverlays(page) {
  await closeDialogs(page);
  await page.evaluate(() => {
    const goal = document.querySelector('#first-goal .fg-ok');
    if (goal) goal.click();
    document.querySelector('#first-goal')?.remove();
  });
}

/** Key events the game actually listens for (window keydown → keys[e.key]). */
export async function dispatchHold(page, keys, ms) {
  await page.evaluate(({ keys, ms }) => new Promise(resolve => {
    for (const key of keys) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    setTimeout(() => {
      for (const key of keys) window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      resolve(true);
    }, ms);
  }), { keys, ms });
}

export async function keyboardNudge(page, key, ms) {
  await dismissOverlays(page);
  await page.evaluate(() => {
    window.__qaKeys = [];
    if (window.__qaKeyHook) return;
    window.__qaKeyHook = true;
    window.addEventListener('keydown', event => {
      window.__qaKeys.push({ key: event.key, code: event.code || '', trusted: event.isTrusted });
    }, true);
  });
  const before = await readProbe(page);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
  const afterCdp = await readProbe(page);
  const cdpMoved = before && afterCdp ? Math.hypot(afterCdp.x - before.x, afterCdp.z - before.z) : 0;
  const seen = await page.evaluate(() => (window.__qaKeys || []).slice(0, 8));
  let after = afterCdp;
  let moved = cdpMoved;
  let via = 'playwright-keyboard';
  if (moved < 0.25) {
    const again = await readProbe(page);
    await dispatchHold(page, [key.length === 1 ? key.toLowerCase() : key], ms);
    after = await readProbe(page);
    const dispatched = again && after ? Math.hypot(after.x - again.x, after.z - again.z) : 0;
    if (dispatched > moved) {
      moved = dispatched;
      via = 'in-page-KeyboardEvent';
    }
  }
  return { before, after, moved, via, cdpMoved, seen };
}

export async function pointerDrag(page, selector, from, to, steps = 12) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x1 = box.x + box.width * from.x;
  const y1 = box.y + box.height * from.y;
  const x2 = box.x + box.width * to.x;
  const y2 = box.y + box.height * to.y;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps });
  await page.mouse.up();
  return { x1, y1, x2, y2, box };
}

export async function joystickHold(page, ms) {
  const box = await page.locator('#joystick').boundingBox();
  if (!box) throw new Error('joystick missing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.evaluate(() => {
    const el = document.querySelector('#joystick');
    window.__qaJoyPtr = 0;
    if (!el || el.dataset.qaJoyHook) return;
    el.dataset.qaJoyHook = '1';
    el.addEventListener('pointerdown', () => { window.__qaJoyPtr += 1; }, true);
  });
  const before = await readProbe(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - box.height * 0.28, { steps: 6 });
  await page.waitForTimeout(ms);
  await page.mouse.up();
  const after = await readProbe(page);
  const pointerdowns = await page.evaluate(() => window.__qaJoyPtr || 0);
  const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
  return { before, after, moved, box, pointerdowns };
}

/** Real touch events via CDP, then a short hold with the stick pushed up. */
export async function touchJoystickHold(page, ms) {
  const box = await page.locator('#joystick').boundingBox();
  if (!box) throw new Error('joystick missing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const ty = cy - box.height * 0.28;
  const before = await readProbe(page);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: cx, y: cy, id: 1 }]
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: cx, y: ty, id: 1 }]
  });
  await page.waitForTimeout(ms);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach().catch(() => {});
  const after = await readProbe(page);
  const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : 0;
  return { before, after, moved };
}

export function yawDelta(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export async function sampleFrames(page, budgetMs = 4000) {
  return page.evaluate(ms => new Promise(resolve => {
    const dts = [];
    const t0 = performance.now();
    let last = t0;
    const step = t => {
      dts.push(t - last);
      last = t;
      if (t - t0 < ms) requestAnimationFrame(step);
      else {
        const body = dts.slice(1);
        const sum = body.reduce((a, b) => a + b, 0);
        const avg = body.length ? sum / body.length : 0;
        const sorted = [...body].sort((a, b) => a - b);
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0;
        resolve({
          frames: body.length,
          budgetMs: ms,
          elapsedMs: +(t - t0).toFixed(1),
          avgFrameMs: +avg.toFixed(2),
          fps: avg ? +(1000 / avg).toFixed(3) : null,
          maxFrameMs: body.length ? +Math.max(...body).toFixed(2) : null,
          p95FrameMs: +p95.toFixed(2),
          method: 'requestAnimationFrame for a fixed wall-clock budget while the page is in the foreground'
        });
      }
    };
    requestAnimationFrame(step);
  }), budgetMs);
}

export async function heap(page) {
  return page.evaluate(() => {
    const m = performance.memory;
    if (!m) return { available: false, reason: 'performance.memory is not exposed in this browser' };
    return {
      available: true,
      usedJSHeapSize: m.usedJSHeapSize,
      totalJSHeapSize: m.totalJSHeapSize,
      jsHeapSizeLimit: m.jsHeapSizeLimit
    };
  });
}

export async function inputLatency(page) {
  return page.evaluate(() => new Promise(resolve => {
    const g = window.MoonGame;
    if (!g || !g.running) { resolve({ ms: null, reason: 'game not running' }); return; }
    const x0 = g.player.x;
    const z0 = g.player.z;
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    const tick = () => {
      const p = window.MoonGame.player;
      const moved = Math.hypot(p.x - x0, p.z - z0);
      const elapsed = performance.now() - t0;
      if (moved > 0.04 || elapsed > 8000) {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true }));
        resolve({
          ms: moved > 0.04 ? +elapsed.toFixed(1) : null,
          moved: +moved.toFixed(3),
          method: 'synthetic KeyboardEvent keydown until player xz changes by > 0.04 m'
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

export async function boxesInside(page, selectors) {
  const vp = page.viewportSize();
  const out = [];
  for (const sel of selectors) {
    const box = await page.locator(sel).boundingBox();
    if (!box) { out.push({ sel, present: false, inside: false }); continue; }
    const inside = box.width > 2 && box.height > 2
      && box.x >= -2 && box.y >= -2
      && box.x + box.width <= vp.width + 2
      && box.y + box.height <= vp.height + 2;
    out.push({
      sel, present: true, inside,
      x: +box.x.toFixed(1), y: +box.y.toFixed(1),
      w: +box.width.toFixed(1), h: +box.height.toFixed(1)
    });
  }
  return { viewport: vp, controls: out };
}

export async function steerTo(page, target, budgetMs) {
  const started = Date.now();
  const samples = [];
  const stuckEvents = [];
  let stuckMs = 0;
  let last = null;
  while (Date.now() - started < budgetMs) {
    await closeDialogs(page);
    const pose = await readProbe(page);
    if (!pose || !pose.running) {
      samples.push({ t: Date.now() - started, running: false });
      break;
    }
    const dx = target.x - pose.x;
    const dz = target.z - pose.z;
    const dist = Math.hypot(dx, dz);
    samples.push({ t: Date.now() - started, x: +pose.x.toFixed(2), z: +pose.z.toFixed(2), dist: +dist.toFixed(2), blocked: pose.blocked, questId: pose.questId });
    if (dist < 3.15 && pose.alt < 1.1) {
      await releaseMove(page);
      await page.keyboard.press('e');
      await page.waitForTimeout(400);
      const after = await readProbe(page);
      return { reached: true, samples, stuckEvents, after, dist };
    }
    if (last && Math.hypot(pose.x - last.x, pose.z - last.z) < 0.05) {
      stuckMs += 250;
      if (stuckMs >= 1000) {
        stuckEvents.push({ t: Date.now() - started, x: pose.x, z: pose.z, dist });
        await releaseMove(page);
        await page.keyboard.down('a');
        await page.waitForTimeout(450);
        await page.keyboard.up('a');
        stuckMs = 0;
      }
    } else stuckMs = 0;
    last = pose;
    const keys = keysFor(dx, dz, pose.camYaw || 0);
    // The sim clamps dt to 45 ms, so a short tap can fall between frames on a slow GPU.
    await dispatchHold(page, keys, 1600);
  }
  await releaseMove(page);
  const end = await readProbe(page);
  return { reached: false, samples, stuckEvents, after: end };
}
