// Renders one PNG per screen at iPhone 15 Pro size (393×852 @3x) with an emulated iOS status bar,
// plus reference-vs-implementation comparison sheets and a 6×2 contact sheet (via tools/compose.py).
import { webkit, chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { SCREENS, BASE } from './screens.mjs';
const OUT = process.env.AIC_OUT || '/workspace/out/ai-control';
await mkdir(OUT + '/screens', { recursive: true });
let browser, engine = 'webkit';
try { browser = await webkit.launch(); } catch { engine = 'chromium'; browser = await chromium.launch(); }
// iPhone 15 Pro profile, but with the full 393×852 screen: the PWA runs standalone (no Safari toolbars)
const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
for (const s of SCREENS) {
  await page.goto(BASE + s.hash);
  await page.waitForSelector('.screen');
  await page.evaluate(() => {
    document.documentElement.classList.add('preview-safe', 'reduce-motion');
    if (!document.getElementById('fake-sb')) {
      const sb = document.createElement('div'); sb.id = 'fake-sb';
      Object.assign(sb.style, { position: 'fixed', top: '0', left: '0', right: '0', height: '54px', zIndex: '100', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 30px 0 44px', pointerEvents: 'none', color: '#fff', font: '600 17px -apple-system, Inter, sans-serif' });
      sb.innerHTML = '<span>9:41</span><svg viewBox="0 0 78 14" width="78" height="14"><g fill="#fff"><rect x="0" y="9" width="3.4" height="4" rx="1"/><rect x="5" y="6.5" width="3.4" height="6.5" rx="1"/><rect x="10" y="4" width="3.4" height="9" rx="1"/><rect x="15" y="1" width="3.4" height="12" rx="1"/><path d="M31 3.2a11 11 0 0 1 14 0l-1.6 1.7a8.6 8.6 0 0 0-10.8 0Zm3 3.2a6.6 6.6 0 0 1 8 0l-1.7 1.7a4.2 4.2 0 0 0-4.6 0ZM38 13l-2.2-2.3a3 3 0 0 1 4.4 0Z"/><rect x="52" y="1.5" width="22" height="11" rx="3.2" fill="none" stroke="#fff" stroke-opacity=".5"/><rect x="54" y="3.5" width="18" height="7" rx="1.8"/><rect x="75" y="5" width="1.6" height="4" rx=".8" fill-opacity=".5"/></g></svg>';
      Object.assign(sb.querySelector('svg').style, { width: '78px', height: '14px' });
      document.body.append(sb);
      const di = document.createElement('div');
      Object.assign(di.style, { position: 'fixed', top: '11px', left: '50%', width: '124px', height: '36px', marginLeft: '-62px', borderRadius: '20px', background: '#000', zIndex: '101', pointerEvents: 'none' });
      document.body.append(di);
      const hi = document.createElement('div');
      Object.assign(hi.style, { position: 'fixed', bottom: '8px', left: '50%', width: '134px', height: '5px', marginLeft: '-67px', borderRadius: '3px', background: 'rgba(255,255,255,.85)', zIndex: '101', pointerEvents: 'none' });
      document.body.append(hi);
    }
  });
  await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 2500)), Promise.all([...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).map((i) => i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); })))]));
  await page.waitForTimeout(150);
  const f = `${OUT}/screens/${String(s.n).padStart(2, '0')}-${s.slug}.png`;
  await page.screenshot({ path: f, caret: 'initial' });
  console.log('shot', f);
}
await browser.close();
const appErrors = errors.filter((e) => !/Refused to apply a stylesheet/.test(e)); // Playwright's screenshot() injects a helper <style>; that is tooling, not the app
console.log('engine:', engine, 'app console errors:', appErrors.length ? appErrors : 'none');
