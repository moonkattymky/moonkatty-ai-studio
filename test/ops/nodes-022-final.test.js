'use strict';
// nodes-022-final: regression tests for QA-NODE-001, -002, -004 (coordinator side), -006 and for signed node uploads (streamed body hash).
// Coordinator: real lib/ops/nodes.js over HTTP (insecureHttpForTests on 127.0.0.1); node side simulated with node:crypto Ed25519 keys (test keys only).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const N = require('../../lib/ops/nodes.js');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'n022f-'));
let clock = Date.now(); const now = () => clock;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const sign = (key, msg) => crypto.sign(null, Buffer.from(msg), key).toString('base64');
const nn = () => crypto.randomBytes(18).toString('base64url');
const devKeys = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { id: 'dev_' + crypto.randomBytes(16).toString('hex'), pub: publicKey.export({ type: 'spki', format: 'pem' }), key: privateKey }; };
const enBody = (code, d) => ({ code, deviceId: d.id, devicePubKey: d.pub, proof: sign(d.key, `enroll:${code.slice(0, 5)}:${d.id}`), info: { hostname: 'iMac-test', agentVersion: '0.2.2' } });
const stBody = (key, rid, ts, nonce = nn()) => ({ ts, nonce, sig: sign(key, `status:${rid}:${ts}:${nonce}`) });
const errCode = fn => { try { fn(); } catch (e) { return e.code; } return null; };
const ACK = { acknowledgeUnverifiedPeer: true };
function enrollFully(m, role = 'news', peer = '100.70.0.2') { const d = devKeys(); const r = m.enrollment.create({ role }); const e = m.enrollment.enroll(enBody(r.code, d), peer); m.enrollment.confirm(e.requestId, ACK);
  const s = m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ...stBody(d.key, e.requestId, Math.max(clock, Date.now())) }, peer); return { d, s, id: s.nodeId }; }
const sigHeaders = (d, method, p, body, ts = Date.now(), nonce = nn()) => ({ 'x-node-ts': String(ts), 'x-node-nonce': nonce, 'x-node-sig': sign(d.key, `${method}\n${p}\n${ts}\n${nonce}\n${sha(body)}`) });
function call(port, method, p, token, body, headers) { return new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { authorization: 'Bearer ' + token, ...headers } }, x => { let t = ''; x.on('data', z => t += z); x.on('end', () => { let j; try { j = JSON.parse(t); } catch { j = { raw: t }; } res({ status: x.statusCode, body: j }); }); }); r.on('error', rej); r.end(body); }); }

test('QA-NODE-006: enrolled node needs agentVersion >=0.2.2 <0.3.0 (0.2.0 / 0.2.1 / missing / malformed / 0.3.0 → 426); 0.2.2 → 200', async () => {
  clock = Date.now(); const m = N.createNodeManager({ dir: tmp(), now: () => Date.now() }); const { d, s } = enrollFully(m);
  const srv = await N.listen(m, { host: '127.0.0.1', port: 0, insecureHttpForTests: true }); const port = srv.address().port;
  try { const hello = async info => { const b = Buffer.from(JSON.stringify({ info })); return call(port, 'POST', '/api/nodes/hello', s.token, b, sigHeaders(d, 'POST', '/api/nodes/hello', b)); };
    for (const v of ['0.2.0', '0.2.1', undefined, '', 'x.y.z', '0.3.0', '1.0.0']) { const r = await hello(v === undefined ? {} : { agentVersion: v }); assert.equal(r.status, 426, 'version ' + v); assert.equal(r.body.code, 'E_AGENT_VERSION'); assert.equal(r.body.agentVersionRange, N.ENROLLED_RANGE); }
    const ok = await hello({ agentVersion: '0.2.2' }); assert.equal(ok.status, 200); assert.equal(ok.body.protocol, 2);
    assert.equal(N.enrolledAgentOk('0.2.3'), true); assert.equal(N.agentOk('0.2.0'), true, 'legacy bearer-only range unchanged (legacy tokens are off by default in the server)');
  } finally { srv.close(); }
});

test('QA-NODE-001: a signed request captured before a coordinator restart is rejected by the new process (replay floor), fresh ones pass', () => {
  const dir = tmp(); clock = Date.now() - 10e3; const m1 = N.createNodeManager({ dir, now }); const { d, s } = enrollFully(m1);
  const p = '/api/nodes/pull'; const body = Buffer.from('{}'); const ts = clock; const nonce = nn(); const captured = { method: 'POST', path: p, ts, nonce, sig: sign(d.key, `POST\n${p}\n${ts}\n${nonce}\n${sha(body)}`), body };
  assert.ok(m1.authNode('Bearer ' + s.token, captured)); const o1 = {}; assert.equal(m1.authNode('Bearer ' + s.token, captured, o1), null); assert.equal(o1.code, 'E_REPLAY');
  fs.rmSync(path.join(dir, 'nodes.lock')); clock += 5e3; const m2 = N.createNodeManager({ dir, now }); // restart 5 s later: captured ts is still inside ±30 s
  const o2 = {}; assert.equal(m2.authNode('Bearer ' + s.token, captured, o2), null, 'captured request must not pass after restart'); assert.equal(o2.code, 'E_REPLAY');
  const ts2 = clock + 1, n2 = nn(); assert.ok(m2.authNode('Bearer ' + s.token, { method: 'POST', path: p, ts: ts2, nonce: n2, sig: sign(d.key, `POST\n${p}\n${ts2}\n${n2}\n${sha(body)}`), body }), 'fresh request after restart passes');
});

test('QA-NODE-002: default (no Tailscale Serve) — loopback X-Forwarded-For / Tailscale-User-Login are ignored, a local process cannot lock a named tailnet peer', async () => {
  clock = Date.now(); const W = { '100.80.0.1': { id: 'nIMAC', name: 'imac', login: 'igor@' } }; const m = N.createNodeManager({ dir: tmp(), now, whois: async ip => W[ip] || null });
  const req = (ra, h = {}) => ({ socket: { remoteAddress: ra }, headers: h });
  const spoof = await m.peerOf(req('127.0.0.1', { 'x-forwarded-for': '100.80.0.1', 'tailscale-user-login': 'igor@' })); assert.equal(spoof.key, 'loopback'); assert.equal(spoof.verified, false);
  const victim = await m.peerOf(req('100.80.0.1')); assert.equal(victim.key, 'tsnode:nIMAC'); assert.equal(victim.verified, true);
  const d = devKeys(); for (let i = 0; i < 10; i++) errCode(() => m.enrollment.enroll(enBody('ZZZZZ-22222-2222' + (i % 8 + 2), d), spoof));
  const r = m.enrollment.create({ role: 'news' }); assert.equal(m.enrollment.enroll(enBody(r.code, d), victim).status, 'pending', 'victim device is not locked by a local spoofer');
  const m2 = N.createNodeManager({ dir: tmp(), now, whois: async ip => W[ip] || null, trustServeHeaders: true }); assert.equal((await m2.peerOf(req('127.0.0.1', { 'x-forwarded-for': '100.80.0.1' }))).key, 'tsnode:nIMAC', 'Serve mode is opt-in');
});

test('QA-NODE-004 (coordinator): valid status polls of 2 nodes behind one bucket do not hit E_RATE_LIMIT; bad secrets still limited; per-request cap', () => {
  clock = Date.now(); const m = N.createNodeManager({ dir: tmp(), now }); const peer = { key: 'loopback', label: 'loopback', verified: false };
  const reqs = ['news', 'monitor'].map(role => { const d = devKeys(); const r = m.enrollment.create({ role }); return { d, e: m.enrollment.enroll(enBody(r.code, d), peer) }; });
  for (let i = 0; i < 40; i++) for (const { d, e } of reqs) { clock += 10; assert.deepEqual(m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ...stBody(d.key, e.requestId, clock) }, peer), { status: 'pending' }); } // 80 polls/min in one bucket
  const { d, e } = reqs[0]; for (let i = 40; i < 60; i++) { clock += 10; m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ...stBody(d.key, e.requestId, clock) }, peer); }
  clock += 10; assert.equal(errCode(() => m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ...stBody(d.key, e.requestId, clock) }, peer)), 'E_RATE_LIMIT', '61st poll of one request within a minute');
  const bad = []; for (let i = 0; i < 12; i++) bad.push(errCode(() => m.enrollment.status({ requestId: e.requestId, requestSecret: 'wrong', ...stBody(d.key, e.requestId, clock) }, peer)));
  assert.ok(bad.includes('E_IP_LOCKED'), 'bad secrets still lock the bucket: ' + bad.join(','));
  const r = m.enrollment.create({ role: 'news' }); assert.equal(errCode(() => m.enrollment.enroll(enBody(r.code, devKeys()), peer)), 'E_IP_LOCKED', 'code submissions stay locked');
});

test('signed node upload (enrolled): body hash verified after streaming — good → 200 + stored; tampered body → 422 (no file); bad signature → 401 (temp removed); no bearer → 401 (nothing written)', async () => {
  const dir = tmp(); clock = Date.now(); const m = N.createNodeManager({ dir, now: () => Date.now() }); const { d, s } = enrollFully(m);
  const srv = await N.listen(m, { host: '127.0.0.1', port: 0, insecureHttpForTests: true }); const port = srv.address().port; const files = () => fs.readdirSync(m.filesDir).sort();
  try { const data = crypto.randomBytes(300000); const h = sha(data); const p = '/api/nodes/files/' + h;
    const ok = await call(port, 'PUT', p, s.token, data, sigHeaders(d, 'PUT', p, data)); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.sha256, h); assert.deepEqual(files(), [h]);
    const evil = Buffer.concat([data, Buffer.from('X')]); const t = await call(port, 'PUT', p, s.token, evil, sigHeaders(d, 'PUT', p, evil)); assert.equal(t.status, 422);
    const other = devKeys(); const b = await call(port, 'PUT', '/api/nodes/files/' + sha(evil), s.token, evil, sigHeaders(other, 'PUT', '/api/nodes/files/' + sha(evil), evil)); assert.equal(b.status, 401);
    const nb = await call(port, 'PUT', '/api/nodes/files/' + sha(evil), 'nk_imac.wrong', evil, {}); assert.equal(nb.status, 401);
    await new Promise(r => setTimeout(r, 200)); assert.deepEqual(files(), [h], 'no temp or rejected files left: ' + files().join(','));
  } finally { srv.close(); }
});
