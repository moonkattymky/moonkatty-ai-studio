// LIVE mode against real MOONKATTY AI STUDIO servers (integ d1adf4d, TEST flavour, temp DBs). See fixture.mjs / live.config.mjs.
import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { EMPTY, SEEDED, IDLE, TEST_USER, TEST_PASSWORD, LOGS, CTL_RE, url } from './fixture.mjs';
import { SEED } from './seed.mjs';
import { guard, liveLogin, open, recordRequests } from './helpers.mjs';
import { SCREENS } from '../screens.mjs';

const ALLOWED_GETS = ['/api/health', '/api/system', '/api/runtime', '/api/agents', '/api/tasks', '/api/jobs', '/api/episodes', '/api/channels', '/api/posts', '/api/queue', '/api/files',
  '/api/projects', '/api/logs', '/api/reports', '/api/world/mission', '/api/world/command-center', '/api/world/approvals', '/api/ops/nodes', '/api/ops/update-center', '/api/backups'];
const studioGet = async (port, p) => { // direct Studio read (test oracle only)
  const r = await fetch(url(port, '/api/auth/login'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ username: TEST_USER, password: TEST_PASSWORD }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return (await fetch(url(port, p), { headers: { cookie } })).json();
};

test.describe('auth', () => {
  test('login screen → wrong password rejected → correct password opens the live home; no DEMO badge', async ({ page, baseURL }) => {
    const g = await guard(page, baseURL);
    await page.goto('./#/home');
    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('.tabbar')).toBeHidden();
    await expect(page.locator('#demo-badge')).toHaveCount(0);
    await page.fill('#lg-user', TEST_USER); await page.fill('#lg-pass', 'wrong-password-xyz');
    await page.click('[data-act=login]');
    await expect(page.locator('#lg-msg')).toHaveText(/Неверный логин или пароль/);
    await expect(page.locator('#lg-pass')).toHaveValue('');
    await page.fill('#lg-pass', TEST_PASSWORD); await page.locator('#lg-pass').press('Enter');
    await expect(page.locator('.hero h2')).toContainText('9 Lives.');
    await expect(page.locator('.tabbar a')).toHaveCount(5);
    await expect(page.locator('#demo-badge')).toHaveCount(0);
    expect(await page.locator('#view [data-tag]').count()).toBeGreaterThan(0);
    const cookies = await page.context().cookies();
    const sid = cookies.find((c) => c.name === 'aic_sid');
    expect(sid.httpOnly).toBe(true); expect(sid.sameSite).toBe('Strict');
    expect(cookies.map((c) => c.name)).not.toContain('mk_session'); // the Studio session never reaches the browser
    g.console = g.console.filter((m) => !/status of 401/.test(m)); // the intentional wrong-password attempt
    await g.check();
  });

  test('logout ends the session (UI → login, API → 401)', async ({ page }) => {
    await liveLogin(page);
    await open(page, '#/more');
    await page.click('[data-act=logout]');
    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('#lg-msg')).toHaveText(/Вы вышли/);
    expect((await page.request.get(url(EMPTY.proxy, '/api/health'))).status()).toBe(401);
    expect((await page.context().cookies()).find((c) => c.name === 'aic_sid')).toBeUndefined();
  });

  test('idle timeout: session expires after AIC_IDLE_SEC → 401 and the login screen says so', async ({ page }) => {
    expect((await liveLogin(page, IDLE.proxy)).status()).toBe(200);
    expect((await page.request.get(url(IDLE.proxy, '/api/health'))).status()).toBe(200);
    await page.waitForTimeout((IDLE.idleSec + 2) * 1000);
    const r = await page.request.get(url(IDLE.proxy, '/api/health'));
    expect(r.status()).toBe(401); expect((await r.json()).error).toBe('session_expired');
    await liveLogin(page, IDLE.proxy);
    await page.waitForTimeout((IDLE.idleSec + 2) * 1000);
    await page.goto(url(IDLE.proxy, '/#/home'));
    await expect(page.locator('.login-screen')).toBeVisible();
    await expect(page.locator('#lg-msg')).toHaveText(/Сессия истекла/);
  });
});

test.describe('proxy is read-only', () => {
  test('unauthenticated requests get 401', async ({ request }) => {
    for (const p of ['/api/health', '/api/agents', '/api/world/command-center', '/api/tasks']) {
      const r = await request.get(url(EMPTY.proxy, p), { headers: { cookie: '' } });
      expect(r.status(), p).toBe(401);
    }
    const forged = await request.get(url(EMPTY.proxy, '/api/agents'), { headers: { cookie: 'aic_sid=' + 'A'.repeat(43) } });
    expect(forged.status()).toBe(401);
  });

  test('non-GET → 405, non-allowlisted → 403, bad Host → 421, cross-site login → 403', async ({ page }) => {
    await liveLogin(page);
    const rq = page.request;
    for (const m of ['post', 'put', 'delete', 'patch']) {
      for (const p of ['/api/tasks', '/api/agents/ceo/start', '/api/world/import', '/api/ops/update-center/check', '/api/queue/x/publish', '/api/backups/run']) {
        const r = await rq[m](url(EMPTY.proxy, p), { headers: { 'x-studio-request': '1', 'content-type': 'application/json' }, data: '{}' });
        expect(r.status(), `${m} ${p}`).toBe(405);
      }
    }
    for (const p of ['/api/backup', '/api/integrations', '/api/meta/config', '/api/world/journal', '/api/ops/nodes/enroll', '/api/ops/nodes/jobs', '/api/ops/update-center/health', '/api/chat', '/api/auth/status', '/api/tasks/abc', '/api/jobs/abc', '/api/comments', '/api/opencode/auth', '/files/x.txt', '/api/%2e%2e/backup', '/api/../api/backup']) {
      const r = await rq.get(url(EMPTY.proxy, p));
      expect([403, 404], p).toContain(r.status());
      expect(r.status(), p).not.toBe(200);
    }
    expect((await rq.get(url(EMPTY.proxy, '/api/backup'))).status()).toBe(403);
    expect((await rq.get(url(EMPTY.proxy, '/api/health'))).status()).toBe(200);
    const bad = await rq.get(url(EMPTY.proxy, '/api/health'), { headers: { host: 'evil.example:' + EMPTY.proxy } });
    expect(bad.status()).toBe(421);
    const csrf = await rq.post(url(EMPTY.proxy, '/aic/login'), { headers: { 'content-type': 'application/json' }, data: { username: TEST_USER, password: TEST_PASSWORD } });
    expect(csrf.status()).toBe(403);
    const xs = await rq.post(url(EMPTY.proxy, '/aic/login'), { headers: { 'content-type': 'application/json', 'x-aic-request': '1', origin: 'http://evil.example' }, data: { username: TEST_USER, password: TEST_PASSWORD } });
    expect(xs.status()).toBe(403);
  });

  test('proxy answers carry no Studio cookie, no secrets and no-store', async ({ page }) => {
    await liveLogin(page);
    const studioToken = []; // the proxy never reveals it; we only check the shape of what comes back
    for (const p of ALLOWED_GETS) {
      const r = await page.request.get(url(EMPTY.proxy, p));
      expect(r.status(), p).toBe(200);
      const h = r.headers();
      expect(h['set-cookie'], p).toBeUndefined();
      expect(h['cache-control'], p).toBe('no-store');
      expect(h['content-security-policy'], p).toContain("default-src 'self'");
      const body = await r.text();
      expect(body, p).not.toContain(TEST_PASSWORD);
      expect(body, p).not.toMatch(/mk_session|passwordHash|"password"|scrypt|"dbPath"|"dataDir"|app-token|BEGIN [A-Z ]*PRIVATE KEY/);
      studioToken.push(body.length);
    }
  });
});

test.describe('screens (empty test DB)', () => {
  for (const s of SCREENS) {
    test(`screen ${s.n} «${s.title}» renders real values or «НЕТ ДАННЫХ», data-state chips, no console/CSP/external`, async ({ page, baseURL }) => {
      const g = await guard(page, baseURL);
      const reqs = recordRequests(page);
      await liveLogin(page);
      await open(page, s.hash);
      if (s.n === 1) await expect(page.locator('.hero h2')).toContainText('9 Lives.');
      else await expect(page.locator('#view h1').first()).toContainText(s.title);
      await expect(page.locator('#demo-badge')).toHaveCount(0);
      await expect(page.locator('.tabbar a')).toHaveCount(5);
      const tags = await page.locator('#view [data-tag]').evaluateAll((n) => n.map((x) => x.dataset.tag));
      if (![11, 12].includes(s.n)) expect(tags.length, 'data-state chips').toBeGreaterThan(0);
      for (const tg of tags) expect(['CONFIRMED', 'ESTIMATE', 'DEMO', 'NO_DATA']).toContain(tg);
      // nothing left from demo-data.js
      const txt = await page.locator('#view').innerText();
      expect(txt).not.toMatch(/\$3 450|3450|129K|News Director|Video Producer|MOONKATTY NEWS DAILY UPDATE|Сводка за октябрь/);
      expect(reqs.filter((r) => !r.startsWith('GET ')), 'only GET leaves the page').toEqual([]);
      for (const r of reqs) expect(r.replace(/^GET /, ''), 'allowlisted').toMatch(/^\/aic\/(config|session)$|^\/api\//);
      await g.check();
    });
  }

  test('values match the Studio (agents, channels, Mac mini, backups) and gaps show «НЕТ ДАННЫХ»', async ({ page }) => {
    const agents = await studioGet(EMPTY.studio, '/api/agents');
    const channels = await studioGet(EMPTY.studio, '/api/channels');
    const health = await studioGet(EMPTY.studio, '/api/health');
    await liveLogin(page);
    await open(page, '#/agents');
    await expect(page.locator('.agent-row')).toHaveCount(agents.length);
    await expect(page.locator('#view h1 + .sub, #view .sub').first()).toContainText(String(agents.length));
    await open(page, '#/home');
    await expect(page.locator('.stat').nth(0).locator('.val')).toHaveText(String(agents.length));
    await expect(page.locator('.stat').nth(2).locator('.val')).toHaveText(String(channels.length));
    await expect(page.locator('.stat').nth(3).locator('.val')).toHaveText('НЕТ ДАННЫХ'); // empty ledger
    await open(page, '#/tasks');
    await expect(page.locator('#list .empty')).toHaveText('НЕТ ДАННЫХ');
    await open(page, '#/finance');
    await expect(page.locator('.total-card .val')).toHaveText(/НЕТ ДАННЫХ/);
    expect(await page.locator('.total-card .val [data-tag=CONFIRMED]').count()).toBe(0);
    await open(page, '#/analytics');
    await expect(page.locator('.kpi').nth(0).locator('.val')).toHaveText('НЕТ ДАННЫХ'); // views: no Studio source
    await expect(page.locator('.kpi').nth(1)).toContainText('DEMO');                  // read-api is in mock mode
    await open(page, '#/settings/mac');
    await expect(page.locator('#view')).toContainText(health.version);
    await expect(page.locator('#view')).toContainText(health.product);
    await open(page, '#/settings/about');
    await expect(page.locator('#view')).toContainText('Update Center выключен');
    await open(page, '#/more/backup');
    await expect(page.locator('#view .kv')).toContainText('backup-');
    await open(page, '#/games');
    await expect(page.locator('.gstat .val').first()).toHaveText('НЕТ ДАННЫХ');
    await open(page, '#/news');
    await expect(page.locator('#view')).toContainText('В студии нет выпусков');
  });
});

test.describe('finance tags (seeded test DB)', () => {
  test('confirmed, estimate and DEMO are separate; DEMO/estimates never shown as confirmed', async ({ page }) => {
    await liveLogin(page, SEEDED.proxy);
    await open(page, '#/finance', SEEDED.proxy);
    const total = page.locator('.total-card .val');
    await expect(total).toContainText('$' + SEED.confirmed.toFixed(2));
    await expect(total.locator('[data-tag]')).toHaveAttribute('data-tag', 'CONFIRMED');
    const split = page.locator('.fin-split');
    await expect(split.locator('div').nth(0)).toContainText('$' + SEED.estimate.toFixed(2));
    await expect(split.locator('div').nth(0).locator('[data-tag]')).toHaveAttribute('data-tag', 'ESTIMATE');
    await expect(split.locator('div').nth(1)).toContainText('$' + SEED.accrued.toFixed(2));
    await expect(split.locator('div').nth(1).locator('[data-tag]')).toHaveAttribute('data-tag', 'ESTIMATE');
    await expect(split.locator('div').nth(2)).toContainText('DEMO');
    await expect(split.locator('div').nth(2)).toContainText(String(SEED.demo));
    await expect(split.locator('div').nth(2).locator('[data-tag]')).toHaveAttribute('data-tag', 'DEMO');
    // every CONFIRMED-tagged amount on the page is the real payout, never the estimate / accrual / demo amount
    const confirmedTexts = await page.locator('[data-tag=CONFIRMED]').evaluateAll((n) => n.map((x) => x.parentElement.textContent));
    expect(confirmedTexts.length).toBeGreaterThan(0);
    for (const tx of confirmedTexts) { expect(tx).not.toMatch(/DEMO|\$40\.00|\$10\.00|\$99\.00/); }
    const ytMain = page.locator('.src-row', { hasText: 'YouTube main' });
    await expect(ytMain).toContainText('$' + SEED.confirmed.toFixed(2));
    await expect(ytMain.locator('[data-tag]')).toHaveAttribute('data-tag', 'CONFIRMED');
    for (const name of ['YouTube NEWS', 'TikTok', 'X']) await expect(page.locator('.src-row', { hasText: name }).first().locator('.amt b')).toHaveText('НЕТ ДАННЫХ');
    await open(page, '#/home', SEEDED.proxy);
    await expect(page.locator('.stat').nth(3)).toContainText('$' + SEED.confirmed.toFixed(2));
    await expect(page.locator('.stat').nth(3).locator('[data-tag]')).toHaveAttribute('data-tag', 'CONFIRMED');
    await open(page, '#/analytics', SEEDED.proxy);
    await expect(page.locator('.kpi').nth(2)).toContainText('$' + SEED.confirmed.toFixed(2));
  });

  test('seeded task shows «На проверке» with approve/rework disabled; episode appears in News', async ({ page }) => {
    await liveLogin(page, SEEDED.proxy);
    await open(page, '#/tasks', SEEDED.proxy);
    const row = page.locator('.task-row', { hasText: 'TEST: проверить выпуск' });
    await expect(row).toContainText('На проверке');
    await row.click();
    await expect(page.locator('#sheet [data-ctl=off]').first()).toBeDisabled();
    await expect(page.locator('#sheet')).toContainText('Управление — после отдельного разрешения');
    await open(page, '#/news', SEEDED.proxy);
    await expect(page.locator('.ep-hero')).toContainText('TEST выпуск #1');
    await expect(page.locator('.ep-hero [data-ctl=off]').first()).toBeDisabled();
    // Update Center is mounted on this instance (STUDIO_OPS_UPDATE=1): status is shown read-only, install stays gated
    await open(page, '#/settings/about', SEEDED.proxy);
    await expect(page.locator('#view .kv')).toContainText(/Update Center.*установка только вручную/s);
  });
});

test.describe('storage, service worker, CSP', () => {
  test('no secrets in localStorage / sessionStorage / document.cookie / caches; SW never caches /api or /aic', async ({ page, browserName }) => {
    await page.goto('./#/home');
    await page.fill('#lg-user', TEST_USER); await page.fill('#lg-pass', TEST_PASSWORD); await page.click('[data-act=login]');
    await expect(page.locator('.hero')).toBeVisible();
    for (const h of ['#/agents', '#/finance', '#/settings/mac']) { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(300); }
    const st = await page.evaluate(async () => {
      const dump = JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage }, cookie: document.cookie });
      const urls = []; let keys = [];
      if (self.caches) { keys = await caches.keys(); for (const k of keys) { const c = await caches.open(k); for (const r of await c.keys()) urls.push(new URL(r.url).pathname); } }
      return { dump, urls, keys, sw: 'serviceWorker' in navigator };
    });
    expect(st.dump).not.toContain(TEST_PASSWORD);
    expect(st.dump).not.toMatch(/aic_sid|mk_session|password/i);
    expect(st.urls.filter((u) => /^\/(api|aic)\//.test(u))).toEqual([]);
    if (st.sw) {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload(); await page.waitForSelector('#view .screen');
      const urls = await page.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const r of await c.keys()) out.push(new URL(r.url).pathname); } return out; });
      expect(urls).toContain('/index.html');
      expect(urls.filter((u) => /^\/(api|aic)\//.test(u))).toEqual([]);
    } else test.info().annotations.push({ type: 'note', description: `${browserName}: no serviceWorker API in Playwright` });
  });

  test('proxy and Studio logs contain no password or session token', async ({ page }) => {
    await liveLogin(page); await liveLogin(page, EMPTY.proxy, 'wrong-password-xyz');
    await page.waitForTimeout(500);
    for (const f of [`${LOGS}/proxy-${EMPTY.proxy}.log`, `${LOGS}/proxy-${SEEDED.proxy}.log`, `${LOGS}/proxy-${IDLE.proxy}.log`]) {
      const log = await readFile(f, 'utf8');
      expect(log, f).not.toContain(TEST_PASSWORD);
      expect(log, f).not.toContain('wrong-password-xyz');
      expect(log, f).not.toMatch(/mk_session|aic_sid=|[a-f0-9]{64}/);
      expect(log, f).toMatch(/GET \/api\/health 200|POST \/aic\/login/);
    }
  });

  test('CSP still holds in LIVE mode (header + meta, no inline, connect-src self)', async ({ page, request }) => {
    const r = await request.get('./');
    expect(r.headers()['content-security-policy']).toMatch(/connect-src 'self'.*frame-ancestors 'none'/);
    await liveLogin(page); await open(page, '#/home');
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self'"); expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|https?:/);
    expect(await page.locator('script:not([src])').count()).toBe(0);
    expect(await page.locator('[style]:not(#fake-sb)').count()).toBe(0);
  });
});

/* ---------- clickable sweep (LIVE): everything works or is disabled with «Управление — после отдельного разрешения» ---------- */
const LIVE_ROUTES = [...SCREENS.map((s) => s.hash), '#/agents/ceo', '#/agents/new', '#/tasks/new', '#/analytics/widget', '#/finance/new', '#/finance/yt-main',
  '#/games/manage', '#/games/players', '#/games/monetization', '#/social/youtube', '#/notifications/l-x', '#/settings/profile', '#/settings/devices', '#/settings/notif',
  '#/settings/integr', '#/settings/mac', '#/settings/look', '#/settings/help', '#/settings/about', '#/more/ideas', '#/more/docs', '#/more/team', '#/more/exp', '#/more/backup', '#/home/request'];
const SEL = 'a, button, [role=button], [role=switch]';
for (const route of LIVE_ROUTES) {
  test(`live sweep ${route}`, async ({ page, baseURL }) => {
    test.setTimeout(600_000);
    const g = await guard(page, baseURL);
    const reqs = recordRequests(page);
    await liveLogin(page);
    if (route === '#/notifications/l-x') { // open a real log/approval id taken from the live list
      await open(page, '#/notifications');
      const rows = page.locator('.notif-row');
      test.skip(await rows.count() === 0, 'test Studio has no notifications yet');
      await open(page, await rows.first().getAttribute('href'));
    } else await open(page, route);
    const at = await page.evaluate(() => location.hash);
    const nf = await page.locator('#view h1', { hasText: 'не найден' }).count();
    expect(nf, `${route} must exist in LIVE`).toBe(0);
    const scope = (await page.locator('#sheet-wrap.open').count()) ? '#sheet' : 'body';
    const Q = SEL.split(',').map((x) => `${scope} ${x.trim()}`).join(', ');
    const count = await page.locator(Q).count();
    const report = [];
    for (let i = 0; i < count; i++) {
      await open(page, at);
      const el = page.locator(Q).nth(i);
      if (!(await el.isVisible())) continue;
      await el.scrollIntoViewIfNeeded();
      const info = await el.evaluate((n) => ({ tag: n.tagName.toLowerCase(), text: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 40), disabled: n.hasAttribute('disabled') || n.getAttribute('aria-disabled') === 'true',
        note: (n.closest('.disabled-block, .logout, .row')?.textContent || '') + ' ' + (n.getAttribute('aria-label') || ''), current: n.getAttribute('aria-current') === 'page', act: n.dataset.act || '' }));
      if (info.disabled) { expect(info.note, `disabled «${info.text}» on ${route}`).toMatch(CTL_RE); report.push('disabled: ' + info.text); continue; }
      if (info.current) { report.push('current-tab: ' + info.text); continue; }
      if (info.act === 'logout') { report.push('logout (covered by auth test)'); continue; }
      const before = await page.evaluate(() => { window.__mut = 0; window.__mo?.disconnect(); window.__mo = new MutationObserver((l) => { window.__mut += l.length; }); window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); return { hash: location.hash }; });
      await el.click({ timeout: 8000 });
      await page.waitForTimeout(350);
      const after = await page.evaluate(() => ({ hash: location.hash, mut: window.__mut, toast: !!document.querySelector('#toast .toast') }));
      expect(after.hash !== before.hash || after.mut > 0 || after.toast, `«${info.text}» (${info.tag} #${i}) on ${route} did nothing`).toBeTruthy();
      report.push(`${after.hash !== before.hash ? 'nav→' + after.hash : after.toast ? 'toast' : 'state'}: ${info.text}`);
    }
    test.info().annotations.push({ type: 'sweep', description: `${route}: ${report.length} — ` + report.join(' | ') });
    expect(report.length).toBeGreaterThan(0);
    // DEMO-only toggles never reach the Studio: only GETs (and our own login POST via page.request) left the page
    expect(reqs.filter((r) => !r.startsWith('GET ')), 'non-GET from the page').toEqual([]);
    await g.check();
  });
}

/* ---------- screenshots of all 12 screens (LIVE, empty test DB) + seeded finance/home ---------- */
test('live screenshots', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'screenshots once, on WebKit (iPhone 16 Pro)');
  test.setTimeout(300_000);
  const OUT = '/workspace/out/ai-control/stage2';
  await mkdir(OUT + '/screens', { recursive: true }); await mkdir(OUT + '/screens-seeded', { recursive: true });
  const shoot = async (port, list, dir) => {
    await liveLogin(page, port);
    for (const s of list) {
      await open(page, s.hash, port);
      await page.evaluate(() => document.documentElement.classList.add('preview-safe', 'reduce-motion')); // iPhone 16 Pro insets 62/34
      await page.evaluate(() => Promise.race([new Promise((r) => setTimeout(r, 2500)), Promise.all([...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).map((i) => (i.complete ? 0 : new Promise((r) => { i.addEventListener('load', r); i.addEventListener('error', r); }))))]));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/${dir}/${String(s.n).padStart(2, '0')}-${s.slug}.png` });
    }
  };
  await shoot(EMPTY.proxy, SCREENS, 'screens');
  await shoot(SEEDED.proxy, SCREENS.filter((s) => [1, 3, 6, 8].includes(s.n)), 'screens-seeded');
  await page.goto('about:blank'); await page.context().clearCookies();
  await page.goto(url(EMPTY.proxy, '/#/home')); await page.waitForSelector('.login-screen');
  await page.screenshot({ path: `${OUT}/screens/00-login.png` });
});
