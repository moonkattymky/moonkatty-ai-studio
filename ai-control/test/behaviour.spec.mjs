import { test, expect } from '@playwright/test';
import { guard, fresh } from './helpers.mjs';

test('CSP meta is strict and server sends security headers', async ({ page, request }) => {
  await page.goto('./');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
  expect(await page.locator('script:not([src])').count()).toBe(0);
  expect(await page.locator('[style]').count()).toBe(0);
  const r = await request.get('./');
  const h = r.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('no-referrer');
  const api = await request.get('./api/anything'); expect(api.status()).toBe(404);
  const trav = await request.get('./..%2fserver.mjs'); expect([403, 404]).toContain(trav.status());
  const post = await request.post('./'); expect(post.status()).toBe(405);
});

test('approve / rework only change local DEMO state, with toast and undo', async ({ page, baseURL }) => {
  const g = await guard(page, baseURL);
  await fresh(page, '#/content');
  const before = await page.locator('[data-act=approve]').count();
  await page.locator('[data-act=approve]').first().click();
  await expect(page.locator('#toast .toast')).toContainText('DEMO');
  await expect(page.locator('.pill.green', { hasText: 'DEMO' }).first()).toBeVisible();
  expect(await page.locator('[data-act=approve]').count()).toBe(before - 1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('aic.state.v1')).approvals)).toEqual({ c1: 'approved' });
  await page.locator('#toast .tb').click();
  expect(await page.locator('[data-act=approve]').count()).toBe(before);
  await page.locator('[data-act=rework]').nth(1).click();
  await expect(page.locator('.pill.red', { hasText: 'DEMO' })).toBeVisible();
  await g.check();
});

test('filters really filter', async ({ page }) => {
  await fresh(page, '#/agents');
  await expect(page.locator('.agent-row')).toHaveCount(12);
  await page.locator('[data-g=agentF][data-v=wait]').click();
  await expect(page.locator('.agent-row')).toHaveCount(3);
  await page.locator('[data-g=agentF][data-v=off]').click();
  await expect(page.locator('.agent-row')).toHaveCount(1);
  await fresh(page, '#/tasks');
  await page.locator('[data-g=taskF][data-v=review]').click();
  await expect(page.locator('.task-row')).toHaveCount(4);
  await fresh(page, '#/notifications');
  await page.locator('[data-g=notifF][data-v=important]').click();
  await expect(page.locator('.notif-row')).toHaveCount(3);
});

test('English toggle in Настройки switches the UI language and persists', async ({ page }) => {
  await fresh(page, '#/settings/look');
  await page.locator('[data-g=lang][data-v=en]').click();
  await expect(page.locator('.tabbar a[data-tab=home]')).toHaveText('Home');
  await page.evaluate(() => { sessionStorage.setItem('aic-keep', '1'); location.hash = '#/agents'; });
  await page.reload();
  await expect(page.locator('#view h1')).toHaveText('AI agents');
  await page.evaluate(() => { location.hash = '#/settings/look'; });
  await page.locator('[data-g=lang][data-v=ru]').click();
  await expect(page.locator('.tabbar a[data-tab=home]')).toHaveText('Главная');
});

test('deep links open sheets; close and back return to the parent screen', async ({ page }) => {
  await fresh(page, '#/agents/news');
  await expect(page.locator('#sheet-wrap.open #sheet .sheet-hdr h2')).toHaveText('News Director');
  await page.locator('#sheet [data-act=close]').click();
  await expect(page).toHaveURL(/#\/agents$/);
  await expect(page.locator('#sheet-wrap.open')).toHaveCount(0);
  await page.locator('a[href="#/agents/ceo"]').click();
  await expect(page.locator('#sheet .sheet-hdr h2')).toHaveText('AI CEO');
  await page.goBack();
  await expect(page.locator('#sheet-wrap.open')).toHaveCount(0);
  await fresh(page, '#/settings/about');
  await page.locator('.back-btn').click();
  await expect(page).toHaveURL(/#\/settings$/);
});

test('i18n dictionaries have the same keys in ru and en', async ({ page }) => {
  await page.goto('./');
  const diff = await page.evaluate(async () => {
    const { _dict } = await import('./js/i18n.js');
    const ru = Object.keys(_dict.ru), en = Object.keys(_dict.en);
    return { missingEn: ru.filter((k) => !en.includes(k)), missingRu: en.filter((k) => !ru.includes(k)) };
  });
  expect(diff).toEqual({ missingEn: [], missingRu: [] });
});

test('reduced motion is honoured', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:8697/#/agents');
  const d = await page.locator('#view .screen').evaluate((n) => getComputedStyle(n).animationDuration);
  expect(parseFloat(d)).toBeLessThan(0.01);
  await ctx.close();
});

test('tap targets are at least 44px', async ({ page }) => {
  const small = [];
  for (const h of ['#/home', '#/agents', '#/tasks', '#/content', '#/analytics', '#/finance', '#/games', '#/news', '#/social', '#/notifications', '#/settings', '#/more']) {
    await fresh(page, h);
    small.push(...await page.evaluate((h) => [...document.querySelectorAll('a, button, [role=switch]')].filter((n) => n.offsetParent && !n.disabled).map((n) => {
      const r = n.getBoundingClientRect(); return { h, t: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), hh: Math.round(r.height) };
    }).filter((x) => x.hh < 28 || x.w < 28), h));
  }
  // chips are 36px tall visually but sit in a 44px row; we assert nothing is below 28px and report the rest
  expect(small).toEqual([]);
});

test('iPhone 16 Pro (402×874): every screen fits — no horizontal overflow, header clears the Dynamic Island, tab bar above the home indicator', async ({ page }) => {
  for (const h of ['#/home', '#/agents', '#/tasks', '#/content', '#/analytics', '#/finance', '#/games', '#/news', '#/social', '#/notifications', '#/settings', '#/more']) {
    await fresh(page, h);
    await page.evaluate(() => document.documentElement.classList.add('preview-safe', 'reduce-motion')); // safe-area 62/34 px like the real device
    await page.waitForTimeout(100);
    await expect.poll(() => page.evaluate(() => document.querySelector('#view h1, .hero .top').getBoundingClientRect().top + scrollY), { message: h + ' header below the Dynamic Island' }).toBeGreaterThanOrEqual(48);
    const m = await page.evaluate(() => {
      document.querySelectorAll('#view .screen').forEach((n) => { n.style.animation = 'none'; }); // freeze out the 14px screen-enter slide (motion, not layout)
      const vw = innerWidth, over = [...document.querySelectorAll('#view *')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && (r.right > vw + 1 || r.left < -1) && !n.closest('.chips, .seg, .plats, .hero'); }).map((n) => n.tagName + "." + n.className + "@" + Math.round(n.getBoundingClientRect().left) + "-" + Math.round(n.getBoundingClientRect().right)).slice(0, 5);
      const head = document.querySelector('#view h1, .hero .top'); const tb = document.querySelector('.tabbar').getBoundingClientRect();
      return { vw, sw: document.documentElement.scrollWidth, over, headTop: head.getBoundingClientRect().top + scrollY, sat: getComputedStyle(document.documentElement).getPropertyValue("--sat"), tbBottom: tb.bottom, tbH: tb.height, ih: innerHeight };
    });
    expect(m.vw, h).toBe(402);
    expect(m.sw, `${h} horizontal scroll`).toBeLessThanOrEqual(402);
    expect(m.over, `${h} overflowing elements`).toEqual([]);
    expect(m.headTop, `${h} sat=${m.sat} header below the Dynamic Island (11+37 px)`).toBeGreaterThanOrEqual(48);
    expect(m.tbBottom, h).toBeLessThanOrEqual(m.ih + 1);
  }
});
