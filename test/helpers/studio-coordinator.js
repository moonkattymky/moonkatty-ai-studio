'use strict';
// v1.2.4: same stdout/admin contract as test/helpers/coordinator.js, but the coordinator is OUR server.js (Node Manager mounted by
// lib/ops/nodes-server.js, TLS listener on 127.0.0.1). The admin calls go through the real owner-only admin API (login, CSRF, confirmation).
const http = require('http'), path = require('path'), fs = require('fs'), net = require('net'); const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const dir = process.env.COORD_DIR;
const free = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
(async () => {
  const [port, nport] = [await free(), await free()]; const PW = 'fake-test-password-' + process.pid;
  // watchdog: the server dies with this helper even on SIGKILL (stdin EOF), so no orphan server survives a test run
  const startSrv = () => spawn(process.execPath, ['-e', "const c=require('child_process').spawn(process.execPath,['server.js'],{stdio:['ignore','ignore','inherit']});process.stdin.on('end',()=>{c.kill('SIGKILL');process.exit(0)});process.stdin.resume()"], { cwd: ROOT, stdio: ['pipe', 'ignore', 'inherit'], env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: process.env.COORD_FLAVOR || 'prod', STUDIO_DATA_DIR: dir, PORT: String(port),
    STUDIO_ADMIN_USER: 'owner', STUDIO_ADMIN_PASSWORD: PW, STUDIO_NODES: '1', STUDIO_NODES_BIND: '', STUDIO_NODES_PORT: String(nport),
    STUDIO_NODES_LEASE_MS: process.env.COORD_LEASE_MS || '1500', STUDIO_NODES_DOWN_MS: process.env.COORD_DOWN_MS || '2500', STUDIO_NODES_SWEEP_MS: '300' } });
  let srv = startSrv();
  process.on('exit', () => { try { srv.kill('SIGKILL'); } catch {} }); process.on('SIGTERM', () => process.exit(0));
  let cookie = ''; const H = { 'content-type': 'application/json', 'x-studio-request': '1', origin: `http://127.0.0.1:${port}` };
  const call = (method, p, body, extra = {}) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...H, cookie, ...extra } }, x => { let d = ''; x.on('data', z => d += z);
    x.on('end', () => { if (x.headers['set-cookie']) cookie = x.headers['set-cookie'].map(c => c.split(';')[0]).join('; '); let j; try { j = JSON.parse(d); } catch { j = { raw: d }; } res({ status: x.statusCode, body: j }); }); }); r.on('error', rej); if (body !== undefined) r.end(Buffer.isBuffer(body) ? body : JSON.stringify(body)); else r.end(); });
  let st; const boot = async () => { cookie = '';
  for (let i = 0; i < 200; i++) { try { if ((await call('GET', '/api/health')).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  await call('POST', '/api/auth/login', { username: 'owner', password: PW });
  for (let i = 0; i < 100; i++) { st = (await call('GET', '/api/ops/nodes')).body; if (st.listening && st.listening.length) break; await new Promise(r => setTimeout(r, 100)); }
  };
  await boot();
  const ok = r => { if (r.status >= 400) throw new Error(r.body.error || 'HTTP ' + r.status); return r.body; };
  const admin = http.createServer(async (req, res) => { const c = []; for await (const d of req) c.push(d); const b = c.length ? JSON.parse(Buffer.concat(c)) : {};
    try { let out; const u = req.url;
      if (u === '/register') { // QA-NODE-005: legacy direct tokens are OFF in v1.3.0-test → real enrollment by one-time code through the owner API
        // (create → node enrolls with its device key over pinned TLS → owner confirms with password + unverified-peer ack). Keychain = test double.
        const role = { imac: 'news', macbook: 'monitor', news: 'news', monitor: 'monitor' }[b.role] || b.role; const EN = require('../../node-agent/enroll.js');
        const home = path.join(dir, 'home-' + b.id); const kc = path.join(dir, 'kc-' + b.id + '.json'); fs.mkdirSync(home, { recursive: true, mode: 0o700 });
        const kenv = { ...process.env, NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: kc };
        const r = ok(await call('POST', '/api/ops/nodes/enroll', { role, nodeId: b.id, name: b.id, confirm: 'ПОДКЛЮЧИТЬ', password: PW }));
        const pend = EN.enroll({ url: `https://127.0.0.1:${nport}`, fingerprint: st.fingerprint, code: r.code, home: path.join(home, '.moonkatty-node'), env: kenv, info: { hostname: b.id, agentVersion: require('../../node-agent/agent.js').VERSION }, pollMs: 100 });
        for (let i = 0; i < 200; i++) { const l = ok(await call('GET', '/api/ops/nodes/enroll')).requests; if (l.some(q => q.requestId === r.requestId && q.state === 'pending')) break; await new Promise(z => setTimeout(z, 50)); }
        ok(await call('POST', `/api/ops/nodes/enroll/${r.requestId}/confirm`, { confirm: 'ПОДТВЕРДИТЬ', password: PW, acknowledgeUnverifiedPeer: true }));
        const e = await pend; out = { id: e.nodeId, enrolled: true, home, kcFile: kc, keychainBin: kenv.NODE_KEYCHAIN_BIN }; }
      else if (u === '/restart') { // r3: crash-like coordinator restart (SIGKILL, no clean shutdown), same data dir and ports
        const old = srv; await new Promise(r => { old.once('exit', r); old.stdin.end(); }); for (let i = 0; i < 50; i++) { try { await call('GET', '/api/health'); } catch { break; } await new Promise(r => setTimeout(r, 50)); }
        const t0 = Date.now(); srv = startSrv(); await boot(); out = { restartedMs: Date.now() - t0, fingerprint: st.fingerprint }; }
      else if (u === '/submit') out = ok(await call('POST', '/api/ops/nodes/jobs', b));
      else if (u === '/status') out = { ...ok(await call('GET', '/api/ops/nodes')), jobsFull: ok(await call('GET', '/api/ops/nodes/jobs')) };
      else if (u === '/put-file') { const buf = Buffer.from(b.data, 'base64'); const h = require('crypto').createHash('sha256').update(buf).digest('hex'); out = { sha256: ok(await call('PUT', '/api/ops/nodes/files/' + h, buf, { 'content-type': 'application/octet-stream' })).sha256 }; }
      else if (u === '/command') out = ok(await call('POST', `/api/ops/nodes/${b.id}/command`, { command: b.command }));
      else if (u === '/retry') out = ok(await call('POST', `/api/ops/nodes/jobs/${b.id}/retry`, {}));
      else throw new Error('404');
      res.end(JSON.stringify(out)); } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); } });
  admin.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ port: nport, admin: admin.address().port, fingerprint: st.fingerprint, cert: path.join(dir, 'ops', 'nodes-tls.crt'), studioPort: port }) + '\n'));
})();
