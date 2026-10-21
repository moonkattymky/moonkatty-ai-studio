'use strict';
// Independent attack harness for MOONKATTY NODE 0.2.1 enrollment.
// Reads the feat/studio-operations tree at NODE_021_SRC (default /tmp/mk-node-021). Does not write there.
// Usage: node qa/reports/node-0.2.1/attack.cjs
// Child: node qa/reports/node-0.2.1/attack.cjs --tls-trust
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const http = require('http'), https = require('https'), net = require('net'), { spawn, execFileSync } = require('child_process');
const SRC = process.env.NODE_021_SRC || '/tmp/mk-node-021';
const N = require(path.join(SRC, 'lib/ops/nodes.js'));
const E = require(path.join(SRC, 'lib/ops/node-enroll.js'));
const EN = require(path.join(SRC, 'node-agent/enroll.js'));
const A = require(path.join(SRC, 'node-agent/agent.js'));
const SC = require(path.join(SRC, 'lib/ops/security-center.js'));
const sec = require(path.join(SRC, 'lib/security.js'));
const mountProtected = require(path.join(SRC, 'lib/ops/protected.js'));
const express = require('/workspace/node_modules/express');
const OUT = path.join(__dirname, 'attack-results.json');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'n021-'));
const devKeys = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { id: 'dev_' + crypto.randomBytes(16).toString('hex'), pub: publicKey.export({ type: 'spki', format: 'pem' }), key: privateKey }; };
const ridOf = code => String(code).toUpperCase().replace(/[\s-]/g, '').slice(0, 5);
const enBody = (code, d, info) => ({ code, deviceId: d.id, devicePubKey: d.pub, proof: EN.sign(d.key, `enroll:${ridOf(code)}:${d.id}`), info: info || { hostname: 'iMac-test', model: 'iMac18,3', os: 'macOS 13.7.1', arch: 'x64', agentVersion: '0.2.1' } });
const errOf = fn => { try { const v = fn(); return { ok: true, v }; } catch (e) { return { ok: false, code: e.code, message: e.message, status: e.status }; } };
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function median(xs) { const a = xs.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; }
function timeit(fn, n = 400) { for (let i = 0; i < 30; i++) fn(); const s = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); fn(); s.push(Number(process.hrtime.bigint() - t)); } return median(s); }
function jsonReq(mod, opts, body) {
  return new Promise((res, rej) => {
    const data = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = mod.request({ timeout: 8000, ...opts, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(opts.headers || {}) } }, resp => {
      const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => { const raw = Buffer.concat(c).toString('utf8'); let j = null; try { j = JSON.parse(raw); } catch {} res({ status: resp.statusCode, body: j, raw, headers: resp.headers }); });
    });
    req.on('error', rej); req.on('timeout', () => req.destroy(new Error('timeout'))); if (data) req.end(data); else req.end();
  });
}
const httpsJson = (url, opt) => { const u = new URL(url); return jsonReq(https, { method: opt.method || 'POST', hostname: u.hostname, port: u.port, path: opt.path, rejectUnauthorized: false, headers: opt.headers, servername: opt.servername }, opt.body); };
const httpJson = (port, opt) => jsonReq(http, { method: opt.method || 'POST', hostname: '127.0.0.1', port, path: opt.path, headers: opt.headers }, opt.body);
function signReq(key, method, p, body, ts) { const data = body == null ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); const t = ts == null ? Date.now() : ts; return { ts: String(t), sig: EN.sign(key, `${method}\n${p}\n${t}\n${sha256(data)}`), data }; }
async function tlsCoord(now = Date.now) { const dir = tmp('coord-'); const logs = []; const m = N.createNodeManager({ dir, now, log: (...x) => logs.push(x.join(' ')) }); const tlsc = N.ensureCert(dir);
  const srv = await N.listen(m, { host: '127.0.0.1', port: 0, tls: tlsc }); const url = `https://127.0.0.1:${srv.address().port}`;
  return { m, dir, logs, url, fp: tlsc.fingerprint, close: () => new Promise(r => { srv.closeAllConnections && srv.closeAllConnections(); srv.close(r); }) }; }
function kcEnv() { const d = tmp('kc-'); const bin = path.join(SRC, 'test/fixtures/fake-security.js'); return { NODE_KEYCHAIN_BIN: bin, FAKE_KC_FILE: path.join(d, 'kc.json'), FAKE_KC_ARGV: path.join(d, 'argv.log'), _dir: d }; }

async function tlsTrustChild() {
  const dir = tmp('ca-'); const caKey = path.join(dir, 'ca.key'), ca = path.join(dir, 'ca.pem'), key = path.join(dir, 'srv.key'), csr = path.join(dir, 'srv.csr'), crt = path.join(dir, 'srv.crt'), ext = path.join(dir, 'san.ext');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', caKey, '-out', ca, '-days', '2', '-nodes', '-subj', '/CN=AttackCA'], { stdio: 'ignore' });
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-keyout', key, '-out', csr, '-nodes', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
  fs.writeFileSync(ext, 'subjectAltName=IP:127.0.0.1\n');
  execFileSync('openssl', ['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-out', crt, '-days', '2', '-extfile', ext], { stdio: 'ignore' });
  const hits = [];
  const srv = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(crt) }, (q, s) => { const c = []; q.on('data', d => c.push(d)); q.on('end', () => { hits.push({ url: q.url, body: Buffer.concat(c).toString('utf8').slice(0, 200) }); s.writeHead(403); s.end('{"error":"stop"}'); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port; const url = `https://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: ca, NODE_KEYCHAIN_BIN: path.join(SRC, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(dir, 'kc.json'), FAKE_KC_ARGV: path.join(dir, 'argv.log') };
  const home = path.join(dir, 'home'); const code = '23456-789GH-JKMNP';
  const run = tlsMode => new Promise(resolve => { const p = spawn(process.execPath, ['-e', `
    const EN = require(${JSON.stringify(path.join(SRC, 'node-agent/enroll.js'))});
    EN.enroll({ url: ${JSON.stringify(url)}, code: ${JSON.stringify(code)}, tlsMode: ${JSON.stringify(tlsMode)}, fingerprint: ${JSON.stringify('ab'.repeat(32))}, home: ${JSON.stringify(home + tlsMode)}, env: process.env, pollMs: 50, maxWaitMs: 1000 })
      .then(r => { console.log(JSON.stringify({ ok: true, r })); process.exit(0); })
      .catch(e => { console.log(JSON.stringify({ ok: false, code: e.code || null, message: String(e.message).slice(0, 240) })); process.exit(0); });
  `], { env }); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => { let j = null; try { j = JSON.parse(o.trim().split('\n').pop()); } catch { j = { raw: o.slice(0, 400) }; } resolve(j); }); });
  const forced = await run('tailscale'); const hitsAfterForced = hits.length;
  const pinned = await run('pinned'); const hitsAfterPinned = hits.length;
  const insecure = await new Promise(resolve => { const p = spawn(process.execPath, ['-e', `
    const EN = require(${JSON.stringify(path.join(SRC, 'node-agent/enroll.js'))});
    EN.enroll({ url: ${JSON.stringify(url)}, code: ${JSON.stringify(code)}, tlsMode: 'tailscale', home: ${JSON.stringify(home + 'insec')}, env: process.env, pollMs: 50, maxWaitMs: 1000 })
      .then(() => process.exit(0)).catch(e => { console.log(JSON.stringify({ code: e.code || null, message: String(e.message).slice(0, 220) })); process.exit(0); });
  `], { env: { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_EXTRA_CA_CERTS: '' } }); let o = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => o += d); p.on('close', () => { try { resolve(JSON.parse(o.trim().split('\n').pop())); } catch { resolve({ raw: o.slice(0, 400) }); } }); });
  const hitsAfterInsecure = hits.length;
  const insecurePinned = await new Promise(resolve => { const p = spawn(process.execPath, ['-e', `
    const EN = require(${JSON.stringify(path.join(SRC, 'node-agent/enroll.js'))});
    EN.enroll({ url: ${JSON.stringify(url)}, code: ${JSON.stringify(code)}, fingerprint: ${JSON.stringify('cd'.repeat(32))}, home: ${JSON.stringify(home + 'insec2')}, env: process.env, pollMs: 50, maxWaitMs: 1000 })
      .then(() => process.exit(0)).catch(e => { console.log(JSON.stringify({ code: e.code || null, message: String(e.message).slice(0, 220) })); process.exit(0); });
  `], { env: { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_EXTRA_CA_CERTS: '' } }); let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => { try { resolve(JSON.parse(o.trim().split('\n').pop())); } catch { resolve({ raw: o.slice(0, 300) }); } }); });
  await new Promise(r => srv.close(r));
  console.log(JSON.stringify({ port, forced, pinned, insecure, insecurePinned, hits, hitsAfterForced, hitsAfterPinned, hitsAfterInsecure, hitsAfterInsecurePinned: hits.length }));
}

if (process.argv[2] === '--tls-trust') { tlsTrustChild().catch(e => { console.error(e); process.exit(1); }); }
else main().catch(e => { console.error(e); process.exit(1); });

async function main() {
  const commit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const rows = [];
  const rec = row => { rows.push(row); console.log(`${row.ok ? 'ok  ' : 'FAIL'} ${row.id}`); if (!row.ok) console.log('    ' + JSON.stringify(row.detail).slice(0, 500)); };
  const mgr = (now = () => Date.now()) => N.createNodeManager({ dir: tmp('m-'), now, log: () => {} });

  // ----- brute force across restart, binding -----
  {
    let clock = Date.now(); const dir = tmp('rst-');
    const m1 = N.createNodeManager({ dir, now: () => clock }); const d = devKeys();
    const r = m1.enrollment.create({ role: 'news', name: 'iMac' });
    const wrongs = [];
    for (let i = 0; i < 5; i++) wrongs.push(errOf(() => m1.enrollment.enroll(enBody(r.requestId + '-22222-2222' + (i + 2), d), '10.9.0.1')).code);
    const m2 = N.createNodeManager({ dir, now: () => clock });
    const after = errOf(() => m2.enrollment.enroll(enBody(r.code, d), '10.9.0.2'));
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8'));
    const blob = JSON.stringify(st);
    rec({ id: 'request-lock-survives-restart', kind: 'control', ok: wrongs[4] === 'E_REQUEST_LOCKED' && after.code === 'E_REQUEST_LOCKED' && !blob.includes(r.code.replace(/-/g, '').slice(5)), detail: { wrongs, after: after.code, codeInState: blob.includes(r.code.slice(6, 11)) } });
    const ip = '10.8.8.8';
    for (let i = 0; i < 10; i++) errOf(() => m2.enrollment.enroll(enBody('23456-22222-22222', d), ip));
    const locked = errOf(() => m2.enrollment.enroll(enBody('23456-22222-22223', d), ip));
    const m3 = N.createNodeManager({ dir, now: () => clock });
    const reset = errOf(() => m3.enrollment.enroll(enBody('23456-22222-22224', d), ip));
    const bucket = m3.enrollment._ip[ip] || {};
    rec({ id: 'ip-lock-resets-on-new-process', kind: 'probe', ok: locked.code === 'E_IP_LOCKED' && reset.code === 'E_CODE_INVALID' && !(bucket.lockedUntil > clock), detail: { locked: locked.code, afterRestart: reset.code, lockedUntil: bucket.lockedUntil || 0, fails: (bucket.fails || []).length } });
    const a = m3.enrollment.create({ role: 'news', nodeId: 'imac' }); const b = m3.enrollment.create({ role: 'monitor', nodeId: 'macbook' });
    const mixed = b.requestId + a.code.slice(5);
    const swap = errOf(() => m3.enrollment.enroll(enBody(mixed, d), '10.7.0.1'));
    const unicodeDash = errOf(() => m3.enrollment.enroll(enBody(a.code.replace('-', '\u2013'), d), '10.7.0.2'));
    const lower = errOf(() => m3.enrollment.enroll(enBody(a.code.toLowerCase(), d), '10.7.0.3'));
    const badProof = enBody(b.code, d); badProof.proof = EN.sign(devKeys().key, `enroll:${b.requestId}:${d.id}`);
    const proof = errOf(() => m3.enrollment.enroll(badProof, '10.7.0.4'));
    const still = errOf(() => m3.enrollment.enroll(enBody(b.code, d), '10.7.0.5'));
    rec({ id: 'request-binding-and-bad-proof', kind: 'control', ok: swap.code === 'E_CODE_INVALID' && unicodeDash.code === 'E_CODE_INVALID' && lower.ok && lower.v.status === 'pending' && proof.code === 'E_BAD_SIGNATURE' && still.ok, detail: { swap: swap.code, unicodeDash: unicodeDash.code, lower: lower.ok ? lower.v.status : lower.code, badProof: proof.code, retryAfterBadProof: still.ok ? still.v.status : still.code } });
  }

  // ----- TTL boundary and single-use -----
  {
    let clock = 1_700_000_000_000; const m = N.createNodeManager({ dir: tmp('ttl-'), now: () => clock }); const d = devKeys();
    const r = m.enrollment.create({ role: 'news' }); const exp = m._state.enroll[r.requestId].expiresAt;
    clock = exp; const at = errOf(() => m.enrollment.enroll(enBody(r.code, d), '10.6.0.1'));
    const r2 = m.enrollment.create({ role: 'monitor' }); const exp2 = m._state.enroll[r2.requestId].expiresAt;
    clock = exp2 + 1; const past = errOf(() => m.enrollment.enroll(enBody(r2.code, d), '10.6.0.2'));
    rec({ id: 'ttl-boundary', kind: 'control', ok: at.ok && at.v.status === 'pending' && past.code === 'E_CODE_EXPIRED', detail: { atExpiry: at.ok ? at.v.status : at.code, oneMsLate: past.code, expiresAt: exp } });
    const r3 = m.enrollment.create({ role: 'news' }); const e = m.enrollment.enroll(enBody(r3.code, d), '10.6.0.3'); m.enrollment.confirm(r3.requestId);
    const call = () => { const ts = clock; return m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts, sig: EN.sign(d.key, `status:${e.requestId}:${ts}`) }, '10.6.0.3'); };
    const first = call(); const second = errOf(call);
    const again = errOf(() => m.enrollment.enroll(enBody(r3.code, d), '10.6.0.9'));
    rec({ id: 'single-use-in-process', kind: 'control', ok: first.status === 'enrolled' && !!first.token && second.code === 'E_NOT_FOUND' && again.code === 'E_CODE_USED', detail: { first: first.status, second: second.code, reuseCode: again.code } });
    const dir = m._state && tmp('race-');
  }
  {
    let clock = Date.now(); const dir = tmp('two-');
    const m1 = N.createNodeManager({ dir, now: () => clock }); const d = devKeys();
    const r = m1.enrollment.create({ role: 'news' }); const e = m1.enrollment.enroll(enBody(r.code, d), '10.6.1.1'); m1.enrollment.confirm(r.requestId);
    const m2 = N.createNodeManager({ dir, now: () => clock });
    const ts = clock; const body = { requestId: e.requestId, requestSecret: e.requestSecret, ts, sig: EN.sign(d.key, `status:${e.requestId}:${ts}`) };
    const t1 = m1.enrollment.status(body, '10.6.1.1'); const t2 = errOf(() => m2.enrollment.status(body, '10.6.1.1'));
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8'));
    const h1 = sha256(t1.token), h2 = t2.ok ? sha256(t2.v.token) : null;
    rec({ id: 'two-managers-same-file', kind: 'probe', ok: true, detail: { t1: t1.status, t2: t2.ok ? t2.v.status : t2.code, storedIsT1: st.nodes.imac && st.nodes.imac.tokenHash === h1, storedIsT2: st.nodes.imac && st.nodes.imac.tokenHash === h2, tokensDiffer: t2.ok ? t1.token !== t2.v.token : null } });
  }

  // ----- real TLS: XFF, races, replay, canonicalisation, revoke, rotate -----
  const c = await tlsCoord();
  try {
    const d = devKeys(); let httpHits = 0; const orig = c.m.handler;
    const bad = { code: 'NOPE' };
    const xff = [];
    for (let i = 0; i < 10; i++) xff.push(await httpsJson(c.url, { path: '/api/nodes/enroll', headers: { 'x-forwarded-for': '8.8.8.8', 'x-real-ip': '9.9.9.9', forwarded: 'for=1.2.3.4' }, body: bad }));
    const eleventh = await httpsJson(c.url, { path: '/api/nodes/enroll', headers: { 'x-forwarded-for': '1.1.1.1' }, body: bad });
    const bucketsBeforeDirect = Object.keys(c.m.enrollment._ip);
    const spoofedDirect = errOf(() => c.m.enrollment.enroll(enBody('23456-33333-33333', d), '8.8.8.8'));
    rec({ id: 'xff-does-not-select-bucket', kind: 'control', ok: xff.filter(x => x.body && x.body.code === 'E_CODE_INVALID').length === 10 && eleventh.body.code === 'E_IP_LOCKED' && spoofedDirect.code === 'E_CODE_INVALID' && bucketsBeforeDirect.join(',') === '127.0.0.1' && c.m.enrollment._ip['127.0.0.1'].lockedUntil > Date.now(), detail: { tenth: xff[9].body && xff[9].body.code, eleventh: eleventh.body && eleventh.body.code, directSpoofedIp: spoofedDirect.code, bucketsBeforeDirect } });

    const fresh = await tlsCoord();
    try {
      const d1 = devKeys(), d2 = devKeys(); const r = fresh.m.enrollment.create({ role: 'news', name: '<b>iMac</b>' });
      const pair = await Promise.all([
        httpsJson(fresh.url, { path: '/api/nodes/enroll', body: enBody(r.code, d1, { hostname: '<img src=x onerror=alert(1)>', model: '<svg/onload=alert(1)>', os: "O'S", arch: 'x64' }) }),
        httpsJson(fresh.url, { path: '/api/nodes/enroll', body: enBody(r.code, d2) })
      ]);
      const codes = pair.map(p => p.body && (p.body.status || p.body.code)).sort();
      rec({ id: 'parallel-enroll-single-winner', kind: 'control', ok: codes.includes('pending') && (codes.includes('E_CODE_USED') || codes.includes('E_CODE_INVALID') || codes.includes('E_REQUEST_LOCKED')), detail: { codes, http: pair.map(p => p.status) } });
      const pending = fresh.m.enrollment.list().find(q => q.state === 'pending');
      fresh.m.enrollment.confirm(pending.requestId);
      const secret = pair.find(p => p.body && p.body.requestSecret).body.requestSecret;
      const winner = pair[0].body && pair[0].body.requestSecret ? d1 : d2;
      const ts = Date.now();
      const sb = { requestId: pending.requestId, requestSecret: secret, ts, sig: EN.sign(winner.key, `status:${pending.requestId}:${ts}`) };
      const both = await Promise.all([
        httpsJson(fresh.url, { path: '/api/nodes/enroll/status', body: sb }),
        httpsJson(fresh.url, { path: '/api/nodes/enroll/status', body: { ...sb, ts: ts + 1, sig: EN.sign(winner.key, `status:${pending.requestId}:${ts + 1}`) } })
      ]);
      const tokens = both.map(x => x.body && x.body.token).filter(Boolean);
      rec({ id: 'parallel-status-one-token', kind: 'control', ok: tokens.length === 1 && both.map(x => x.body && (x.body.status || x.body.code)).sort().join(',') === 'E_NOT_FOUND,enrolled', detail: { results: both.map(x => x.body && (x.body.status || x.body.code)), tokenCount: tokens.length } });
      const token = tokens[0]; const nodeId = both.find(x => x.body && x.body.token).body.nodeId;
      const stFile = fs.readFileSync(path.join(fresh.dir, 'nodes.json'), 'utf8');
      const audit = JSON.stringify(fresh.m.audit());
      rec({ id: 'secrets-absent-from-state-and-audit', kind: 'control', ok: !stFile.includes(token) && !stFile.includes(secret) && !stFile.includes(r.code.slice(6)) && !audit.includes(token) && !audit.includes(secret) && stFile.includes(sha256(token)), detail: { mode: (fs.statSync(path.join(fresh.dir, 'nodes.json')).mode & 0o777).toString(8), tokenInFile: stFile.includes(token), secretInFile: stFile.includes(secret), hashPresent: stFile.includes(sha256(token)) } });

      const ping = async (method, p, body, extra) => { const s = signReq(winner.key, method, p, body, extra && extra.ts); const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
        return httpsJson(fresh.url, { method: extra && extra.httpMethod || method, path: extra && extra.urlPath || p, body: extra && extra.raw ? extra.raw : data, headers: { authorization: 'Bearer ' + (extra && extra.token || token), 'x-node-ts': extra && extra.tsHeader || s.ts, 'x-node-sig': extra && extra.sig || s.sig, ...(extra && extra.headers || {}) } }); };
      fresh.m.submit({ capability: 'news.collect', input: { n: 1 } }); fresh.m.submit({ capability: 'news.collect', input: { n: 2 } });
      const body = { info: { agentVersion: '0.2.1' } }; const s = signReq(winner.key, 'POST', '/api/nodes/pull', body);
      const p1 = await httpsJson(fresh.url, { path: '/api/nodes/pull', body, headers: { authorization: 'Bearer ' + token, 'x-node-ts': s.ts, 'x-node-sig': s.sig } });
      const p2 = await httpsJson(fresh.url, { path: '/api/nodes/pull', body, headers: { authorization: 'Bearer ' + token, 'x-node-ts': s.ts, 'x-node-sig': s.sig } });
      const late = await ping('POST', '/api/nodes/pull', body, { ts: Date.now() + 121000 });
      const early = await ping('POST', '/api/nodes/pull', body, { ts: Date.now() - 121000 });
      rec({ id: 'signed-pull-replay-window', kind: 'probe', ok: true, detail: { first: p1.body && p1.body.job && p1.body.job.id, replay: p2.body && p2.body.job && p2.body.job.id, sameJob: p1.body && p2.body && p1.body.job && p2.body.job && p1.body.job.id === p2.body.job.id, replayStatus: p2.status, future: late.status, past: early.status, futureCode: late.body && late.body.code, pastCode: early.body && early.body.code } });

      const lower = await ping('get', '/api/nodes/ping', null, { httpMethod: 'GET' });
      const spaced = await ping('GET', '/api/nodes/ping ', null, { httpMethod: 'GET', urlPath: '/api/nodes/ping' });
      const crlf = (() => { const ts = Date.now(); const msg = `GET\r\n/api/nodes/ping\r\n${ts}\r\n${sha256(Buffer.alloc(0))}`; return { ts, sig: EN.sign(winner.key, msg) }; })();
      const crlfRes = await httpsJson(fresh.url, { method: 'GET', path: '/api/nodes/ping', headers: { authorization: 'Bearer ' + token, 'x-node-ts': String(crlf.ts), 'x-node-sig': crlf.sig } });
      const good = await ping('GET', '/api/nodes/ping', null, { httpMethod: 'GET' });
      const query = await ping('GET', '/api/nodes/ping', null, { httpMethod: 'GET', urlPath: '/api/nodes/ping?injected=1' });
      const noSig = await httpsJson(fresh.url, { method: 'GET', path: '/api/nodes/ping', headers: { authorization: 'Bearer ' + token } });
      const other = await ping('GET', '/api/nodes/ping', null, { httpMethod: 'GET', sig: EN.sign(devKeys().key, `GET\n/api/nodes/ping\n${Date.now()}\n${sha256(Buffer.alloc(0))}`), tsHeader: String(Date.now()) });
      const qpath = new URL('/api/nodes/ping/../ping', 'http://x').pathname;
      const dot = await ping('GET', qpath, null, { httpMethod: 'GET', urlPath: '/api/nodes/ping/../ping' });
      const enc = new URL('/api/nodes/%2e%2e/ping', 'http://x').pathname;
      rec({ id: 'signature-canonicalisation', kind: 'control', ok: good.status === 200 && lower.status === 401 && spaced.status === 401 && crlfRes.status === 401 && noSig.status === 401 && other.status === 401 && query.status === 200, detail: { good: good.status, lowerMethod: lower.status, pathSpace: spaced.status, crlf: crlfRes.status, noSig: noSig.status, otherKey: other.status, dotPathname: qpath, dotStatus: dot.status, encodedPathname: enc, querySignedWithoutQuery: query.status, queryBody: query.body && query.body.ok } });

      const rot = await ping('POST', '/api/nodes/rotate', {});
      const oldPing = await ping('GET', '/api/nodes/ping', null, { httpMethod: 'GET' });
      const neu = rot.body && rot.body.token;
      const newPing = neu ? await ping('GET', '/api/nodes/ping', null, { httpMethod: 'GET', token: neu }) : null;
      fresh.m.revokeNode(nodeId);
      const dead = neu ? await ping('GET', '/api/nodes/ping', null, { httpMethod: 'GET', token: neu }) : null;
      rec({ id: 'self-rotate-and-revoke', kind: 'probe', ok: true, detail: { rotateStatus: rot.status, rotateHadPending: false, oldAfterRotate: oldPing.status, newToken: newPing && newPing.status, afterRevoke: dead && dead.status, tokenInState: fs.readFileSync(path.join(fresh.dir, 'nodes.json'), 'utf8').includes(neu || 'no-token') } });

      const view = fresh.m.enrollment.list().find(q => q.device);
      rec({ id: 'api-view-has-full-fingerprint', kind: 'probe', ok: true, detail: { sample: view ? { pubKeyShort: view.device.pubKeyShort, pubKeyFingerprint: view.device.pubKeyFingerprint, hostname: view.device.hostname } : null } });
    } finally { await fresh.close(); }

    // plaintext 426 and pin
    const plainDir = tmp('plain-'); const pm = N.createNodeManager({ dir: plainDir, now: () => Date.now() });
    const ps = http.createServer(pm.handler()); await new Promise(r => ps.listen(0, '127.0.0.1', r));
    const plain = await httpJson(ps.address().port, { path: '/api/nodes/enroll', body: { code: '23456-789GH-JKMNP' } });
    ps.close();
    rec({ id: 'plaintext-enroll-426', kind: 'control', ok: plain.status === 426 && plain.body.code === 'E_TLS_REQUIRED', detail: plain.body });

    const kc = kcEnv(); const home = tmp('home-');
    let pinErr = null; try { await EN.enroll({ url: c.url, fingerprint: 'ab'.repeat(32), code: '23456-789GH-JKMNP', home, env: kc, pollMs: 50, maxWaitMs: 2000 }); } catch (e) { pinErr = { code: e.code, message: e.message }; }
    const accepted = c.m.audit().some(a => a.type === 'code_accepted');
    rec({ id: 'wrong-pin-sends-no-enrollment', kind: 'control', ok: pinErr && pinErr.code === 'E_PIN' && !accepted && !fs.existsSync(path.join(home, 'device.json')), detail: { pinErr, accepted, deviceFile: fs.existsSync(path.join(home, 'device.json')) } });

    let tsErr = null; const before = c.m.audit().length;
    try { await EN.enroll({ url: c.url, tlsMode: 'tailscale', code: '23456-789GH-JKMNP', home: tmp('ts-'), env: kc, pollMs: 50, maxWaitMs: 2000 }); } catch (e) { tsErr = { code: e.code || null, message: String(e.message).slice(0, 200) }; }
    rec({ id: 'tailscale-mode-on-self-signed-ip', kind: 'probe', ok: true, detail: { error: tsErr, newAudit: c.m.audit().length - before } });

    let clientErr = null; try { A.client({ url: 'https://127.0.0.1:1', tlsMode: 'tailscale', token: 'nk_imac.abcdefghijklmnopqrstuv' }); } catch (e) { clientErr = e.message; }
    rec({ id: 'client-tailscale-requires-ts-net', kind: 'control', ok: /ts\.net/.test(clientErr || ''), detail: { message: clientErr } });

    let httpHits2 = 0; const hs = http.createServer((q, s) => { httpHits2++; s.end('no'); }); await new Promise(r => hs.listen(0, '127.0.0.1', r));
    let httpErr = null; try { await EN.enroll({ url: 'http://127.0.0.1:' + hs.address().port, code: '23456-789GH-JKMNP', home: tmp('http-'), env: kc }); } catch (e) { httpErr = e.code; }
    hs.close();
    rec({ id: 'http-url-never-connects', kind: 'control', ok: httpErr === 'E_TLS_REQUIRED' && httpHits2 === 0, detail: { code: httpErr, hits: httpHits2 } });
  } finally { await c.close(); }

  // trusted-CA child: does explicit tlsMode skip the pin?
  {
    const child = spawn(process.execPath, [__filename, '--tls-trust'], { env: process.env });
    let o = ''; child.stdout.on('data', d => o += d); child.stderr.on('data', d => o += d);
    const code = await new Promise(r => child.on('close', r));
    let parsed = null; try { parsed = JSON.parse(o.trim().split('\n').filter(Boolean).pop()); } catch { parsed = { raw: o.slice(0, 800), exit: code }; }
    rec({ id: 'pin-skip-with-locally-trusted-cert', kind: 'probe', ok: true, detail: parsed });
  }

  // ----- address matrix -----
  {
    const cases = ['127.0.0.1', '10.0.0.1', '192.168.0.1', '172.16.0.1', '172.31.255.255', '100.64.0.1', '100.127.255.255', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:abcd::2', 'FD7A:115C:A1E0::1',
      '0.0.0.0', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.15.255.255', '172.32.0.1', '192.168.1.256', '100.64.999.1', '1.2.3', '127.1', '127.0.0.01', '0177.0.0.1', '0x7f.0.0.1', '2130706433', '127.0.0.1.',
      '::ffff:127.0.0.1', '::ffff:100.64.0.1', '::ffff:8.8.8.8', '::1', 'fd00::1', 'fe80::1', 'localhost', 'imac.tailnet.ts.net', '127.0.0.1.attacker.test', '[fd7a:115c:a1e0::1]'];
    const table = cases.map(h => ({ h, priv: N.isPrivateIPv4(h), ip: net.isIP(h) }));
    const rejected = [];
    for (const h of ['0.0.0.0', '8.8.8.8', '::ffff:8.8.8.8', '::ffff:100.64.0.1', '0177.0.0.1', '2130706433', 'localhost', 'imac.tailnet.ts.net', '127.0.0.1.attacker.test']) {
      let msg = null; try { await N.listen(mgr(), { host: h, port: 0, insecureHttpForTests: true }); msg = 'LISTENED'; } catch (e) { msg = e.message.slice(0, 80); }
      rejected.push({ h, msg });
    }
    const allow = table.filter(x => ['127.0.0.1', '10.0.0.1', '100.64.0.1', '100.127.255.255', 'fd7a:115c:a1e0::1'].includes(x.h)).every(x => x.priv);
    const deny = table.filter(x => ['0.0.0.0', '8.8.8.8', '::ffff:8.8.8.8', '::ffff:100.64.0.1', '0177.0.0.1', '2130706433', '127.1', 'localhost', 'fd00::1', '100.128.0.1'].includes(x.h)).every(x => !x.priv);
    rec({ id: 'address-matrix', kind: 'control', ok: allow && deny && rejected.every(x => x.msg !== 'LISTENED'), detail: { table, rejected } });
  }

  // ----- approval UI: XSS, fingerprint, local CSRF -----
  {
    const appSrc = fs.readFileSync(path.join(SRC, 'public/app.js'), 'utf8');
    const escLine = appSrc.split('\n').find(l => l.startsWith('const esc = ')) || '';
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    if (escLine.trim() !== 'const esc = ' + esc.toString() + ';') throw new Error('esc() in app.js changed: ' + escLine);
    const q = { name: '<script>alert(1)</script>', nodeId: 'imac"><script>', role: 'news', state: 'pending', reenroll: false, requestId: 'ABCDE',
      device: { deviceId: 'dev_' + 'a'.repeat(32), hostname: '"><img src=x onerror=alert(1)>', model: '<svg/onload=alert(1)>', os: "O'S", arch: 'x64', pubKeyShort: 'ABCD-EF01-2345-6789', ip: '100.1.1.1' } };
    const html = `<div class="row small"><b>${esc(q.name)}</b> <span class="mut">${esc(q.nodeId)} · ${esc(q.role)} · ${esc(q.state)}</span>
        ${q.device ? `<div class="mut">deviceId ${esc(q.device.deviceId)} · ${esc(q.device.hostname)} · ${esc(q.device.model)} · ${esc(q.device.os)} · ${esc(q.device.arch)} · ключ ${esc(q.device.pubKeyShort)} · IP ${esc(q.device.ip)}</div>` : ''}
        <button class="btn sm" data-enc="${esc(q.requestId)}">Подтвердить</button></div>`;
    const ui = fs.readFileSync(path.join(SRC, 'public/ops-ui.js'), 'utf8');
    const page = fs.readFileSync(path.join(SRC, 'node-agent/enroll.html'), 'utf8');
    const confirmCall = (ui.split('\n').find(l => l.includes("confirm('Подтвердить")) || '').trim();
    rec({ id: 'approval-ui-escapes-and-fingerprint', kind: 'probe', ok: true, detail: {
      escaped: !html.includes('<script>alert') && html.includes('&lt;script&gt;') && html.includes('&quot;&gt;&lt;img') && html.includes('&#39;'),
      templateUsesEsc: /esc\(q\.device\.hostname\)/.test(ui) && /esc\(q\.device\.model\)/.test(ui) && /esc\(r\.code\)/.test(ui),
      templateShowsShortOnly: /pubKeyShort/.test(ui) && !/pubKeyFingerprint/.test(ui),
      confirmText: confirmCall.slice(0, 280),
      confirmInterpolatesFingerprint: /pubKey|fingerprint/.test(confirmCall),
      enrollHtmlUsesTextContent: page.includes('textContent') && !page.includes('innerHTML'),
      enrollHtmlShowsDeviceId: page.includes('deviceId'),
      enrollHtmlShowsDeviceKey: /pubKey|отпечаток ключа/.test(page),
      enrollHtmlCertField: page.includes('Отпечаток сертификата')
    } });

    const uiSrv = A.enrollUi(0); await sleep(50); const port = uiSrv.address().port;
    const home = await httpJson(port, { method: 'GET', path: '/' });
    const tok = (home.raw.match(/const T='([a-f0-9]+)'/) || [])[1];
    const badHost = await jsonReq(http, { method: 'GET', hostname: '127.0.0.1', port, path: '/', headers: { host: 'evil.example' } });
    const rebind = await jsonReq(http, { method: 'GET', hostname: '127.0.0.1', port, path: '/', headers: { host: '127.0.0.1.attacker.test' } });
    const local = await jsonReq(http, { method: 'GET', hostname: '127.0.0.1', port, path: '/', headers: { host: 'localhost:' + port } });
    const noHdr = await httpJson(port, { path: '/enroll', headers: { host: '127.0.0.1:' + port }, body: { code: 'x', url: 'http://127.0.0.1/', fingerprint: '' } });
    const okHdr = await httpJson(port, { path: '/enroll', headers: { host: '127.0.0.1:' + port, 'x-node-local': tok }, body: { code: '23456-789GH-JKMNP', url: 'http://127.0.0.1:9', fingerprint: 'ab' } });
    await sleep(80); uiSrv.close();
    rec({ id: 'enroll-ui-host-and-local-token', kind: 'control', ok: badHost.status === 421 && rebind.status === 421 && local.status === 200 && noHdr.status === 403 && okHdr.status === 202 && tok && tok.length === 32, detail: { badHost: badHost.status, rebind: rebind.status, local: local.status, missingHeader: noHdr.status, withHeader: okHdr.status } });
  }

  // ----- admin authz + CSRF -----
  {
    const dir = tmp('adm-'); const m = N.createNodeManager({ dir, now: () => Date.now(), log: () => {} });
    const app = express(); const portP = 8799;
    app.use(sec.hostCheck(portP));
    app.use('/api', sec.csrfCheck(portP));
    app.use(express.json({ limit: '200kb' }));
    const sessions = new Map(); const hashTok = t => crypto.createHash('sha256').update(t).digest('hex');
    const cookie = crypto.randomBytes(16).toString('hex'); sessions.set(hashTok(cookie), { user: 'owner', exp: Date.now() + 3600e3 });
    app.use('/api', (req, res, next) => {
      if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
      const mm = /(?:^|;\s*)mk_session=([a-f0-9]+)/.exec(req.headers.cookie || ''); const s = mm && sessions.get(hashTok(mm[1]));
      if (!s || s.exp < Date.now()) return res.status(401).json({ error: 'auth required' }); req.user = s.user; next();
    });
    mountProtected(app, { nodes: m, flags: {}, log: () => {}, dataDir: dir, q: { meta: { get: () => null } } });
    const srv = http.createServer(app); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;
    const host = `127.0.0.1:${portP}`;
    const call = (opt) => httpJson(port, { method: opt.method || 'POST', path: opt.path, headers: { host, ...(opt.headers || {}) }, body: opt.body });
    const none = await call({ path: '/api/ops/nodes/enroll', body: { role: 'news', name: 'iMac' } });
    const noCsrf = await call({ path: '/api/ops/nodes/enroll', headers: { cookie: 'mk_session=' + cookie }, body: { role: 'news', name: 'iMac' } });
    const evil = await call({ path: '/api/ops/nodes/enroll', headers: { cookie: 'mk_session=' + cookie, 'x-studio-request': '1', origin: 'https://evil.test' }, body: { role: 'news' } });
    const nul = await call({ path: '/api/ops/nodes/enroll', headers: { cookie: 'mk_session=' + cookie, 'x-studio-request': '1', origin: 'null' }, body: { role: 'news' } });
    const sfs = await call({ path: '/api/ops/nodes/enroll', headers: { cookie: 'mk_session=' + cookie, 'x-studio-request': '1', 'sec-fetch-site': 'cross-site' }, body: { role: 'news' } });
    const bearer = await call({ path: '/api/ops/nodes/enroll', headers: { authorization: 'Bearer nk_imac.abcdefghijklmnopqrstuv', 'x-studio-request': '1' }, body: { role: 'news' } });
    const ok = await call({ path: '/api/ops/nodes/enroll', headers: { cookie: 'mk_session=' + cookie, 'x-studio-request': '1', origin: 'http://127.0.0.1:' + portP }, body: { role: 'news', name: '<script>alert(1)</script>' } });
    const d = devKeys(); const enrolled = m.enrollment.enroll(enBody(ok.body.code, d), '100.70.2.2');
    const confirm = await call({ path: '/api/ops/nodes/enroll/' + enrolled.requestId + '/confirm', headers: { cookie: 'mk_session=' + cookie, 'x-studio-request': '1', origin: 'http://127.0.0.1:' + portP }, body: {} });
    const cls = SC.classify({ path: '/api/ops/nodes/enroll/' + enrolled.requestId + '/confirm', method: 'POST', body: {} });
    const clsR = SC.classify({ path: '/api/ops/nodes/imac/revoke', method: 'POST', body: {} });
    const getNo = await call({ method: 'GET', path: '/api/ops/nodes/enroll' });
    const hostBad = await httpJson(port, { method: 'POST', path: '/api/ops/nodes/enroll', headers: { host: 'evil.example', cookie: 'mk_session=' + cookie, 'x-studio-request': '1' }, body: { role: 'news' } });
    const reg = await call({ path: '/api/ops/nodes', headers: { cookie: 'mk_session=' + cookie, 'x-studio-request': '1', origin: 'http://127.0.0.1:' + portP }, body: { id: 'macbook', role: 'monitor', name: 'mb' } });
    let legacy = null; if (reg.body && reg.body.token) legacy = m.authNode('Bearer ' + reg.body.token, null);
    srv.close();
    const auditFn = SC.securityAudit({ env: { HOST: '127.0.0.1', PORT: '3000' }, list: () => [], q: { meta: { get: () => null } }, dataDir: dir, sec: { filesHeaders: (req, res, next) => { res.setHeader('content-disposition', 'attachment'); res.setHeader('content-security-policy', 'sandbox'); next(); } }, caps: { can: () => false } });
    const funnel = auditFn.checks.find(x => x.id === 'funnel-not-used');
    rec({ id: 'admin-auth-csrf', kind: 'control', ok: none.status === 403 && noCsrf.status === 403 && evil.status === 403 && nul.status === 403 && sfs.status === 403 && bearer.status === 401 && ok.status === 200 && !!ok.body.code && confirm.status === 200 && getNo.status === 401 && hostBad.status === 421, detail: { postWithoutSession: none.status, note: 'csrfCheck is mounted before session auth, so a POST with no X-Studio-Request is 403 before 401', noCsrf: noCsrf.status, evilOrigin: evil.status, nullOrigin: nul.status, secFetch: sfs.status, nodeBearerOnAdmin: bearer.status, owner: ok.status, confirm: confirm.status, getUnauth: getNo.status, foreignHost: hostBad.status } });
    rec({ id: 'no-password-stepup-and-funnel-stub-and-legacy-token', kind: 'probe', ok: true, detail: { classifyConfirm: cls, classifyRevoke: clsR, confirmSucceededWithoutConfirmHeader: confirm.status === 200, funnel, legacyBearerAcceptedWithoutSignature: !!(legacy && legacy.id === 'macbook'), legacyHasDeviceKey: !!(legacy && legacy.devicePubKey) } });
    const createdLog = JSON.stringify(m.audit());
    rec({ id: 'admin-create-does-not-log-code', kind: 'control', ok: ok.body && !createdLog.includes(ok.body.code) && !createdLog.includes(ok.body.code.slice(6)), detail: { logged: createdLog.includes(ok.body.code) } });
  }

  // ----- argv / keychain -----
  {
    const kc = kcEnv(); const home = tmp('argv-'); const secret = 'nk_imac.' + crypto.randomBytes(18).toString('base64url');
    await EN.keychain(kc).set('moonkatty-node-imac', 'node-token', secret);
    const argvLog = fs.readFileSync(kc.FAKE_KC_ARGV, 'utf8');
    const store = JSON.parse(fs.readFileSync(kc.FAKE_KC_FILE, 'utf8'));
    let threw = false; try { await EN.keychain(kc).set('moonkatty-node-imac', 'node-token', 'has space'); } catch { threw = true; }
    rec({ id: 'keychain-set-argv-is-dash-i', kind: 'control', ok: argvLog.trim().split('\n').every(l => l === '["-i"]') && store['moonkatty-node-imac|node-token'] === secret && !argvLog.includes(secret) && threw, detail: { argvLog, threwOnSpace: threw } });

    const code = '23456-789GH-JKMNP';
    const p = spawn(process.execPath, [path.join(SRC, 'node-agent/agent.js'), '--enroll', '--url', 'https://127.0.0.1:1', '--fingerprint', 'ab'.repeat(32), '--code', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let cmd = ''; try { cmd = fs.readFileSync('/proc/' + p.pid + '/cmdline').toString('utf8').replace(/\0/g, ' '); } catch (e) { cmd = 'unreadable ' + e.message; }
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    await new Promise(r => p.on('close', r));
    rec({ id: 'cli-code-in-argv', kind: 'probe', ok: true, detail: { cmdlineHasCode: cmd.includes(code), cmdline: cmd.slice(0, 300), outputHasCode: out.includes(code), outputTail: out.slice(-200) } });
  }

  // ----- timing -----
  {
    const n = 800; const big = crypto.randomBytes(8192);
    const a = Buffer.concat([big]); const b0 = Buffer.from(a); b0[0] ^= 0xff; const b31 = Buffer.from(a); b31[b31.length - 1] ^= 0xff;
    const safe0 = timeit(() => crypto.timingSafeEqual(a, b0), n);
    const safe31 = timeit(() => crypto.timingSafeEqual(a, b31), n);
    const early = (x, y) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };
    const early0 = timeit(() => early(a, b0), n);
    const early31 = timeit(() => early(a, b31), n);
    const m = mgr(); const d = devKeys(); const reg = m.registerNode({ id: 'imac', role: 'news' });
    m._state.nodes.imac.devicePubKey = d.pub; m._state.nodes.imac.enrolled = true;
    const wrongTok = 'nk_imac.' + crypto.randomBytes(18).toString('base64url');
    const badSig = EN.sign(devKeys().key, 'x');
    const tWrong = timeit(() => m.authNode('Bearer ' + wrongTok, { method: 'GET', path: '/api/nodes/ping', ts: Date.now(), sig: badSig, body: Buffer.alloc(0) }), n);
    const tRight = timeit(() => m.authNode('Bearer ' + reg.token, { method: 'GET', path: '/api/nodes/ping', ts: Date.now(), sig: badSig, body: Buffer.alloc(0) }), n);
    const rightHash = sha256('same'); const other = sha256('other');
    const h0 = timeit(() => crypto.timingSafeEqual(Buffer.from(rightHash, 'hex'), Buffer.from(other, 'hex')), n);
    const h1 = timeit(() => crypto.timingSafeEqual(Buffer.from(rightHash, 'hex'), Buffer.from(rightHash, 'hex')), n);
    rec({ id: 'timing-comparisons', kind: 'probe', ok: true, detail: { samples: n, timingSafeEqual8k_differByte0_ns: safe0, timingSafeEqual8k_differLastByte_ns: safe31, earlyExit8k_differByte0_ns: early0, earlyExit8k_differLastByte_ns: early31, authWrongToken_ns: tWrong, authRightTokenBadSig_ns: tRight, hmacHashCompareDiffer_ns: h0, hmacHashCompareEqual_ns: h1 } });
  }

  // rate limit still 30
  {
    let clock = Date.now(); const m = N.createNodeManager({ dir: tmp('rate-'), now: () => clock }); let last;
    for (let i = 0; i < 31; i++) last = errOf(() => m.enrollment.status({ requestId: 'x', requestSecret: 'y' }, '10.3.3.3'));
    const m2 = N.createNodeManager({ dir: tmp('rate2-'), now: () => clock });
    m2.enrollment._ip['10.4.4.4'] = { calls: Array(30).fill(clock), fails: [], lockedUntil: 0 };
    const capped = errOf(() => m2.enrollment.enroll({ code: 'NO' }, '10.4.4.4'));
    rec({ id: 'rate-limit-31st', kind: 'control', ok: (last.code === 'E_RATE_LIMIT' || last.code === 'E_IP_LOCKED') && capped.code === 'E_RATE_LIMIT', detail: { failingCallsEnd: last.code, prefilled30: capped.code } });
  }

  const controls = rows.filter(r => r.kind === 'control');
  const failed = controls.filter(r => !r.ok);
  const summary = { commit, src: SRC, controls: controls.length, controlsFailed: failed.map(r => r.id), probes: rows.filter(r => r.kind === 'probe').length, node: process.version };
  fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 2));
  console.log(JSON.stringify(summary));
  if (failed.length) process.exitCode = 1;
}
