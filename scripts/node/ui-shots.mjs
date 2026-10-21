// Screenshots of the built UI with SIMULATED nodes enrolled through the REAL one-time-code flow (0.2.2):
// temp data dir (never real user data), loopback only, fake Keychain (test double), test owner password from test/helpers.
// Usage: node scripts/node/ui-shots.mjs [/workspace/send/ui] [port=8899]
import { chromium } from 'playwright-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { startServer, sleep } = require('../../test/helpers/server.js');
const OUT = process.argv[2] || '/workspace/send/ui'; const PORT = +(process.argv[3] || 8899); const NP = 18799; fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const PW = 'fake-password-123';
const s = await startServer({ port: PORT, env: { STUDIO_OPS_NODES: '1', STUDIO_OPS_DASHBOARD: '1', STUDIO_OPS_MOBILE: '1', STUDIO_OPS_RESOURCES: '1', STUDIO_OPS_SECURITY: '1', OPS_NODES_PORT: String(NP), STUDIO_LANG: 'ru' } });
const procs = []; const kill = async () => { for (const p of procs) { try { p.kill('SIGTERM'); } catch {} } await sleep(1500); for (const p of procs) if (p.exitCode === null && p.signalCode === null) { try { p.kill('SIGKILL'); } catch {} } }; let b;
const stepUp = async (method, url, action, body = {}) => { const cr = await s.j('POST', '/api/ops/confirm', s.A, { action, password: PW }); if (!cr.body || !cr.body.confirmToken) console.error('confirm:', cr.status, JSON.stringify(cr.body)); const c = cr.body.confirmToken; return s.j(method, url, { ...s.A, 'x-studio-confirm': c }, body); };
const KC = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-kc-')); const kcEnv = id => ({ NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(KC, id + '.json') });
const homes = {}; const agent = (id, port) => { const home = homes[id] ||= fs.mkdtempSync(path.join(os.tmpdir(), 'shot-' + id + '-'));
  const p = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { stdio: 'ignore', env: { PATH: process.env.PATH, HOME: home, NODE_POLL_MS: '700', NODE_STATUS_PORT: String(port), ...kcEnv(id) } }); procs.push(p); return p; };
try {
  const rss = (n, items) => `<?xml version="1.0"?><rss><channel>${items.map((t, i) => `<item><title>${t}</title><link>http://127.0.0.1/sim/${n}/${i}</link></item>`).join('')}</channel></rss>`;
  const FEEDS = { a: ['[SIM] Рынки реагируют на новые данные', '[SIM] Саммит по климату'], b: ['[SIM] Международная космическая миссия', '[SIM] Рынки реагируют на новые данные'] };
  const rs = http.createServer((q, r) => { r.setHeader('content-type', 'application/rss+xml'); r.end(rss(q.url.slice(1), FEEDS[q.url.slice(1)] || [])); }); await new Promise(r => rs.listen(18798, '127.0.0.1', r));
  let st; for (let i = 0; i < 50; i++) { st = (await s.j('GET', '/api/ops/nodes', s.A)).body; if (st.fingerprint) break; await sleep(100); }
  b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' }); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' }); await ctx.addCookies([{ name: s.A.cookie.split('=')[0], value: s.A.cookie.split('=').slice(1).join('='), url: s.B }]);
  const page = async (url, vp) => { const p = await ctx.newPage(); if (vp) await p.setViewportSize(vp); p.on('pageerror', e => errs.push(url + ': ' + e.message)); await p.goto(url); return p; };
  const jpg = (p, f, o = {}) => p.screenshot({ path: path.join(OUT, f), type: 'jpeg', quality: 85, ...o });
  const opsPage = async () => { const p = await page(s.B + '/'); await p.waitForTimeout(4000); await p.evaluate(() => { location.hash = 'ops'; }); await p.waitForTimeout(3000); return p; };
  const at = async (p, text) => { const l = p.getByText(text, { exact: false }).first(); await l.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -120)); await p.waitForTimeout(300); };
  // --- 4: «Подключить компьютер» in the panel → code + server fingerprint (iMac / news)
  let p = await opsPage(); await p.selectOption('#enRole', 'news'); await p.fill('#enName', 'iMac 27 (NEWS)'); await p.click('#enNew'); await p.waitForSelector('#enOut b'); await p.waitForTimeout(500);
  const codeImac = (await p.textContent('#enOut b')).trim(); await at(p, 'Подключить компьютер'); await jpg(p, '04-podklyuchit-kompyuter-kod.jpg'); await p.close();
  // --- 6: node local enroll screen on 127.0.0.1:8791 (iMac) → code, address, fingerprint → pending with device-key fingerprint
  agent('imac', 18791); await sleep(1500); p = await page('http://127.0.0.1:18791/');
  await p.fill('#code', codeImac); await p.fill('#url', `https://127.0.0.1:${NP}`); await p.fill('#fp', st.fingerprint); await p.click('#go');
  await p.waitForFunction(() => /Ключ устройства/.test(document.getElementById('st').textContent), null, { timeout: 20000 }); await p.waitForTimeout(500); await jpg(p, '06-uzel-ekran-podklyucheniya-8791.jpg', { fullPage: true });
  const nodeKey = (await p.textContent('#st')).match(/Ключ устройства[^:]*: ([A-F0-9-]{19})/)[1]; await p.close();
  // MacBook / monitor: same real flow via CLI (code through stdin)
  const enM = (await s.j('POST', '/api/ops/nodes/enroll', s.A, { role: 'monitor', name: 'MacBook Pro 13 (MONITOR)' })).body; homes.macbook = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-macbook-'));
  const cli = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js'), '--enroll', '--url', `https://127.0.0.1:${NP}`, '--fingerprint', st.fingerprint], { stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: process.env.PATH, HOME: homes.macbook, ...kcEnv('macbook') } }); procs.push(cli); cli.stdin.end(enM.code + '\n');
  for (let i = 0; i < 100; i++) { const l = (await s.j('GET', '/api/ops/nodes/enroll', s.A)).body.requests; if (l.filter(q => q.state === 'pending').length === 2) break; await sleep(200); }
  // --- 5: pending requests with device-key fingerprint (confirm screen)
  p = await opsPage(); let dialogText = ''; p.on('dialog', d => { dialogText = d.message(); d.dismiss(); }); await at(p, 'Ключ устройства'); await jpg(p, '05-podtverzhdenie-klyuch-ustroystva.jpg');
  await p.click('[data-enc]'); await p.waitForTimeout(500); fs.writeFileSync(path.join(OUT, '05-dialog-text.txt'), dialogText + '\n'); await p.close();
  for (const q of (await s.j('GET', '/api/ops/nodes/enroll', s.A)).body.requests.filter(q => q.state === 'pending')) { const r = await stepUp('POST', `/api/ops/nodes/enroll/${q.requestId}/confirm`, 'node-confirm'); if (r.status !== 200) throw new Error('confirm ' + r.status); }
  for (let i = 0; i < 60 && procs.some(x => x.exitCode === null && (x === cli || x.spawnargs.length === 2)); i++) await sleep(250); // enroll UI exits 75, CLI exits 0
  agent('imac', 18791); agent('macbook', 18792); await sleep(4000);
  const job = x => s.j('POST', '/api/ops/nodes/jobs', s.A, x);
  await job({ capability: 'news.collect', input: { feeds: [{ url: 'http://127.0.0.1:18798/a', source: 'SIM feed A' }, { url: 'http://127.0.0.1:18798/b', source: 'SIM feed B' }] }, safeToRetry: true });
  await job({ capability: 'studio.health', input: { urls: [s.B + '/api/health'] } }); await sleep(5000);
  // --- 1 main panel, 2 operations/resources, 3 node manager, 7 audit
  p = await page(s.B + '/'); await p.waitForTimeout(5000); await jpg(p, '01-glavnaya-panel.jpg'); await p.close();
  p = await opsPage(); await at(p, 'Память'); await jpg(p, '02-operatsii-resursy-pamyat.jpg');
  await at(p, 'Узлы (Node Manager)'); await jpg(p, '03a-operatsii-uzly-online.jpg');
  await p.evaluate(() => document.querySelectorAll('details').forEach(d => { if (/Журнал событий узлов/.test(d.textContent)) d.open = true; })); await at(p, 'Журнал событий узлов'); await jpg(p, '07-zhurnal-audita.jpg'); await p.close();
  p = await page(s.B + '/'); await p.waitForTimeout(4000); await p.getByText('Computers (Nodes)').first().click(); await p.waitForTimeout(3000); await jpg(p, '03-menedzher-uzlov-oba-online.jpg', { fullPage: true }); await p.close();
  // --- 8 mobile control (iPhone 390) with a real mobile token
  const mt = (await s.j('POST', '/api/ops/mobile-tokens', s.A, { label: 'iPhone (демо)' })).body; const mctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'ru-RU' });
  const mp = await mctx.newPage(); await mp.goto(s.B + '/mobile.html'); await mp.evaluate(t => localStorage.setItem('mk_mobile_token', t), mt.token); await mp.reload(); await mp.waitForTimeout(4000); await mp.screenshot({ path: path.join(OUT, '08-mobilnoe-upravlenie-iphone.jpg'), type: 'jpeg', quality: 85 }); await mctx.close();
  const nodes = (await s.j('GET', '/api/ops/nodes', s.A)).body.nodes.map(n => `${n.id}:${n.status}:${n.info && n.info.agentVersion}`);
  console.log(JSON.stringify({ ok: true, nodeKey, nodes, errors: errs, files: fs.readdirSync(OUT) })); rs.close();
} catch (e) { console.error("ui-shots FAILED:", e.stack); } finally { if (b) await b.close(); await kill(); await s.cleanup(); process.exit(0); }
