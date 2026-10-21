'use strict';
// Full connection test, MOONKATTY NODE 0.2.2: real TLS coordinator + two REAL agent processes (NEWS + MONITOR profile), enrolled by one-time code.
// enroll → confirm → pull/heartbeat/complete → rotate → revoke → re-enroll → offline→online; agent-side connection errors (pin mismatch).
// Keychain = test double; Tailscale not available here (peer unverified → explicit owner ack).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'); const { spawn } = require('child_process');
const N = require('../../lib/ops/nodes.js'); const EN = require('../../node-agent/enroll.js'); const A = require('../../node-agent/agent.js');
const ROOT = path.join(__dirname, '..', '..'); const sleep = ms => new Promise(r => setTimeout(r, ms)); const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const ACK = { acknowledgeUnverifiedPeer: true }; const BASEPORT = 21000 + (process.pid % 2000) * 3;
async function until(fn, ms = 20000, step = 100) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error('timeout: ' + fn.toString().slice(0, 120)); await sleep(step); } }
const getJSON = port => new Promise(res => http.get({ host: '127.0.0.1', port, path: '/status' }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch { res(null); } }); }).on('error', () => res(null)));

test('NEWS NODE 0.2.2 + MONITOR NODE 0.2.2: full lifecycle against the coordinator', { timeout: 120000 }, async () => {
  const dir = tmp('e2e-coord-'); const logs = []; const m = N.createNodeManager({ dir, leaseMs: 3000, nodeDownMs: 2500, log: (...x) => logs.push(x.join(' ')) }); const tls = N.ensureCert(dir);
  const srv = await N.listen(m, { host: '127.0.0.1', port: 0, tls }); const url = `https://127.0.0.1:${srv.address().port}`;
  const slow = http.createServer((q, r) => setTimeout(() => r.end('<rss><item><title>[SIM] one</title><link>http://x/1</link></item></rss>'), 2500)); await new Promise(r => slow.listen(0, '127.0.0.1', r));
  const kcDir = tmp('e2e-kc-'); const procs = []; const out = { imac: '', macbook: '' }; const homes = {};
  const env = id => ({ PATH: process.env.PATH, HOME: homes[id], NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(kcDir, id + '.json'), NODE_POLL_MS: '250', NODE_AUTH_RETRY_MS: '400' });
  const port = { imac: BASEPORT, macbook: BASEPORT + 1 };
  const start = (id, extra = {}, p = port[id]) => { const c = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { env: { ...env(id), NODE_STATUS_PORT: String(p), ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    c.stdout.on('data', d => out[id] += d); c.stderr.on('data', d => out[id] += d); procs.push(c); return c; };
  const stop = async c => { if (c.exitCode !== null || c.signalCode) return; c.kill('SIGTERM'); await Promise.race([new Promise(r => c.once('exit', r)), sleep(4000)]); if (c.exitCode === null && !c.signalCode) { c.kill('SIGKILL'); await new Promise(r => c.once('exit', r)); } };
  const node = id => m.status().nodes.find(n => n.id === id); const job = id => m.status().jobs.find(j => j.id === id);
  async function enrollBoth(ids) { const ps = ids.map(id => { homes[id] ||= tmp('e2e-home-' + id + '-'); const r = m.enrollment.create({ role: id === 'imac' ? 'news' : 'monitor', name: id });
      return EN.enroll({ url, fingerprint: tls.fingerprint, code: r.code, home: path.join(homes[id], '.moonkatty-node'), env: env(id), info: { hostname: id, agentVersion: A.VERSION }, pollMs: 100 }); });
    const pend = await until(() => { const l = m.enrollment.list().filter(q => q.state === 'pending'); return l.length === ids.length && l; });
    for (const q of pend) { assert.equal(q.device.peerVerified, false); assert.ok(!/127\.0\.0\.1/.test(q.device.peer), 'never shows 127.0.0.1 as device address'); assert.throws(() => m.enrollment.confirm(q.requestId), e => e.code === 'E_PEER_UNVERIFIED'); m.enrollment.confirm(q.requestId, ACK); }
    return Promise.all(ps); }
  try {
    // 1) enroll by code + confirm
    const res = await enrollBoth(['imac', 'macbook']); assert.deepEqual(res.map(r => r.role).sort(), ['monitor', 'news']);
    let ai = start('imac'), am = start('macbook');
    await until(() => node('imac')?.status === 'online' && node('macbook')?.status === 'online');
    assert.equal(node('imac').info.agentVersion, '0.2.2'); assert.equal(node('macbook').title, 'MONITOR NODE'); assert.ok(node('imac').deviceKeyShort);
    // 2) pull / heartbeat / complete
    const j1 = m.submit({ capability: 'news.collect', input: { feeds: [`http://127.0.0.1:${slow.address().port}/a`] }, safeToRetry: true }).jobId;
    const j2 = m.submit({ capability: 'studio.health', input: { urls: [] } }).jobId;
    await until(() => job(j1)?.status === 'succeeded' && job(j2)?.status === 'succeeded', 30000);
    assert.equal(job(j1).nodeId, 'imac'); assert.equal(job(j2).nodeId, 'macbook'); assert.ok(job(j1).heartbeatAt, 'heartbeat received during the slow job');
    // 3) rotation (owner flag → agent rotates, keeps working with the new token)
    const kcI = () => JSON.parse(fs.readFileSync(path.join(kcDir, 'imac.json'), 'utf8'))['moonkatty-node-imac|node-token']; const t0 = kcI();
    m.requestRotate('imac'); await until(() => kcI() !== t0 && !node('imac').rotatePending); const j3 = m.submit({ capability: 'news.dedup', input: { items: [{ title: 'a', link: '1' }] } }).jobId;
    await until(() => job(j3)?.status === 'succeeded'); assert.ok(m.audit().some(a => a.type === 'rotated' && a.nodeId === 'imac'));
    // 4) revoke → agent shows connection error, coordinator shows revoked
    m.revokeNode('imac'); await until(async () => { const s = await getJSON(port.imac); return s && s.connError && s.connError.code === 'E_UNAUTHORIZED'; });
    assert.equal(node('imac').status, 'revoked'); await until(() => node('imac').lastConnError?.code === 'E_REVOKED');
    // 5) re-enroll iMac (new code, new token), restart agent → online again
    await stop(ai); await enrollBoth(['imac']); ai = start('imac'); await until(() => node('imac').status === 'online' && !node('imac').revoked);
    const j4 = m.submit({ capability: 'news.dedup', input: { items: [] } }).jobId; await until(() => job(j4)?.status === 'succeeded' && job(j4).nodeId === 'imac');
    // 6) offline → online (MacBook stops; heartbeat stale → down; restart → online)
    await stop(am); await until(() => { m.sweep(); return node('macbook').status === 'down'; }, 15000); am = start('macbook'); await until(() => node('macbook').status === 'online');
    // 7) agent-side TLS fingerprint mismatch is reported on the node status screen
    const bad = start('macbook', { COORDINATOR_FINGERPRINT: 'a'.repeat(64) }, BASEPORT + 2); const s = await until(async () => { const x = await getJSON(BASEPORT + 2); return x && x.connError && x; });
    assert.equal(s.connError.code, 'E_PIN'); assert.equal(s.online, false); await stop(bad);
    // 8) version gate recorded for the panel (simulated old/new agent version through a signed request)
    const dk = await EN.deviceIdentity(path.join(homes.macbook, '.moonkatty-node'), EN.keychain(env('macbook')), { create: false });
    const tokM = JSON.parse(fs.readFileSync(path.join(kcDir, 'macbook.json'), 'utf8'))['moonkatty-node-macbook|node-token'];
    const cert = path.join(homes.macbook, '.moonkatty-node', 'coordinator.crt'); const r426 = await A.client({ url, certFile: cert, fingerprint: tls.fingerprint, token: tokM, deviceKey: dk.key })('POST', '/hello', { info: { agentVersion: '0.3.1' } });
    assert.equal(r426.status, 426); assert.equal(m.status().nodes.find(n => n.id === 'macbook').lastConnError.code, 'E_AGENT_VERSION');
    // secrets: no token / request secret / private key in coordinator logs, audit, state, agent output or files
    const tokens = [kcI(), tokM]; const blob = [logs.join('\n'), JSON.stringify(m.audit()), JSON.stringify(m.status()), out.imac, out.macbook, fs.readFileSync(path.join(dir, 'nodes.json'), 'utf8'),
      ...['imac', 'macbook'].flatMap(id => fs.readdirSync(path.join(homes[id], '.moonkatty-node')).map(f => { try { return fs.readFileSync(path.join(homes[id], '.moonkatty-node', f), 'latin1'); } catch { return ''; } }))].join('\n');
    for (const t of tokens) { assert.ok(!blob.includes(t), 'token leaked'); assert.ok(!blob.includes(t.split('.')[1]), 'token secret leaked'); } assert.ok(!/PRIVATE KEY/.test(blob));
  } finally { for (const c of procs) await stop(c); await new Promise(r => { srv.closeAllConnections(); srv.close(r); }); slow.close(); }
});
