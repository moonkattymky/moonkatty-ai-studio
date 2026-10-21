#!/usr/bin/env node
// NEWS NODE RAM simulation (Linux/macOS): real agent process + real in-process coordinator (HTTP test mode on 127.0.0.1)
// + local RSS feed server. Samples the AGENT process RSS (ps -o rss) every 100 ms. Usage:
//   node scripts/node/news-load-sim.mjs [--jobs 20] [--feeds 50] [--items 200] [--item-bytes 900] [--heap 192] [--json out.json]
import { spawn, execFileSync } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const N = require(path.join(ROOT, 'lib/ops/nodes.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const JOBS = +arg('jobs', 20), FEEDS = +arg('feeds', 50), ITEMS = +arg('items', 200), IB = +arg('item-bytes', 900), HEAP = +arg('heap', 192);
// feeds: ~35 % of items are cross-feed duplicates (same title+link) → exercises dedup
const pad = 'Лента новостей MOONKATTY — описание события, цитаты и контекст. '.repeat(Math.ceil(IB / 60)).slice(0, IB);
function feed(f) { let x = '<?xml version="1.0"?><rss><channel><title>feed ' + f + '</title>'; for (let i = 0; i < ITEMS; i++) { const dup = i % 3 === 0; const id = dup ? 'shared-' + i : f + '-' + i;
  x += `<item><title><![CDATA[Новость ${id}: заголовок события]]></title><link>https://news.example/${id}</link><pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[${pad}]]></description></item>`; } return x + '</channel></rss>'; }
const bodies = Array.from({ length: FEEDS }, (_, f) => Buffer.from(feed(f)));
const fsrv = http.createServer((q, r) => { const m = /\/f(\d+)\.xml/.exec(q.url); r.writeHead(200, { 'content-type': 'application/rss+xml' }); r.end(bodies[+m[1]]); }); await new Promise(r => fsrv.listen(0, '127.0.0.1', r));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'newssim-')); const m = N.createNodeManager({ dir: path.join(dir, 'coord'), leaseMs: 60000 }); const { token } = m.registerNode({ id: 'imac', role: 'news', name: 'iMac sim' });
const srv = await N.listen(m, { host: '127.0.0.1', port: 0, insecureHttpForTests: true }); const port = srv.address().port;
const env = { PATH: process.env.PATH, HOME: dir, NODE_AGENT_ENV: path.join(dir, 'none.env'), NODE_ID: 'imac', NODE_PROFILE: 'news', NODE_TOKEN: token, COORDINATOR_URL: `http://127.0.0.1:${port}`, NODE_AGENT_TEST_HTTP: '1', NODE_POLL_MS: '100', NODE_STATUS_PORT: '0' };
// same flags as the LaunchAgent plist; exit 75 → restarted like launchd KeepAlive (counted)
let agent, log = '', restarts = 0, stopping = false; const start = () => { agent = spawn(process.execPath, [`--max-old-space-size=${HEAP}`, '--expose-gc', path.join(ROOT, 'node-agent/agent.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  agent.stdout.on('data', d => log += d); agent.stderr.on('data', d => log += d); agent.on('exit', c => { if (!stopping && c === 75) { restarts++; m.sweep(); start(); } }); }; start();
const sweeper = setInterval(() => m.sweep(), 1000);
const rssOf = pid => { try { return +execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim() / 1024; } catch { return 0; } };
const samples = []; const sampler = setInterval(() => samples.push({ t: Date.now(), mb: rssOf(agent.pid) }), 100);
const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(1500); const idle = Math.max(...samples.map(s => s.mb)); const t0 = Date.now();
const feeds = bodies.map((_, f) => ({ url: `http://127.0.0.1:${fsrv.address().port}/f${f}.xml`, source: 'src' + (f % 10) }));
const ids = []; for (let j = 0; j < JOBS; j++) ids.push(m.submit({ capability: 'news.collect', input: { feeds }, idempotencyKey: 'sim:' + j, safeToRetry: true, maxAttempts: 3 }).jobId);
setTimeout(() => { console.error("TIMEOUT log:\n" + log.slice(-3000)); process.exit(2); }, +arg("timeout", 600000)).unref();
const results = await Promise.all(ids.map(id => m.waitFor(id))); const dt = Date.now() - t0; clearInterval(sampler); clearInterval(sweeper);
const busy = samples.filter(s => s.t >= t0).map(s => s.mb).sort((a, b) => a - b); const r0 = results[0].result || {};
const out = { node: process.version, platform: `${process.platform}/${process.arch}`, heapFlagMB: HEAP, jobs: JOBS, feedsPerJob: FEEDS, itemsPerFeed: ITEMS, feedBytes: bodies[0].length, rawItemsPerJob: FEEDS * ITEMS,
  uniqueItemsPerJob: (r0.items || []).length || r0.total, resultAsArtifact: !!r0.resultArtifact, artifactOnCoordinator: !!(r0.resultArtifact && fs.existsSync(path.join(m.filesDir, r0.resultArtifact))), truncated: r0.truncated || null, restarts, backpressureEvents: (log.match(/backpressure/g) || []).length, succeeded: results.filter(r => r.status === 'succeeded').length, seconds: +(dt / 1000).toFixed(1),
  rssMB: { idle: +idle.toFixed(1), p50: +busy[Math.floor(busy.length / 2)].toFixed(1), p95: +busy[Math.floor(busy.length * 0.95)].toFixed(1), peak: +busy[busy.length - 1].toFixed(1) } };
stopping = true; agent.kill('SIGTERM'); await new Promise(r => agent.once('exit', r)); srv.close(); fsrv.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1)); if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 1)); if (out.succeeded !== JOBS) { console.error(log.slice(-2000)); process.exit(1); }
