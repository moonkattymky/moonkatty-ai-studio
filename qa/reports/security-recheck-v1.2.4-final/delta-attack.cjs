'use strict';
// Delta exploit for feat/v1.2.4-test-nodes @ 322023f. Fake passwords only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const SRC = process.env.V124_SRC || '/tmp/mk-v124d';
const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? null : detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail == null ? '' : ' ' + JSON.stringify(detail)));
  return !!ok;
}
function httpReq(port, method, p, { headers = {}, body, tls } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const lib = tls ? https : http;
    const req = lib.request({
      host: '127.0.0.1', port, method, path: p, rejectUnauthorized: false,
      headers: { ...headers, ...(data ? { 'content-length': data.length, 'content-type': headers['content-type'] || 'application/json' } : {}) },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(c);
        let json = null;
        try { json = JSON.parse(buf.toString('utf8')); } catch {}
        resolve({ status: res.statusCode, json, text: buf.toString('utf8') });
      });
    });
    req.on('error', reject);
    if (data) req.end(data); else req.end();
  });
}
function nodeSnap(mgr) {
  const S = mgr._state;
  const nodes = {};
  for (const [id, n] of Object.entries(S.nodes)) nodes[id] = { tokenHash: n.tokenHash || null, command: n.command || null, revoked: !!n.revoked, status: n.status, lastSeen: n.lastSeen || null, errors: n.errors || 0, lastError: n.lastError || null, enrolled: !!n.enrolled, diskLastConn: n.lastConnError || null };
  const jobs = {};
  for (const [id, j] of Object.entries(S.jobs)) jobs[id] = { status: j.status, nodeId: j.nodeId, leaseId: j.lease && j.lease.id };
  return { nodes, jobs, audit: (S.audit || []).length };
}
const HASH = 'cd'.repeat(32);
const PATHS = jobId => [
  ['POST', '/api/nodes/hello', { info: { agentVersion: '0.2.2', hostname: 'evil' } }],
  ['POST', '/api/nodes/pull', { info: { agentVersion: '0.2.2' }, state: 'pwn' }],
  ['POST', '/api/nodes/rotate', {}],
  ['POST', `/api/nodes/jobs/${jobId}/heartbeat`, { leaseId: 'deadbeefdeadbeefdeadbeef' }],
  ['POST', `/api/nodes/jobs/${jobId}/complete`, { leaseId: 'deadbeefdeadbeefdeadbeef', result: { pwned: true } }],
  ['POST', `/api/nodes/jobs/${jobId}/fail`, { leaseId: 'deadbeefdeadbeefdeadbeef', error: 'pwned' }],
  ['GET', '/api/nodes/ping', null],
  ['GET', '/api/nodes/files/' + HASH, null],
  ['PUT', '/api/nodes/files/' + HASH, Buffer.from('not-the-hash')],
  ['POST', '/api/nodes/nope', { x: 1 }],
];
async function blast(port, headers, jobId) {
  const rows = [];
  for (const [method, p, body] of PATHS(jobId)) {
    const r = await httpReq(port, method, p, { headers, body });
    rows.push({ method, path: p, status: r.status, code: r.json && r.json.code || null });
  }
  return rows;
}

async function foreignToken() {
  const N = require(path.join(SRC, 'lib/ops/nodes.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dlt-'));
  const mgr = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois: async () => null, nodeDownMs: 60000, log: () => {} });
  const imac = mgr.registerNode({ id: 'imac', role: 'news', name: 'iMac' });
  const mac = mgr.registerNode({ id: 'macbook', role: 'monitor', name: 'MacBook' });
  const job = mgr.submit({ capability: 'news.collect', input: { feeds: [] } });
  const srv = await N.listen(mgr, { host: '127.0.0.1', port: 0, insecureHttpForTests: true });
  const port = srv.address().port;
  const setup = await httpReq(port, 'POST', '/api/nodes/pull', { headers: { authorization: 'Bearer ' + imac.token }, body: { info: { hostname: 'imac', agentVersion: '0.2.2' } } });
  check('setup leased news.collect to imac', !!(setup.json && setup.json.job && setup.json.job.id === job.jobId), { status: setup.status });
  const kinds = [
    ['none', {}],
    ['foreign-shape', { authorization: 'Bearer foreign-token' }],
    ['wrong-secret', { authorization: 'Bearer nk_imac.WRONGSECRETWRONGSECRETWRONG' }],
    ['unknown-id', { authorization: 'Bearer nk_notanode.aaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['empty-bearer', { authorization: 'Bearer ' }],
    ['basic', { authorization: 'Basic nk_imac.WRONGSECRETWRONGSECRETWRONG' }],
  ];
  let diskWrote = false, nodeChanged = false, jobChanged = false, diskConn = false;
  const calls = [];
  for (const [kind, headers] of kinds) {
    const d0 = fs.readFileSync(path.join(dir, 'nodes.json'));
    const s0 = nodeSnap(mgr);
    const rows = await blast(port, headers, job.jobId);
    const d1 = fs.readFileSync(path.join(dir, 'nodes.json'));
    const s1 = nodeSnap(mgr);
    const dw = !d0.equals(d1), nc = JSON.stringify(s0.nodes) !== JSON.stringify(s1.nodes), jc = JSON.stringify(s0.jobs) !== JSON.stringify(s1.jobs);
    diskWrote = diskWrote || dw; nodeChanged = nodeChanged || nc; jobChanged = jobChanged || jc;
    diskConn = diskConn || d1.toString('utf8').includes('lastConnError');
    calls.push({ kind, statuses: [...new Set(rows.map(r => r.status))], diskWrote: dw, nodeChanged: nc });
  }
  const mem = mgr.status().nodes.find(n => n.id === 'imac').lastConnError;
  check('unauth foreign token left node records unchanged', !nodeChanged, { calls });
  check('unauth foreign token left jobs unchanged', !jobChanged, null);
  check('unauth foreign token did not change nodes.json', !diskWrote && !diskConn, { diskWrote, diskConn });
  check('wrong secret is remembered only in memory', mem && mem.code === 'E_UNAUTHORIZED', mem);
  const fileHit = path.join(dir, 'node-files', HASH);
  check('unauth PUT did not create a file', !fs.existsSync(fileHit), null);
  const dEn0 = fs.readFileSync(path.join(dir, 'nodes.json'));
  const sEn0 = nodeSnap(mgr);
  const enRows = [];
  for (const [method, p, body] of [['POST', '/api/nodes/enroll', { code: '22222-22222-22222', deviceId: 'dev_x', devicePubKey: 'nope', proof: 'nope' }], ['POST', '/api/nodes/enroll/status', { requestId: '22222', requestSecret: 'nope' }]]) {
    for (const headers of [{}, { authorization: 'Bearer foreign-token' }, { authorization: 'Bearer ' + mac.token }]) {
      const hit = await httpReq(port, method, p, { headers, body });
      enRows.push({ path: p, auth: headers.authorization ? 'bearer' : 'none', status: hit.status, code: hit.json && hit.json.code || null });
    }
  }
  const sEn1 = nodeSnap(mgr);
  check('enroll and status without a real code left node records and jobs unchanged', JSON.stringify(sEn0.nodes) === JSON.stringify(sEn1.nodes) && JSON.stringify(sEn0.jobs) === JSON.stringify(sEn1.jobs) && !fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8').includes('lastConnError'), { rows: enRows, diskChanged: !dEn0.equals(fs.readFileSync(path.join(dir, 'nodes.json'))) });
  const before = nodeSnap(mgr);
  const cross = await blast(port, { authorization: 'Bearer ' + mac.token }, job.jobId);
  const after = nodeSnap(mgr);
  check('other node token left the victim node and its job unchanged', JSON.stringify(before.nodes.imac) === JSON.stringify(after.nodes.imac) && JSON.stringify(before.jobs) === JSON.stringify(after.jobs) && !fs.existsSync(fileHit), { cross: cross.filter(r => /jobs|files|rotate|enroll/.test(r.path)) });
  const pub = JSON.stringify(mgr.status()) + JSON.stringify(mgr.audit()) + fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8');
  check('status audit and nodes.json omit bearer secrets', ![imac.token, mac.token, imac.token.split('.')[1]].some(s => pub.includes(s)), null);
  const mgr2 = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois: async () => null, log: () => {} });
  check('a new manager does not see the memory connection error', mgr2.status().nodes.find(n => n.id === 'imac').lastConnError == null, null);
  await new Promise(r => { try { srv.closeAllConnections(); } catch {} srv.close(r); });
  fs.rmSync(dir, { recursive: true, force: true });
}

function device() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pem: publicKey.export({ type: 'spki', format: 'pem' }), id: 'dev_' + crypto.randomBytes(16).toString('hex'), key: privateKey,
    sign: msg => crypto.sign(null, Buffer.from(msg), privateKey).toString('base64') };
}

async function peerAndVersion() {
  const N = require(path.join(SRC, 'lib/ops/nodes.js'));
  const whois = async ip => ip === '100.101.1.2' ? { id: 'nMB', name: 'macbook', login: 'igor@x' } : null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dlt-peer-'));
  const mgr = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois, idSuffix: '-test', log: () => {} });
  const loop = await mgr.peerOf({ socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  const named = await mgr.peerOf({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '100.101.1.2' } });
  const miss = await mgr.peerOf({ socket: { remoteAddress: '100.101.1.9' }, headers: {} });
  check('loopback peer is unverified and hides 127.0.0.1', loop.verified === false && loop.ip == null && !/127\.0\.0\.1/.test(loop.label), loop);
  check('stub whois names the tailnet peer', named.verified === true && named.label === 'macbook · 100.101.1.2 · igor@x', named);
  check('whois miss stays unverified', miss.verified === false && /whois недоступен/.test(miss.label), miss);
  check('defaultWhois on this host returns null', (await N.defaultWhois('100.101.1.2')) == null, null);
  const dev = device();
  const created = mgr.enrollment.create({ role: 'news', name: 'iMac <script>' });
  const en = mgr.enrollment.enroll({ code: created.code, deviceId: dev.id, devicePubKey: dev.pem, proof: dev.sign('enroll:' + created.requestId + ':' + dev.id), info: { hostname: '<img src=x>', agentVersion: '0.2.2' } }, loop);
  let code = null;
  try { mgr.enrollment.confirm(en.requestId); } catch (e) { code = e.code; }
  const mid = mgr.audit().some(a => a.type === 'peer_unverified_acknowledged');
  const ok = mgr.enrollment.confirm(en.requestId, { acknowledgeUnverifiedPeer: true });
  check('unknown peer confirm is 409 E_PEER_UNVERIFIED until the second ack', code === 'E_PEER_UNVERIFIED' && ok.state === 'confirmed', { code, state: ok.state });
  check('the second ack is one audit row', !mid && mgr.audit().filter(a => a.type === 'peer_unverified_acknowledged').length === 1, null);
  const listed = mgr.enrollment.list().find(q => q.requestId === created.requestId);
  check('pending view keeps the unverified peer text', listed.device.peerVerified === false && !/127\.0\.0\.1/.test(JSON.stringify(listed.device.peer)), { peer: listed.device.peer });
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dlt-peer2-'));
  const mgr2 = N.createNodeManager({ dir: dir2, allowPlainEnrollForTests: true, whois, idSuffix: '-test', log: () => {} });
  const d2 = device();
  const c2 = mgr2.enrollment.create({ role: 'monitor', name: 'mb' });
  const e2 = mgr2.enrollment.enroll({ code: c2.code, deviceId: d2.id, devicePubKey: d2.pem, proof: d2.sign('enroll:' + c2.requestId + ':' + d2.id), info: {} }, named);
  let skipped = null;
  try { skipped = mgr2.enrollment.confirm(e2.requestId).state; } catch (e) { skipped = e.code; }
  check('loopback XFF plus stub whois still confirms without the second ack', skipped === 'confirmed', { skipped });
  const blob = JSON.stringify(mgr.enrollment.list()) + JSON.stringify(mgr.audit()) + fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8');
  check('code and request secret stay out of list audit and nodes.json', !blob.includes(created.code.replace(/-/g, '')) && !blob.includes(en.requestSecret), null);

  const srv = await N.listen(mgr, { host: '127.0.0.1', port: 0, insecureHttpForTests: true });
  const port = srv.address().port;
  const ts = Date.now();
  const nonce = crypto.randomBytes(18).toString('base64url');
  const body = { info: { agentVersion: '0.2.0' } };
  const raw = Buffer.from(JSON.stringify(body));
  const pathName = '/api/nodes/hello';
  const sig = dev.sign(`POST\n${pathName}\n${ts}\n${nonce}\n${crypto.createHash('sha256').update(raw).digest('hex')}`);
  async function hello(ver, extra) {
    const b = { info: ver == null ? {} : { agentVersion: ver } };
    const buf = Buffer.from(JSON.stringify(b));
    const t = Date.now();
    const n = crypto.randomBytes(18).toString('base64url');
    const headers = { authorization: 'Bearer ' + (extra && extra.token || 'pending') };
    if (!(extra && extra.nosig)) {
      headers['x-node-ts'] = String(t);
      headers['x-node-nonce'] = n;
        headers['x-node-sig'] = dev.sign(`POST\n${pathName}\n${t}\n${n}\n${crypto.createHash('sha256').update(buf).digest('hex')}`);
    }
    if (extra && extra.nononce) {
      const t = Date.now();
      headers['x-node-ts'] = String(t);
      delete headers['x-node-nonce'];
      headers['x-node-sig'] = dev.sign(`POST\n${pathName}\n${t}\n\n${crypto.createHash('sha256').update(buf).digest('hex')}`);
    }
    return httpReq(port, 'POST', pathName, { headers, body: buf });
  }
  const polled = mgr.enrollment.status({ requestId: en.requestId, requestSecret: en.requestSecret, ts, nonce, sig: dev.sign(`status:${en.requestId}:${ts}:${nonce}`) }, loop);
  check('status poll returns the enrolled token once', polled.status === 'enrolled' && /^nk_imac-test\./.test(polled.token || ''), { status: polled.status });
  const tok = polled.token;
  const v020 = await hello('0.2.0', { token: tok });
  const v021 = await hello('0.2.1', { token: tok });
  const v022 = await hello('0.2.2', { token: tok });
  const v030 = await hello('0.3.0', { token: tok });
  const vMiss = await hello(null, { token: tok });
  const noNonce = await hello('0.2.2', { token: tok, nosig: true });
  const sigNoNonce = await hello('0.2.1', { token: tok, nononce: true });
  check('signed 0.2.0 and 0.2.1 pass the version gate', v020.status === 200 && v021.status === 200, { v020: v020.status, v021: v021.status });
  check('signed 0.2.2 is online and 0.3.0 is 426', v022.status === 200 && v030.status === 426 && v030.json.code === 'E_AGENT_VERSION', { v022: v022.status, v030: v030.status });
  check('a missing agentVersion is accepted', vMiss.status === 200, { status: vMiss.status });
  check('an enrolled token without a signature is 401', noNonce.status === 401, { status: noNonce.status });
  check('a signature without a nonce is 426', sigNoNonce.status === 426 && sigNoNonce.json && sigNoNonce.json.code === 'E_AGENT_VERSION', { status: sigNoNonce.status, code: sigNoNonce.json && sigNoNonce.json.code });
  await new Promise(r => { try { srv.closeAllConnections(); } catch {} srv.close(r); });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  return { sigUnused: sig };
}

async function lockProbe() {
  const src = path.join(SRC, 'lib/ops/nodes.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dlt-lock-'));
  const hold = spawn(process.execPath, ['-e', `const N=require(${JSON.stringify(src)}); N.createNodeManager({dir:process.argv[1], log:()=>{}}); setInterval(()=>{}, 1000);`, dir], { stdio: 'ignore' });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(path.join(dir, 'nodes.lock')) && Date.now() < deadline) spawnSync('sleep', ['0.05']);
  const second = spawnSync(process.execPath, ['-e', `const N=require(${JSON.stringify(src)}); try { N.createNodeManager({dir:process.argv[1]}); console.log('OPEN'); } catch(e){ console.log('ERR '+e.message); }`, dir], { encoding: 'utf8' });
  check('a second process cannot open the same nodes directory', /второй координатор/.test(second.stdout), { out: (second.stdout || '').slice(0, 240), err: (second.stderr || '').slice(0, 180), holder: hold.pid });
  try { process.kill(hold.pid, 'SIGKILL'); } catch {}
  const zombie = spawnSync(process.execPath, ['-e', `const N=require(${JSON.stringify(src)}); try { N.createNodeManager({dir:process.argv[1]}); console.log('OPEN'); } catch(e){ console.log('ERR '+e.message); }`, dir], { encoding: 'utf8' });
  check('an unreaped SIGKILL pid still counts as alive', /второй координатор/.test(zombie.stdout), { out: (zombie.stdout || '').trim().slice(0, 180) });
  await new Promise(r => hold.once('exit', r));
  const third = spawnSync(process.execPath, ['-e', `const N=require(${JSON.stringify(src)}); const fs=require('fs'); try { N.createNodeManager({dir:process.argv[1]}); console.log('PID '+fs.readFileSync(process.argv[1]+'/nodes.lock','utf8').trim()); } catch(e){ console.log('ERR '+e.message); }`, dir], { encoding: 'utf8' });
  const printed = (third.stdout || '').trim();
  const m = printed.match(/^PID (\d+)$/);
  check('a dead lock pid is taken over', !!(m && +m[1] === third.pid && +m[1] !== hold.pid), { out: printed, thirdPid: third.pid, holder: hold.pid, status: third.status });
  fs.rmSync(dir, { recursive: true, force: true });
}

async function ownerApi() {
  const port = 29221;
  const nport = 29222;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dlt-own-'));
  const PW = 'fake-password-123';
  const env = { ...process.env, NODE_PATH: process.env.NODE_PATH || '/workspace/node_modules', STUDIO_SQLITE: 'node', STUDIO_FLAVOR: 'test', NODE_ENV: 'test', STUDIO_DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', STUDIO_NODES: '1', STUDIO_NODES_PORT: String(nport), OPS_NODES_DOWN_MS: '500' };
  delete env.DB_PATH; delete env.STUDIO_APP_BUNDLE_ID; delete env.STUDIO_NODES_LEGACY_TOKENS; delete env.STUDIO_NODES_DOWN_MS;
  const out = [];
  const proc = spawn(process.execPath, ['server.js'], { cwd: SRC, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', d => out.push(String(d)));
  proc.stderr.on('data', d => out.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const R = { 'content-type': 'application/json', 'x-studio-request': '1', origin: base };
  let cookie = '';
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: R, body: JSON.stringify({ username: 'igor', password: PW }) });
  cookie = (setup.headers.get('set-cookie') || '').split(';')[0];
  const A = { ...R, cookie };
  const j = async (method, p, headers, body) => {
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let bodyj = null; try { bodyj = JSON.parse(t); } catch { bodyj = t; }
    return { status: r.status, body: bodyj };
  };
  try {
    const st = await j('GET', '/api/ops/nodes', A);
    check('OPS_NODES_DOWN_MS 500 is raised to 2000', st.body && st.body.nodeDownMs === 2000, { nodeDownMs: st.body && st.body.nodeDownMs, enabled: st.body && st.body.enabled });
    const noCookie = { 'content-type': 'application/json', 'x-studio-request': '1' };
    const noHdr = { 'content-type': 'application/json', cookie, origin: base };
    const evil = { ...A, origin: 'https://evil.example' };
    const cross = { ...A, 'sec-fetch-site': 'cross-site' };
    const rows = [];
    for (const [name, h, body] of [
      ['no-session', noCookie, { role: 'news', confirm: 'ПОДКЛЮЧИТЬ', password: PW }],
      ['no-header', noHdr, { role: 'news', confirm: 'ПОДКЛЮЧИТЬ', password: PW }],
      ['evil-origin', evil, { role: 'news', confirm: 'ПОДКЛЮЧИТЬ', password: PW }],
      ['cross-site', cross, { role: 'news', confirm: 'ПОДКЛЮЧИТЬ', password: PW }],
    ]) rows.push({ name, status: (await j('POST', '/api/ops/nodes/enroll', h, body)).status });
    check('enroll without a session is 401', rows.find(r => r.name === 'no-session').status === 401, rows);
    check('enroll without X-Studio-Request is 403', rows.find(r => r.name === 'no-header').status === 403, rows);
    check('evil origin and cross-site are 403', rows.filter(r => r.name === 'evil-origin' || r.name === 'cross-site').every(r => r.status === 403), rows);
    const missingWord = await j('POST', '/api/ops/nodes/enroll', A, { role: 'news', password: PW });
    const badPw = await j('POST', '/api/ops/nodes/enroll', A, { role: 'news', confirm: 'ПОДКЛЮЧИТЬ', password: 'wrong-password' });
    const created = await j('POST', '/api/ops/nodes/enroll', A, { role: 'news', name: 'iMac', confirm: 'ПОДКЛЮЧИТЬ', password: PW });
    check('confirm word and password are both required', missingWord.status === 400 && badPw.status === 403 && created.status === 200 && !!(created.body && created.body.code), { missing: missingWord.status, bad: badPw.status, ok: created.status });
    const dev = device();
    const proof = dev.sign('enroll:' + created.body.requestId + ':' + dev.id);
    const nodeEn = await httpReq(nport, 'POST', '/api/nodes/enroll', { tls: true, body: { code: created.body.code, deviceId: dev.id, devicePubKey: dev.pem, proof, info: { hostname: 'imac', agentVersion: '0.2.2' } } });
    check('device enroll over TLS reaches pending', nodeEn.status === 200 && nodeEn.json && nodeEn.json.status === 'pending' && !!(nodeEn.json && nodeEn.json.requestSecret), { status: nodeEn.status, enrollStatus: nodeEn.json && nodeEn.json.status });
    const noAck = await j('POST', '/api/ops/nodes/enroll/' + created.body.requestId + '/confirm', A, { confirm: 'ПОДТВЕРДИТЬ', password: PW, acknowledgeUnverifiedPeer: false });
    const strAck = await j('POST', '/api/ops/nodes/enroll/' + created.body.requestId + '/confirm', A, { confirm: 'ПОДТВЕРДИТЬ', password: PW, acknowledgeUnverifiedPeer: 'true' });
    const ack = await j('POST', '/api/ops/nodes/enroll/' + created.body.requestId + '/confirm', A, { confirm: 'ПОДТВЕРДИТЬ', password: PW, acknowledgeUnverifiedPeer: true });
    check('HTTP confirm of a loopback peer is 409 until boolean true', noAck.status === 409 && noAck.body.code === 'E_PEER_UNVERIFIED' && strAck.status === 409 && ack.status === 200, { noAck: noAck.status, strAck: strAck.status, ack: ack.status, code: noAck.body && noAck.body.code });
    const audit = await j('GET', '/api/ops/nodes/audit', A);
    check('peer_unverified_acknowledged is in the owner audit', !!(audit.body && audit.body.events && audit.body.events.some(e => e.type === 'peer_unverified_acknowledged')), { types: audit.body && audit.body.events && audit.body.events.map(e => e.type) });
    const created2 = await j('POST', '/api/ops/nodes/enroll', A, { role: 'monitor', name: 'MacBook', confirm: 'ПОДКЛЮЧИТЬ', password: PW });
    const dev2 = device();
    const proof2 = dev2.sign('enroll:' + created2.body.requestId + ':' + dev2.id);
    const nodeEn2 = await httpReq(nport, 'POST', '/api/nodes/enroll', { tls: true, body: { code: created2.body.code, deviceId: dev2.id, devicePubKey: dev2.pem, proof: proof2, info: { hostname: 'mb', agentVersion: '0.2.2' } } });
    const rej = await j('POST', '/api/ops/nodes/enroll/' + created2.body.requestId + '/reject', A, {});
    check('reject of a pending request still skips the password', nodeEn2.status === 200 && rej.status === 200 && rej.body && rej.body.state === 'rejected', { enroll: nodeEn2.status, status: rej.status, body: rej.body });
    const logs = await j('GET', '/api/logs', A);
    const files = [];
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { files.push(fs.readFileSync(p, 'latin1')); } catch {} } } };
    walk(dir);
    const hay = out.join('') + JSON.stringify(logs.body) + files.join('\n');
    check('the owner password is absent from stdout, logs, and data files', !hay.includes(PW), { logChars: hay.length });
    const code = created.body && created.body.code;
    check('the one-time code is absent from the log store', code && !JSON.stringify(logs.body).includes(code) && !out.join('').includes(code), null);
    fs.writeFileSync(path.join(OUT, 'delta-owner.json'), JSON.stringify({ rows, noAck: noAck.body, ack: ack.status, rej: rej.body, nodeDownMs: st.body && st.body.nodeDownMs }, null, 2));
  } finally {
    proc.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function studioGap() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-dlt-studio-'));
  const env = { ...process.env, NODE_PATH: process.env.NODE_PATH || '/workspace/node_modules', STUDIO_SQLITE: 'node', COORD_DIR: dir };
  delete env.STUDIO_FLAVOR; delete env.STUDIO_NODES_LEGACY_TOKENS; delete env.DB_PATH; delete env.COORD_FLAVOR;
  const proc = spawn(process.execPath, ['test/helpers/studio-coordinator.js'], { cwd: SRC, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const err = []; proc.stderr.on('data', d => err.push(String(d)));
  try {
    const line = await new Promise((resolve, reject) => {
      let b = ''; const t = setTimeout(() => reject(new Error('studio helper timeout ' + err.join('').slice(0, 200))), 8000);
      proc.stdout.on('data', d => { b += d; const i = b.indexOf('\n'); if (i >= 0) { clearTimeout(t); try { resolve(JSON.parse(b.slice(0, i))); } catch (e) { reject(e); } } });
    });
    const body = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: line.admin, path: '/register', method: 'POST', headers: { 'content-type': 'application/json' } }, x => { const c = []; x.on('data', d => c.push(d)); x.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
      r.on('error', reject); r.end(JSON.stringify({ id: 'imac', role: 'imac' }));
    });
    check('studio helper register is refused as a legacy token', /E_LEGACY_DISABLED|Прямые токены/.test(body), { body: body.slice(0, 280) });
  } finally { try { proc.kill('SIGKILL'); } catch {} fs.rmSync(dir, { recursive: true, force: true }); }
}

async function main() {
  await foreignToken();
  await peerAndVersion();
  await lockProbe();
  await ownerApi();
  await studioGap();
  const failed = results.filter(r => !r.ok).map(r => r.name);
  const summary = { commit: '322023fd6f8e98dbddd38341e07227ded149c1fb', controls: results.length, failed };
  fs.writeFileSync(path.join(OUT, 'delta-attack.json'), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  if (failed.length) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
