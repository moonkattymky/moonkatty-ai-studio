// Screenshots of the built UI with SIMULATED nodes (local processes, temp data, loopback only). Usage: node scripts/node/ui-shots.mjs /workspace/ui-shots
import { chromium } from 'playwright-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { startServer, sleep } = require('../../test/helpers/server.js');
const OUT = process.argv[2] || '/workspace/ui-shots'; fs.mkdirSync(OUT, { recursive: true }); const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const s = await startServer({ port: 18655, env: { STUDIO_OPS_NODES: '1', STUDIO_OPS_DASHBOARD: '1', STUDIO_OPS_MOBILE: '1', STUDIO_OPS_RESOURCES: '1', STUDIO_OPS_MONEY: '1', OPS_NODES_PORT: '18799' } });
const procs = []; const kill = () => procs.forEach(p => { try { p.kill(); } catch {} });
try {
  // simulated RSS feeds (clearly labelled as simulation, loopback only)
  const rss = (n, items) => `<?xml version="1.0"?><rss><channel>${items.map((t, i) => `<item><title>${t}</title><link>http://127.0.0.1/sim/${n}/${i}</link><pubDate>Wed, 21 Oct 2026 0${i}:00:00 +0300</pubDate></item>`).join('')}</channel></rss>`;
  const FEEDS = { a: ['[SIM] Рынки реагируют на новые данные', '[SIM] Саммит по климату: ключевое соглашение', '[SIM] Технологические компании объявили партнёрство'], b: ['[SIM] Международная космическая миссия', '[SIM] Рынки реагируют на новые данные'], c: ['[SIM] Новости науки: открытие года'] };
  const rs = http.createServer((q, r) => { const k = q.url.slice(1); r.setHeader('content-type', 'application/rss+xml'); r.end(rss(k, FEEDS[k] || [])); }); await new Promise(r => rs.listen(18798, '127.0.0.1', r));
  const reg = async (id, role, name) => (await s.j('POST', '/api/ops/nodes', s.A, { id, role, name })).body;
  const news = await reg('imac', 'news', 'iMac'), mon = await reg('macbook', 'monitor', 'MacBook');
  let st; for (let i = 0; i < 50; i++) { st = (await s.j('GET', '/api/ops/nodes', s.A)).body; if (st.fingerprint) break; await sleep(100); }
  const agent = (id, token, port) => { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shot-' + id + '-')); const p = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { stdio: 'ignore',
    env: { PATH: process.env.PATH, HOME: home, NODE_AGENT_ENV: path.join(home, 'x.env'), NODE_ID: id, NODE_TOKEN: token, COORDINATOR_URL: 'https://127.0.0.1:18799', COORDINATOR_CERT: path.join(s.UD, 'ops', 'nodes-tls.crt'), COORDINATOR_FINGERPRINT: st.fingerprint, NODE_POLL_MS: '500', NODE_STATUS_PORT: String(port), NODE_AGENT_SLOW_MS: id === 'macbook' ? '0' : '0' } }); procs.push(p); return p; };
  agent('imac', news.token, 18791); agent('macbook', mon.token, 18792); await sleep(2500);
  const job = b => s.j('POST', '/api/ops/nodes/jobs', s.A, b);
  await job({ capability: 'news.collect', input: { feeds: [{ url: 'http://127.0.0.1:18798/a', source: 'SIM feed A' }, { url: 'http://127.0.0.1:18798/b', source: 'SIM feed B' }, { url: 'http://127.0.0.1:18798/c', source: 'SIM feed C' }] }, safeToRetry: true });
  const clip = path.join(s.UD, 'clip.mp4'); await new Promise(r => spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=f=440', '-t', '2', '-shortest', clip]).on('exit', r));
  const N = require(path.join(ROOT, 'lib/ops/nodes.js'));
  // upload the clip to the coordinator store via the node file API is node-side only; for the sim we place it with the manager's content-addressed layout
  const crypto = await import('node:crypto'); const buf = fs.readFileSync(clip); const h = crypto.createHash('sha256').update(buf).digest('hex'); fs.writeFileSync(path.join(s.UD, 'ops', 'node-files', h), buf);
  await job({ capability: 'ffprobe.check', input: { width: 1280, height: 720 }, files: [{ sha256: h, name: 'moonkatty-news-001.mp4' }] });
  await job({ capability: 'site.check', input: { urls: ['http://127.0.0.1:18655/api/health'] } });
  await s.j('POST', '/api/tasks', s.A, { title: 'Новостной выпуск #001 (демо-задача)', agentId: 'news', status: 'queued' });
  await sleep(5000);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' }); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }); await ctx.addCookies([{ name: s.A.cookie.split('=')[0], value: s.A.cookie.split('=').slice(1).join('='), url: s.B }]);
  const shot = async (url, file, vp) => { const p = await ctx.newPage(); if (vp) await p.setViewportSize(vp); p.on('pageerror', e => errs.push(file + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(file + ': ' + m.text()); }); await p.goto(url); await p.waitForTimeout(2500); await p.screenshot({ path: path.join(OUT, file), fullPage: true }); await p.close(); };
  await shot(s.B + '/studio.html', '01-main-server-dashboard.png');
  await shot('http://127.0.0.1:18791/', '02-imac-news-node.png', { width: 1200, height: 760 });
  await shot('http://127.0.0.1:18792/', '03-macbook-monitor-node.png', { width: 1200, height: 760 });
  await s.j('POST', '/api/ops/nodes/macbook/command', s.A, { command: 'pause' }); await sleep(1500);
  await shot(s.B + '/studio.html', '04-main-server-macbook-paused.png');
  await shot(s.B + '/', '05-main-panel.png'); { const p = await ctx.newPage(); await p.goto(s.B + '/'); await p.waitForTimeout(7000); await p.evaluate(() => { location.hash = 'ops'; }); await p.waitForTimeout(3000); await p.screenshot({ path: path.join(OUT, '06-operations-panel-nodes-money.png'), fullPage: true }); await p.close(); }
  console.log(JSON.stringify({ ok: true, errors: errs, files: fs.readdirSync(OUT) })); await b.close();
} finally { kill(); await s.cleanup(); process.exit(0); }
