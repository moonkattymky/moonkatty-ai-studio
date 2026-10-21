import { test, expect } from '@playwright/test';
import { SCREENS, SUBS } from './screens.mjs';
import { guard, fresh } from './helpers.mjs';

for (const s of SCREENS) {
  test(`screen ${s.n} «${s.title}» renders with DEMO badge, no console/CSP errors`, async ({ page, baseURL }) => {
    const g = await guard(page, baseURL);
    await fresh(page, s.hash);
    if (s.n === 1) await expect(page.locator('.hero h2')).toContainText('9 Lives.');
    else await expect(page.locator('#view h1').first()).toContainText(s.title);
    const badge = page.locator('#demo-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/DEMO/);
    const box = await badge.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    await expect(page.locator('.tabbar a')).toHaveCount(5);
    await page.waitForTimeout(300);
    await g.check();
  });
}

for (const h of SUBS) {
  test(`sub-screen ${h} renders (page or sheet) with DEMO badge`, async ({ page, baseURL }) => {
    const g = await guard(page, baseURL);
    await fresh(page, h);
    const sheetOpen = await page.locator('#sheet-wrap.open').count();
    if (sheetOpen) await expect(page.locator('#sheet .sheet-hdr h2')).toBeVisible();
    else { await expect(page.locator('.back-btn')).toBeVisible(); await expect(page.locator('#view h1')).toBeVisible(); }
    await expect(page.locator('#view h1, #sheet .sheet-hdr h2').first()).not.toHaveText(/не найден|not found/i);
    await expect(page.locator('#demo-badge')).toBeVisible();
    await g.check();
  });
}

test('financial and analytics totals carry a DEMO chip', async ({ page }) => {
  for (const h of ['#/finance', '#/analytics', '#/home']) {
    await fresh(page, h);
    expect(await page.locator('#view .demo-chip').count(), h).toBeGreaterThan(0);
  }
});

test('unknown route shows a not-found screen with a way home', async ({ page }) => {
  await fresh(page, '#/nope');
  await expect(page.locator('#view h1')).toHaveText(/не найден/);
  await page.locator('#view a[href="#/home"]').click();
  await expect(page).toHaveURL(/#\/home$/);
});
