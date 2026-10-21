'use strict';
// v1.2.4-test — port of MOONKATTY NODE 0.2.1 coordinator (Studio 3 38bce84..596cb57): one-time code enrollment with owner confirmation,
// Ed25519 device-signed requests, rotation (rotate:true on pull), revoke, audit, protocol 1 / agentVersion >=0.2.0 <0.3.0, strict address checks.
// Coordinator side only; the node side is simulated here with node:crypto (fake keys, no Keychain).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), http = require('http'), crypto = require('crypto');
const N = require('../../lib/ops/nodes.js'); const E = require('../../lib/ops/node-enroll.js');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'enr021-'));
let clock = Date.now(); const now = () => clock;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sign = (key, msg) => crypto.sign(null, Buffer.from(msg), key).toString('base64');
const devKeys = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { id: 'dev_' + crypto.randomBytes(16).toString('hex'), pub: publicKey.export({ type: 'spki', format: 'pem' }), key: privateKey }; };
const ridOf = code => code.slice(0, 5);
const enBody = (code, d, ver = '0.2.1') => ({ code, deviceId: d.id, devicePubKey: d.pub, proof: sign(d.key, `enroll:${ridOf(code)}:${d.id}`), info: { hostname: 'iMac-test', model: 'iMac18,3', os: 'macOS 13.7.1', arch: 'x64', agentVersion: ver } });
const errCode = fn => { try { fn(); } catch (e) { return e.code; } return null; };
const mgr = (o = {}) => { const logs = []; const m = N.createNodeManager({ dir: tmp(), now, log: (...x) => logs.push(x.join(' ')), idSuffix: '-test', ...o }); m._logs = logs; return m; };
function enrollFully(m, d = devKeys(), role = 'news') { const r = m.enrollment.create({ role, name: 'iMac 27' }); const e = m.enrollment.enroll(enBody(r.code, d), '100.70.0.2'); m.enrollment.confirm(e.requestId);
  const ts = clock; const s = m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts, sig: sign(d.key, `status:${e.requestId}:${ts}`) }, '100.70.0.2'); return { r, e, s, d }; }

test('code: 15 chars from 31-symbol alphabet, TTL 300 s, HMAC only (code never in state/list/logs), default node id carries -test', () => {
  const m = mgr(); const r = m.enrollment.create({ role: 'news', name: 'iMac' }); assert.match(r.code, /^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/);
  assert.equal(r.ttlSec, 300); assert.equal(r.nodeId, 'imac-test'); assert.equal(m.enrollment.create({ role: 'monitor' }).nodeId, 'macbook-test');
  assert.equal(errCode(() => m.enrollment.create({ role: 'news', nodeId: 'imac' })), 'E_BAD_REQUEST'); // TEST build: no prod node ids
  assert.equal(errCode(() => m.enrollment.create({ role: 'heavy' })), 'E_BAD_REQUEST');
  const secretPart = r.code.slice(6); const disk = fs.readFileSync(path.join(m.filesDir, '..', 'nodes.json'), 'utf8');
  for (const hay of [disk, JSON.stringify(m.enrollment.list()), m._logs.join('\n'), JSON.stringify(m.audit())]) assert.ok(!hay.includes(secretPart.replace('-', '')) && !hay.includes(secretPart));
  assert.ok(!/enrollKey/.test(disk), 'HMAC key is not persisted');
  assert.equal(new Set(Array.from({ length: 2000 }, () => E.randomCode())).size, 2000);
});
test('lifecycle: expired after 5 min, single use, foreign/wrong code refused, 5 wrong → locked, IP lockout, rate limit', () => {
  const m = mgr(); const d = devKeys(); let r = m.enrollment.create({ role: 'news' }); clock += 5 * 60e3 + 1;
  assert.equal(errCode(() => m.enrollment.enroll(enBody(r.code, d), '100.70.0.2')), 'E_CODE_EXPIRED');
  r = m.enrollment.create({ role: 'news' }); assert.equal(m.enrollment.enroll(enBody(r.code, d), '100.70.0.3').status, 'pending');
  assert.equal(errCode(() => m.enrollment.enroll(enBody(r.code, d), '100.70.0.3')), 'E_CODE_USED');
  const a = m.enrollment.create({ role: 'news' }), b = m.enrollment.create({ role: 'monitor' });
  assert.equal(errCode(() => m.enrollment.enroll(enBody(b.requestId + a.code.slice(5), d), '100.70.0.4')), 'E_CODE_INVALID');
  for (let i = 0; i < 3; i++) errCode(() => m.enrollment.enroll(enBody(b.requestId + '-33333-3333' + (i + 2), d), '100.70.1.' + i));
  assert.equal(errCode(() => m.enrollment.enroll(enBody(b.requestId + '-44444-44444', d), '100.70.1.9')), 'E_REQUEST_LOCKED');
  assert.equal(errCode(() => m.enrollment.enroll(enBody(b.code, d), '100.70.1.10')), 'E_REQUEST_LOCKED');
  const m2 = mgr(); for (let i = 0; i < 10; i++) errCode(() => m2.enrollment.enroll(enBody('ZZZZZ-22222-2222' + (i % 8 + 2), d), '100.71.0.1'));
  const ok = m2.enrollment.create({ role: 'news' }); assert.equal(errCode(() => m2.enrollment.enroll(enBody(ok.code, d), '100.71.0.1')), 'E_IP_LOCKED');
  const m3 = mgr(); let last; for (let i = 0; i < 31; i++) last = errCode(() => m3.enrollment.status({ requestId: 'x', requestSecret: 'y' }, '100.72.0.1')); assert.ok(['E_RATE_LIMIT', 'E_IP_LOCKED'].includes(last));
  assert.ok(m.audit().some(x => x.type === 'request_locked'));
});
test('owner confirmation required: pending/rejected get no token; wrong device key refused; confirm → token once', () => {
  const m = mgr(); const d = devKeys(); const r = m.enrollment.create({ role: 'news' }); const e = m.enrollment.enroll(enBody(r.code, d), '100.70.0.5');
  const st = (dk = d) => { const ts = clock; return m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts, sig: sign(dk.key, `status:${e.requestId}:${ts}`) }, '100.70.0.5'); };
  assert.deepEqual(st(), { status: 'pending' }); assert.equal(errCode(() => st(devKeys())), 'E_BAD_SIGNATURE'); assert.equal(m._state.nodes['imac-test'], undefined);
  const v = m.enrollment.list()[0]; assert.equal(v.device.deviceId, d.id); assert.match(v.device.pubKeyShort, /^[A-F0-9]{4}(-[A-F0-9]{4}){3}$/);
  m.enrollment.confirm(e.requestId); const got = st(); assert.equal(got.status, 'enrolled'); assert.equal(got.protocol, 1); assert.match(got.token, /^nk_imac-test\./);
  assert.equal(errCode(() => st()), 'E_NOT_FOUND'); // token handed out once; request secret consumed
  const m2 = mgr(); const r2 = m2.enrollment.create({ role: 'monitor' }); const e2 = m2.enrollment.enroll(enBody(r2.code, d), '100.70.0.6'); m2.enrollment.reject(e2.requestId);
  const ts = clock; assert.deepEqual(m2.enrollment.status({ requestId: e2.requestId, requestSecret: e2.requestSecret, ts, sig: sign(d.key, `status:${e2.requestId}:${ts}`) }, '100.70.0.6'), { status: 'rejected' });
  assert.equal(errCode(() => m2.enrollment.confirm(e2.requestId)), 'E_BAD_REQUEST');
  assert.ok(!fs.readFileSync(path.join(m.filesDir, '..', 'nodes.json'), 'utf8').includes(got.token) && !m._logs.join('\n').includes(got.token));
});
test('signed requests: enrolled (0.2.1) token useless without a valid Ed25519 signature; 0.2.0 bearer tokens keep working', () => {
  const m = mgr(); const { s, d } = enrollFully(m); const body = Buffer.from('{"info":{}}');
  const sig = (k = d.key, ts = clock, p = '/api/nodes/hello', b = body) => ({ method: 'POST', path: p, ts, body: b, sig: sign(k, `POST\n${p}\n${ts}\n${sha(b)}`) });
  assert.ok(m.authNode('Bearer ' + s.token, sig())); assert.equal(m.authNode('Bearer ' + s.token), null); assert.equal(m.authNode('Bearer ' + s.token, sig(devKeys().key)), null);
  assert.equal(m.authNode('Bearer ' + s.token, sig(d.key, clock - 121e3)), null); assert.equal(m.authNode('Bearer ' + s.token, { ...sig(), body: Buffer.from('{"x":1}') }), null);
  assert.equal(m.authNode('Bearer ' + s.token, { ...sig(), path: '/api/nodes/pull' }), null);
  const legacy = m.registerNode({ id: 'macbook-test', role: 'macbook' }); assert.ok(m.authNode('Bearer ' + legacy.token)); // 0.2.0 compatibility
});
test('rotation: owner requests → hello/pull rotate:true → node rotates, old token dead; revoke kills token + device key; re-enroll invalidates old token', () => {
  const m = mgr(); const { s, d } = enrollFully(m); const n = m._state.nodes['imac-test'];
  assert.equal(m.hello(n, { agentVersion: '0.2.1' }).rotate, false); m.requestRotate('imac-test'); assert.equal(m.hello(n, {}).rotate, true);
  const t2 = m.rotateToken(n).token; assert.notEqual(t2, s.token); assert.equal(m.hello(n, {}).rotate, false);
  const sg = t => ({ method: 'GET', path: '/api/nodes/ping', ts: clock, body: Buffer.alloc(0), sig: sign(d.key, `GET\n/api/nodes/ping\n${clock}\n${sha(Buffer.alloc(0))}`) });
  assert.equal(m.authNode('Bearer ' + s.token, sg()), null); assert.ok(m.authNode('Bearer ' + t2, sg()));
  const r3 = enrollFully(m, devKeys()); assert.equal(m.authNode('Bearer ' + t2, sg()), null, 're-enroll: old token invalid'); assert.equal(r3.s.status, 'enrolled');
  m.revokeNode('imac-test'); assert.equal(m._state.nodes['imac-test'].devicePubKey, null); assert.equal(errCode(() => m.requestRotate('imac-test')) ?? 'threw', 'threw');
  const types = m.audit().map(x => x.type); for (const t of ['request_created', 'code_accepted', 'confirmed', 'enrolled', 'rotate_requested', 'rotated', 'token_invalidated', 'revoked']) assert.ok(types.includes(t), t);
  assert.ok(!JSON.stringify(m.audit()).includes(t2));
});
test('addresses (38bce84 fix): strict octets, 100.64.0.0/10 and fd7a:115c:a1e0::/48 only for listeners', () => {
  for (const bad of ['100.64.999.1', '192.168.1.300', '100.128.0.1', '100.63.255.255', '127.0.0.300', '0.0.0.0', '8.8.8.8', '192.168.1.10', '10.0.0.1', 'fd7a:115c:a1e1::1', '::', '100.064.0.1'])
    assert.equal(N.isTailscaleOrLoopback(bad), false, bad);
  for (const good of ['127.0.0.1', '::1', '100.64.0.0', '100.127.255.255', '100.101.102.103', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:ab12::5', '::ffff:100.64.0.1'])
    assert.equal(N.isTailscaleOrLoopback(good), true, good);
  assert.equal(N.isPrivateIPv4('100.64.999.1'), false); assert.equal(N.isPrivateIPv4('192.168.1.300'), false); assert.equal(N.isPrivateIPv4('fd7a:115c:a1e0::1'), true); assert.equal(N.isPrivateIPv4('100.64.0.1'), true);
  return Promise.all(['0.0.0.0', '192.168.1.10', '100.64.999.1', '8.8.8.8'].map(h => assert.rejects(N.listen(mgr(), { host: h, port: 0, insecureHttpForTests: true }))));
});
test('protocol 1 / agentVersion range over HTTP: hello protocol:1 + range, 426 E_AGENT_VERSION outside, pull carries rotate', async () => {
  const m = mgr(); const legacy = m.registerNode({ id: 'macbook-test', role: 'macbook' }); const srv = await N.listen(m, { host: '127.0.0.1', port: 0, insecureHttpForTests: true }); const port = srv.address().port;
  const call = (p, body, hdr = {}) => new Promise((res, rej) => { const b = Buffer.from(JSON.stringify(body)); const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + legacy.token, ...hdr } }, x => { let d = ''; x.on('data', z => d += z); x.on('end', () => res({ status: x.statusCode, body: JSON.parse(d) })); }); r.on('error', rej); r.end(b); });
  try { clock = Date.now();
    const h = await call('/api/nodes/hello', { info: { agentVersion: '0.2.0' } }); assert.equal(h.status, 200); assert.equal(h.body.protocol, 1); assert.equal(h.body.agentVersionRange, '>=0.2.0 <0.3.0');
    assert.equal((await call('/api/nodes/hello', { info: { agentVersion: '0.2.9' } })).status, 200);
    for (const v of ['0.1.9', '0.3.0', '1.0.0', 'abc']) { const r = await call('/api/nodes/hello', { info: { agentVersion: v } }); assert.equal(r.status, 426, v); assert.equal(r.body.code, 'E_AGENT_VERSION'); }
    assert.equal((await call('/api/nodes/pull', { info: { agentVersion: '0.3.1' } })).body.code, 'E_AGENT_VERSION');
    const p = await call('/api/nodes/pull', { info: { agentVersion: '0.2.0' } }); assert.equal(p.body.protocol, 1); assert.equal(p.body.rotate, false);
    assert.equal((await call('/api/nodes/rotate', {})).body.code, 'E_NOT_ENROLLED');
    const en = await call('/api/nodes/enroll', { code: 'x' }, { authorization: '' }); assert.equal(en.status, 426); assert.equal(en.body.code, 'E_TLS_REQUIRED'); // plain HTTP: no enrollment
  } finally { srv.close(); }
});
test('end-to-end over real TLS (pinned): enroll → owner confirm → signed hello/pull → rotate:true → POST /rotate', async () => {
  const dir = tmp('coord-'); const m = N.createNodeManager({ dir, now: () => Date.now(), idSuffix: '-test' }); const tlsc = N.ensureCert(dir);
  const srv = await N.listen(m, { host: '127.0.0.1', port: 0, tls: tlsc }); const port = srv.address().port; const d = devKeys();
  const call = (p, body, { token, sign: sg = false, method = 'POST' } = {}) => new Promise((res, rej) => { const b = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)); const ts = Date.now();
    const headers = { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(sg ? { 'x-node-ts': String(ts), 'x-node-sig': sign(d.key, `${method}\n${p}\n${ts}\n${sha(b)}`) } : {}) };
    const r = https.request({ host: '127.0.0.1', port, method, path: p, headers, rejectUnauthorized: false, checkServerIdentity: () => undefined }, x => {
      const fp = x.socket.getPeerCertificate().fingerprint256.replace(/:/g, '').toLowerCase(); if (fp !== tlsc.fingerprint) return rej(new Error('pin mismatch'));
      let s = ''; x.on('data', z => s += z); x.on('end', () => res({ status: x.statusCode, body: JSON.parse(s) })); }); r.on('error', rej); r.end(b); });
  try { const r = m.enrollment.create({ role: 'news', name: 'iMac 27' });
    const e = await call('/api/nodes/enroll', enBody(r.code, d)); assert.equal(e.status, 200); assert.equal(e.body.status, 'pending');
    const poll = () => { const ts = Date.now(); return call('/api/nodes/enroll/status', { requestId: e.body.requestId, requestSecret: e.body.requestSecret, ts, sig: sign(d.key, `status:${e.body.requestId}:${ts}`) }); };
    assert.equal((await poll()).body.status, 'pending'); m.enrollment.confirm(e.body.requestId); const done = await poll(); assert.equal(done.body.status, 'enrolled'); const tok = done.body.token;
    assert.equal((await call('/api/nodes/hello', { info: { agentVersion: '0.2.1' } }, { token: tok })).status, 401, 'unsigned → 401');
    const h = await call('/api/nodes/hello', { info: { agentVersion: '0.2.1' } }, { token: tok, sign: true }); assert.equal(h.status, 200); assert.equal(h.body.protocol, 1); assert.equal(h.body.enrolled, true);
    m.requestRotate('imac-test'); const p = await call('/api/nodes/pull', { info: { agentVersion: '0.2.1' } }, { token: tok, sign: true }); assert.equal(p.body.rotate, true);
    const rot = await call('/api/nodes/rotate', {}, { token: tok, sign: true }); assert.equal(rot.status, 200); assert.match(rot.body.token, /^nk_imac-test\./);
    assert.equal((await call('/api/nodes/ping', undefined, { token: tok, sign: true, method: 'GET' })).status, 401, 'old token dead');
    assert.equal((await call('/api/nodes/ping', undefined, { token: rot.body.token, sign: true, method: 'GET' })).status, 200);
    assert.equal((await call('/api/nodes/pull', { info: { agentVersion: '0.2.1' } }, { token: rot.body.token, sign: true })).body.rotate, false);
    m.revokeNode('imac-test'); assert.equal((await call('/api/nodes/ping', undefined, { token: rot.body.token, sign: true, method: 'GET' })).status, 401);
    const disk = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    for (const sec of [tok, rot.body.token, e.body.requestSecret, r.code]) assert.ok(!disk.includes(sec));
  } finally { srv.closeAllConnections && srv.closeAllConnections(); srv.close(); }
});
