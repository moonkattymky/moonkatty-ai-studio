import { test, expect } from '@playwright/test';
import { guard } from './helpers.mjs';

const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

test('manifest is valid and icons exist with the declared sizes', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const res = await request.get(href);
  expect(res.ok()).toBeTruthy();
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const m = await res.json();
  expect(m.name).toBe('MOONKATTY AI CONTROL');
  expect(m.display).toBe('standalone');
  expect(m.theme_color).toMatch(/^#0[0-9a-f]{5}$/i);
  expect(m.background_color).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  const sizes = m.icons.map((i) => i.sizes);
  for (const s of ['180x180', '192x192', '512x512']) expect(sizes).toContain(s);
  for (const ic of m.icons) {
    const r = await request.get(ic.src);
    expect(r.ok(), ic.src).toBeTruthy();
    const { w, h } = pngSize(await r.body());
    expect(`${w}x${h}`).toBe(ic.sizes);
  }
  const apple = await page.locator('link[rel=apple-touch-icon]').getAttribute('href');
  const ar = await request.get(apple); expect(pngSize(await ar.body())).toEqual({ w: 180, h: 180 });
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /viewport-fit=cover/);
  await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', /^#/);
});

test('service worker registers, caches only static assets and never /api/*', async ({ page, browserName, baseURL }) => {
  const g = await guard(page, baseURL);
  await page.goto('./#/home');
  const hasSW = await page.evaluate(() => 'serviceWorker' in navigator);
  test.skip(!hasSW, `serviceWorker API not available in Playwright ${browserName}`);
  const state = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, active: !!r.active }; });
  expect(state.active).toBeTruthy();
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
  const result = await page.evaluate(async () => {
    const apiStatus = (await fetch('./api/status').catch(() => ({ status: 'err' }))).status;
    await fetch('./api/v1/agents').catch(() => 0);
    const keys = await caches.keys();
    const urls = [];
    for (const k of keys) { const c = await caches.open(k); for (const r of await c.keys()) urls.push(new URL(r.url).pathname); }
    return { keys, urls, apiStatus };
  });
  expect(result.keys.length).toBe(1);
  expect(result.keys[0]).toMatch(/^aic-static-[0-9a-f]{12}$/);
  expect(result.urls).toContain('/index.html');
  expect(result.urls).toContain('/js/demo-data.js');
  expect(result.urls.filter((u) => u.includes('/api'))).toEqual([]);
  expect(result.apiStatus).toBe(404); // goes to network (server has no API in stage 1)
  // the two intentional /api fetches log 'Failed to load resource: 404' — expected; anything else is an error
  g.console = g.console.filter((m) => !/status of 404/.test(m));
  await g.check();
});

test('works offline after first load (static cache)', async ({ page, context, browserName }) => {
  await page.goto('./#/home');
  const hasSW = await page.evaluate(() => 'serviceWorker' in navigator);
  test.skip(!hasSW, `serviceWorker API not available in Playwright ${browserName}`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.goto('./#/agents');
  await expect(page.locator('#view h1')).toContainText('AI-агенты');
  await context.setOffline(false);
});
