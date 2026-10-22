// Stage 2 verification (item 5): DEMO finance values can never appear as CONFIRMED.
// DEMO mode renders the Stage 1 data set; it must carry no CONFIRMED chip, no «confirmed revenue» label and no data-tag
// other than the plain DEMO chip, on every finance-bearing screen, sheet, period and currency.
import { test, expect } from '@playwright/test';
import { guard, fresh } from './helpers.mjs';

const CONFIRMED_SEL = '[data-tag=CONFIRMED], .tag-confirmed';
const CONFIRMED_TXT = /ПОДТВЕРЖДЕНО|CONFIRMED|Подтверждённая выручка|Confirmed revenue/;

test('DEMO mode: finance / home / analytics / source sheets never show a CONFIRMED value', async ({ page, baseURL }) => {
  const g = await guard(page, baseURL);
  const cfg = await (await page.request.get('/aic/config')).json();
  expect(cfg.mode).toBe('demo');
  for (const hash of ['#/home', '#/analytics', '#/finance', '#/finance/yt', '#/finance/tt', '#/finance/tg', '#/finance/ig', '#/finance/xm', '#/settings/profile', '#/more']) {
    await fresh(page, hash);
    await expect(page.locator(CONFIRMED_SEL), hash).toHaveCount(0);
    expect(await page.locator('body').innerText(), hash).not.toMatch(CONFIRMED_TXT);
  }
  await fresh(page, '#/finance');
  await expect(page.locator('.total-card')).toContainText('DEMO');
  for (const per of ['7', '30', '90', 'year']) {
    const chip = page.locator(`[data-g=finPeriod][data-v="${per}"]`).first();
    if (await chip.count()) await chip.click().catch(() => {});
    for (let i = 0; i < 4; i++) {
      await page.locator('[data-act=currency]').click();
      await expect(page.locator(CONFIRMED_SEL)).toHaveCount(0);
      await expect(page.locator('.total-card')).toContainText('DEMO');
    }
  }
  await page.waitForTimeout(300);
  await g.check();
});
