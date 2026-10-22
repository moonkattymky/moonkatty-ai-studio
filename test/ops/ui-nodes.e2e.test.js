'use strict';
// nodes-022-final: headless-browser E2E of the «Узлы» (Computers) panel of v1.3.0-test — real server.js (temp data dir, fake owner password),
// real TLS Node API on 127.0.0.1, enrollment by one-time code created IN THE PANEL, device confirmation in the panel (password + word + unverified-peer ack),
// two REAL agent processes (NEWS + MONITOR 0.2.2), statuses Online → Offline → Отозван, reject needs the password (QA-NODE-003), no secrets in DOM/API/logs.
// QA-NODE-004: each code is read only after the panel shows a NEW code (never the previous one). Keychain = test double; Tailscale is NOT available here.
// Skipped (reported as SKIP) only when playwright-core or Chrome is missing.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http'); const { spawn } = require('child_process');
const EN = require('../../node-agent/enroll.js'); const A = require('../../node-agent/agent.js');
const ROOT = path.join(__dirname, '..', '..'); const PW = 'fake-password-123';
let chromium = null; try { ({ chromium } = require('playwright-core')); } catch {} const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const skip = !chromium || !fs.existsSync(CHROME) ? 'playwright-core/Chrome not available' : false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const free = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
async function until(fn, ms = 30000, step = 200) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout: ' + fn.toString().slice(0, 160)); await sleep(step); } }
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('UI «Узлы»: enroll NEWS + MONITOR by panel codes, confirm, Online/Offline/Отозван, reject needs password, no secrets', { skip, timeout: 240000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-nodes-')); const [port, nport] = [await free(), await free()]; const srvLog = [];
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'prod', STUDIO_DATA_DIR: dir, PORT: String(port),
    STUDIO_ADMIN_USER: 'owner', STUDIO_ADMIN_PASSWORD: PW, STUDIO_NODES: '1', STUDIO_NODES_BIND: '', STUDIO_NODES_PORT: String(nport), STUDIO_NODES_DOWN_MS: '3000', STUDIO_NODES_SWEEP_MS: '500' } });
  srv.stdout.on('data', d => srvLog.push(String(d))); srv.stderr.on('data', d => srvLog.push(String(d)));
  const procs = [srv]; const kcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-kc-')); const homes = {}; const agentOut = []; const codes = [];
  const env = id => ({ PATH: process.env.PATH, HOME: homes[id] ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ui-home-' + id + '-')), NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(kcDir, id + '.json'), NODE_POLL_MS: '300' });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    const base = `http://127.0.0.1:${port}`; await until(() => new Promise(r => http.get(base + '/api/health', x => { x.resume(); r(x.statusCode === 200); }).on('error', () => r(false))));
    const page = await browser.newPage(); page.on('dialog', d => d.accept()); await page.goto(base + '/');
    const api = (method, p, body) => page.evaluate(async ([method, p, body]) => { const r = await fetch(p, { method, headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; }, [method, p, body]);
    assert.equal((await api('POST', '/api/auth/login', { username: 'owner', password: PW })).status, 200);
    await page.goto(base + '/#nodes'); await page.reload(); await page.waitForSelector('#enNew', { timeout: 20000 });
    const fp = (await api('GET', '/api/ops/nodes')).body.fingerprint; assert.match(fp, /^[a-f0-9]{64}$/);
    const fill = async word => { await page.fill('#npw', PW); await page.fill('#nconf', word); };
    const codeText = () => page.evaluate(() => { const b = [...document.querySelectorAll('b')].find(x => /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/.test(x.textContent.trim())); return b ? b.textContent.trim() : null; });
    async function newCode(role) { const prev = await codeText(); await fill('ПОДКЛЮЧИТЬ'); await page.selectOption('#enRole', role); await page.click('#enNew');
      const c = await until(async () => { const t = await codeText(); return t && t !== prev && t; }); codes.push(c); return c; } // QA-NODE-004: wait for a NEW code
    const enrolls = {}; for (const [id, role] of [['imac', 'news'], ['macbook', 'monitor']]) { const code = await newCode(role);
      enrolls[id] = EN.enroll({ url: `https://127.0.0.1:${nport}`, fingerprint: fp, code, home: path.join(env(id).HOME, '.moonkatty-node'), env: env(id), info: { hostname: id, agentVersion: A.VERSION }, pollMs: 3000 }); }
    for (let k = 0; k < 2; k++) { const btn = await until(async () => { await page.reload(); await page.waitForSelector('#enNew'); return (await page.$$('[data-enc]'))[0]; });
      assert.ok(await page.evaluate(() => document.body.innerText.includes('адрес Tailscale не определён')), 'unverified peer warning shown');
      await fill('ПОДТВЕРДИТЬ'); await btn.click(); await sleep(800); }
    const res = await Promise.all(Object.values(enrolls)); assert.deepEqual(res.map(r => r.nodeId).sort(), ['imac', 'macbook']);
    const start = id => { const c = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { env: { ...env(id), NODE_STATUS_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] }); c.stdout.on('data', d => agentOut.push(String(d))); c.stderr.on('data', d => agentOut.push(String(d))); procs.push(c); return c; };
    const ai = start('imac'), am = start('macbook');
    const statusOf = async id => { await page.reload(); await page.waitForSelector('#enNew'); return page.evaluate(id => { const tr = [...document.querySelectorAll('tr')].find(r => r.querySelector('td b') && r.querySelector('td b').textContent === id); const td = tr && tr.querySelector('td[data-status]'); return td ? td.dataset.status : null; }, id); };
    await until(async () => (await statusOf('imac')) === 'online' && (await statusOf('macbook')) === 'online', 30000, 500);
    am.kill('SIGTERM'); await until(async () => (await statusOf('macbook')) === 'offline', 30000, 700);
    await fill('ОТОЗВАТЬ'); await page.click('[data-nrev="imac"]'); await until(async () => (await statusOf('imac')) === 'revoked', 20000, 500);
    await until(() => agentOut.join('').match(/E_REVOKED|отозван|401|unauthorized/i), 20000); ai.kill('SIGTERM');
    // QA-NODE-003: reject without password → refused; with password + ОТКЛОНИТЬ → rejected
    const c3 = await newCode('news'); const pend = EN.enroll({ url: `https://127.0.0.1:${nport}`, fingerprint: fp, code: c3, home: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ui-home-r-')), '.moonkatty-node'), env: { ...env('rej'), FAKE_KC_FILE: path.join(kcDir, 'rej.json') }, info: { hostname: 'rej', agentVersion: A.VERSION }, pollMs: 500 }).catch(e => e);
    const rq = await until(async () => ((await api('GET', '/api/ops/nodes/enroll')).body.requests || []).find(q => q.state === 'pending'));
    const noPw = await api('POST', `/api/ops/nodes/enroll/${rq.requestId}/reject`, {}); assert.ok(noPw.status >= 400 && noPw.status < 500, 'reject without password refused: ' + noPw.status);
    const wrongPw = await api('POST', `/api/ops/nodes/enroll/${rq.requestId}/reject`, { confirm: 'ОТКЛОНИТЬ', password: 'wrong-password' }); assert.ok(wrongPw.status >= 400 && wrongPw.status < 500, 'reject with wrong password refused: ' + wrongPw.status);
    await page.reload(); await page.waitForSelector('[data-enr]'); await fill('ОТКЛОНИТЬ'); await page.click('[data-enr]'); const e3 = await pend; assert.equal(e3.code, 'E_REJECTED');
    // secret scan: one-time codes, tokens, private keys must not appear in DOM, API, server log or data files (the coordinator TLS key file is the only key on disk)
    const kc = Object.fromEntries(fs.readdirSync(kcDir).map(f => [f, fs.readFileSync(path.join(kcDir, f), 'utf8')])); const tokens = Object.values(kc).flatMap(t => t.match(/nk_[a-z0-9-]+\.[A-Za-z0-9_-]{20,}/g) || []);
    assert.ok(tokens.length >= 2, 'tokens are in the (test) Keychain only');
    const hay = [await page.content(), JSON.stringify((await api('GET', '/api/ops/nodes')).body), JSON.stringify((await api('GET', '/api/ops/nodes/audit')).body), srvLog.join(''), ...walk(dir).filter(f => !f.endsWith(path.join('ops', 'nodes-tls.key'))).map(f => fs.readFileSync(f, 'latin1'))].join('\n');
    for (const t of tokens) assert.ok(!hay.includes(t) && !hay.includes(t.split('.')[1]), 'token leaked'); for (const c of codes) assert.ok(!hay.includes(c.slice(6)), 'code leaked');
    assert.ok(!/PRIVATE KEY/.test(hay), 'no private key outside the coordinator TLS key file'); assert.equal(fs.statSync(path.join(dir, 'ops', 'nodes-tls.key')).mode & 0o777, 0o600, 'coordinator TLS key is 0600');
  } finally { await browser.close(); for (const p of procs) try { p.kill('SIGKILL'); } catch {} }
});
