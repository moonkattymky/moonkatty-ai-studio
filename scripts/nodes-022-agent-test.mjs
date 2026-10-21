// v1.2.4-test: REAL NODE 0.2.2 agent package (enroll.js + agent.js from /workspace/dist-node, SHA-256 + MANIFEST verified) against OUR server.js (TEST flavor).
// Enroll by one-time code → owner confirms device key (fingerprint equal on both sides) → signed traffic → owner rotation → revoke; legacy flag off/on. Fake Keychain (test double), loopback only.
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
{ const c = await call('GET', '/api/ops/nodes/cert'); ok('public coordinator cert downloadable by owner (no private key)', /BEGIN CERTIFICATE/.test(c.body.raw || '') && !/PRIVATE KEY/.test(c.body.raw || '')); }
const PKG = process.env.NODE_PKG || '/workspace/dist-node/moonkatty-node-0.2.2-js-only.tar.gz';
ok('package SHA-256 verified', spawnSync('sha256sum', ['-c', path.basename(PKG) + '.sha256'], { cwd: path.dirname(PKG) }).status === 0);
const X = fs.mkdtempSync(path.join(os.tmpdir(), 'n022-')); spawnSync('tar', ['-xzf', PKG, '-C', X]); const PD = path.join(X, fs.readdirSync(X)[0]);
ok('package MANIFEST verified', spawnSync('sha256sum', ['-c', '--quiet', 'MANIFEST.sha256'], { cwd: PD }).status === 0);
const A = require(path.join(PD, 'app/agent.js')), EN = require(path.join(PD, 'app/enroll.js'));
ok('agent is 0.2.2', /const VERSION = '0\.2\.2'/.test(fs.readFileSync(path.join(PD, 'app/agent.js'), 'utf8')));
const KD = fs.mkdtempSync(path.join(os.tmpdir(), 'kc-')); const kc = { NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(KD, 'kc.json'), FAKE_KC_ARGV: path.join(KD, 'argv.log') };
let st; for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/ops/nodes')).body; if (st.fingerprint && st.listening?.length) break; await sleep(100); }
const url = `https://127.0.0.1:${NPORT}`; const fp = st.fingerprint;
async function enrollReal(role, name, home) { const r = (await call('POST', '/api/ops/nodes/enroll', { role, name, confirm: 'ПОДКЛЮЧИТЬ', password: PW })).body; const states = [];
  const p = EN.enroll({ url, fingerprint: fp, code: r.code, home, env: kc, info: { hostname: name, agentVersion: '0.2.2' }, pollMs: 100, onState: s => states.push(s) });
  let q; for (let i = 0; i < 100 && !(q = ((await call('GET', '/api/ops/nodes/enroll')).body.requests || []).find(x => x.requestId === r.requestId && x.state === 'pending')); i++) await sleep(100);
  const nodeFp = states.map(s => s.deviceFingerprint || s.fingerprint || s.pubKeyShort || s.short).find(Boolean) || null;
  const conf = await call('POST', `/api/ops/nodes/enroll/${r.requestId}/confirm`, { confirm: 'ПОДТВЕРДИТЬ', password: PW }); const res = await p; return { r, q, conf, res, states, nodeFp }; }
const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'homeA-')), homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'homeB-'));
const ea = await enrollReal('news', 'iMac-test', homeA);
ok('NEWS NODE: real agent enrolls by code (pending → owner confirm → enrolled imac-test)', ea.q && ea.conf.status === 200 && ea.res.nodeId === 'imac-test', JSON.stringify({ node: ea.res.nodeId, steps: [...new Set(ea.states.map(s => s.step))] }));
const dkA = await EN.deviceIdentity(homeA, EN.keychain(kc), { create: false });
const pubFpA = crypto.createHash('sha256').update(crypto.createPublicKey(dkA.key).export({ type: 'spki', format: 'der' })).digest('hex');
ok('owner panel shows the SAME device-key fingerprint as the node', ea.q.device.pubKeyFingerprint === pubFpA && ea.q.device.pubKeyShort === pubFpA.slice(0, 16).toUpperCase().match(/.{4}/g).join('-'), ea.q.device.pubKeyShort);
const store = () => JSON.parse(fs.readFileSync(kc.FAKE_KC_FILE, 'utf8')); const tokA = store()['moonkatty-node-imac-test|node-token'];
ok('token only in (fake) Keychain, never argv', /^nk_imac-test\./.test(tokA || '') && !fs.readFileSync(kc.FAKE_KC_ARGV, 'utf8').includes(tokA));
const base = id => ({ url, certFile: path.join(id === 'imac-test' ? homeA : homeB, 'coordinator.crt'), fingerprint: fp, profileKey: id === 'imac-test' ? 'news' : 'monitor', limits: A.PROFILES[id === 'imac-test' ? 'news' : 'monitor'].limits });
let reqA = A.client({ ...base('imac-test'), token: tokA, deviceKey: dkA.key });
const h = await reqA('POST', '/hello', { info: { agentVersion: '0.2.2' } }); ok('real agent signed hello → 200, protocol 2', h.status === 200 && h.body.protocol === 2, JSON.stringify(h.body).slice(0, 80));
ok('unsigned request with the same token → 401', (await A.client({ ...base('imac-test'), token: tokA })('GET', '/ping')).status === 401);
const eb = await enrollReal('monitor', 'MacBook-test', homeB); const tokB = store()['moonkatty-node-macbook-test|node-token']; const dkB = await EN.deviceIdentity(homeB, EN.keychain(kc), { create: false });
ok('MONITOR NODE: real agent enrolls (macbook-test) and pings', eb.res.nodeId === 'macbook-test' && (await A.client({ ...base('macbook-test'), token: tokB, deviceKey: dkB.key })('GET', '/ping')).status === 200);
ok('owner rotation requires password', (await call('POST', '/api/ops/nodes/imac-test/rotate', { confirm: 'СМЕНИТЬ' })).status === 403);
ok('owner rotation → pull rotate:true', (await call('POST', '/api/ops/nodes/imac-test/rotate', { confirm: 'СМЕНИТЬ', password: PW })).status === 200 && (await reqA('POST', '/pull', { info: { agentVersion: '0.2.2' } })).body.rotate === true);
ok('real agent rotates (A.rotate), new token in Keychain', await A.rotate({ ...base('imac-test'), token: tokA, deviceKey: dkA.key, env: kc, nodeId: 'imac-test' }, reqA) === true);
const tokA2 = store()['moonkatty-node-imac-test|node-token'];
ok('old token dead, new token works', tokA2 !== tokA && (await A.client({ ...base('imac-test'), token: tokA, deviceKey: dkA.key })('GET', '/ping')).status === 401 && (await A.client({ ...base('imac-test'), token: tokA2, deviceKey: dkA.key })('GET', '/ping')).status === 200);
ok('revoke requires password; revoke → agent 401', (await call('POST', '/api/ops/nodes/imac-test/revoke', { confirm: 'ОТОЗВАТЬ' })).status === 403 && (await call('POST', '/api/ops/nodes/imac-test/revoke', { confirm: 'ОТОЗВАТЬ', password: PW })).status === 200 && (await A.client({ ...base('imac-test'), token: tokA2, deviceKey: dkA.key })('GET', '/ping')).status === 401);
const reA = await enrollReal('news', 'iMac-test', homeA); ok('re-enroll after revoke works', reA.res.nodeId === 'imac-test');
ok('legacy 0.2.0 token issuance off by default (E_LEGACY_DISABLED)', (await call('POST', '/api/ops/nodes', { id: 'old-test', role: 'imac', confirm: 'ВЫДАТЬ', password: PW })).body.code === 'E_LEGACY_DISABLED');
const leak = [tokA, tokA2, tokB]; const files = []; const walk = d => { for (const x of fs.readdirSync(d, { withFileTypes: true })) x.isDirectory() ? walk(path.join(d, x.name)) : files.push(path.join(d, x.name)); }; walk(UD); walk(homeA); walk(homeB);
ok('no token in data dir, node HOME or server stderr', !files.some(f => leak.some(s => fs.readFileSync(f).toString('latin1').includes(s.split('.')[1]))) && !leak.some(s => srv.err.includes(s)));
srv.kill('SIGTERM'); await sleep(500);
// legacy flag ON: 0.2.0-style direct token still issuable and accepted from the 0.2.2 agent (bearer only)
srv = startServer({ STUDIO_NODES_LEGACY_TOKENS: '1' }); ok('server restarts with STUDIO_NODES_LEGACY_TOKENS=1', await up()); await call('POST', '/api/auth/login', { username: 'owner', password: PW });
for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/ops/nodes')).body; if (st.listening?.length) break; await sleep(100); }
const lg = await call('POST', '/api/ops/nodes', { id: 'old-test', role: 'imac', confirm: 'ВЫДАТЬ', password: PW });
ok('legacy flag on: direct token issued once; agent bearer-only ping 200', lg.status === 200 && (await A.client({ ...base('imac-test'), token: lg.body.token })('GET', '/ping')).status === 200);
ok('enrolled node still needs signature with legacy flag on', (await A.client({ ...base('imac-test'), token: store()['moonkatty-node-imac-test|node-token'] })('GET', '/ping')).status === 401);
srv.kill('SIGTERM'); await sleep(300); fs.rmSync(X, { recursive: true, force: true });
const failed = res.filter(r => !r.p).map(r => r.n); console.log(JSON.stringify({ passed: res.length - failed.length, failed })); process.exit(failed.length ? 1 : 0);
