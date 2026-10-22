'use strict';
// QA-NODE-001 residual (r3): durable replay floor — no replay after a fast coordinator restart, incl. +skew future timestamps.
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

const P = '/api/nodes/pull', BODY = Buffer.from('{}');
const req = (d, ts, nonce = nn()) => ({ method: 'POST', path: P, ts, nonce, sig: sign(d.key, `POST\n${P}\n${ts}\n${nonce}\n${sha(BODY)}`), body: BODY });
const auth = (m, s, r) => { const o = {}; const ok = m.authNode('Bearer ' + s.token, r, o); return ok ? 'OK' : o.code; };
const restart = (dir, opts = {}) => { try { fs.rmSync(path.join(dir, 'nodes.lock')); } catch {} return N.createNodeManager({ dir, now, ...opts }); }; // crash-like: no clean shutdown

test('replay before restart is refused; after a FAST restart (1 ms … 2 s) captured requests with ts = now and ts = now+29 s are refused', () => {
  for (const gap of [1, 500, 2000]) {
    const dir = tmp(); clock = Date.now(); const m1 = N.createNodeManager({ dir, now }); const { d, s } = enrollFully(m1);
    const past = req(d, clock), future = req(d, clock + 29e3), skewMid = req(d, clock + 10e3);
    for (const r of [past, future, skewMid]) { assert.equal(auth(m1, s, r), 'OK'); assert.equal(auth(m1, s, r), 'E_REPLAY', 'replay in the same process'); }
    clock += gap; const m2 = restart(dir);
    for (const r of [past, future, skewMid]) assert.equal(auth(m2, s, r), 'E_REPLAY', `gap ${gap} ms, ts-now=${r.ts - clock}`);
    clock += 30e3; assert.equal(auth(m2, s, req(d, clock)), 'OK', 'service resumes');
  }
});

test('legit requests within the allowed skew are still accepted (before and after restart); outside ±30 s still refused', () => {
  const dir = tmp(); clock = Date.now(); const m1 = N.createNodeManager({ dir, now }); const { d, s } = enrollFully(m1); const b = enrollFully(m1, 'monitor'); clock += 60e3; /* coordinator has been up for a while */
  for (const sk of [-29e3, -5e3, 0, 5e3, 29e3]) assert.equal(auth(m1, s, req(d, clock + sk)), 'OK', 'skew ' + sk);
  for (const sk of [-31e3, 31e3]) assert.equal(auth(m1, s, req(d, clock + sk)), 'E_UNAUTHORIZED', 'skew ' + sk);
  clock += 10e3; const m2 = restart(dir);
  assert.equal(auth(m2, b.s, req(b.d, clock)), 'OK', 'another node is not blocked by node A future skew');
  assert.equal(auth(m2, s, req(d, clock + 25e3)), 'OK', 'A: new ts above its own high-water mark');
  assert.equal(auth(m2, b.s, req(b.d, clock - 5e3)), 'OK', 'B: slightly late clock, after the restart instant');
  assert.equal(auth(m2, b.s, req(b.d, clock - 8e3)), 'E_REPLAY', 'ts at/below the persisted clock floor is refused');
});

test('floor file: 0600, small, no secrets; coordinator clock moved back → fail closed (audit clock_back), then recovers', () => {
  const dir = tmp(); clock = Date.now(); const m1 = N.createNodeManager({ dir, now }); const { d, s } = enrollFully(m1);
  const old = req(d, clock); assert.equal(auth(m1, s, old), 'OK'); for (let i = 0; i < 200; i++) { clock += 50; assert.equal(auth(m1, s, req(d, clock)), 'OK'); }
  const f = path.join(dir, 'replay-floor.json'); assert.equal(fs.statSync(f).mode & 0o777, 0o600); const txt = fs.readFileSync(f, 'utf8');
  assert.ok(txt.length < 4096); assert.ok(!txt.includes(s.token) && !/nk_|sig|nonce/.test(txt), txt);
  const t0 = clock; clock -= 120e3; const m2 = restart(dir); // clock jumped back 2 min
  assert.equal(auth(m2, s, old), 'E_UNAUTHORIZED', 'old request outside window anyway'); const replayLike = req(d, clock); assert.equal(auth(m2, s, replayLike), 'E_REPLAY', 'everything refused while clock < floor');
  assert.match(fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8'), /clock_back/);
  clock = t0 + 4e3; assert.equal(auth(m2, s, req(d, clock)), 'OK', 'recovers once the clock passes the floor');
});

test('floor cannot be persisted → request refused (E_RATE_LIMIT, retryable), never accepted unpersisted', { skip: process.getuid && process.getuid() === 0 ? 'root ignores dir perms' : false }, () => {
  const dir = tmp(); clock = Date.now(); const m1 = N.createNodeManager({ dir, now }); const { d, s } = enrollFully(m1);
  fs.chmodSync(dir, 0o500); try { clock += 10e3; assert.equal(auth(m1, s, req(d, clock)), 'E_RATE_LIMIT'); } finally { fs.chmodSync(dir, 0o700); }
  assert.equal(auth(m1, s, req(d, clock)), 'OK');
});

test('missing or corrupt floor file → fall back to process start time (no replay of pre-restart requests)', () => {
  for (const bad of [null, '{garbage', '{"nowHwm":"x"}']) {
    const dir = tmp(); clock = Date.now(); const m1 = N.createNodeManager({ dir, now }); const { d, s } = enrollFully(m1); const r = req(d, clock); assert.equal(auth(m1, s, r), 'OK');
    const f = path.join(dir, 'replay-floor.json'); if (bad === null) fs.rmSync(f); else fs.writeFileSync(f, bad);
    clock += 1000; const m2 = restart(dir); assert.equal(auth(m2, s, r), 'E_REPLAY', String(bad)); assert.equal(auth(m2, s, req(d, clock)), 'OK');
  }
});

test('r4: injected write / file fsync / rename / directory fsync failures → request refused (429 code), previous floor intact, no .tmp left; later success persists', () => {
  for (const fail of ['writeSync', 'fsyncFile', 'renameSync', 'fsyncDir', 'openTmp']) {
    const dir = tmp(); clock = Date.now(); let armed = false; const err = () => Object.assign(new Error('injected ' + fail), { code: 'EIO' });
    const ffs = { ...fs,
      openSync: (p, ...a) => { if (armed && fail === 'openTmp' && String(p).endsWith('.tmp')) throw err(); return fs.openSync(p, ...a); },
      writeSync: (...a) => { if (armed && fail === 'writeSync') { fs.writeSync(a[0], '{"v":1,"nowHwm":1,"sc'); throw err(); } return fs.writeSync(...a); }, // partial write then error
      fsyncSync: fd => { const isDir = fs.fstatSync(fd).isDirectory(); if (armed && ((fail === 'fsyncDir' && isDir) || (fail === 'fsyncFile' && !isDir))) throw err(); return fs.fsyncSync(fd); },
      renameSync: (a, b) => { if (armed && fail === 'renameSync') throw err(); return fs.renameSync(a, b); } };
    const m = N.createNodeManager({ dir, now, floorFs: ffs }); const { d, s } = enrollFully(m); const f = path.join(dir, 'replay-floor.json');
    assert.equal(auth(m, s, req(d, clock)), 'OK'); const before = fs.readFileSync(f, 'utf8'); const prevHwm = JSON.parse(before).nowHwm;
    armed = true; clock += 10e3; const r = req(d, clock + 20e3); assert.equal(auth(m, s, r), 'E_RATE_LIMIT', fail + ': refused');
    assert.deepEqual(fs.readdirSync(dir).filter(x => x.endsWith('.tmp')), [], fail + ': no .tmp left');
    const now1 = JSON.parse(fs.readFileSync(f, 'utf8')); // always valid JSON (atomic rename)
    if (fail === 'fsyncDir') assert.ok(now1.nowHwm >= prevHwm, 'renamed new floor (higher), but durability unconfirmed → refused');
    else assert.equal(fs.readFileSync(f, 'utf8'), before, fail + ': previous replay-floor.json intact');
    clock += 10; assert.equal(auth(m, s, req(d, clock)), 'E_RATE_LIMIT', fail + ': still refused while the floor is unconfirmed (no unpersisted accept)');
    armed = false; assert.equal(auth(m, s, r), 'OK', fail + ': same request accepted once persistence works (it was never accepted before)');
    const after = JSON.parse(fs.readFileSync(f, 'utf8')); assert.ok(after.nowHwm >= clock && after.scopes['n:' + s.nodeId] === r.ts, fail + ': floor covers the accepted request');
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
    fs.rmSync(path.join(dir, 'nodes.lock')); const m2 = N.createNodeManager({ dir, now }); assert.equal(auth(m2, s, r), 'E_REPLAY', fail + ': no replay after restart');
  }
});
