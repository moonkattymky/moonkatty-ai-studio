// QA-DD-001 against the REAL Studio 2 backend (no mocks): run feat/e2e-security-agents server code with this app.js, e.g.
//   git worktree add --detach /tmp/s2 <studio2-commit> && cp public/app.js /tmp/s2/public/ && start it on REAL_URL.
// Flow: savings → 403 needs_owner → owner approves with password → server executes → UI shows result, no retry, no 409.
// SKIPs without REAL_URL + PW_FILE (login password of the owner, also used for owner re-auth / self-approval step-up).
import fs from 'fs';
const B = process.env.REAL_URL; if (!B || !process.env.PW_FILE) { console.log('SKIP: set REAL_URL and PW_FILE'); process.exit(0); }
const { chromium } = await import('playwright-core'); const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim();
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await br.newPage(); const errs = [], toasts = [], sav = [], appr = [];
p.on('pageerror', e => errs.push(e.message));
p.on('response', async r => { const u = r.url(); if (r.request().method() !== 'POST') return;
  if (u.endsWith('/api/world/savings')) sav.push({ s: r.status(), body: r.request().postDataJSON(), j: await r.json().catch(() => ({})) });
  if (/\/api\/world\/approvals\//.test(u)) appr.push({ s: r.status(), j: await r.json().catch(() => ({})) }); });
await p.goto(B + '/'); await p.fill('#auth input[name=username]', 'igor'); await p.fill('#auth input[name=password]', PW); await p.click('#auth button'); await p.waitForSelector('#app:not(.hidden)');
await p.exposeFunction('__toast', x => toasts.push(x)); await p.evaluate(() => new MutationObserver(m => m.forEach(r => r.addedNodes.forEach(n => window.__toast(n.textContent)))).observe(document.querySelector('#toast'), { childList: true }));
await p.evaluate(() => location.hash = 'revenue'); await p.waitForSelector('#savForm', { timeout: 20000 });
const target = 1234 + Math.floor(Math.random() * 1000);
await p.fill('#savForm input[name=target]', String(target)); await p.click('#savForm button');
await p.waitForFunction(() => document.querySelector('[data-ap][data-dec="approve"]'), null, { timeout: 45000 } /* fresh server: first owner-queue load can be slow */); await p.waitForTimeout(300); const apId = sav[0] && sav[0].j.approvalId;
t('real: savings → 403 needs_owner (approval created)', sav[0] && sav[0].s === 403, JSON.stringify(sav[0]));
await p.click(`[data-ap="${apId}"][data-dec="approve"]`); await p.fill('#modal input[name=password]', PW); await p.click('#modal .btn.primary');
await p.waitForSelector('[data-ap-result]', { timeout: 20000 }).catch(() => {});
const res = await p.locator('[data-ap-result]').innerText().catch(() => '');
t('real: approve 200, server executed the action', appr[0] && appr[0].s === 200 && appr[0].j.execStatus === 'executed', JSON.stringify(appr[0] && { s: appr[0].s, st: appr[0].j.execStatus, executed: appr[0].j.executed }));
t('real: UI shows execution result', /Подтверждено и выполнено/.test(res), res);
await p.waitForTimeout(1500);
t('real: savings NOT re-sent after approval (no retry path)', sav.length === 1, 'savings POSTs: ' + sav.length);
t('real: no «одобрение уже использовано» / 409 shown', !toasts.some(x => /уже использовано|409/i.test(x)), toasts.join(' | '));
const cc = await p.evaluate(() => fetch('/api/world/command-center', { headers: { 'x-studio-request': '1' } }).then(r => r.json()).catch(() => null));
t('real: refreshed state has the new target', JSON.stringify(cc && cc.savings || {}).includes(String(target)) && (await p.locator('#view').innerText()).includes(String(target)), JSON.stringify(cc && cc.savings).slice(0, 200) + ' VIEW:' + ((await p.locator('#view').innerText()).match(/Mac Studio[^\n]*\n[^\n]*/) || [''])[0]);
t('no JS errors', !errs.length, errs.join('; '));
await br.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
