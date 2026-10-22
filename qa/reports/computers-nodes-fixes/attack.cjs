'use strict';
// Independent exploit checks for Computers (Nodes) d38c682..fe8e4ab.
// Fake passwords and tokens only. Does not edit the product trees.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const FE = process.env.NODES_SRC || '/tmp/mk-nodes';
const PRE = process.env.NODES_PRE || '/tmp/mk-nodes-pre';
const V124 = process.env.NODES_V124 || '/tmp/mk-v124f';
const OUT = path.join(__dirname, 'logs');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? null : detail });
  const line = (ok ? 'PASS ' : 'FAIL ') + name + (detail == null ? '' : ' ' + JSON.stringify(detail));
  console.log(line);
  return !!ok;
}

function httpReq(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const req = http.request({
      host: '127.0.0.1', port, method, path: p,
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
  for (const [id, n] of Object.entries(S.nodes)) {
    nodes[id] = {
      tokenHash: n.tokenHash || null,
      command: n.command || null,
      revoked: !!n.revoked,
      status: n.status,
      lastSeen: n.lastSeen || null,
      errors: n.errors || 0,
      lastError: n.lastError || null,
      rotatePending: !!n.rotatePending,
      enrolled: !!n.enrolled,
      diskLastConnError: n.lastConnError || null,
    };
  }
  const jobs = {};
  for (const [id, j] of Object.entries(S.jobs)) {
    jobs[id] = { status: j.status, nodeId: j.nodeId, leaseId: j.lease && j.lease.id, result: j.result || null, error: j.error || null };
  }
  return { nodes, jobs, audit: (S.audit || []).length };
}

function memConn(mgr, id) {
  const n = mgr.status().nodes.find(x => x.id === id);
  return n ? n.lastConnError || null : null;
}

const HASH = 'ab'.repeat(32);
const PATHS = jobId => [
  ['POST', '/api/nodes/hello', { info: { agentVersion: '0.2.2', hostname: 'evil<script>' } }],
  ['POST', '/api/nodes/pull', { info: { agentVersion: '0.2.2' }, state: 'pwn' }],
  ['POST', '/api/nodes/rotate', {}],
  ['POST', `/api/nodes/jobs/${jobId}/heartbeat`, { leaseId: 'deadbeefdeadbeefdeadbeef', checkpoint: { progress: 99 } }],
  ['POST', `/api/nodes/jobs/${jobId}/complete`, { leaseId: 'deadbeefdeadbeefdeadbeef', result: { pwned: true } }],
  ['POST', `/api/nodes/jobs/${jobId}/fail`, { leaseId: 'deadbeefdeadbeefdeadbeef', error: 'pwned', retryable: true }],
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

async function probe(label, src, { expectDiskConn }) {
  const N = require(path.join(src, 'lib/ops/nodes.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cn-' + label + '-'));
  const mgr = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois: async () => null, nodeDownMs: 60000, log: () => {} });
  const imac = mgr.registerNode({ id: 'imac', role: 'news', name: 'iMac' });
  const mac = mgr.registerNode({ id: 'macbook', role: 'monitor', name: 'MacBook' });
  const job = mgr.submit({ capability: 'news.collect', input: { feeds: [] } });
  const srv = await N.listen(mgr, { host: '127.0.0.1', port: 0, insecureHttpForTests: true });
  const port = srv.address().port;
  const setup = await httpReq(port, 'POST', '/api/nodes/pull', {
    headers: { authorization: 'Bearer ' + imac.token },
    body: { info: { hostname: 'imac', agentVersion: '0.2.2' } },
  });
  const leased = !!(setup.json && setup.json.job && setup.json.job.id === job.jobId);
  const before = nodeSnap(mgr);
  const diskBefore = fs.readFileSync(path.join(dir, 'nodes.json'));
  const unauth = [
    ['none', {}],
    ['foreign-shape', { authorization: 'Bearer foreign-token' }],
    ['wrong-secret', { authorization: 'Bearer nk_imac.WRONGSECRETWRONGSECRETWRONG' }],
    ['unknown-id', { authorization: 'Bearer nk_notanode.aaaaaaaaaaaaaaaaaaaaaaaa' }],
    ['empty-bearer', { authorization: 'Bearer ' }],
    ['basic', { authorization: 'Basic nk_imac.WRONGSECRETWRONGSECRETWRONG' }],
  ];
  const calls = [];
  let diskWrote = false;
  let nodeChanged = false;
  let jobChanged = false;
  let diskConn = false;
  for (const [kind, headers] of unauth) {
    const d0 = fs.readFileSync(path.join(dir, 'nodes.json'));
    const s0 = nodeSnap(mgr);
    const rows = await blast(port, headers, job.jobId);
    const d1 = fs.readFileSync(path.join(dir, 'nodes.json'));
    const s1 = nodeSnap(mgr);
    const dw = !d0.equals(d1);
    const nc = JSON.stringify(s0.nodes) !== JSON.stringify(s1.nodes);
    const jc = JSON.stringify(s0.jobs) !== JSON.stringify(s1.jobs);
    const dc = d1.toString('utf8').includes('lastConnError');
    diskWrote = diskWrote || dw;
    nodeChanged = nodeChanged || nc;
    jobChanged = jobChanged || jc;
    diskConn = diskConn || dc;
    calls.push({ kind, rows, diskWrote: dw, nodeChanged: nc, jobChanged: jc, diskLastConnError: dc, statuses: [...new Set(rows.map(r => r.status))] });
  }
  const memAfterUnauth = memConn(mgr, 'imac');
  const crossHeaders = { authorization: 'Bearer ' + mac.token };
  const crossBefore = nodeSnap(mgr);
  const cross = await blast(port, crossHeaders, job.jobId);
  const crossAfter = nodeSnap(mgr);
  const imacSame = JSON.stringify(crossBefore.nodes.imac) === JSON.stringify(crossAfter.nodes.imac);
  const jobSame = JSON.stringify(crossBefore.jobs) === JSON.stringify(crossAfter.jobs);
  const victimPaths = cross.filter(r => /\/jobs\/|\/files\/|\/rotate|\/nope/.test(r.path));
  const victimDenied = victimPaths.every(r => r.status === 401 || r.status === 403 || r.status === 404 || r.status === 405 || r.status === 409);
  const fileHit = path.join(dir, 'files', HASH);
  const fileWritten = fs.existsSync(fileHit);

  const enrollBefore = nodeSnap(mgr);
  const enrollDisk0 = fs.readFileSync(path.join(dir, 'nodes.json'));
  const enrollRows = [];
  for (const [kind, headers] of unauth) {
    enrollRows.push({ kind, enroll: (await httpReq(port, 'POST', '/api/nodes/enroll', { headers, body: { code: 'AAAAA-BBBBB-CCCCC' } })).status,
      status: (await httpReq(port, 'POST', '/api/nodes/enroll/status', { headers, body: { requestId: 'AAAAA', requestSecret: 'nope' } })).status });
  }
  const enrollAfter = nodeSnap(mgr);
  const enrollNodesSame = JSON.stringify(enrollBefore.nodes) === JSON.stringify(enrollAfter.nodes);
  const enrollJobsSame = JSON.stringify(enrollBefore.jobs) === JSON.stringify(enrollAfter.jobs);
  const enrollDisk = fs.readFileSync(path.join(dir, 'nodes.json'));
  const enrollDiskConn = enrollDisk.toString('utf8').includes('lastConnError');

  const prefix = label;
  check(prefix + ' setup leased the news job to imac', leased, { status: setup.status, code: setup.json && setup.json.code });
  check(prefix + ' unauth foreign token left jobs unchanged', !jobChanged, null);
  check(prefix + ' unauth foreign token did not write a file', !fileWritten, null);
  if (expectDiskConn) {
    check(prefix + ' pre-fix wrong secret persisted lastConnError', diskConn && diskWrote && nodeChanged, { diskWrote, diskConn, nodeChanged });
  } else {
    check(prefix + ' unauth foreign token left node records unchanged', !nodeChanged, { calls: calls.map(c => ({ kind: c.kind, nodeChanged: c.nodeChanged, statuses: c.statuses })) });
    check(prefix + ' unauth foreign token did not change nodes.json', !diskWrote, { diskWrote, bytes: diskBefore.length });
    check(prefix + ' nodes.json has no lastConnError', !diskConn && !enrollDiskConn, { diskConn, enrollDiskConn });
  }
  check(prefix + ' enroll attempts did not change node or job records', enrollNodesSame && enrollJobsSame, { enrollRows });
  check(prefix + ' other node token did not change the victim node or its job', imacSame && jobSame, {
    victimDenied, victim: victimPaths, imacStatus: crossAfter.nodes.imac && crossAfter.nodes.imac.status,
  });
  const secrets = [imac.token, mac.token, imac.token.split('.')[1], mac.token.split('.')[1]];
  const pub = JSON.stringify(mgr.status()) + JSON.stringify(mgr.audit()) + fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8');
  const leaked = secrets.filter(s => pub.includes(s));
  check(prefix + ' status audit and nodes.json omit bearer secrets', leaked.length === 0, { leaked: leaked.length });
  await new Promise(r => { try { srv.closeAllConnections(); } catch {} srv.close(r); });
  fs.rmSync(dir, { recursive: true, force: true });
  return { memAfterUnauth, calls, cross };
}

function device() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const deviceId = 'dev_' + crypto.randomBytes(16).toString('hex');
  const sign = msg => crypto.sign(null, Buffer.from(msg), privateKey).toString('base64');
  return { pem, deviceId, sign, privateKey };
}

async function peerAndAck() {
  const N = require(path.join(FE, 'lib/ops/nodes.js'));
  const whois = async ip => {
    if (ip === '100.101.1.2') return { id: 'nMB', name: 'macbook', login: 'igor@x' };
    return null;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cn-peer-'));
  const mgr = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois, log: () => {} });
  const loop = await mgr.peerOf({ socket: { remoteAddress: '127.0.0.1' }, headers: {} });
  const named = await mgr.peerOf({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '100.101.1.2' } });
  const miss = await mgr.peerOf({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '100.101.1.9' } });
  const login = await mgr.peerOf({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'tailscale-user-login': 'igor@x' } });
  const direct = await mgr.peerOf({ socket: { remoteAddress: '100.101.1.2' }, headers: { 'x-forwarded-for': '10.1.1.1' } });
  check('loopback peer label hides 127.0.0.1 and is unverified', loop.verified === false && !/127\.0\.0\.1/.test(loop.label), loop);
  check('stub whois names the tailnet peer', named.verified === true && named.label === 'macbook · 100.101.1.2 · igor@x' && named.key === 'tsnode:nMB', named);
  check('whois miss stays unverified', miss.verified === false && /whois недоступен/.test(miss.label) && !/127\.0\.0\.1/.test(miss.label), miss);
  check('login header without a tailnet address is unverified', login.verified === false && login.key === 'tsuser:igor@x' && !/127\.0\.0\.1/.test(login.label), login);
  check('direct tailnet ignores a spoofed forwarded header', direct.verified === true && direct.key === 'tsnode:nMB', direct);
  const live = await N.defaultWhois('100.101.1.2');
  check('defaultWhois on this host returns null', live == null, { live });

  const dev = device();
  const created = mgr.enrollment.create({ role: 'news', name: 'iMac <script>' });
  const en = mgr.enrollment.enroll({
    code: created.code, deviceId: dev.deviceId, devicePubKey: dev.pem,
    proof: dev.sign('enroll:' + created.requestId + ':' + dev.deviceId),
    info: { hostname: 'imac', agentVersion: '0.2.2' },
  }, loop);
  const listed = mgr.enrollment.list().find(q => q.requestId === created.requestId);
  let unverified = null;
  try { mgr.enrollment.confirm(created.requestId); } catch (e) { unverified = e.code; }
  const auditMid = mgr.audit().some(a => a.type === 'peer_unverified_acknowledged');
  const confirmed = mgr.enrollment.confirm(created.requestId, { acknowledgeUnverifiedPeer: true });
  const auditAck = mgr.audit().filter(a => a.type === 'peer_unverified_acknowledged').length;
  const blob = JSON.stringify(mgr.enrollment.list()) + JSON.stringify(mgr.status()) + JSON.stringify(mgr.audit()) + fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8');
  check('unknown peer confirm throws E_PEER_UNVERIFIED', unverified === 'E_PEER_UNVERIFIED' && confirmed.state === 'confirmed', { unverified, state: confirmed.state });
  check('unverified ack is audited once', !auditMid && auditAck === 1, { auditAck });
  check('pending view carries the unverified peer and no loopback address', listed && listed.device.peerVerified === false && !/127\.0\.0\.1/.test(listed.device.peer || ''), { peer: listed && listed.device.peer });
  check('code and request secret stay out of list status audit and nodes.json', !blob.includes(created.code.replace(/-/g, '')) && !blob.includes(en.requestSecret) && !/PRIVATE KEY/.test(blob), null);

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cn-peer2-'));
  const mgr2 = N.createNodeManager({ dir: dir2, allowPlainEnrollForTests: true, whois, log: () => {} });
  const dev2 = device();
  const c2 = mgr2.enrollment.create({ role: 'monitor', name: 'MacBook' });
  mgr2.enrollment.enroll({
    code: c2.code, deviceId: dev2.deviceId, devicePubKey: dev2.pem,
    proof: dev2.sign('enroll:' + c2.requestId + ':' + dev2.deviceId), info: { hostname: 'mb' },
  }, named);
  let skipped = null;
  try { skipped = mgr2.enrollment.confirm(c2.requestId).state; } catch (e) { skipped = e.code; }
  check('loopback XFF plus stub whois still confirms without the second ack', skipped === 'confirmed', { skipped });

  const dev3 = device();
  const c3 = mgr.enrollment.create({ role: 'monitor', name: 'reject-me', nodeId: 'macbook' });
  mgr.enrollment.enroll({
    code: c3.code, deviceId: dev3.deviceId, devicePubKey: dev3.pem,
    proof: dev3.sign('enroll:' + c3.requestId + ':' + dev3.deviceId), info: {},
  }, loop);
  const rejected = mgr.enrollment.reject(c3.requestId);
  check('reject of an unverified peer does not require the second ack', rejected.state === 'rejected', { state: rejected.state });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
}

function classifyChecks() {
  const SC = require(path.join(FE, 'lib/ops/security-center.js'));
  const c = (method, p) => SC.classify({ method, path: p, body: {} });
  check('classify maps confirm revoke rotate and legacy token', c('POST', '/api/ops/nodes/enroll/R7K2Q/confirm') === 'node-confirm'
    && c('POST', '/api/ops/nodes/imac/revoke') === 'node-revoke'
    && c('POST', '/api/ops/nodes/imac/rotate') === 'node-rotate'
    && c('POST', '/api/ops/nodes') === 'node-legacy-token', null);
  check('classify leaves reject and command outside the password set', c('POST', '/api/ops/nodes/enroll/R7K2Q/reject') == null
    && c('POST', '/api/ops/nodes/imac/command') == null, { reject: c('POST', '/api/ops/nodes/enroll/R7K2Q/reject'), command: c('POST', '/api/ops/nodes/imac/command') });
}

function memoryOnly() {
  const N = require(path.join(FE, 'lib/ops/nodes.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-cn-mem-'));
  const mgr = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois: async () => null, log: () => {} });
  const imac = mgr.registerNode({ id: 'imac', role: 'news', name: 'iMac' });
  return N.listen(mgr, { host: '127.0.0.1', port: 0, insecureHttpForTests: true }).then(async srv => {
    const port = srv.address().port;
    await httpReq(port, 'POST', '/api/nodes/hello', { headers: { authorization: 'Bearer nk_imac.WRONGSECRETWRONGSECRETWRONG' }, body: { info: { agentVersion: '9.9.9' } } });
    const seen = memConn(mgr, 'imac');
    const disk = fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8').includes('lastConnError');
    const mgr2 = N.createNodeManager({ dir, allowPlainEnrollForTests: true, whois: async () => null, log: () => {} });
    const gone = memConn(mgr2, 'imac');
    check('wrong secret sets an in-memory connection error', seen && seen.code === 'E_UNAUTHORIZED', seen);
    check('a new manager on the same directory does not see that error', !disk && gone == null, { disk, gone });
    await new Promise(r => { try { srv.closeAllConnections(); } catch {} srv.close(r); });
    fs.rmSync(dir, { recursive: true, force: true });
    return imac.token;
  });
}

async function ownerApi() {
  delete process.env.STUDIO_FLAVOR;
  delete process.env.STUDIO_APP_BUNDLE_ID;
  delete process.env.DB_PATH;
  process.env.STUDIO_SQLITE = 'node';
  process.env.NODE_PATH = process.env.NODE_PATH || '/workspace/node_modules';
  const { startServer } = require(path.join(FE, 'test/helpers/server.js'));
  const port = 28111;
  const np = 28112;
  const s = await startServer({
    port,
    cwd: FE,
    env: { STUDIO_OPS_NODES: '1', STUDIO_OPS_SECURITY: '1', STUDIO_SQLITE: 'node', OPS_NODES_PORT: String(np), NODE_PATH: process.env.NODE_PATH },
  });
  try {
    const noCookie = { 'content-type': 'application/json', 'x-studio-request': '1' };
    const noCsrf = { 'content-type': 'application/json', cookie: s.A.cookie };
    const nodeBearer = { 'content-type': 'application/json', 'x-studio-request': '1', authorization: 'Bearer nk_imac.WRONGSECRETWRONGSECRETWRONG' };
    const probes = [
      ['POST', '/api/ops/nodes/enroll', noCookie, { role: 'news', name: 'x' }],
      ['POST', '/api/ops/nodes/imac/revoke', noCookie, {}],
      ['POST', '/api/ops/nodes/imac/command', noCookie, { command: 'pause' }],
      ['POST', '/api/ops/nodes/jobs', noCookie, { capability: 'news.collect', input: {} }],
      ['GET', '/api/ops/nodes', noCookie, undefined],
      ['POST', '/api/ops/nodes/enroll/R7K2Q/confirm', noCsrf, { acknowledgeUnverifiedPeer: true }],
      ['POST', '/api/ops/nodes/imac/revoke', nodeBearer, {}],
      ['POST', '/api/ops/nodes/imac/rotate', nodeBearer, {}],
      ['POST', '/api/ops/nodes/enroll/R7K2Q/reject', nodeBearer, {}],
    ];
    const rows = [];
    for (const [method, p, headers, body] of probes) rows.push({ method, path: p, status: (await s.j(method, p, headers, body)).status });
    const bearerRows = rows.filter(r => r.path.endsWith('/revoke') || r.path.endsWith('/rotate') || r.path.endsWith('/reject'));
    check('owner node routes reject a missing session', rows.filter(r => !String(r.path).includes('/confirm') && r.path !== '/api/ops/nodes/imac/rotate' && !r.path.endsWith('/reject')).every(r => r.status === 401) && rows.filter(r => r.path.endsWith('/revoke')).every(r => r.status === 401), rows);
    check('confirm without the studio request header is 403', rows.find(r => r.path.includes('/confirm')).status === 403, rows);
    check('a node bearer is not a studio session', bearerRows.every(r => r.status === 401), bearerRows);

    const created = await s.j('POST', '/api/ops/nodes/enroll', s.A, { role: 'news', name: 'iMac' });
    const rid = created.body && created.body.requestId;
    const bare = await s.j('POST', '/api/ops/nodes/enroll/' + rid + '/confirm', s.A, {});
    const badPw = await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-confirm', password: 'wrong-password' });
    const okPw = await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-confirm', password: 'fake-password-123' });
    const tok = okPw.body && okPw.body.confirmToken;
    const withTok = await s.j('POST', '/api/ops/nodes/enroll/' + rid + '/confirm', { ...s.A, 'x-studio-confirm': tok }, { acknowledgeUnverifiedPeer: false });
    const rev = await s.j('POST', '/api/ops/nodes/imac/revoke', s.A, {});
    const rot = await s.j('POST', '/api/ops/nodes/imac/rotate', s.A, {});
    const leg = await s.j('POST', '/api/ops/nodes', s.A, { id: 'imac', role: 'news' });
    const legPw = await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-legacy-token', password: 'fake-password-123' });
    const leg2 = await s.j('POST', '/api/ops/nodes', { ...s.A, 'x-studio-confirm': legPw.body.confirmToken }, { id: 'imac', role: 'news', name: 'iMac' });
    const rej = await s.j('POST', '/api/ops/nodes/enroll/' + rid + '/reject', s.A, {});
    const nodesGet = await s.j('GET', '/api/ops/nodes', s.A);
    const auditGet = await s.j('GET', '/api/ops/nodes/audit', s.A);
    const enrollGet = await s.j('GET', '/api/ops/nodes/enroll', s.A);
    const blob = JSON.stringify(nodesGet.body) + JSON.stringify(auditGet.body) + JSON.stringify(enrollGet.body) + s.out.join('');
    const code = created.body && created.body.code;
    check('security center confirm without a password token is 428', bare.status === 428 && bare.body && bare.body.action === 'node-confirm', bare.body);
    check('wrong password is 403 and the right password issues a token', badPw.status === 403 && okPw.status === 200 && !!tok, { bad: badPw.status, ok: okPw.status });
    check('password token reaches confirm and does not treat the action as unknown', withTok.status !== 428 && !(withTok.body && /Неизвестное действие/.test(JSON.stringify(withTok.body))), { status: withTok.status, body: withTok.body });
    check('revoke and rotate still require the password', rev.status === 428 && rot.status === 428, { rev: rev.status, rot: rot.status });
    check('legacy token stays disabled after the password', leg.status === 428 && leg2.status === 403 && leg2.body && leg2.body.code === 'E_LEGACY_DISABLED', { leg: leg.status, leg2: leg2.status, code: leg2.body && leg2.body.code });
    check('reject still skips the password', rej.status !== 428, { status: rej.status, body: rej.body });
    check('owner GET responses omit the one-time code and the fake password', code && !blob.includes(code) && !blob.includes('fake-password-123'), { codeLen: code && code.length });
    const log = s.out.join('');
    fs.writeFileSync(path.join(OUT, 'owner-api.json'), JSON.stringify({ rows, bare: bare.body, withTok, rev: rev.status, rot: rot.status, leg2: leg2.body, rej: rej.body }, null, 2));
    return { logHasPassword: log.includes('fake-password-123') };
  } finally {
    await s.cleanup();
  }
}

async function main() {
  const fe = await probe('fe8e4ab', FE, { expectDiskConn: false });
  const pre = await probe('343d645', PRE, { expectDiskConn: true });
  const old = await probe('b7101c4', V124, { expectDiskConn: false });
  check('fe8e4ab records the failed token in memory', fe.memAfterUnauth && fe.memAfterUnauth.code === 'E_UNAUTHORIZED', fe.memAfterUnauth);
  check('b7101c4 does not record a connection error for a foreign token', old.memAfterUnauth == null, old.memAfterUnauth);
  check('343d645 is the build that wrote the error', pre.memAfterUnauth && pre.memAfterUnauth.code === 'E_UNAUTHORIZED', pre.memAfterUnauth);
  await memoryOnly();
  await peerAndAck();
  classifyChecks();
  const owner = await ownerApi();
  check('studio log omits the fake password', owner.logHasPassword === false, null);
  const failed = results.filter(r => !r.ok).map(r => r.name);
  const summary = { commit: 'fe8e4ab56fdc756a22e128724502ea45a73c3660', pre: '343d645', v124: 'b7101c437466599558bf14653ff782677a2ec95b', controls: results.length, failed };
  fs.writeFileSync(path.join(OUT, 'attack.json'), JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary));
  if (failed.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
