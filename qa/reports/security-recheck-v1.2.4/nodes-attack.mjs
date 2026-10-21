// Node-coordinator recheck for v1.2.4-test @ 6cf7c08.
// Fake data only. Exit 0 when every control passes. Findings are residuals and do not fail the process.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import net from 'net';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { Readable } from 'stream';

const require = createRequire(import.meta.url);
const SRC = process.env.STUDIO_SRC || '/tmp/mk-v124';
const N = require(path.join(SRC, 'lib/ops/nodes.js'));
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-v124n-'));
const PW = 'fake-recheck-only-1';
const controls = [];
const findings = [];
const rec = (name, ok, detail = '') => { controls.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) }); console.log((ok ? 'CONTROL PASS ' : 'CONTROL FAIL ') + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); };
const finding = (sev, name, detail = '') => { findings.push({ sev, name, detail: String(detail).slice(0, 600) }); console.log('FINDING ' + sev + ' ' + name + (detail ? ' — ' + String(detail).slice(0, 400) : '')); };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const sign = msg => crypto.sign(null, Buffer.from(msg), privateKey).toString('base64');
const deviceId = 'dev_' + crypto.randomBytes(16).toString('hex');

function callHandler(handler, { method, url, remote, headers = {}, body = '', encrypted = true }) {
  return new Promise(resolve => {
    const buf = Buffer.from(body);
    const req = new Readable({ read() { this.push(buf); this.push(null); } });
    req.method = method; req.url = url; req.headers = { host: '127.0.0.1', ...headers }; req.socket = { remoteAddress: remote, encrypted };
    const res = { headersSent: false, writeHead(code, h) { this.status = code; this.headers = h; this.headersSent = true; }, end(b) { let j = null; const t = String(b || ''); try { j = JSON.parse(t); } catch {} resolve({ s: this.status, t, j }); } };
    Promise.resolve(handler(req, res)).catch(e => resolve({ s: 0, t: e.message, j: null }));
  });
}
function tlsReq(port, method, p, body, token, ts = Date.now()) {
  const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const msg = `${method}\n/api/nodes${p}\n${ts}\n${sha256(raw)}`;
  const sig = sign(msg);
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, method, path: '/api/nodes' + p, rejectUnauthorized: false, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': raw.length, 'x-node-ts': String(ts), 'x-node-sig': sig } }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ s: res.statusCode, j, t }); });
    });
    req.on('error', reject); req.end(raw);
  });
}
function nodeReq(port, method, p, body, token, ts = Date.now()) {
  const raw = body == null ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const msg = `${method}\n/api/nodes${p}\n${ts}\n${sha256(raw)}`;
  const sig = sign(msg);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: '/api/nodes' + p, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': raw.length, 'x-node-ts': String(ts), 'x-node-sig': sig } }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ s: res.statusCode, j, t, ts, sig, raw }); });
    });
    req.on('error', reject); req.end(raw);
  });
}
function replayReq(port, method, p, raw, token, ts, sig) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: '/api/nodes' + p, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', 'content-length': raw.length, 'x-node-ts': String(ts), 'x-node-sig': sig } }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ s: res.statusCode, j, t }); });
    });
    req.on('error', reject); req.end(raw);
  });
}
let portN = 19100;
function startServer(extra = {}) {
  const port = String(extra.PORT || ++portN);
  const dir = extra.STUDIO_DATA_DIR || fs.mkdtempSync(path.join(ROOT, 'd-'));
  const env = { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: dir, HOST: '127.0.0.1', PORT: port, ...extra, PORT: port };
  delete env.STUDIO_SECRET_KEY; delete env.STUDIO_ADMIN_PASSWORD;
  const p = spawn(process.execPath, ['server.js'], { cwd: SRC, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
  return { p, dir, port, env, get out() { return out; }, stop() { try { p.kill('SIGTERM'); } catch {} } };
}
async function waitUp(s, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (s.p.exitCode != null) return null;
    try { const r = await fetch(`http://127.0.0.1:${s.port}/api/health`, { signal: AbortSignal.timeout(800) }); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  return null;
}
async function login(port) {
  const R = { 'content-type': 'application/json', 'x-studio-request': '1' };
  let r = await fetch(`http://127.0.0.1:${port}/api/auth/setup`, { method: 'POST', headers: R, body: JSON.stringify({ username: 'qa', password: PW }) });
  if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: R, body: JSON.stringify({ username: 'qa', password: PW }) });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  return { ...R, cookie };
}
async function api(port, headers, method, p, body) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, t };
}
function closed(port) {
  return new Promise(resolve => {
    const s = net.connect({ host: '127.0.0.1', port, timeout: 400 }, () => { s.end(); resolve(false); });
    s.on('error', () => resolve(true)); s.on('timeout', () => { s.destroy(); resolve(true); });
  });
}
function httpsJson(port, p, body) {
  const raw = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: p, method: 'POST', rejectUnauthorized: false, headers: { 'content-type': 'application/json', 'content-length': raw.length } }, res => {
      const c = []; res.on('data', d => c.push(d)); res.on('end', () => { const t = Buffer.concat(c).toString(); let j = null; try { j = JSON.parse(t); } catch {} resolve({ s: res.statusCode, j, t }); });
    });
    req.on('error', reject); req.end(raw);
  });
}

async function enrollPair(mgr, nodeId) {
  const created = mgr.enrollment.create({ role: nodeId.startsWith('macbook') ? 'monitor' : 'news', nodeId, name: nodeId });
  const en = mgr.enrollment.enroll({ code: created.code, deviceId, devicePubKey: pubPem, proof: sign(`enroll:${created.requestId}:${deviceId}`), info: { hostname: 'qa-host', model: 'qa', os: 'linux', agentVersion: '0.2.0' } }, '100.64.0.9');
  mgr.enrollment.confirm(created.requestId);
  const ts = Date.now();
  const st = mgr.enrollment.status({ requestId: created.requestId, requestSecret: en.requestSecret, ts, sig: sign(`status:${created.requestId}:${ts}`) }, '100.64.0.9');
  return { created, en, st };
}

async function main() {
  const appJs = fs.readFileSync(path.join(SRC, 'public/app.js'), 'utf8');
  const agentJs = fs.readFileSync(path.join(SRC, 'node-agent/agent.js'), 'utf8');
  const nodesJs = fs.readFileSync(path.join(SRC, 'lib/ops/nodes.js'), 'utf8');
  rec('panel nodes view has no enrollment approval screen', !/pubKeyShort|pubKeyFingerprint|ПОДКЛЮЧИТЬ|ПОДТВЕРДИТЬ|\/api\/ops\/nodes\/enroll/.test(appJs));
  rec('panel shows the TLS certificate fingerprint', /Отпечаток сертификата/.test(appJs) && /st\.fingerprint/.test(appJs));
  rec('agent.js has no --code or --enroll argv', !/--code|--enroll/.test(agentJs));
  rec('client() refuses tailscale mode unless the host ends in .ts.net', /cfg\.tlsMode === 'tailscale'\) \{ if \(!isHttps \|\| !\/\\\.ts\\\.net\$\/i\.test\(u\.hostname\)\) throw/.test(agentJs));

  const tlsThrow = spawnSync(process.execPath, ['-e', `
    const { client } = require('./node-agent/agent.js');
    try { client({ tlsMode: 'tailscale', url: 'https://127.0.0.1:1', token: 'x', fingerprint: '${'ab'.repeat(32)}', certFile: '/dev/null' }); process.stdout.write('NO_THROW'); }
    catch (e) { process.stdout.write(e.message); }
  `], { cwd: SRC, encoding: 'utf8' });
  rec('client(tlsMode tailscale, 127.0.0.1) throws before connect', /ts\.net/.test(tlsThrow.stdout || ''), (tlsThrow.stdout || tlsThrow.stderr || '').slice(0, 220));

  const bad = ['0.0.0.0', '8.8.8.8', '1.1.1.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '100.63.255.255', '100.128.0.1', '100.64.999.1', '::', 'fd7a:115c:a1e1::1'];
  const good = ['127.0.0.1', '127.8.8.8', '::1', '[::1]', '::ffff:127.0.0.1', '100.64.0.1', '100.127.255.254', '::ffff:100.100.1.2', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:53::1'];
  rec('isTailscaleOrLoopback rejects public, LAN, and 0.0.0.0', bad.every(a => N.isTailscaleOrLoopback(a) === false), bad.filter(a => N.isTailscaleOrLoopback(a)).join(','));
  rec('isTailscaleOrLoopback allows 127/8, ::1, 100.64/10, fd7a:115c:a1e0::/48', good.every(a => N.isTailscaleOrLoopback(a) === true), good.filter(a => !N.isTailscaleOrLoopback(a)).join(','));
  const dir0 = fs.mkdtempSync(path.join(ROOT, 'bind-'));
  const mgr0 = N.createNodeManager({ dir: dir0, idSuffix: '-test', allowPlainEnrollForTests: true });
  const throws = [];
  for (const host of ['0.0.0.0', '8.8.8.8', '10.1.2.3', '192.168.1.9', '::']) {
    try { await N.listen(mgr0, { host, port: 0, insecureHttpForTests: true }); throws.push(host + ':accepted'); }
    catch (e) { throws.push(/Tailscale|127\.0\.0\.1/.test(e.message) ? host + ':refused' : host + ':' + e.message); }
  }
  rec('listen() refuses 0.0.0.0, public, and LAN before bind', throws.every(x => x.endsWith(':refused')), throws.join(' | '));
  rec('no nodes.json is written before the first enrollment save', !fs.existsSync(path.join(dir0, 'nodes.json')));

  const pair = await enrollPair(mgr0, 'imac-test');
  rec('0.2.1 enroll issues one token bound to the device key', pair.st.status === 'enrolled' && /^nk_imac-test\./.test(pair.st.token || ''), pair.st.status);
  const diskAfter = fs.readFileSync(path.join(dir0, 'nodes.json'), 'utf8');
  rec('issued token is not stored; sha256 is; enroll key is absent', !diskAfter.includes(pair.st.token) && diskAfter.includes(sha256(pair.st.token)) && !/"enrollKey"/.test(diskAfter));
  const view = mgr0.enrollment.list().find(q => q.requestId === pair.created.requestId);
  rec('enrollment API view includes the device public-key fingerprint', !!(view && view.device && view.device.pubKeyFingerprint && view.device.pubKeyShort), JSON.stringify(view && view.device && { pubKeyShort: view.device.pubKeyShort, fp: (view.device.pubKeyFingerprint || '').slice(0, 16) }));
  if (!/pubKeyShort|ПОДТВЕРДИТЬ/.test(appJs)) finding('medium', 'the shipped panel has no enrollment approval screen and does not show the device-key fingerprint', 'GET /api/ops/nodes/enroll returns pubKeyFingerprint and pubKeyShort. public/app.js renders the TLS certificate fingerprint only. node-agent/enroll.js and the Connect computer screen are not in this tree.');

  mgr0.submit({ capability: 'news.collect', input: { title: 'a' } });
  mgr0.submit({ capability: 'news.collect', input: { title: 'b' } });
  const srv = await N.listen(mgr0, { host: '127.0.0.1', port: 0, insecureHttpForTests: true });
  const np = srv.address().port;
  const first = await nodeReq(np, 'POST', '/pull', { info: { agentVersion: '0.2.0' }, state: 'idle' }, pair.st.token);
  const second = await replayReq(np, 'POST', '/pull', first.raw, pair.st.token, first.ts, first.sig);
  const future = await nodeReq(np, 'POST', '/pull', { info: { agentVersion: '0.2.0' } }, pair.st.token, Date.now() + 121000);
  const past = await nodeReq(np, 'POST', '/pull', { info: { agentVersion: '0.2.0' } }, pair.st.token, Date.now() - 121000);
  const same = first.j && second.j && first.j.job && second.j.job && first.j.job.id === second.j.job.id;
  rec('replay of one signed pull inside 120s is still accepted', first.s === 200 && second.s === 200 && first.j.job && second.j.job && !same && future.s === 401 && past.s === 401, JSON.stringify({ first: first.j && first.j.job && first.j.job.id, replay: second.j && second.j.job && second.j.job.id, replayStatus: second.s, future: future.s, past: past.s }));
  if (second.s === 200 && second.j && second.j.job && !same) finding('medium', 'a captured signed pull is accepted again inside 120 seconds', `first ${first.j.job.id}, replay ${second.j.job.id}. authNode still uses ±120s and no nonce (lib/ops/nodes.js). ±121s is 401.`);

  const before = mgr0._state.nodes['imac-test'].rotatePending;
  const rot = await nodeReq(np, 'POST', '/rotate', {}, pair.st.token);
  const oldPing = await nodeReq(np, 'GET', '/ping', null, pair.st.token);
  const newPing = rot.j && rot.j.token ? await nodeReq(np, 'GET', '/ping', null, rot.j.token) : { s: 0 };
  rec('enrolled node rotates without rotatePending', before === false && rot.s === 200 && !!rot.j.token && oldPing.s === 401 && newPing.s === 200, JSON.stringify({ pendingBefore: before, rot: rot.s, oldPing: oldPing.s, newPing: newPing.s }));
  if (rot.s === 200 && rot.j && rot.j.token) finding('low', 'an enrolled node can rotate its token without the owner flag', 'POST /api/nodes/rotate called rotateToken while rotatePending was false. The old bearer then got 401 and the new bearer got 200.');
  srv.close();

  const reg = mgr0.registerNode({ id: 'macbook-test', name: 'mb', role: 'monitor' });
  const bearer = mgr0.authNode('Bearer ' + reg.token, null);
  rec('registerNode still mints a bearer-only 0.2.0 token', bearer && bearer.id === 'macbook-test' && !bearer.devicePubKey, reg.id);
  if (bearer && !bearer.devicePubKey) finding('low', 'the owner can still mint a bearer-only 0.2.0 node', 'registerNode stores no devicePubKey. authNode accepts the bearer with a null signature. The HTTP route now also requires the owner password and the word ВЫДАТЬ, and the id must end in -test.');

  const h403 = mgr0.handler();
  const denied = await callHandler(h403, { method: 'POST', url: '/api/nodes/enroll', remote: '8.8.8.8', body: '{}' });
  const xff = await callHandler(h403, { method: 'POST', url: '/api/nodes/enroll', remote: '127.0.0.1', headers: { 'x-forwarded-for': '8.8.8.8', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'nope' }) });
  const other = await callHandler(h403, { method: 'POST', url: '/api/nodes/enroll', remote: '100.64.0.77', headers: { 'x-forwarded-for': '8.8.8.8', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'nope' }) });
  const keys = Object.keys(mgr0.enrollment._ip);
  rec('a public source is 403 and X-Forwarded-For does not choose the bucket', denied.s === 403 && denied.j.code === 'E_FORBIDDEN_SOURCE' && keys.includes('127.0.0.1') && keys.includes('100.64.0.77') && !keys.includes('8.8.8.8'), 'keys=' + keys.join(',') + ' denied=' + denied.s);
  finding('low', 'per-IP counters stay in memory and a front on 127.0.0.1 still shares one bucket', 'X-Forwarded-For is ignored. Two different remoteAddress values get two buckets. The documented listener binds the Tailscale address, so a direct peer is its own bucket. tailscale serve to 127.0.0.1 would collapse peers again. Docs say not to use serve.');

  const dirR = fs.mkdtempSync(path.join(ROOT, 'race-'));
  const prep = N.createNodeManager({ dir: dirR, idSuffix: '-test', allowPlainEnrollForTests: true });
  const created = prep.enrollment.create({ role: 'news', nodeId: 'imac-test', name: 'race' });
  const en = prep.enrollment.enroll({ code: created.code, deviceId, devicePubKey: pubPem, proof: sign(`enroll:${created.requestId}:${deviceId}`), info: {} }, '127.0.0.1');
  prep.enrollment.confirm(created.requestId);
  const rts = Date.now();
  const rsig = sign(`status:${created.requestId}:${rts}`);
  const loadedA = path.join(dirR, 'a.loaded'), loadedB = path.join(dirR, 'b.loaded'), go = path.join(dirR, 'go');
  const child = (loaded) => spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), 'attack-race-child.cjs'), dirR, en.requestSecret, created.requestId, rsig, String(rts), loaded, go], { env: { ...process.env, NODES_JS: path.join(SRC, 'lib/ops/nodes.js') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const a = child(loadedA), b = child(loadedB);
  const readOut = p => new Promise(resolve => { let s = ''; p.stdout.on('data', d => { s += d; }); p.on('close', () => resolve(s)); });
  const oa = readOut(a), ob = readOut(b);
  const t1 = Date.now();
  while (!(fs.existsSync(loadedA) && fs.existsSync(loadedB)) && Date.now() - t1 < 8000) await sleep(20);
  fs.writeFileSync(go, '1');
  const [sa, sb] = await Promise.all([oa, ob]);
  let ja = {}, jb = {}; try { ja = JSON.parse(sa); } catch {} try { jb = JSON.parse(sb); } catch {}
  const final = JSON.parse(fs.readFileSync(path.join(dirR, 'nodes.json'), 'utf8'));
  const hashes = [ja.token, jb.token].filter(Boolean).map(sha256);
  const stored = final.nodes && final.nodes['imac-test'] && final.nodes['imac-test'].tokenHash;
  const both = !!(ja.token && jb.token && ja.token !== jb.token);
  rec('two processes on one nodes.json can each return an enrollment token', both && hashes.includes(stored) && hashes.filter(h => h === stored).length === 1, JSON.stringify({ a: ja.status || ja.code, b: jb.status || jb.code, distinct: ja.token !== jb.token, storedMatchesOne: hashes.filter(h => h === stored).length }));
  if (both) finding('low', 'two processes on one state file can each hand out a token', 'Both status() calls returned a different token. nodes.json kept one tokenHash. state.js writes with a temp file and rename and has no lock.');

  const fresh = N.createNodeManager({ dir: fs.mkdtempSync(path.join(ROOT, 'ip2-')), allowPlainEnrollForTests: true, idSuffix: '-test' });
  rec('a new process starts with an empty in-memory IP map', Object.keys(fresh.enrollment._ip).length === 0);

  const argvProbe = spawn(process.execPath, [path.join(SRC, 'node-agent/agent.js'), '--info'], { env: { ...process.env, NODE_ID: 'imac-test', NODE_TOKEN: 'nk_imac-test.NOTINARGV', HOME: ROOT }, stdio: 'ignore' });
  let cmd = ''; try { cmd = fs.readFileSync('/proc/' + argvProbe.pid + '/cmdline').toString(); } catch {}
  argvProbe.kill('SIGTERM');
  rec('node-agent argv does not contain the token or a one-time code', cmd.length > 0 && !cmd.includes('NOTINARGV') && !cmd.includes('--code') && !cmd.includes('--enroll'), cmd.replace(/\0/g, ' ').slice(0, 240));

  const loops = 200;
  const body0 = Buffer.alloc(0);
  const tsig = Date.now();
  const goodSig = { method: 'GET', path: '/api/nodes/ping', ts: tsig, sig: sign(`GET\n/api/nodes/ping\n${tsig}\n${sha256(body0)}`), body: body0 };
  const wrongHdr = 'Bearer nk_imac-test.' + 'b'.repeat(32);
  const rightHdr = 'Bearer ' + (rot.j && rot.j.token);
  const time = (header, sig) => { const t = process.hrtime.bigint(); for (let i = 0; i < loops; i++) mgr0.authNode(header, sig); return Number(process.hrtime.bigint() - t) / loops; };
  const wrongNs = time(wrongHdr, goodSig); const rightNs = rightHdr.includes('undefined') ? 0 : time(rightHdr, goodSig);
  rec('timing sample recorded', wrongNs > 0 && rightNs > 0, `wrong ${wrongNs.toFixed(0)} ns, right ${rightNs.toFixed(0)} ns, ratio ${(rightNs / wrongNs).toFixed(2)}`);
  if (rightNs > wrongNs * 5) finding('low', 'a correct bearer token is slower than a wrong one', `About ${(rightNs / wrongNs).toFixed(1)}× over ${loops} calls. timingSafeEqual runs on the SHA-256 of the bearer; Ed25519 verify runs only after that hash matches.`);

  const hostBad = spawnSync(process.execPath, ['server.js'], { cwd: SRC, env: { ...process.env, STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', HOST: '0.0.0.0', PORT: '1', STUDIO_DATA_DIR: fs.mkdtempSync(path.join(ROOT, 'host-')) }, encoding: 'utf8', timeout: 5000 });
  rec('panel HOST=0.0.0.0 exits 78', hostBad.status === 78 && /HOST=/.test((hostBad.stderr || '') + (hostBad.stdout || '')), 'status=' + hostBad.status);

  const nodesPort = String(++portN);
  const off = startServer({ PORT: String(++portN), STUDIO_NODES_PORT: nodesPort });
  delete off.env.STUDIO_NODES;
  const hoff = await waitUp(off);
  let stOff = null;
  if (hoff) { const A = await login(off.port); stOff = await api(off.port, A, 'GET', '/api/ops/nodes'); }
  const portClosed = await closed(+nodesPort);
  rec('node listener is off by default', !!(hoff && stOff && stOff.j && stOff.j.enabled === false && (stOff.j.listening || []).length === 0 && portClosed), JSON.stringify({ enabled: stOff && stOff.j && stOff.j.enabled, listening: stOff && stOff.j && stOff.j.listening, portClosed }));
  if (hoff) {
    const A = await login(off.port);
    const binds = [];
    for (const bind of ['0.0.0.0', '8.8.8.8', '10.0.0.1', '192.168.1.1', '172.16.0.1']) {
      const r = await api(off.port, A, 'POST', '/api/ops/nodes/settings', { enabled: true, bind, password: PW, confirm: 'СОХРАНИТЬ' });
      binds.push(bind + ':' + r.s);
    }
    const okBind = await api(off.port, A, 'POST', '/api/ops/nodes/settings', { enabled: true, bind: '100.64.1.2', password: PW, confirm: 'СОХРАНИТЬ' });
    const noPw = await api(off.port, A, 'POST', '/api/ops/nodes', { id: 'imac-test', role: 'news', confirm: 'ВЫДАТЬ' });
    const disabled = await api(off.port, A, 'POST', '/api/ops/nodes', { id: 'imac-test', role: 'news', password: PW, confirm: 'ВЫДАТЬ' });
    rec('settings reject 0.0.0.0, public, and LAN binds', binds.every(x => x.endsWith(':400')) && okBind.s === 200 && okBind.j.settings.bind === '100.64.1.2', binds.join(' ') + ' tailscale=' + okBind.s);
    rec('a disabled manager returns 409 before the password check', noPw.s === 409 && disabled.s === 409 && disabled.j.code === 'nodes_disabled', JSON.stringify({ noPw: noPw.s, disabled: disabled.s + ':' + (disabled.j && disabled.j.code) }));
  }
  off.stop();

  const onPort = String(++portN);
  const on = startServer({ STUDIO_NODES: '1', STUDIO_NODES_PORT: onPort, STUDIO_NODES_BIND: '8.8.8.8' });
  const hon = await waitUp(on);
  if (hon) {
    const A = await login(on.port);
    let st = null;
    for (let i = 0; i < 20; i++) { st = await api(on.port, A, 'GET', '/api/ops/nodes'); if ((st.j.listening || []).length || (st.j.errors || []).length) break; await sleep(100); }
    const listening = (st.j.listening || []).join(',');
    const listenPort = Number(String((st.j.listening || [])[0] || '').split(':').pop());
    rec('enabled listener binds 127.0.0.1 only and records the public bind as an error', /^127\.0\.0\.1:\d+$/.test(listening) && !/8\.8\.8\.8/.test(listening) && (st.j.errors || []).some(e => /8\.8\.8\.8/.test(e)), JSON.stringify({ listening: st.j.listening, errors: st.j.errors, requested: onPort }));
    const noPwOn = await api(on.port, A, 'POST', '/api/ops/nodes', { id: 'imac-test', role: 'news', confirm: 'ВЫДАТЬ' });
    const badPw = await api(on.port, A, 'POST', '/api/ops/nodes', { id: 'imac-test', role: 'news', password: 'wrong-password', confirm: 'ВЫДАТЬ' });
    rec('enabled register without the password or with a wrong password is refused', (noPwOn.s === 400 || noPwOn.s === 403) && badPw.s === 403, JSON.stringify({ noPw: noPwOn.s, badPw: badPw.s + ':' + (badPw.j && badPw.j.code) }));
    const bare = await api(on.port, A, 'POST', '/api/ops/nodes', { id: 'imac-test', role: 'news', name: 'iMac', password: PW, confirm: 'ВЫДАТЬ' });
    const ping = listenPort ? await tlsReq(listenPort, 'GET', '/ping', null, bare.j.token) : { s: 0 };
    rec('HTTP register with password and ВЫДАТЬ returns a bearer that pings with no signature', bare.s === 200 && /^nk_imac-test\./.test(bare.j.token || '') && ping.s === 200 && !JSON.stringify(st.j.nodes || []).includes(bare.j.token), 'HTTP ' + bare.s + ' ping ' + ping.s);
    const enr = await api(on.port, A, 'POST', '/api/ops/nodes/enroll', { role: 'monitor', nodeId: 'macbook-test', password: PW, confirm: 'ПОДКЛЮЧИТЬ' });
    const noConfirm = await httpsJson(listenPort, '/api/nodes/enroll', { code: 'ZZZZZ-ZZZZZ-ZZZZZ' });
    const posted = await httpsJson(listenPort, '/api/nodes/enroll', { code: enr.j.code, deviceId, devicePubKey: pubPem, proof: sign(`enroll:${enr.j.requestId}:${deviceId}`), info: { hostname: 'mb', model: 'qa', os: 'test', agentVersion: '0.2.1' } });
    const list = await api(on.port, A, 'GET', '/api/ops/nodes/enroll');
    const row = ((list.j && list.j.requests) || []).find(q => q.requestId === enr.j.requestId);
    const deny = await api(on.port, A, 'POST', '/api/ops/nodes/enroll/' + enr.j.requestId + '/confirm', {});
    const okc = await api(on.port, A, 'POST', '/api/ops/nodes/enroll/' + enr.j.requestId + '/confirm', { password: PW, confirm: 'ПОДТВЕРДИТЬ' });
    rec('enroll confirm requires the owner password and the word ПОДТВЕРДИТЬ', enr.s === 200 && posted.s === 200 && posted.j.status === 'pending' && row && row.device && row.device.pubKeyFingerprint && (deny.s === 400 || deny.s === 403) && okc.s === 200 && okc.j.state === 'confirmed', JSON.stringify({ enr: enr.s, posted: posted.s, deny: deny.s, okc: okc.s, short: row && row.device && row.device.pubKeyShort, plain: noConfirm.s }));
    const ownerRot = await api(on.port, A, 'POST', '/api/ops/nodes/imac-test/rotate', { password: PW, confirm: 'СМЕНИТЬ' });
    rec('owner rotate of a 0.2.0 node returns a new token once', ownerRot.s === 200 && !!ownerRot.j.token, 'HTTP ' + ownerRot.s);
  } else rec('enabled node server started', false, on.out.slice(-300));
  on.stop();

  if (!/nonce|seenSig|replay/.test(nodesJs)) finding('info', 'no nonce store was added in the port', 'The 120 second window is unchanged.');
  const failed = controls.filter(c => !c.ok);
  const out = { controls: controls.length, failed: failed.length, findings, root: ROOT, failedNames: failed.map(f => f.name) };
  fs.mkdirSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'logs'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'logs/nodes-attack.json'), JSON.stringify({ controls, findings, ...out }, null, 2));
  console.log(JSON.stringify(out));
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
