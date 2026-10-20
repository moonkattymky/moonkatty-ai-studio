// Headless smoke test + screenshots. Usage: node scripts/smoke.mjs <url> <prefix> <user> <pass>
import { chromium } from 'playwright-core';
const [url, prefix, user, pass] = process.argv.slice(2);
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const b = await chromium.launch({ executablePath: exe });
const errors = [];
async function run(ctxOpts, tag, pages) {
  const ctx = await b.newContext(ctxOpts); const p = await ctx.newPage(); p.on('dialog', d => d.accept());
  p.on('pageerror', e => errors.push(tag + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|404/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
  await p.goto(url); await p.waitForSelector('#auth form, #app:not(.hidden)');
  if (await p.isVisible('#auth form')) { await p.fill('input[name=username]', user); await p.fill('input[name=password]', pass); await p.click('#auth button'); }
  await p.waitForSelector('#app:not(.hidden) #view .card', { timeout: 10000 });
  for (const r of pages) { await p.evaluate(r => location.hash = r, r); await p.waitForTimeout(500); await p.screenshot({ path: `screenshots/${prefix}-${tag}-${r}.png`, fullPage: tag === 'desktop' }); }
  return { ctx, p };
}
const all = ['dashboard', 'agents', 'news', 'project', 'video', 'studio3d', 'social', 'pr', 'calendar', 'analytics', 'reports', 'files', 'logs', 'settings'];
const { p } = await run({ viewport: { width: 1440, height: 900 } }, 'desktop', ['dashboard']);
// Functional flow: director chat
await p.click('#chatBtn'); await p.fill('#chatForm textarea', 'Подготовь сегодняшний выпуск новостей на 15 минут на трёх языках'); await p.click('#chatForm button');
await p.waitForSelector('.msg.director .badge', { timeout: 10000 }); await p.screenshot({ path: `screenshots/${prefix}-desktop-director-chat.png` });
await p.click('#chatClose');
// create task via form
await p.evaluate(() => location.hash = 'agents'); await p.waitForTimeout(300); await p.click('[data-tab=queue]'); await p.click('[data-task-new]');
await p.fill('#modal input[name=title]', 'Еженедельный дайджест'); await p.selectOption('#modal select[name=agentId]', 'social'); await p.selectOption('#modal select[name=stype]', 'every_days'); await p.fill('#modal input[name=days]', '3');
await p.click('#modal .btn.primary'); await p.waitForSelector('text=Еженедельный дайджест');
// start agent
await p.click('[data-tab=cards]'); await p.click('[data-start=news]'); await p.waitForSelector('.card:has([data-stop=news]:not([disabled]))');
// episode
await p.evaluate(() => location.hash = 'news'); await p.waitForTimeout(300); await p.click('#newEp'); await p.fill('#modal input[name=title]', 'MOONKATTY NEWS #1'); await p.click('#modal .btn.primary');
await p.waitForSelector('.stage'); await p.click('.stage >> nth=0'); await p.waitForTimeout(300);
// post approval flow
await p.evaluate(() => location.hash = 'social'); await p.waitForTimeout(300); await p.click('[data-tab=posts]'); await p.waitForTimeout(200); await p.click('#newPost'); await p.fill('#modal input[name=title]', 'Анонс выпуска #1');
await p.fill('#modal input[name=scheduledAt]', '2026-10-25T12:00'); await p.click('#modal .btn.primary'); await p.click('[data-pst$="|pending"]'); await p.waitForSelector('[data-pst$="|approved"]');
// FB/IG module flow
const shot = async n => { await p.waitForTimeout(400); await p.screenshot({ path: `screenshots/${prefix}-desktop-social-${n}.png`, fullPage: true }); };
await p.evaluate(() => location.hash = 'social'); await p.waitForTimeout(300); await p.click('[data-tab=pages]'); await shot('pages-empty');
await p.click('#demoLoad'); await p.waitForTimeout(800); await shot('pages-demo');
await p.click('[data-tab=queue]'); await p.waitForTimeout(300); await p.click('#newMat');
await p.fill('#modal input[name=title]', 'Smoke test material'); await p.fill('#modal textarea[name=text]', 'Smoke test body text'); await p.fill('#modal input[name=link]', 'https://moonkatty.com/');
await p.click('#modal .btn.primary'); await p.waitForSelector('text=Smoke test material'); await shot('queue');
if (await p.locator('[data-qpub]:not([disabled])').count()) errors.push('publish button enabled without connection');
await p.click('[data-tab="ws:news-fb"]'); await shot('ws-news-fb'); await p.click('[data-tab="ws:mk-ig"]'); await shot('ws-mk-ig');
await p.click('[data-tab=analytics]'); await shot('analytics'); await p.click('[data-tab=community]'); await shot('community');
await p.click('#demoDel'); await p.click('#modal .btn.primary'); await p.waitForTimeout(800); if (await p.locator('text=[ДЕМО]').count()) errors.push('demo items not removed');
await p.click('[data-tab=pages]'); await p.waitForTimeout(300);
// report + integration test
await p.evaluate(() => location.hash = 'reports'); await p.waitForTimeout(300); await p.click('#genRep'); await p.waitForTimeout(500);
await p.evaluate(() => location.hash = 'settings'); await p.waitForTimeout(300); await p.click('[data-test=ollama]'); await p.waitForTimeout(1500);
for (const r of all) { await p.evaluate(r => location.hash = r, r); await p.waitForTimeout(400); await p.screenshot({ path: `screenshots/${prefix}-desktop-${r}.png`, fullPage: true }); }
await run({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'iphone', ['dashboard', 'agents', 'news', 'social']).then(async ({ p }) => {
  await p.click('#menuBtn'); await p.waitForTimeout(300); await p.screenshot({ path: `screenshots/${prefix}-iphone-menu.png` }); });
for (const lang of ['en', 'uk']) {
  await p.evaluate(l => localStorage.setItem('mk-lang', l), lang); await p.evaluate(() => location.hash = 'dashboard'); await p.reload(); await p.waitForSelector('#app:not(.hidden) #view .card'); await p.waitForTimeout(600);
  await p.screenshot({ path: `screenshots/${prefix}-desktop-dashboard-${lang}.png`, fullPage: true });
  await p.evaluate(() => location.hash = 'news'); await p.waitForTimeout(500); await p.screenshot({ path: `screenshots/${prefix}-desktop-news-${lang}.png`, fullPage: true });
  await p.evaluate(() => location.hash = 'social'); await p.waitForTimeout(500); await p.screenshot({ path: `screenshots/${prefix}-desktop-social-${lang}.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => location.hash = 'dashboard'); await p.waitForTimeout(500); await p.screenshot({ path: `screenshots/${prefix}-iphone-dashboard-${lang}.png` }); await p.setViewportSize({ width: 1440, height: 900 });
}
await p.evaluate(() => localStorage.setItem('mk-lang', 'ru'));
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 1)); await b.close();
