// v1.2.4-test NODE 0.2.1 owner API suite: OUR server.js (TEST flavor) — enroll/confirm/reject/rotate/revoke/audit over the owner session + node enrollment over pinned TLS. Fake credentials only.
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
await call('POST', '/api/auth/login', { username: 'owner', password: PW });
ok('owner enroll API requires the owner session', (await (async () => { const c = cookie; cookie = ''; const r = await call('POST', '/api/ops/nodes/enroll', { role: 'news' }); cookie = c; return r.status === 401; })()));
let st; for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/ops/nodes')).body; if (st.fingerprint) break; await sleep(100); }
const sha = b => crypto.createHash('sha256').update(b).digest('hex'); const sign = (k, m) => crypto.sign(null, Buffer.from(m), k).toString('base64');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); const dev = { id: 'dev_' + crypto.randomBytes(16).toString('hex'), pub: publicKey.export({ type: 'spki', format: 'pem' }) };
const ncall = (p, body, { token, signed, method = 'POST' } = {}) => new Promise((resolve, rej) => { const b = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)); const ts = Date.now();
  const r = https.request({ host: '127.0.0.1', port: NPORT, method, path: p, rejectUnauthorized: false, checkServerIdentity: () => undefined, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(signed ? { 'x-node-ts': String(ts), 'x-node-sig': sign(privateKey, `${method}\n${p}\n${ts}\n${sha(b)}`) } : {}) } }, x => {
    if (x.socket.getPeerCertificate().fingerprint256.replace(/:/g, '').toLowerCase() !== st.fingerprint) return rej(new Error('pin')); let d = ''; x.on('data', z => d += z); x.on('end', () => resolve({ status: x.statusCode, body: JSON.parse(d || '{}') })); }); r.on('error', rej); r.end(b); });
ok('enroll without typed confirmation/password → refused', (await call('POST', '/api/ops/nodes/enroll', { role: 'news' })).status === 400 && (await call('POST', '/api/ops/nodes/enroll', { role: 'news', confirm: 'ПОДКЛЮЧИТЬ', password: 'nope' })).status === 403);
ok('enroll with prod node id refused in TEST flavor', (await call('POST', '/api/ops/nodes/enroll', { role: 'news', nodeId: 'imac', confirm: 'ПОДКЛЮЧИТЬ', password: PW })).status === 400);
const en = await call('POST', '/api/ops/nodes/enroll', { role: 'news', name: 'iMac 27', confirm: 'ПОДКЛЮЧИТЬ', password: PW });
ok('POST /api/ops/nodes/enroll → one-time code (TTL 300 s), node id imac-test, cert fingerprint', en.status === 200 && /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/.test(en.body.code) && en.body.ttlSec === 300 && en.body.nodeId === 'imac-test' && en.body.fingerprint === st.fingerprint, JSON.stringify({ s: en.status, n: en.body.nodeId }));
const e = await ncall('/api/nodes/enroll', { code: en.body.code, deviceId: dev.id, devicePubKey: dev.pub, proof: sign(privateKey, `enroll:${en.body.requestId}:${dev.id}`), info: { hostname: 'iMac', agentVersion: '0.2.1' } });
ok('node POST /api/nodes/enroll (TLS, pinned) → pending', e.status === 200 && e.body.status === 'pending');
const poll = () => { const ts = Date.now(); return ncall('/api/nodes/enroll/status', { requestId: e.body.requestId, requestSecret: e.body.requestSecret, ts, sig: sign(privateKey, `status:${e.body.requestId}:${ts}`) }); };
ok('no token before owner confirmation', (await poll()).body.status === 'pending');
const lst = (await call('GET', '/api/ops/nodes/enroll')).body.requests || []; ok('GET /api/ops/nodes/enroll lists device (deviceId + short key), never the code', lst[0]?.device?.deviceId === dev.id && !JSON.stringify(lst).includes(en.body.code.slice(6)));
ok('confirm without owner password → 403', (await call('POST', `/api/ops/nodes/enroll/${e.body.requestId}/confirm`, { confirm: 'ПОДТВЕРДИТЬ', password: 'x' })).status === 403);
ok('confirm → 200', (await call('POST', `/api/ops/nodes/enroll/${e.body.requestId}/confirm`, { confirm: 'ПОДТВЕРДИТЬ', password: PW })).status === 200);
const done = await poll(); const tok = done.body.token; ok('enrolled: token once, protocol 1', done.body.status === 'enrolled' && done.body.protocol === 1 && /^nk_imac-test\./.test(tok || ''));
ok('unsigned request with enrolled token → 401', (await ncall('/api/nodes/hello', { info: { agentVersion: '0.2.1' } }, { token: tok })).status === 401);
const h = await ncall('/api/nodes/hello', { info: { agentVersion: '0.2.1' } }, { token: tok, signed: true }); ok('signed hello → protocol 1, range >=0.2.0 <0.3.0', h.status === 200 && h.body.protocol === 1 && h.body.agentVersionRange === '>=0.2.0 <0.3.0');
ok('agentVersion 0.3.0 → 426 E_AGENT_VERSION', (await ncall('/api/nodes/hello', { info: { agentVersion: '0.3.0' } }, { token: tok, signed: true })).body.code === 'E_AGENT_VERSION');
ok('owner rotate (enrolled) → rotatePending', (await call('POST', '/api/ops/nodes/imac-test/rotate', { confirm: 'СМЕНИТЬ', password: PW })).body.rotatePending === true);
ok('pull → rotate:true', (await ncall('/api/nodes/pull', { info: { agentVersion: '0.2.1' } }, { token: tok, signed: true })).body.rotate === true);
const rot = await ncall('/api/nodes/rotate', {}, { token: tok, signed: true }); ok('node /api/nodes/rotate → new token; old dead', rot.status === 200 && (await ncall('/api/nodes/ping', undefined, { token: tok, signed: true, method: 'GET' })).status === 401 && (await ncall('/api/nodes/ping', undefined, { token: rot.body.token, signed: true, method: 'GET' })).status === 200);
const rj = await call('POST', '/api/ops/nodes/enroll', { role: 'monitor', confirm: 'ПОДКЛЮЧИТЬ', password: PW }); const e2 = await ncall('/api/nodes/enroll', { code: rj.body.code, deviceId: dev.id, devicePubKey: dev.pub, proof: sign(privateKey, `enroll:${rj.body.requestId}:${dev.id}`), info: {} });
ok('reject → no token', (await call('POST', `/api/ops/nodes/enroll/${e2.body.requestId}/reject`, {})).body.state === 'rejected');
ok('revoke → token + device key void', (await call('POST', '/api/ops/nodes/imac-test/revoke', { confirm: 'ОТОЗВАТЬ' })).status === 200 && (await ncall('/api/nodes/ping', undefined, { token: rot.body.token, signed: true, method: 'GET' })).status === 401);
const au = (await call('GET', '/api/ops/nodes/audit')).body.events || []; const auS = JSON.stringify(au);
ok('GET /api/ops/nodes/audit: events, no secrets', ['request_created', 'code_accepted', 'confirmed', 'enrolled', 'rotate_requested', 'rotated', 'rejected', 'revoked'].every(t => au.some(x => x.type === t)) && ![tok, rot.body.token, e.body.requestSecret, en.body.code].some(s => auS.includes(s)));
srv.kill('SIGTERM'); await sleep(300);
const leak = [tok, rot.body.token, e.body.requestSecret, en.body.code.slice(6)]; const files = []; const walk = d => { for (const x of fs.readdirSync(d, { withFileTypes: true })) x.isDirectory() ? walk(path.join(d, x.name)) : files.push(path.join(d, x.name)); }; walk(UD);
ok('no token/code/request secret in data dir files or server stderr', !files.some(f => { const c = fs.readFileSync(f).toString('latin1'); return leak.some(s => c.includes(s)); }) && !leak.some(s => srv.err.includes(s)));
const failed = res.filter(r => !r.p).map(r => r.n); console.log(JSON.stringify({ passed: res.length - failed.length, failed })); process.exit(failed.length ? 1 : 0);
