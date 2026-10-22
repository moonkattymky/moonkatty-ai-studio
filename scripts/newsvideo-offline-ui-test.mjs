// S5-NV-02: with the network blocked, «Автопоиск» must report failure (not «Поиск завершён»). Starts its own server
// (fresh mkdtemp dir, random port, test flavor) with scripts/fixtures/no-network.cjs preloaded. Needs playwright-core + Chrome.
import { spawn } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import net from 'net'; import crypto from 'crypto';
const { chromium } = await import('playwright-core');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const PORT = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-offline-')), PW = crypto.randomBytes(12).toString('hex'), B = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, ['--require', path.resolve('scripts/fixtures/no-network.cjs'), 'server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: UD, PORT: String(PORT), STUDIO_ADMIN_PASSWORD: PW }, stdio: 'ignore' });
try {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await new Promise(z => setTimeout(z, 250)); }
  const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const p = await br.newPage(); const errs = [], toasts = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/'); await p.fill('#auth input[name=username]', 'igor'); await p.fill('#auth input[name=password]', PW); await p.click('#auth button'); await p.waitForSelector('#app:not(.hidden)');
  await p.exposeFunction('__toast', (x, c) => toasts.push({ x, c })); await p.evaluate(() => new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(n => window.__toast(n.textContent, n.style.borderColor)))).observe(document.querySelector('#toast'), { childList: true }));
  const cases = await p.evaluate(() => [nvSearchMsg({ status: 'failed', errors: [1, 2, 3, 4, 5, 6], fetched: 0 }), nvSearchMsg({ status: 'partial', errors: [1], fetched: 20, new: 3 }), nvSearchMsg({ status: 'ok', errors: [], fetched: 0 }), nvSearchMsg({ status: 'ok', errors: [], fetched: 50, new: 7 })]);
  t('nvSearchMsg: failed → error', cases[0].err && cases[0].kind === 'failed' && !/Поиск завершён/.test(cases[0].text), cases[0].text);
  t('nvSearchMsg: partial → warning with counts', cases[1].err && /частично/.test(cases[1].text) && /20/.test(cases[1].text), cases[1].text);
  t('nvSearchMsg: 0 fetched → not success', cases[2].err && /0 материалов/.test(cases[2].text), cases[2].text);
  t('nvSearchMsg: ok → success with counts', !cases[3].err && /получено 50, новых 7/.test(cases[3].text), cases[3].text);
  await p.evaluate(() => location.hash = 'news'); await p.waitForSelector('#nvSearch:not([disabled])', { timeout: 20000 }); await p.click('#nvSearch');
  await p.waitForFunction(() => /Последний поиск/.test(document.querySelector('#nvRun')?.textContent || ''), null, { timeout: 90000 });
  await p.waitForTimeout(500); const all = toasts.map(x => x.x).join(' | ');
  t('offline: toast says search failed', toasts.some(x => /Поиск не удался/.test(x.x)), all);
  t('offline: toast styled as error', toasts.some(x => /Поиск не удался/.test(x.x) && /239, 68, 68|ef4444/.test(x.c)));
  t('offline: no «Поиск завершён» success toast', !toasts.some(x => /^Поиск завершён/.test(x.x)), all);
  const runTxt = await p.textContent('#nvRun'); t('offline: run line shows failed + 0 fetched', /failed/.test(runTxt) && /получено 0/.test(runTxt), runTxt.slice(0, 160));
  t('no JS errors', !errs.length, errs.join('; '));
  await br.close();
} finally { srv.kill('SIGTERM'); setTimeout(() => fs.rmSync(UD, { recursive: true, force: true }), 500); }
console.log(`\n${pass} passed, ${fail} failed`); setTimeout(() => process.exit(fail ? 1 : 0), 700);
