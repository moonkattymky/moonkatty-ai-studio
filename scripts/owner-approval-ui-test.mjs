// UI contract test for owner approvals (Studio 2 contract, feat/e2e-security-agents) + comment replies «не реализовано».
// Server responses for /api/world/approvals|savings and /api/comments are MOCKED via Playwright routing: the real
// server side lives in Studio 2's branch, so this checks only the client half of the contract.
// Needs a running test-flavor server + PW_FILE + playwright-core + Chrome. SKIPs without PW_FILE.
import fs from 'fs';
const B = process.env.STUDIO_URL || 'http://127.0.0.1:8687';
if (!process.env.PW_FILE) { console.log('SKIP: set PW_FILE'); process.exit(0); }
const { chromium } = await import('playwright-core');
const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim(); const OWNER_PW = 'owner-test-pass-123';
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const br = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await br.newPage(); const errs = [], consoleTxt = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => consoleTxt.push(m.text()));
const apprBodies = [], savBodies = [];
const seq = [[403, { error: 'x', code: 'owner_reauth' }], [403, { error: 'x', code: 'self_approval' }], [403, { error: 'x', code: 'owner_session_required' }], [409, { error: 'x', code: 'expired' }], [200, { ok: true, status: 'approved', executed: true, execStatus: 'executed', result: { ok: true } }], [200, { ok: true, status: 'rejected' }]];
await p.route('**/api/world/approvals/**', async r => { apprBodies.push(r.request().postDataJSON()); const [s, j] = seq[apprBodies.length - 1] || [500, {}]; await r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(j) }); });
await p.route('**/api/world/savings', async r => { const b = r.request().postDataJSON(); savBodies.push(b); await r.fulfill(b.approvalId === 'ap-1' ? { status: 200, contentType: 'application/json', body: '{"ok":true}' } : { status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Нужно подтверждение владельца', code: 'needs_owner', approvalId: 'ap-1' }) }); });
await p.route('**/api/world/command-center', async r => { const res = await r.fetch(); const j = await res.json(); j.approvals = [{ id: 'ap-1', action: 'critical_settings', detail: 'savings target 500', status: 'pending' }]; await r.fulfill({ response: res, json: j }); });
await p.route('**/api/comments', async r => r.request().method() === 'GET' ? r.fulfill({ json: [{ id: 'c1', author: 'Tester', text: 'Hi', draft: 'Thanks!', status: 'approved', at: new Date().toISOString() }] }) : r.continue());
await p.goto(B + '/'); await p.fill('#auth input[name=username]', 'igor'); await p.fill('#auth input[name=password]', PW); await p.click('#auth button'); await p.waitForSelector('#app:not(.hidden)');
const lastToast = async () => { await p.waitForTimeout(250); return (await p.locator('#toast div').last().textContent().catch(() => '')) || ''; };
await p.evaluate(() => location.hash = 'revenue'); await p.waitForSelector('#savForm', { timeout: 20000 });
await p.fill('#savForm input[name=target]', '500'); await p.click('#savForm button'); const tNeeds = await lastToast();
t('savings: 403 needs_owner → понятное сообщение с номером запроса', /Нужно подтверждение владельца.*ap-1/.test(tNeeds), tNeeds);
t('savings: первый запрос без confirm и без approvalId', savBodies[0] && !('confirm' in savBodies[0]) && !savBodies[0].approvalId);
const expect = [['owner_reauth', /Неверный пароль владельца/], ['self_approval', /Нельзя подтвердить собственный запрос/], ['owner_session_required', /только из сессии владельца/], ['expired', /Срок подтверждения истёк/], ['ok', /Подтверждено и выполнено/]];
for (const [code, re] of expect) {
  await p.waitForSelector('[data-ap="ap-1"][data-dec="approve"]'); await p.click('[data-ap="ap-1"][data-dec="approve"]');
  const inp = p.locator('#modal input[name=password]'); t(`${code}: поле пароля type=password`, (await inp.getAttribute('type')) === 'password');
  await inp.fill(OWNER_PW); await p.click('#modal .btn.primary'); const tx = await lastToast(); t(`${code}: сообщение`, re.test(tx), tx);
  const b = apprBodies.at(-1); t(`${code}: тело {decision:approve,password}, без confirm`, b && b.decision === 'approve' && b.password === OWNER_PW && !('confirm' in b));
  t(`${code}: поле пароля очищено после отправки`, (await p.locator('#modal input[name=password]').inputValue().catch(() => '')) === '');
}
// QA-DD-001: approval executes server-side → UI shows the result, never re-sends the action with approvalId
t('QA-DD-001: после подтверждения действие НЕ отправляется повторно', savBodies.length === 1, 'savings POSTs: ' + savBodies.length);
t('QA-DD-001: результат выполнения показан в «Очереди владельца»', /Подтверждено и выполнено.*ap-1/.test(await p.locator('[data-ap-result]').innerText().catch(() => '')));
t('QA-DD-001: текст needs_owner не просит повторить действие', !/повторите действие/.test(tNeeds));
await p.waitForSelector('[data-ap="ap-1"][data-dec="reject"]'); await p.click('[data-ap="ap-1"][data-dec="reject"]'); await lastToast();
t('reject: без пароля', apprBodies.at(-1).decision === 'reject' && !('password' in apprBodies.at(-1)));
const store = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
t('пароль владельца не сохранён в storage/cookie', !store.includes(OWNER_PW));
t('пароль владельца не попал в консоль', !consoleTxt.some(x => x.includes(OWNER_PW)));
t('пароль не остался в DOM', !(await p.content()).includes(OWNER_PW));
await p.evaluate(() => { SUB.social = 'community'; location.hash = 'social'; render(); }); await p.waitForSelector('[data-creply="c1"]');
const rb = p.locator('[data-creply="c1"]'); t('comments: кнопка ответа отключена', await rb.isDisabled()); t('comments: подпись «не реализовано»', /не реализовано/.test(await rb.textContent()));
// Studio 2 contract b1073fd: 409 consumed → Russian text; opencode_task 403 needs_owner → Approval Center
t('409 consumed → «одобрение уже использовано»', await p.evaluate(() => /одобрение уже использовано/i.test(ownerErrText(409, { code: 'consumed' }))));
await p.route('**/api/jobs', r => r.request().method() === 'POST' ? r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 'needs_owner', approvalId: 'ap-oc-1', error: 'owner' }) }) : r.continue());
await p.evaluate(() => { location.hash = 'dashboard'; });
await p.evaluate(() => act(() => api('POST', '/api/jobs', { kind: 'opencode_task', payload: { task: 'x' } })));
await p.waitForFunction(() => location.hash === '#revenue', null, { timeout: 5000 }).catch(() => {});
t('opencode_task 403 needs_owner → переход в Центр подтверждений', await p.evaluate(() => location.hash === '#revenue' && OWNER_PENDING.id === 'ap-oc-1'));
t('opencode_task: показано сообщение с № запроса', await p.locator('#toast').innerText().then(x => /ap-oc-1/.test(x)));
// QA-DD-001: savings form never sends approvalId (no retry path)
t('savings: approvalId никогда не отправляется', savBodies.every(b => !('approvalId' in b)));
t('нет JS-ошибок', !errs.length, errs.join('; '));
await br.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
