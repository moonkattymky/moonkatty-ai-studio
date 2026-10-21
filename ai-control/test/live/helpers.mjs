import { expect } from '@playwright/test';
import { TEST_USER, TEST_PASSWORD, url, EMPTY } from './fixture.mjs';
export { guard } from '../helpers.mjs';
/** Log in through the proxy's own endpoint (same as the login screen does); the context keeps the httpOnly cookie. */
export async function liveLogin(page, port = EMPTY.proxy, password = TEST_PASSWORD) {
  const r = await page.request.post(url(port, '/aic/login'), { headers: { 'x-aic-request': '1', 'content-type': 'application/json', origin: url(port, '').replace(/\/$/, '') }, data: { username: TEST_USER, password } });
  return r;
}
export async function open(page, hash, port = EMPTY.proxy) {
  await page.goto('about:blank');
  await page.goto(url(port, '/' + hash));
  await page.waitForSelector('#view .screen');
  await expect(page.locator('.login-screen')).toHaveCount(0);
}
/** Record every request the page makes, to prove only GET/allowlisted calls leave the browser. */
export function recordRequests(page) {
  const list = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api') || u.pathname.startsWith('/aic')) list.push(`${r.method()} ${u.pathname}`); });
  return list;
}
