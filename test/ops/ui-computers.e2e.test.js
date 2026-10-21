'use strict';
// Headless-browser E2E of «Computers (Nodes)» with Security Center ON: real server (temp data dir), real TLS node API, two REAL agent
// processes (NEWS + MONITOR 0.2.2) enrolled by one-time code through the panel. Checks: every sidebar route has a view (no VIEWS[ROUTE] crash),
// Mac mini + iMac + MacBook shown, «Подключить компьютер»/«Подтвердить»/«Ротация токена»/«Отозвать» with password step-up, status
// rendering (Online / Offline / 426 error / Отозван), unverified Tailscale peer warning + extra ack, no secrets in DOM/API/logs/audit/files.
// Optional screenshots: UI_SHOTS_DIR=/path. Skipped when playwright-core or Chrome is not available. Tailscale is NOT available here.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'); const { spawn } = require('child_process');
const { startServer, sleep } = require('../helpers/server.js'); const EN = require('../../node-agent/enroll.js'); const A = require('../../node-agent/agent.js');
const ROOT = path.join(__dirname, '..', '..'); const PW = 'fake-password-123';
let chromium = null; try { ({ chromium } = require('playwright-core')); } catch {} const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const skip = !chromium || !fs.existsSync(CHROME) ? 'playwright-core/Chrome not available' : false;
async function until(fn, ms = 20000, step = 150) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout: ' + fn.toString().slice(0, 140)); await sleep(step); } }
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('UI: Computers (Nodes) end-to-end with Security Center ON', { skip, timeout: 240000 }, async () => {
  const P = 23000 + (process.pid % 1000), NP = 24000 + (process.pid % 1000), SP = 25000 + (process.pid % 1000) * 2; const SHOTS = process.env.UI_SHOTS_DIR; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const s = await startServer({ port: P, env: { STUDIO_OPS_NODES: '1', STUDIO_OPS_DASHBOARD: '1', STUDIO_OPS_SECURITY: '1', STUDIO_OPS_MOBILE: '1', STUDIO_OPS_RESOURCES: '1', OPS_NODES_PORT: String(NP), OPS_NODES_DOWN_MS: '3000' } });
  const kcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-kc-')); const homes = {}; const procs = []; const agentOut = [];
  const env = id => ({ PATH: process.env.PATH, HOME: homes[id] ||= fs.mkdtempSync(path.join(os.tmpdir(), 'ui-home-' + id + '-')), NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(kcDir, id + '.json'), NODE_POLL_MS: '300', NODE_AUTH_RETRY_MS: '500' });
  const startAgent = (id, port) => { const c = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { env: { ...env(id), NODE_STATUS_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] }); c.stdout.on('data', d => agentOut.push(String(d))); c.stderr.on('data', d => agentOut.push(String(d))); procs.push(c); return c; };
  const stopAgent = async c => { if (c.exitCode !== null || c.signalCode) return; c.kill('SIGTERM'); await Promise.race([new Promise(r => c.once('exit', r)), sleep(4000)]); if (c.exitCode === null && !c.signalCode) { c.kill('SIGKILL'); await new Promise(r => c.once('exit', r)); } };
  const token = id => { try { return JSON.parse(fs.readFileSync(path.join(kcDir, id + '.json'), 'utf8'))['moonkatty-node-' + id + '|node-token']; } catch { return null; } };
  const allTokens = new Set(); const codes = []; const errs = []; const dialogs = []; let b;
  const nodesApi = async () => (await s.j('GET', '/api/ops/nodes', s.A)).body; const nodeApi = async id => (await nodesApi()).nodes.find(n => n.id === id);
  try {
    let st; for (let i = 0; i < 60; i++) { st = await nodesApi(); if (st.fingerprint) break; await sleep(100); } assert.match(st.fingerprint, /^[a-f0-9]{64}$/);
    b = await chromium.launch({ executablePath: CHROME }); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
    await ctx.addCookies([{ name: s.A.cookie.split('=')[0], value: s.A.cookie.split('=').slice(1).join('='), url: s.B }]);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    p.on('dialog', d => { dialogs.push({ type: d.type(), message: d.message() }); d.type() === 'prompt' ? d.accept(PW) : d.accept(); });
    const shot = async name => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, name), type: 'jpeg', quality: 85, fullPage: true }); };
    const go = async hash => { await p.evaluate(h => { location.hash = h; }, hash); await p.waitForTimeout(1200); };
    const statusOf = async id => p.evaluate(i => { const c = document.querySelector(`.machine.node-${i === 'imac' ? 'news' : 'monitor'}`); return c ? [...c.classList].find(x => x.startsWith('st-')) : null; }, id);
    const reloadComputers = async () => { await go('dashboard'); await go('computers'); await p.waitForSelector('#machines', { timeout: 15000 }); await p.waitForTimeout(800); };
    await p.goto(s.B + '/'); await p.waitForFunction(() => document.querySelectorAll('#nav a').length > 5, null, { timeout: 30000 });
    await p.waitForFunction(() => [...document.querySelectorAll('#nav a')].some(a => a.getAttribute('href') === '#computers'), null, { timeout: 30000 });
    // (1) every sidebar route renders a view — no VIEWS[ROUTE] crash
    const routes = await p.evaluate(() => [...document.querySelectorAll('#nav a')].map(a => a.getAttribute('href').slice(1)));
    assert.ok(routes.includes('computers') && routes.includes('ops'), routes.join(','));
    for (const r of routes) { const before = errs.length; await go(r); assert.equal(errs.length, before, `route ${r}: ${errs.slice(before).join('; ')}`); assert.ok(await p.evaluate(() => document.getElementById('view').innerHTML.length > 20), 'view empty for ' + r); }
    assert.ok(!errs.some(e => /VIEWS\[ROUTE\]/.test(e)));
    // (2) Computers: Mac mini coordinator card; «Подключить компьютер» → code + server fingerprint
    await reloadComputers(); assert.equal(await p.locator('#machines .machine.coordinator').count(), 1); assert.match(await p.textContent('#machines .coordinator'), /Mac mini/);
    const enrollVia = async (role, name) => { await p.selectOption('#enRole', role); await p.fill('#enName', name); await p.click('#enNew'); await p.waitForSelector('#enOut .enroll-code');
      const txt = await p.textContent('#enOut'); assert.ok(txt.includes(st.fingerprint), 'server fingerprint shown with the code'); const code = (await p.textContent('#enOut .enroll-code')).trim(); codes.push(code); return code; };
    const codeI = await enrollVia('news', 'iMac 27 (NEWS)'); await shot('01-podklyuchit-kompyuter.jpg'); const codeM = await enrollVia('monitor', 'MacBook Pro 13 (MONITOR)');
    const enr = [['imac', codeI], ['macbook', codeM]].map(([id, code]) => EN.enroll({ url: `https://127.0.0.1:${NP}`, fingerprint: st.fingerprint, code, home: path.join(env(id).HOME, '.moonkatty-node'), env: env(id), info: { hostname: id + '-sim', model: id === 'imac' ? 'iMac18,3' : 'MacBookPro12,1', os: id === 'imac' ? 'macOS 13.7.1' : 'macOS 12.7.6', arch: 'x64', agentVersion: A.VERSION }, pollMs: 200 }));
    await until(async () => (await s.j('GET', '/api/ops/nodes/enroll', s.A)).body.requests.filter(q => q.state === 'pending').length === 2);
    // (6) confirmation screen: device key + explicit «адрес Tailscale не определён», never 127.0.0.1 as device address
    await reloadComputers(); const reqText = await p.locator('.enroll-req').allTextContents(); assert.equal(reqText.length, 2);
    for (const t of reqText) { assert.match(t, /Ключ устройства: [A-F0-9]{4}(-[A-F0-9]{4}){3}/); assert.match(t, /адрес Tailscale не определён/); assert.ok(!/127\.0\.0\.1/.test(t), 'device address shown as 127.0.0.1: ' + t); assert.match(t, /Сообщено устройством \(не проверено\)/); }
    assert.ok(!(await p.content()).includes(codeI) && !(await p.content()).includes(codeM), 'one-time codes gone from DOM after reload'); await shot('02-podtverzhdenie.jpg');
    // (3) «Подтвердить» via the UI: confirm → unverified-peer acknowledgment → password step-up (428 → prompt)
    for (let i = 0; i < 2; i++) { const nd = dialogs.length; await p.locator('[data-enc]').first().click(); await until(async () => dialogs.length >= nd + 3, 10000); await p.waitForTimeout(800); await reloadComputers(); }
    const kinds = dialogs.map(d => d.type); assert.ok(kinds.filter(k => k === 'prompt').length >= 2, 'password prompt shown'); assert.ok(dialogs.some(d => /адрес tailscale не определ/i.test(d.message)) && dialogs.some(d => /Ключ устройства: [A-F0-9-]{19}/.test(d.message)));
    assert.ok(!dialogs.some(d => /127\.0\.0\.1/.test(d.message)), 'no 127.0.0.1 in confirm dialog');
    await Promise.all(enr); allTokens.add(token('imac')); allTokens.add(token('macbook'));
    const ai = startAgent('imac', SP), am = startAgent('macbook', SP + 1); await until(async () => (await nodeApi('imac'))?.status === 'online' && (await nodeApi('macbook'))?.status === 'online', 30000);
    await reloadComputers(); assert.equal(await p.locator('#machines .machine').count(), 3); const mt = await p.textContent('#machines');
    assert.match(mt, /Mac mini/); assert.match(mt, /NEWS NODE/); assert.match(mt, /MONITOR NODE/); assert.equal(await statusOf('imac'), 'st-online'); assert.equal(await statusOf('macbook'), 'st-online'); await shot('03-computers-3-mashiny-online.jpg');
    // (3) «Ротация токена» via the UI (password) → agent rotates; «Отозвать» via the UI (confirm + password)
    const t0 = token('imac'); await p.click('[data-rot="imac"]'); await until(() => token('imac') && token('imac') !== t0, 20000); allTokens.add(token('imac'));
    await reloadComputers(); await p.click('[data-rev="macbook"]'); await until(async () => (await nodeApi('macbook')).revoked);
    await until(async () => (await nodeApi('macbook')).lastConnError?.code === 'E_REVOKED', 10000);
    // (5) statuses: Offline (heartbeat stale), error 426, revoked
    await stopAgent(ai); await until(async () => (await nodeApi('imac')).status === 'down', 15000); await reloadComputers();
    assert.equal(await statusOf('imac'), 'st-offline'); assert.match(await p.textContent('.machine.node-news'), /Offline/); assert.equal(await statusOf('macbook'), 'st-revoked'); assert.match(await p.textContent('.machine.node-monitor'), /Отозван/); await shot('04-statusy-offline-otozvan.jpg');
    const dk = await EN.deviceIdentity(path.join(env('imac').HOME, '.moonkatty-node'), EN.keychain(env('imac')), { create: false });
    const r426 = await A.client({ url: `https://127.0.0.1:${NP}`, certFile: path.join(env('imac').HOME, '.moonkatty-node', 'coordinator.crt'), fingerprint: st.fingerprint, token: token('imac'), deviceKey: dk.key })('POST', '/hello', { info: { agentVersion: '0.3.0' } }); assert.equal(r426.status, 426);
    await reloadComputers(); assert.equal(await statusOf('imac'), 'st-error'); assert.match(await p.textContent('.machine.node-news'), /426/); await shot('05-status-oshibka-426.jpg');
    // (3) audit shows the whole story
    const ev = (await s.j('GET', '/api/ops/nodes/audit', s.A)).body.events.map(e => e.type); for (const k of ['request_created', 'code_accepted', 'peer_unverified_acknowledged', 'confirmed', 'enrolled', 'rotate_requested', 'rotated', 'revoked']) assert.ok(ev.includes(k), k);
    await p.evaluate(() => { const d = document.getElementById('nodesAudit'); if (d) d.open = true; }); await shot('06-zhurnal.jpg');
    await stopAgent(am);
    // (7) secrets: DOM, API responses, server logs/stdout, audit, every file in the data dir, agent output
    const secrets = [...allTokens].filter(Boolean).flatMap(t => [t, t.split('.')[1]]).concat([PW], codes.map(c => c.replace(/-/g, '')), codes);
    const dom = await p.content(); const apis = []; for (const u of ['/api/ops/nodes', '/api/ops/nodes/enroll', '/api/ops/nodes/audit', '/api/ops/dashboard', '/api/logs', '/api/ops/status', '/api/system', '/api/ops/security/audit']) apis.push(JSON.stringify((await s.j('GET', u, s.A)).body));
    const files = walk(s.UD).filter(f => !/\.(sqlite|db)(-wal|-shm)?$/.test(f) || true).map(f => { try { return fs.readFileSync(f, 'latin1'); } catch { return ''; } });
    const hay = { dom, api: apis.join('\n'), serverLog: s.out.join(''), agentLog: agentOut.join(''), files: files.join('\n') };
    for (const [where, text] of Object.entries(hay)) for (const sec of secrets) assert.ok(!text.includes(sec), `secret leaked into ${where}: ${sec.slice(0, 6)}…`);
    assert.ok(!/PRIVATE KEY-----/.test(hay.api + hay.dom + hay.serverLog));
    assert.deepEqual(errs, []);
  } finally { if (b) await b.close(); for (const c of procs) await stopAgent(c); await s.cleanup(); }
});
