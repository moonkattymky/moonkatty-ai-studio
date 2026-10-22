// REAL end-to-end UI test (Playwright): RSS → verify → Ollama script → edit → approve → TTS+ffmpeg render → preview/export.
// Gated: needs a running test-flavor server, PW_FILE, and playwright-core + Chrome (CHROME=/path). Not part of npm test.
import { chromium } from 'playwright-core'; import fs from 'fs';
const B = process.env.STUDIO_URL || 'http://127.0.0.1:8687', PW = fs.readFileSync(process.env.PW_FILE || '/workspace/e2e-data/.pw', 'utf8').trim(), OUT = process.env.OUT || '/workspace/out/e2e-artifacts';
const res = []; const ok = (n, c, x = '') => { res.push({ n, pass: !!c, x }); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await br.newPage({ viewport: { width: 1400, height: 1000 } }); const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(B + '/'); await p.fill('#auth input[name=username]', 'igor'); await p.fill('#auth input[name=password]', PW); await p.click('#auth button');
await p.waitForSelector('#app:not(.hidden)'); await p.evaluate(() => location.hash = 'news');
await p.waitForSelector('#nvSearch', { timeout: 20000 }); ok('news: кнопка Автопоиск активна', await p.isEnabled('#nvSearch'));
await p.click('#nvSearch'); await p.waitForSelector('[data-nv-pick]', { timeout: 90000 }); const n = await p.locator('[data-nv-pick]').count(); ok('news: кандидаты из RSS', n > 0, n + ' шт.');
ok('news: строка последнего поиска', (await p.textContent('#nvRun')).includes('получено'));
const before = await p.locator('#nvPanel [data-nv-draft]').count();
await p.locator('[data-nv-pick]').nth(0).check(); await p.waitForTimeout(300); await p.locator('[data-nv-pick]').nth(1).check(); await p.waitForTimeout(300);
await p.click('#nvDraft'); await p.waitForFunction(b => document.querySelectorAll('#nvPanel [data-nv-draft]').length > b, before, { timeout: 180000 });
const card = p.locator('#nvPanel [data-nv-draft]').first(); const id = await card.getAttribute('data-nv-draft'); ok('news: черновик сценария создан', !!id, id);
await card.locator('[data-nv-edit]').click(); await p.fill('#modal input[name=title]', 'MOONKATTY News UI test'); await p.click('#modal button.primary');
await p.waitForFunction(i => document.querySelector(`#nvPanel [data-nv-draft="${i}"] h3`)?.textContent.includes('UI test'), id, { timeout: 20000 }); ok('news: правка владельцем сохранена', true);
await p.locator(`#nvPanel [data-nv-draft="${id}"] [data-nv-approve]`).click(); await p.waitForSelector(`#nvPanel [data-nv-draft="${id}"] [data-nv-render]`, { timeout: 60000 }); ok('news: утверждено → кнопки рендера', true);
await p.screenshot({ path: OUT + '/ui_news.png', fullPage: true });
await p.evaluate(() => location.hash = 'video'); await p.waitForSelector(`[data-nv-draft="${id}"] [data-nv-render]`, { timeout: 20000 });
ok('video: кнопка Рендер активна', await p.isEnabled(`[data-nv-draft="${id}"] [data-nv-render]`));
await p.locator(`[data-nv-draft="${id}"] [data-nv-render]`).first().click();
await p.waitForSelector(`[data-nv-draft="${id}"] [data-nv-video], [data-nv-draft="${id}"] [data-nv-error]`, { timeout: 600000 });
const err = await p.locator(`[data-nv-draft="${id}"] [data-nv-error]`).count(); ok('video: рендер завершён без ошибки', !err, err ? await p.textContent(`[data-nv-draft="${id}"] [data-nv-error]`) : '');
if (!err) { const d = await p.locator(`[data-nv-draft="${id}"] [data-nv-video]`).evaluate(v => new Promise(r => { if (v.readyState >= 1) r(v.duration); v.onloadedmetadata = () => r(v.duration); v.onerror = () => r(-1); setTimeout(() => r(-2), 20000); }));
  ok('video: предпросмотр <video> загрузил MP4', d > 5, 'duration ' + d);
  const href = await p.getAttribute(`[data-nv-draft="${id}"] [data-nv-export]`, 'href'); const r = await p.request.get(B + href); ok('video: Экспорт MP4 скачивается', r.status() === 200 && /attachment/.test(r.headers()['content-disposition'] || ''), r.status() + ' ' + (await r.body()).length + ' B'); }
await p.screenshot({ path: OUT + '/ui_video.png', fullPage: true });
ok('нет JS-ошибок на странице', !errs.length, errs.join('; '));
fs.writeFileSync(OUT + '/ui_test_results.json', JSON.stringify({ id, res, errs }, null, 2)); await br.close(); process.exit(res.every(r => r.pass) ? 0 : 1);
