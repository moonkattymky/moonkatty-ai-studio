#!/usr/bin/env node
// MONITOR NODE RAM/CPU simulation: real agent process (profile monitor, flags from the plist) pinned to 2 CPU cores (taskset, like the
// MacBook Pro 13" 2015 i5 2-core) + real in-process coordinator (HTTP test mode, 127.0.0.1) + local "sites" server.
// Workload mix per round: studio.health, site.check (20 URLs), result.verify (SHA-256 of N artifacts × S MB, streamed), ffprobe.check
// (if ffprobe+ffmpeg exist), stats.compute (10k values). Samples agent RSS (ps) every 100 ms and CPU (utime+stime incl. children, /proc).
//   node scripts/node/monitor-load-sim.mjs [--rounds 10] [--files 3] [--file-mb 64] [--heap 128] [--cores 0,1] [--json out.json]
import { spawn, execFileSync } from 'node:child_process'; import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'); const N = require(path.join(ROOT, 'lib/ops/nodes.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROUNDS = +arg('rounds', 10), FILES = +arg('files', 3), FMB = +arg('file-mb', 64), HEAP = +arg('heap', 128), CORES = arg('cores', '0,1');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monsim-')); const sleep = ms => new Promise(r => setTimeout(r, ms));
const site = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<html>MOONKATTY ok ' + 'x'.repeat(20000) + '</html>'); }); await new Promise(r => site.listen(0, '127.0.0.1', r));
const urls = Array.from({ length: 20 }, (_, i) => `http://127.0.0.1:${site.address().port}/p${i}`);
const m = N.createNodeManager({ dir: path.join(dir, 'coord'), leaseMs: 120000, maxFileBytes: 2 * 1024 ** 3 }); const { token } = m.registerNode({ id: 'macbook', role: 'monitor', name: 'MacBook sim' });
const srv = await N.listen(m, { host: '127.0.0.1', port: 0, insecureHttpForTests: true }); const port = srv.address().port;
// artifacts: random data files (content-addressed) + a short real video if ffmpeg is present
const arts = []; for (let k = 0; k < FILES; k++) { const f = path.join(dir, 'a' + k); const fd = fs.openSync(f, 'w'); const chunk = crypto.randomBytes(1 << 20); for (let i = 0; i < FMB; i++) fs.writeSync(fd, chunk); fs.closeSync(fd);
  const h = execFileSync('sha256sum', [f]).toString().split(' ')[0]; fs.renameSync(f, path.join(m.filesDir, h)); arts.push({ sha256: h, name: `artifact-${k}.bin` }); }
let video = null; const hasFF = (() => { try { execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
if (hasFF) { const v = path.join(dir, 'clip.mp4'); execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', v]);
  video = { sha256: m.putLocalFile(fs.readFileSync(v)), name: 'clip.mp4' }; }
const env = { PATH: process.env.PATH, HOME: dir, NODE_AGENT_ENV: path.join(dir, 'none.env'), NODE_ID: 'macbook', NODE_PROFILE: 'monitor', NODE_TOKEN: token, COORDINATOR_URL: `http://127.0.0.1:${port}`, NODE_AGENT_TEST_HTTP: '1', NODE_POLL_MS: '100', NODE_STATUS_PORT: '0' };
const useTaskset = process.platform === 'linux' && (() => { try { execFileSync('taskset', ['-V'], { stdio: 'ignore' }); return true; } catch { return false; } })();
let agent, log = '', restarts = 0, stopping = false; const start = () => { const a = [`--max-old-space-size=${HEAP}`, '--expose-gc', path.join(ROOT, 'node-agent/agent.js')];
  agent = useTaskset ? spawn('taskset', ['-c', CORES, process.execPath, ...a], { env, stdio: ['ignore', 'pipe', 'pipe'] }) : spawn(process.execPath, a, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  agent.stdout.on('data', d => log += d); agent.stderr.on('data', d => log += d); agent.on('exit', c => { if (!stopping && c === 75) { restarts++; m.sweep(); start(); } }); }; start();
process.on('exit', () => { stopping = true; try { agent.kill('SIGKILL'); } catch {} }); for (const sg of ['SIGINT', 'SIGTERM']) process.on(sg, () => process.exit(130));
const pidOf = () => { if (!useTaskset) return agent.pid; return agent.pid; }; // taskset execs in place → same pid
const rssOf = pid => { try { return +execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim() / 1024; } catch { return 0; } };
const cpuTicks = pid => { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return +f[11] + +f[12] + +f[13] + +f[14]; } catch { return null; } }; // utime stime cutime cstime
const HZ = 100; const samples = []; const sampler = setInterval(() => samples.push({ t: Date.now(), mb: rssOf(pidOf()) }), 100);
await sleep(1500); const idle = Math.max(...samples.map(s => s.mb)); const c0 = cpuTicks(pidOf()); const t0 = Date.now(); const sweeper = setInterval(() => m.sweep(), 1000);
const ids = []; const add = (capability, input, files) => ids.push(m.submit({ capability, input, files, safeToRetry: true, maxAttempts: 3, timeoutSec: 600 }).jobId);
for (let r = 0; r < ROUNDS; r++) { add('studio.health', { urls: urls.slice(0, 5) }); add('site.check', { urls, expectText: 'MOONKATTY' }); add('result.verify', { minBytes: 1 }, arts);
  if (video) add('ffprobe.check', { width: 1280, height: 720, maxDurationSec: 30 }, [video]); add('stats.compute', { values: Array.from({ length: 10000 }, (_, i) => (i * 7919) % 1000) }); }
setTimeout(() => { console.error('TIMEOUT\n' + log.slice(-3000)); process.exit(2); }, +arg('timeout', 900000)).unref();
const res = await Promise.all(ids.map(id => m.waitFor(id))); const dt = (Date.now() - t0) / 1000; const c1 = cpuTicks(pidOf()); clearInterval(sampler); clearInterval(sweeper);
const busy = samples.filter(s => s.t >= t0).map(s => s.mb).sort((a, b) => a - b); const by = {}; for (const j of res) (by[j.capability] ||= { ok: 0, fail: 0 })[j.status === 'succeeded' && (j.result || {}).ok !== false ? 'ok' : 'fail']++;
const verifyOk = res.filter(j => j.capability === 'result.verify').every(j => j.result && j.result.ok && j.result.files.every(f => arts.some(a => a.sha256 === f.sha256)));
const cpuSec = c0 != null && c1 != null ? (c1 - c0) / HZ : null;
const out = { node: process.version, platform: `${process.platform}/${process.arch}`, cores: useTaskset ? CORES : 'all (no taskset)', heapFlagMB: HEAP, rounds: ROUNDS, jobs: ids.length, artifacts: `${FILES} × ${FMB} MB`, ffprobe: video ? execFileSync('ffprobe', ['-version']).toString().split('\n')[0] : 'absent',
  byCapability: by, verifySha256Ok: verifyOk, restarts, seconds: +dt.toFixed(1), cpu: cpuSec == null ? null : { cpuSeconds: +cpuSec.toFixed(1), avgPctOfOneCore: +(100 * cpuSec / dt).toFixed(1), avgPctOf2Cores: +(50 * cpuSec / dt).toFixed(1) },
  rssMB: { idle: +idle.toFixed(1), p50: +busy[Math.floor(busy.length / 2)].toFixed(1), p95: +busy[Math.floor(busy.length * 0.95)].toFixed(1), peak: +busy[busy.length - 1].toFixed(1) } };
stopping = true; agent.kill('SIGTERM'); await new Promise(r => agent.exitCode != null ? r() : agent.once('exit', r)); srv.close(); site.close(); fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 1)); if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify(out, null, 1)); if (res.some(j => j.status !== 'succeeded')) { console.error(log.slice(-2000)); process.exit(1); }
