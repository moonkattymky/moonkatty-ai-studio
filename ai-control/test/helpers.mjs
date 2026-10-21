import { expect } from '@playwright/test';
export const STAGE_RE = /Будет доступно на этапе [23]|Available in stage [23]/;
/** Attach console/CSP/network guards to a page. Returns the collected problems. */
export async function guard(page, baseURL) {
  const g = { console: [], csp: [], external: [] };
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('console', (m) => { if (m.type() === 'error') g.console.push(m.text()); });
  page.on('pageerror', (e) => g.console.push(String(e)));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(baseURL) && !u.startsWith('data:')) g.external.push(u); });
  g.check = async () => {
    const csp = await page.evaluate(() => window.__csp || []).catch(() => []);
    expect(g.console, 'console errors').toEqual([]);
    expect([...g.csp, ...csp], 'CSP violations').toEqual([]);
    expect(g.external, 'non same-origin requests').toEqual([]);
  };
  return g;
}
/** Full page load of `hash` with a clean local DEMO state. */
export async function fresh(page, hash) {
  if (!page.__aicInit) {
    page.__aicInit = true;
    await page.addInitScript(() => { try { if (location.protocol.startsWith('http') && !sessionStorage.getItem('aic-keep')) localStorage.clear(); } catch { /* about:blank */ } });
  }
  await page.goto('about:blank');
  await page.goto('./' + hash);
  await page.waitForSelector('#view .screen');
}
