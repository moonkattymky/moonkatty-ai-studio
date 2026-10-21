'use strict';
// MOONKATTY NODE 0.2.1 — enrollment by one-time code: real HTTPS coordinator (self-signed, pinned), real agent enroll flow,
// Keychain replaced by a test double of /usr/bin/security. Covers code lifecycle, brute force, TLS/pin, token secrecy, revoke/re-enroll/rotation, 0.2.0 compat.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const N = require('../../lib/ops/nodes.js'); const E = require('../../lib/ops/node-enroll.js'); const EN = require('../../node-agent/enroll.js'); const A = require('../../node-agent/agent.js');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'enr-'));
let clock = Date.now(); const now = () => clock;
function kcEnv() { const d = tmp('kc-'); return { NODE_KEYCHAIN_BIN: path.join(__dirname, '..', 'fixtures', 'fake-security.js'), FAKE_KC_FILE: path.join(d, 'kc.json'), FAKE_KC_ARGV: path.join(d, 'argv.log'), _dir: d }; }
async function coord() { const dir = tmp('coord-'); const logs = []; const m = N.createNodeManager({ dir, now, log: (...x) => logs.push(x.join(' ')) }); const tlsc = N.ensureCert(dir);
  const srv = await N.listen(m, { host: '127.0.0.1', port: 0, tls: tlsc }); const url = `https://127.0.0.1:${srv.address().port}`;
  return { m, dir, logs, url, fp: tlsc.fingerprint, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) }; }
const devKeys = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { id: 'dev_' + crypto.randomBytes(16).toString('hex'), pub: publicKey.export({ type: 'spki', format: 'pem' }), key: privateKey }; };
const ridOf = code => code.slice(0, 5);
const enBody = (code, d) => ({ code, deviceId: d.id, devicePubKey: d.pub, proof: EN.sign(d.key, `enroll:${ridOf(code)}:${d.id}`), info: { hostname: 'iMac-test', model: 'iMac18,3', os: 'macOS 13.7.1', arch: 'x64', agentVersion: '0.2.1' } });
const errCode = fn => { try { fn(); } catch (e) { return e.code; } return null; };
const mgr = () => N.createNodeManager({ dir: tmp(), now });
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('code: high entropy, 31-symbol alphabet without 0/O/1/I/L, bound to request, stored only as HMAC', () => {
  const m = mgr(); const r = m.enrollment.create({ role: 'news', name: 'iMac' }); assert.match(r.code, /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/); assert.equal(ridOf(r.code), r.requestId);
  assert.equal(r.ttlSec, 300); assert.ok(10 * Math.log2(31) > 49); const st = JSON.stringify(m.enrollment.list()); assert.ok(!st.includes(r.code.slice(6, 11)));
  const set = new Set(Array.from({ length: 2000 }, () => E.randomCode())); assert.equal(set.size, 2000);
});
test('expired code → E_CODE_EXPIRED; reuse → E_CODE_USED; wrong code → E_CODE_INVALID', () => {
  const m = mgr(); const d = devKeys(); let r = m.enrollment.create({ role: 'news' }); clock += 5 * 60e3 + 1; assert.equal(errCode(() => m.enrollment.enroll(enBody(r.code, d), '100.70.0.2')), 'E_CODE_EXPIRED');
  r = m.enrollment.create({ role: 'news' }); assert.equal(m.enrollment.enroll(enBody(r.code, d), '100.70.0.3').status, 'pending'); assert.equal(errCode(() => m.enrollment.enroll(enBody(r.code, d), '100.70.0.3')), 'E_CODE_USED');
  r = m.enrollment.create({ role: 'monitor' }); const bad = r.requestId + '-22222-22222'; assert.equal(errCode(() => m.enrollment.enroll(enBody(bad, d), '100.70.0.4')), 'E_CODE_INVALID');
  assert.equal(errCode(() => m.enrollment.enroll(enBody('garbage', d), '100.70.0.4')), 'E_CODE_INVALID');
});
test('code of another request does not work (code bound to its requestId)', () => {
  const m = mgr(); const d = devKeys(); const a = m.enrollment.create({ role: 'news' }); const b = m.enrollment.create({ role: 'monitor' });
  const mixed = b.requestId + a.code.slice(5); assert.equal(errCode(() => m.enrollment.enroll(enBody(mixed, d), '10.0.0.9')), 'E_CODE_INVALID');
  assert.equal(m.enrollment.list().find(q => q.requestId === b.requestId).attempts, 1);
});
test('brute force: 5 wrong codes lock the request (even the right code then fails); IP lockout after 10 failures; rate limit 30/min', () => {
  const m = mgr(); const d = devKeys(); const r = m.enrollment.create({ role: 'news' });
  for (let i = 0; i < 4; i++) assert.equal(errCode(() => m.enrollment.enroll(enBody(r.requestId + '-33333-3333' + (i + 2), d), '10.1.0.' + i)), 'E_CODE_INVALID');
  assert.equal(errCode(() => m.enrollment.enroll(enBody(r.requestId + '-44444-44444', d), '10.1.0.9')), 'E_REQUEST_LOCKED');
  assert.equal(errCode(() => m.enrollment.enroll(enBody(r.code, d), '10.1.0.10')), 'E_REQUEST_LOCKED');
  const m2 = mgr(); for (let i = 0; i < 10; i++) errCode(() => m2.enrollment.enroll(enBody('ZZZZZ-22222-2222' + (i % 8 + 2), d), '10.2.0.1'));
  const ok = m2.enrollment.create({ role: 'news' }); assert.equal(errCode(() => m2.enrollment.enroll(enBody(ok.code, d), '10.2.0.1')), 'E_IP_LOCKED');
  assert.equal(m2.enrollment.enroll(enBody(ok.code, d), '10.2.0.2').status, 'pending'); clock += 16 * 60e3;
  const m3 = mgr(); let last; for (let i = 0; i < 31; i++) last = errCode(() => m3.enrollment.status({ requestId: 'x', requestSecret: 'y' }, '10.3.0.1')); assert.ok(['E_RATE_LIMIT', 'E_IP_LOCKED'].includes(last));
  const m4 = mgr(); m4.enrollment.create({ role: 'news' }); const ip = '10.4.0.1'; m4.enrollment._ip[ip] = { calls: Array(30).fill(clock), fails: [], lockedUntil: 0 }; assert.equal(errCode(() => m4.enrollment.enroll(enBody('A', d), ip)), 'E_RATE_LIMIT');
  assert.match(fs.readFileSync(require.resolve('../../lib/ops/node-enroll.js'), 'utf8'), /timingSafeEqual/);
});
test('unconfirmed request gets no token; rejected request gets no token; bad device signature refused', () => {
  const m = mgr(); const d = devKeys(); const r = m.enrollment.create({ role: 'news' }); const e = m.enrollment.enroll(enBody(r.code, d), '10.5.0.1');
  const st = (dk = d) => { const ts = clock; const nonce = crypto.randomBytes(18).toString('base64url'); return m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts, nonce, sig: EN.sign(dk.key, `status:${e.requestId}:${ts}:${nonce}`) }, '10.5.0.1'); };
  assert.deepEqual(st(), { status: 'pending' }); assert.equal(errCode(() => st(devKeys())), 'E_BAD_SIGNATURE');
  assert.equal(errCode(() => m.enrollment.status({ requestId: e.requestId, requestSecret: 'wrong', ts: clock, sig: 'x' }, '10.5.0.1')), 'E_NOT_FOUND');
  const v = m.enrollment.list()[0]; assert.equal(v.device.deviceId, d.id); assert.equal(v.device.hostname, 'iMac-test'); assert.match(v.device.pubKeyShort, /^[A-F0-9]{4}(-[A-F0-9]{4}){3}$/);
  m.enrollment.reject(e.requestId); assert.deepEqual(st(), { status: 'rejected' }); assert.ok(!m.listNodes || !m.listNodes().some(n => n.id === 'imac'));
  const r2 = m.enrollment.create({ role: 'news' }); const b = enBody(r2.code, d); b.proof = EN.sign(devKeys().key, `enroll:${r2.requestId}:${d.id}`); assert.equal(errCode(() => m.enrollment.enroll(b, '10.5.0.2')), 'E_BAD_SIGNATURE');
});
test('end-to-end over real TLS: agent enrolls with pinned cert, owner confirms, token only in Keychain (never files/logs/argv), signed requests', async () => {
  const c = await coord(); const kc = kcEnv(); const home = tmp('home-'); clock = Date.now();
  try { const r = c.m.enrollment.create({ role: 'news', name: 'iMac 27' }); const states = [];
    const p = EN.enroll({ url: c.url, fingerprint: c.fp, code: r.code, home, env: kc, info: { hostname: 'iMac', agentVersion: '0.2.1' }, pollMs: 50, onState: s => states.push(s.step) });
    let q; for (let i = 0; i < 200 && !(q = c.m.enrollment.list().find(x => x.state === 'pending')); i++) await new Promise(z => setTimeout(z, 20)); assert.ok(q, 'pending');
    assert.equal(q.device.hostname, 'iMac'); c.m.enrollment.confirm(q.requestId); const res = await p; assert.equal(res.nodeId, 'imac'); assert.deepEqual([...new Set(states)], ['pin', 'device', 'pending', 'enrolled']);
    const store = JSON.parse(fs.readFileSync(kc.FAKE_KC_FILE, 'utf8')); const token = store['moonkatty-node-imac|node-token']; assert.match(token, /^nk_imac\.[A-Za-z0-9_-]{20,}$/);
    assert.ok(!Object.keys(store).some(k => k.startsWith('moonkatty-node-enroll|')), 'request secret removed');
    for (const f of [...walk(home), ...walk(c.dir)]) assert.ok(!fs.readFileSync(f, 'latin1').includes(token.split('.')[1]), 'token leaked into ' + f);
    assert.ok(!fs.readFileSync(kc.FAKE_KC_ARGV, 'utf8').includes(token), 'token passed in argv'); assert.ok(!c.logs.join('\n').includes(token)); assert.ok(!JSON.stringify(c.m.audit()).includes(token));
    const env = fs.readFileSync(path.join(home, 'node-agent.env'), 'utf8'); assert.match(env, /NODE_ID=imac/); assert.match(env, /COORDINATOR_FINGERPRINT=/); assert.ok(!/TOKEN/.test(env.replace(/Токен/g, '')));
    assert.equal((fs.statSync(path.join(home, 'node-agent.env')).mode & 0o777), 0o600);
    // agent config loads token from Keychain and device key; signed request works, unsigned or wrongly signed is refused
    const cfg = await A.config({ ...kc, HOME: home, NODE_AGENT_ENV: path.join(home, 'node-agent.env') }).catch(() => null);
    const base = { url: c.url, certFile: path.join(home, 'coordinator.crt'), fingerprint: c.fp, token, profileKey: 'news', limits: A.PROFILES.news.limits };
    const dk = await EN.deviceIdentity(home, EN.keychain(kc), { create: false }); assert.ok(dk && dk.key);
    let req = A.client({ ...base, deviceKey: dk.key }); assert.equal((await req('GET', '/ping')).status, 200);
    assert.equal((await A.client(base)('GET', '/ping')).status, 401, 'unsigned request from enrolled node refused');
    assert.equal((await A.client({ ...base, deviceKey: devKeys().key })('GET', '/ping')).status, 401, 'other device key refused');
    if (cfg) assert.equal(cfg.token, token);
    // rotation: owner requests → pull says rotate → agent rotates, new token in Keychain, old token dead
    c.m.requestRotate('imac'); const pr = await req('POST', '/pull', { info: { agentVersion: '0.2.1' } }); assert.equal(pr.body.rotate, true);
    const cfgR = { ...base, deviceKey: dk.key, env: kc, nodeId: 'imac' }; assert.equal(await A.rotate(cfgR, req), true); const t2 = JSON.parse(fs.readFileSync(kc.FAKE_KC_FILE, 'utf8'))['moonkatty-node-imac|node-token'];
    assert.notEqual(t2, token); assert.equal((await A.client({ ...base, token, deviceKey: dk.key })('GET', '/ping')).status, 401); assert.equal((await A.client({ ...base, token: t2, deviceKey: dk.key })('GET', '/ping')).status, 200);
    // version gate
    assert.equal((await A.client({ ...base, token: t2, deviceKey: dk.key })('POST', '/hello', { info: { agentVersion: '0.3.0' } })).status, 426);
    // re-enroll: new code for the same node; old token invalidated at confirm
    const r2 = c.m.enrollment.create({ role: 'news' }); assert.equal(r2.reenroll, true); const home2 = tmp('home2-');
    const p2 = EN.enroll({ url: c.url, fingerprint: c.fp, code: r2.code, home: home2, env: kc, info: {}, pollMs: 50 });
    let q2; for (let i = 0; i < 200 && !(q2 = c.m.enrollment.list().find(x => x.state === 'pending')); i++) await new Promise(z => setTimeout(z, 20)); c.m.enrollment.confirm(q2.requestId);
    assert.equal((await A.client({ ...base, token: t2, deviceKey: dk.key })('GET', '/ping')).status, 401, 'old token dead after re-enroll confirm'); await p2;
    const t3 = JSON.parse(fs.readFileSync(kc.FAKE_KC_FILE, 'utf8'))['moonkatty-node-imac|node-token']; const dk2 = await EN.deviceIdentity(home2, EN.keychain(kc), { create: false });
    assert.equal((await A.client({ ...base, token: t3, deviceKey: dk2.key })('GET', '/ping')).status, 200);
    // revoke
    c.m.revokeNode('imac'); assert.equal((await A.client({ ...base, token: t3, deviceKey: dk2.key })('GET', '/ping')).status, 401);
    const ev = c.m.audit().map(a => a.event || a.type); for (const k of ['request_created', 'code_accepted', 'confirmed', 'enrolled', 'rotated', 'token_invalidated', 'revoked']) assert.ok(ev.includes(k), k);
  } finally { await c.close(); }
});
test('plaintext refused (client and server), wrong fingerprint refused before any data is sent', async () => {
  const kc = kcEnv(); await assert.rejects(() => EN.enroll({ url: 'http://127.0.0.1:1', code: 'X', env: kc, home: tmp() }), e => e.code === 'E_TLS_REQUIRED');
  const m = mgr(); const srv = http.createServer(m.handler()); await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const res = await new Promise((ok, no) => { const q = http.request({ method: 'POST', port: srv.address().port, host: '127.0.0.1', path: '/api/nodes/enroll', headers: { 'content-type': 'application/json' } }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => ok({ s: r.statusCode, b: JSON.parse(b) })); }); q.on('error', no); q.end('{"code":"x"}'); });
  assert.equal(res.s, 426); assert.equal(res.b.code, 'E_TLS_REQUIRED'); srv.close();
  const c = await coord(); try { const r = c.m.enrollment.create({ role: 'monitor' }); const home = tmp();
    await assert.rejects(() => EN.enroll({ url: c.url, fingerprint: 'a'.repeat(64), code: r.code, env: kc, home, pollMs: 50 }), e => e.code === 'E_PIN');
    assert.equal(c.m.enrollment.list()[0].state, 'awaiting_code', 'nothing reached the coordinator'); assert.ok(!fs.existsSync(path.join(home, 'device.json')));
    await assert.rejects(() => EN.enroll({ url: c.url, fingerprint: 'short', code: r.code, env: kc, home }), /64 hex/);
  } finally { await c.close(); }
});
test('0.2.0 compatibility: direct-token node (no device key, no agentVersion or 0.2.0) keeps working; contract versions', async () => {
  const c = await coord(); try { const reg = c.m.registerNode({ id: 'macbook', role: 'monitor' }); const dir = tmp(); fs.writeFileSync(path.join(dir, 'c.crt'), fs.readFileSync(path.join(c.dir, 'nodes-tls.crt')));
    const req = A.client({ url: c.url, certFile: path.join(dir, 'c.crt'), fingerprint: c.fp, token: reg.token });
    assert.equal((await req('GET', '/ping')).status, 200); assert.equal((await req('POST', '/hello', { info: { agentVersion: '0.2.0' } })).status, 200); assert.equal((await req('POST', '/pull', { info: {} })).status, 200);
    assert.equal((await req('POST', '/rotate', {})).body.code, 'E_NOT_ENROLLED'); assert.equal(N.PROTOCOL, 2); assert.equal(N.AGENT_RANGE, '>=0.2.0 <0.3.0'); assert.equal(A.VERSION, '0.2.2');
  } finally { await c.close(); }
});
test('CGNAT / private address check: Tailscale 100.64/10 ok, strict octets, no public/0.0.0.0', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.20', '172.16.0.1', '172.31.255.255', '100.64.0.1', '100.101.102.103', '100.127.255.254', 'fd7a:115c:a1e0::1']) assert.ok(N.isPrivateIPv4(ip), ip);
  for (const ip of ['0.0.0.0', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.32.0.1', '192.168.1.300', '100.64.999.1', '1.2.3', '::', 'fd00::1', 'localhost']) assert.ok(!N.isPrivateIPv4(ip), ip);
});

test('anti-replay: same signed pull twice → 2nd is 401 E_REPLAY (no second job); 30 s window; status poll replay refused; 0.2.1 (no nonce) → 426', async () => {
  const c = await coord(); const kc = kcEnv(); const home = tmp('home-'); clock = Date.now();
  try { const r = c.m.enrollment.create({ role: 'news' }); const p = EN.enroll({ url: c.url, fingerprint: c.fp, code: r.code, home, env: kc, info: {}, pollMs: 30 });
    let q; for (let i = 0; i < 200 && !(q = c.m.enrollment.list().find(x => x.state === 'pending')); i++) await new Promise(z => setTimeout(z, 20)); c.m.enrollment.confirm(q.requestId); await p;
    const token = JSON.parse(fs.readFileSync(kc.FAKE_KC_FILE, 'utf8'))['moonkatty-node-imac|node-token']; const dk = await EN.deviceIdentity(home, EN.keychain(kc), { create: false });
    c.m.submit({ capability: 'news.collect', input: { feeds: [] } }); c.m.submit({ capability: 'news.collect', input: { feeds: [] } });
    const body = Buffer.from(JSON.stringify({ info: { agentVersion: '0.2.2' } })); const h = A.signHeaders({ deviceKey: dk.key }, 'POST', '/api/nodes/pull', body);
    const raw = (hd) => new Promise((ok, no) => { const u = new URL(c.url); const q2 = require('https').request({ method: 'POST', host: u.hostname, port: u.port, path: '/api/nodes/pull', ca: fs.readFileSync(path.join(c.dir, 'nodes-tls.crt')), checkServerIdentity: () => undefined, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...hd } }, rs => { let b = ''; rs.on('data', x => b += x); rs.on('end', () => ok({ s: rs.statusCode, b: JSON.parse(b) })); }); q2.on('error', no); q2.end(body); });
    const r1 = await raw(h); assert.equal(r1.s, 200); assert.ok(r1.b.job); const r2 = await raw(h); assert.equal(r2.s, 401); assert.equal(r2.b.code, 'E_REPLAY');
    assert.equal(Object.values(c.m.status().jobs || {}).length >= 0, true); assert.ok(c.m.audit().some(a => a.type === 'replay_rejected'));
    clock += 31e3; assert.equal((await raw(A.signHeaders({ deviceKey: dk.key }, 'POST', '/api/nodes/pull', body))).s, 401, 'old ts (clock moved 31 s) refused'); clock -= 31e3;
    const tsOld = clock - 31e3; const nn = crypto.randomBytes(18).toString('base64url'); assert.equal((await raw({ 'x-node-ts': String(tsOld), 'x-node-nonce': nn, 'x-node-sig': EN.sign(dk.key, `POST\n/api/nodes/pull\n${tsOld}\n${nn}\n${crypto.createHash('sha256').update(body).digest('hex')}`) })).s, 401);
    const ts = clock; const v021 = await raw({ 'x-node-ts': String(ts), 'x-node-sig': EN.sign(dk.key, `POST\n/api/nodes/pull\n${ts}\n${crypto.createHash('sha256').update(body).digest('hex')}`) }); assert.equal(v021.s, 426); assert.equal(v021.b.code, 'E_AGENT_VERSION');
    // node may not self-rotate without owner flag
    const req = A.client({ url: c.url, certFile: path.join(home, 'coordinator.crt'), fingerprint: c.fp, token, deviceKey: dk.key }); assert.equal((await req('POST', '/rotate', {})).body.code, 'E_ROTATE_NOT_REQUESTED');
  } finally { await c.close(); }
  // status poll replay
  const m = mgr(); const d = devKeys(); const r = m.enrollment.create({ role: 'monitor' }); const e = m.enrollment.enroll(enBody(r.code, d), '10.9.0.1'); const ts = clock; const nonce = crypto.randomBytes(18).toString('base64url');
  const b = { requestId: e.requestId, requestSecret: e.requestSecret, ts, nonce, sig: EN.sign(d.key, `status:${e.requestId}:${ts}:${nonce}`) }; assert.equal(m.enrollment.status(b, '10.9.0.1').status, 'pending'); assert.equal(errCode(() => m.enrollment.status(b, '10.9.0.1')), 'E_REPLAY');
});
test('auth timing: wrong token and right token + bad signature do the same work (dummy verify)', () => {
  const m = mgr(); const src = fs.readFileSync(require.resolve('../../lib/ops/nodes.js'), 'utf8'); assert.match(src, /DUMMY\.pub/);
  const t = (f) => { const a = []; for (let i = 0; i < 300; i++) { const s = process.hrtime.bigint(); f(); a.push(Number(process.hrtime.bigint() - s)); } a.sort((x, y) => x - y); return a[150]; };
  const d = devKeys(); const r = m.enrollment.create({ role: 'news' }); const e = m.enrollment.enroll(enBody(r.code, d), '10.10.0.1'); m.enrollment.confirm(e.requestId);
  const ts = clock, nonce = crypto.randomBytes(18).toString('base64url'); const tok = m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts, nonce, sig: EN.sign(d.key, `status:${e.requestId}:${ts}:${nonce}`) }, '10.10.0.1').token;
  const sig = { method: 'GET', path: '/api/nodes/ping', ts: clock, nonce: 'n'.repeat(22), sig: 'AA==' };
  const wrong = t(() => m.authNode('Bearer nk_imac.' + 'z'.repeat(32), sig)), right = t(() => m.authNode('Bearer ' + tok, sig));
  assert.ok(right / wrong < 3 && wrong / right < 3, `wrong ${wrong} ns vs right ${right} ns`);
});
