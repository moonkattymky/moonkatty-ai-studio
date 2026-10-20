// Headless check of the Mobile Control Center page (iPhone viewport, CSP errors, all tabs render).
// Usage: node scripts/mobile-ui-test.mjs <url> <user> <pass> [screenshotDir]   (server must run with STUDIO_OPS_MOBILE=1)
import { chromium } from 'playwright-core';
const [url, user, pass, dir = '/tmp'] = process.argv.slice(2); const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
const login = await fetch(url + '/api/auth/login', { method: 'POST', headers: R, body: JSON.stringify({ username: user, password: pass }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
const { token, id: tokId } = await (await fetch(url + '/api/ops/mobile-tokens', { method: 'POST', headers: { ...R, cookie }, body: JSON.stringify({ label: 'ui-test', ttlDays: 1 }) })).json();
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(url + '/mobile.html'); await p.fill('#tok', token); await p.click('#save'); await p.waitForSelector('#app .card');
const tabs = {}; for (const v of ['summary', 'tasks', 'materials', 'media', 'alerts']) { await p.click(`nav button[data-v=${v}]`); await p.waitForTimeout(500);
  tabs[v] = !(await p.isVisible('#app .card.err')); await p.screenshot({ path: `${dir}/mobile-${v}.png` }); }
const stored = await p.evaluate(() => localStorage.getItem('mk_mobile_token')) === token;
await b.close(); await fetch(url + '/api/ops/mobile-tokens/' + tokId, { method: 'DELETE', headers: { ...R, cookie } }); // revoke the test token
const ok = !errors.length && Object.values(tabs).every(Boolean) && stored;
console.log(JSON.stringify({ ok, tabs, errors }, null, 1)); process.exit(ok ? 0 : 1);
