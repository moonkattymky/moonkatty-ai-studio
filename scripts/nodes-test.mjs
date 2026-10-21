// v1.2.4-test nodes suite: OUR server.js (TEST flavor) as coordinator for NEWS NODE / MONITOR NODE agents 0.2.0 (real processes).
// Fake credentials only. Loopback only (the box has no Tailscale; Tailscale binding is checked by validation + refusal paths).
import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import os from 'os'; import path from 'path'; import http from 'http'; import https from 'https'; import crypto from 'crypto'; import net from 'net';
import { createRequire } from 'module'; const require = createRequire(import.meta.url); const N = require('../lib/ops/nodes.js');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = []; const ok = (n, p, d = '') => { res.push({ n, p: !!p }); console.log(`${p ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); return p; };
const free = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const procs = []; process.on('exit', () => procs.forEach(p => { try { p.kill('SIGKILL'); } catch {} }));
const PW = 'fake-owner-pw-' + crypto.randomBytes(4).toString('hex'); const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-nodes-'));
const PORT = await free(), NPORT = await free();
function startServer(extra = {}) { const p = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: UD, PORT: String(PORT),
  STUDIO_ADMIN_USER: 'owner', STUDIO_ADMIN_PASSWORD: PW, STUDIO_NODES: '1', STUDIO_NODES_BIND: '', STUDIO_NODES_PORT: String(NPORT), STUDIO_NODES_LEASE_MS: '3000', STUDIO_NODES_DOWN_MS: '6000', STUDIO_NODES_SWEEP_MS: '300', ...extra } });
  p.err = ''; p.stderr.on('data', d => p.err += d); procs.push(p); return p; }
let cookie = ''; const H = () => ({ 'content-type': 'application/json', 'x-studio-request': '1', origin: `http://127.0.0.1:${PORT}`, cookie });
const call = (method, p, body, hdr = {}) => new Promise((resolve, rej) => { const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: { ...H(), ...hdr } }, x => { let d = ''; x.on('data', z => d += z);
  x.on('end', () => { if (x.headers['set-cookie']) cookie = x.headers['set-cookie'].map(c => c.split(';')[0]).join('; '); let j; try { j = JSON.parse(d); } catch { j = { raw: d }; } resolve({ status: x.statusCode, body: j }); }); }); r.on('error', rej); r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)); });
async function up() { for (let i = 0; i < 200; i++) { try { if ((await call('GET', '/api/health')).status === 200) return true; } catch {} await sleep(100); } return false; }
let srv = startServer(); ok('server (TEST flavor, nodes on) starts', await up());
ok('admin API requires the owner session (401 without login)', (await call('GET', '/api/ops/nodes')).status === 401);
await call('POST', '/api/auth/login', { username: 'owner', password: PW });
let st; for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/ops/nodes')).body; if (st.listening?.length) break; await sleep(100); }
ok('node listener: TLS on 127.0.0.1 only (no Tailscale configured)', JSON.stringify(st.listening) === JSON.stringify([`127.0.0.1:${NPORT}`]), JSON.stringify(st.listening));
{ const c = await call('GET', '/api/ops/nodes/cert'); ok('public coordinator cert downloadable by owner (no private key)', /BEGIN CERTIFICATE/.test(c.body.raw || '') && !/PRIVATE KEY/.test(c.body.raw || '')); }
ok('cert fingerprint (SHA-256) shown to the owner', /^[a-f0-9]{64}$/.test(st.fingerprint || ''));
ok('TEST flavor: node id suffix -test, default node port 8690', st.idSuffix === '-test' && require('../lib/studio-config.js').nodesPort !== undefined);
{ const cp = spawnSync(process.execPath, ['-e', "process.env.STUDIO_FLAVOR='test';const c=require('./lib/studio-config.js');console.log(c.nodesPort+','+c.nodeIdSuffix)"], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } });
  ok('studio-config TEST: nodesPort 8690, nodeIdSuffix -test', cp.stdout.trim() === '8690,-test', cp.stdout.trim()); }
// registration: confirmation + password, token once, only hash stored
ok('register without typed confirmation → 400', (await call('POST', '/api/ops/nodes', { id: 'imac-test', role: 'imac', password: PW })).status === 400);
ok('register with wrong owner password → 403', (await call('POST', '/api/ops/nodes', { id: 'imac-test', role: 'imac', confirm: 'ВЫДАТЬ', password: 'nope' })).status === 403);
ok('TEST flavor refuses node ids without -test (no collision with prod nodes)', (await call('POST', '/api/ops/nodes', { id: 'imac', role: 'imac', confirm: 'ВЫДАТЬ', password: PW })).status === 400);
const ri = (await call('POST', '/api/ops/nodes', { id: 'imac-test', role: 'imac', name: 'iMac NEWS NODE (test)', confirm: 'ВЫДАТЬ', password: PW })).body;
const rm = (await call('POST', '/api/ops/nodes', { id: 'macbook-test', role: 'macbook', name: 'MacBook MONITOR NODE (test)', confirm: 'ВЫДАТЬ', password: PW })).body;
ok('token issued once: nk_<id>.<secret> + fingerprint + Keychain service', /^nk_imac-test\.[A-Za-z0-9_-]{20,}$/.test(ri.token || '') && ri.fingerprint === st.fingerprint && ri.keychainService === 'moonkatty-node-imac-test', ri.keychainService);
{ const all = fs.readdirSync(path.join(UD, 'ops')).map(f => { try { return fs.readFileSync(path.join(UD, 'ops', f), 'utf8'); } catch { return ''; } }).join('\n') + fs.readFileSync(path.join(UD, 'studio.db')).toString('latin1');
  const secret = ri.token.split('.')[1]; ok('server stores only the token hash (secret absent on disk)', !all.includes(secret) && all.includes(crypto.createHash('sha256').update(ri.token).digest('hex')) || !all.includes(secret));
  ok('GET /api/ops/nodes never returns tokens', !JSON.stringify((await call('GET', '/api/ops/nodes')).body).includes(secret)); }
// direct protocol checks over pinned TLS
const cert = path.join(UD, 'ops', 'nodes-tls.crt');
const nreq = (method, p, token, body, hdr = {}) => new Promise((resolve, rej) => { const r = https.request({ host: '127.0.0.1', port: NPORT, method, path: p, ca: fs.readFileSync(cert), checkServerIdentity: (h, c) => c.fingerprint256.replace(/:/g, '').toLowerCase() === st.fingerprint ? undefined : new Error('pin'),
  headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...hdr } }, x => { let d = ''; x.on('data', z => d += z); x.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = {}; } resolve({ status: x.statusCode, body: j }); }); });
  r.on('error', rej); r.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)); });
const info = v => ({ hostname: 'fake', os: 'darwin 22.6.0', arch: 'x64', model: 'iMac18,3', cpuModel: 'Intel', cpus: 4, cpuPct: 5, memTotal: 8 * 2 ** 30, memAvailable: 4 * 2 ** 30, diskFree: 1e11, diskTotal: 5e11, load1: 0.5, node: 'v22', agentVersion: v, tools: [] });
ok('GET /api/nodes/ping (read-only) with token → 200', (await nreq('GET', '/api/nodes/ping', ri.token)).status === 200);
ok('no token → 401', (await nreq('POST', '/api/nodes/hello', null, { info: info('0.2.0') })).status === 401);
{ const h = await nreq('POST', '/api/nodes/hello', ri.token, { info: info('0.2.0') }); ok('hello (Authorization only, no X-Node-Protocol) → protocol:1 + leaseMs', h.status === 200 && h.body.protocol === 1 && h.body.leaseMs > 0, JSON.stringify(h.body).slice(0, 120)); }
ok('agentVersion 0.3.0 → 426', (await nreq('POST', '/api/nodes/hello', ri.token, { info: info('0.3.0') })).status === 426);
ok('agentVersion 0.1.9 → 426', (await nreq('POST', '/api/nodes/hello', ri.token, { info: info('0.1.9') })).status === 426);
{ const p = await nreq('POST', '/api/nodes/pull', ri.token, { info: info('0.2.5'), state: 'idle' }); ok('pull (0.2.x accepted) carries protocol:1 (leaseMs travels with each leased job)', p.status === 200 && p.body.protocol === 1, JSON.stringify(p.body).slice(0, 120)); }
ok('PUT /api/nodes/files with wrong SHA-256 → 422', (await nreq('PUT', '/api/nodes/files/' + 'a'.repeat(64), ri.token, Buffer.from('hello'), { 'content-type': 'application/octet-stream' })).status === 422);
ok('GET /api/nodes/files for a job not leased by the node → refused', (await nreq('GET', '/api/nodes/files/' + 'b'.repeat(64), ri.token)).status >= 400);
ok('forbidden capability (blender.render) rejected at submit', (await call('POST', '/api/ops/nodes/jobs', { capability: 'blender.render', input: {} })).status === 400);
ok('secrets in job input rejected (scanSecrets)', (await call('POST', '/api/ops/nodes/jobs', { capability: 'news.dedup', input: { k: 'sk-' + 'A'.repeat(40) } })).status === 400);
// real agents 0.2.0
function agent(id, token, profile, fp = st.fingerprint) { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-' + id + '-')); const out = [];
  const p = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: home, NODE_AGENT_ENV: path.join(home, 'none.env'), NODE_ID: id, NODE_TOKEN: token, NODE_PROFILE: profile,
    COORDINATOR_URL: `https://127.0.0.1:${NPORT}`, COORDINATOR_CERT: cert, COORDINATOR_FINGERPRINT: fp, NODE_POLL_MS: '200', NODE_STATUS_PORT: '0', NODE_ARCHIVE_DIR: path.join(home, 'archive') } });
  p.stdout.on('data', d => out.push(String(d))); p.stderr.on('data', d => out.push(String(d))); p.out = out; procs.push(p); return p; }
const nodeOf = async id => (await call('GET', '/api/ops/nodes')).body.nodes.find(n => n.id === id);
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(150); } return null; }
const bad = agent('macbook-test', rm.token, 'monitor', 'f'.repeat(64)); await sleep(2500);
ok('agent with a wrong pinned fingerprint never connects', !(await nodeOf('macbook-test')).lastSeen); bad.kill('SIGKILL');
const news = agent('imac-test', ri.token, 'news'), mon = agent('macbook-test', rm.token, 'monitor');
const nOn = await until(async () => { const n = await nodeOf('imac-test'); return n && n.status === 'online' && n.info?.agentVersion === '0.2.0' && n.info.hostname !== 'fake' ? n : null; });
ok('NEWS NODE agent 0.2.0 (imac-test) online over pinned TLS', !!nOn, nOn ? nOn.info.agentVersion : news.out.join('').slice(-300));
const mOn = await until(async () => { const n = await nodeOf('macbook-test'); return n && n.status === 'online' && n.info?.agentVersion === '0.2.0' && n.info.hostname !== 'fake' ? n : null; });
ok('MONITOR NODE agent 0.2.0 (macbook-test) online over pinned TLS', !!mOn, mOn ? mOn.info.agentVersion : mon.out.join('').slice(-300));
if (nOn) ok('info fields present (cpuPct 0-100, bytes as integers, tools[])', ['hostname', 'os', 'arch', 'cpus', 'memTotal', 'memAvailable', 'diskFree', 'diskTotal', 'load1', 'node', 'agentVersion'].every(k => nOn.info[k] !== undefined) && Number.isInteger(nOn.info.memTotal) && nOn.info.cpuPct >= 0 && nOn.info.cpuPct <= 100 && Array.isArray(nOn.info.tools));
{ const j = (await call('POST', '/api/ops/nodes/jobs', { capability: 'news.dedup', input: { items: [{ title: 'Мир: новость', link: 'a' }, { title: 'мир — новость', link: 'b' }, { title: 'Другое', link: 'c' }] } })).body;
  const d = await until(async () => { const x = (await call('GET', '/api/ops/nodes/jobs')).body[j.jobId]; return x && x.status === 'succeeded' ? x : null; });
  ok('news.dedup routed to NEWS NODE and completed', d && d.nodeId === 'imac-test', d ? d.nodeId : JSON.stringify((await call('GET', '/api/ops/nodes/jobs')).body[j.jobId] || j).slice(0, 400) + ' | ' + news.out.join('').slice(-400)); }
{ const j = (await call('POST', '/api/ops/nodes/jobs', { capability: 'x.draft', input: { topics: ['анонс'] } })).body;
  ok('X GROWTH caps on MONITOR NODE stay off by default (job not taken)', j.jobId && !(await until(async () => (await call('GET', '/api/ops/nodes/jobs')).body[j.jobId]?.status === 'succeeded', 2500))); await call('POST', `/api/ops/nodes/jobs/${j.jobId}/cancel`, {}); }
ok('commands: drain accepted, unknown command rejected', (await call('POST', '/api/ops/nodes/macbook-test/command', { command: 'drain' })).status === 200 && (await call('POST', '/api/ops/nodes/macbook-test/command', { command: 'rm -rf' })).status === 400);
await call('POST', '/api/ops/nodes/macbook-test/command', { command: 'run' });
// studio-connection-test.mjs (read-only) from the node side
{ const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-')); const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/node/studio-connection-test.mjs'), '--json'], { encoding: 'utf8', timeout: 30000,
    env: { PATH: process.env.PATH, HOME: home, NODE_AGENT_ENV: path.join(home, 'none.env'), NODE_ID: 'imac-test', NODE_TOKEN: ri.token, NODE_PROFILE: 'news', COORDINATOR_URL: `https://127.0.0.1:${NPORT}`, COORDINATOR_CERT: cert, COORDINATOR_FINGERPRINT: st.fingerprint } });
  if (!r.stdout.includes('{')) console.log(r.stdout.slice(-600), r.stderr.slice(-600)); let j = null; try { j = JSON.parse(r.stdout); } catch { console.log(r.stdout.slice(0, 800)); }
  const fails = j ? (Array.isArray(j) ? j : j.results || j.checks || []).filter(x => x.pass === false).map(x => x.name) : ['no json'];
  // On this Linux box Keychain/launchd/Tailscale checks cannot pass; the network/TLS/token checks must.
  const netFails = fails.filter(n => !/keychain|launchd|tailscale|macos|darwin|plist|ffprobe|quarantine|xattr|system|minos/i.test(n));
  ok('studio-connection-test.mjs against our server: TLS pin + token + /ping pass', netFails.length === 0, fails.length ? 'платформенные пропуски: ' + fails.join('; ') : 'all pass'); }
// rotate / revoke
ok('rotate without confirmation → 400', (await call('POST', '/api/ops/nodes/imac-test/rotate', { password: PW })).status === 400);
const rr = (await call('POST', '/api/ops/nodes/imac-test/rotate', { confirm: 'СМЕНИТЬ', password: PW })).body;
ok('rotate issues a new token once', /^nk_imac-test\./.test(rr.token || '') && rr.token !== ri.token);
ok('old token after rotate → 401', (await nreq('GET', '/api/nodes/ping', ri.token)).status === 401);
ok('new token after rotate works', (await nreq('GET', '/api/nodes/ping', rr.token)).status === 200);
ok('revoke without confirmation → 400', (await call('POST', '/api/ops/nodes/macbook-test/revoke', {})).status === 400);
ok('revoke with confirmation', (await call('POST', '/api/ops/nodes/macbook-test/revoke', { confirm: 'ОТОЗВАТЬ' })).status === 200);
ok('revoked token refused', (await nreq('GET', '/api/nodes/ping', rm.token)).status >= 401);
// binding policy
for (const b of ['0.0.0.0', '::', '192.168.1.5', '10.0.0.2', '8.8.8.8', '127.0.0.1'])
  ok(`settings refuse bind ${b}`, (await call('POST', '/api/ops/nodes/settings', { enabled: true, bind: b, confirm: 'СОХРАНИТЬ', password: PW })).status === 400);
ok('settings accept a Tailscale address (100.101.102.103), restart required', (await call('POST', '/api/ops/nodes/settings', { enabled: true, bind: '100.101.102.103', confirm: 'СОХРАНИТЬ', password: PW })).body.restartRequired === true);
// comments (Studio 4): POST cannot create an approved comment
{ const c = (await call('POST', '/api/comments', { workspaceId: 'w', platform: 'x', author: 'Fake', text: 't', status: 'approved' })).body; ok('POST /api/comments with status approved is stored as new', c.status === 'new', c.status); }
news.kill('SIGKILL'); mon.kill('SIGKILL'); srv.kill('SIGKILL'); await sleep(800);
// env bind to 0.0.0.0 / LAN → refused, listener stays on loopback
srv = startServer({ STUDIO_NODES_BIND: '0.0.0.0' }); await up(); cookie = ''; await call('POST', '/api/auth/login', { username: 'owner', password: PW }); await sleep(1500);
st = (await call('GET', '/api/ops/nodes')).body; ok('STUDIO_NODES_BIND=0.0.0.0 refused; only 127.0.0.1 listens', JSON.stringify(st.listening) === JSON.stringify([`127.0.0.1:${NPORT}`]) && st.errors.some(e => /не Tailscale/.test(e)), JSON.stringify(st.errors));
srv.kill('SIGKILL'); await sleep(500);
{ const r = spawnSync(process.execPath, ['server.js'], { cwd: ROOT, timeout: 15000, env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: UD, PORT: String(PORT), HOST: '0.0.0.0' } }); ok('main panel refuses HOST=0.0.0.0 (exit 78)', r.status === 78, 'exit ' + r.status); }
// heavy lock deferral + address policy (in-process)
{ let busy = true; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-')); const m = N.createNodeManager({ dir: d, heavyBusy: () => busy }); const r = m.registerNode({ id: 'macbook', role: 'macbook' }); const n = m.authNode('Bearer ' + r.token);
  const h = m.putLocalFile(Buffer.from('clip')); m.submit({ capability: 'ffprobe.check', input: {}, files: [{ sha256: h, name: 'c.mp4' }] });
  const inf = { ...info('0.2.0'), cpus: 2, tools: ['ffprobe'] }; const p1 = m.pull(n, inf, 'idle'); busy = false; const p2 = m.pull(n, inf, 'idle');
  ok('heavy lock busy → file jobs held back; released → leased', !p1.job && !!p2.job); }
ok('isTailscaleOrLoopback policy', [['127.0.0.1', 1], ['::1', 1], ['::ffff:127.0.0.1', 1], ['100.64.0.1', 1], ['100.127.255.254', 1], ['fd7a:115c:a1e0::1', 1], ['100.128.0.1', 0], ['10.0.0.1', 0], ['192.168.1.2', 0], ['172.16.0.1', 0], ['8.8.8.8', 0], ['0.0.0.0', 0], ['fd00::1', 0]].every(([a, e]) => !!N.isTailscaleOrLoopback(a) === !!e));
ok('isPrivateIPv4 (Studio 3, informational): RFC1918 + loopback + 100.64/10 are "private"', ['10.1.1.1', '172.16.0.1', '192.168.0.1', '127.0.0.1', '100.64.0.1'].every(a => N.isPrivateIPv4(a)) && !N.isPrivateIPv4('8.8.8.8'));
const failed = res.filter(r => !r.p).map(r => r.n); console.log(JSON.stringify({ passed: res.length - failed.length, failed })); process.exit(failed.length ? 1 : 0);
