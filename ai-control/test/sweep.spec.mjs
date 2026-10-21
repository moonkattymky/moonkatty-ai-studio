// Automated sweep: every visible a / button / [role=button] / [role=switch] on every screen and sub-screen must
// either DO something (hash change, DOM/state change, toast, scroll) or be disabled AND say «Будет доступно на этапе 2/3».
import { test, expect } from '@playwright/test';
import { SCREENS, SUBS } from './screens.mjs';
import { guard, fresh, STAGE_RE } from './helpers.mjs';

const SEL = 'a, button, [role=button], [role=switch]';
const ROUTES = [...SCREENS.map((s) => s.hash), ...SUBS];

for (const route of ROUTES) {
  test(`sweep ${route}`, async ({ page, baseURL }) => {
    const g = await guard(page, baseURL);
    await fresh(page, route);
    const scope = (await page.locator('#sheet-wrap.open').count()) ? '#sheet' : 'body';
    const count = await page.locator(`${scope} ${SEL}`).count();
    const report = [];
    for (let i = 0; i < count; i++) {
      await fresh(page, route);
      const el = page.locator(`${scope} ${SEL}`).nth(i);
      if (!(await el.isVisible())) continue;
      // scroll into view, but skip elements fully hidden under the fixed tab bar after scrolling (still reachable by scroll)
      await el.scrollIntoViewIfNeeded();
      const info = await el.evaluate((n) => ({
        tag: n.tagName.toLowerCase(), text: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 40),
        disabled: n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true',
        note: (n.closest('.disabled-block, .logout, .row')?.textContent || '') + ' ' + (n.getAttribute('aria-label') || ''),
        current: n.getAttribute('aria-current') === 'page',
      }));
      if (info.disabled) {
        expect(info.note, `disabled «${info.text}» on ${route} must explain stage`).toMatch(STAGE_RE);
        report.push(`disabled: ${info.text}`);
        continue;
      }
      const before = await page.evaluate(() => {
        window.__mut = 0;
        window.__mo?.disconnect();
        window.__mo = new MutationObserver((l) => { window.__mut += l.length; });
        window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        return { hash: location.hash, y: scrollY };
      });
      if (info.current) { report.push(`current-tab: ${info.text}`); continue; } // the active tab is the location indicator
      await el.click();
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => ({ hash: location.hash, mut: window.__mut, toast: !!document.querySelector('#toast .toast') }));
      const did = after.hash !== before.hash || after.mut > 0 || after.toast;
      expect(did, `«${info.text}» (${info.tag} #${i}) on ${route} did nothing`).toBeTruthy();
      report.push(`${after.hash !== before.hash ? 'nav→' + after.hash : after.toast ? 'toast' : 'state'}: ${info.text}`);
    }
    test.info().annotations.push({ type: 'sweep', description: `${route}: ${report.length} elements — ` + report.join(' | ') });
    expect(report.length, `no interactive elements found on ${route}`).toBeGreaterThan(0);
    await g.check();
  });
}
