// Independent re-check of NODE 0.2.2 claims against feat/studio-operations @ db4720b.
// Reads NODE_022_SRC (default /tmp/mk-node022). Does not write into that tree.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const http = require('http'), https = require('https'), { spawn, spawnSync, execFileSync } = require('child_process');
const SRC = process.env.NODE_022_SRC || '/tmp/mk-node022';
const N = require(path.join(SRC, 'lib/ops/nodes.js'));
const E = require(path.join(SRC, 'lib/ops/node-enroll.js'));
const EN = require(path.join(SRC, 'node-agent/enroll.js'));
const A = require(path.join(SRC, 'node-agent/agent.js'));
const SC = require(path.join(SRC, 'lib/ops/security-center.js'));
const { startServer } = require(path.join(SRC, 'test/helpers/server.js'));
const HERE = __dirname;
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'n022-'));
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const devKeys = () => { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); return { id: 'dev_' + crypto.randomBytes(16).toString('hex'), pub: publicKey.export({ type: 'spki', format: 'pem' }), key: privateKey }; };
const ridOf = code => String(code).toUpperCase().replace(/[\s-]/g, '').slice(0, 5);
const enBody = (code, d, info) => ({ code, deviceId: d.id, devicePubKey: d.pub, proof: EN.sign(d.key, `enroll:${ridOf(code)}:${d.id}`), info: info || { hostname: '<img src=x>', model: 'iMac18,3', os: 'macOS 13.7.1', arch: 'x64', agentVersion: '0.2.2' } });
const errOf = fn => { try { const v = fn(); return { ok: true, v }; } catch (e) { return { ok: false, code: e.code, message: e.message }; } };
const kcEnv = () => { const d = tmp('kc-'); return { NODE_KEYCHAIN_BIN: path.join(SRC, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(d, 'kc.json'), FAKE_KC_ARGV: path.join(d, 'argv.log'), HOME: d }; };
function signed(key, method, p, body, ts, nonce) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body));
  const n = nonce || crypto.randomBytes(18).toString('base64url');
  return { method, path: p, ts, nonce: n, sig: EN.sign(key, `${method}\n${p}\n${ts}\n${n}\n${sha256(data)}`), body: data };
}
const R = (ra, h = {}) => ({ socket: { remoteAddress: ra }, headers: h });
function median(fn, n = 250) { for (let i = 0; i < 40; i++) fn(); const a = []; for (let i = 0; i < n; i++) { const t = process.hrtime.bigint(); fn(); a.push(Number(process.hrtime.bigint() - t)); } a.sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; }

async function main() {
  const rows = [];
  const rec = (id, ok, detail) => { rows.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${id}: ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`); };
  const commit = execFileSync('git', ['-C', SRC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', SRC, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  rec('commit', commit === 'db4720bee599f42a815c6876eb1446317f7d5258', commit);
  rec('worktree-clean-before', dirty === '', dirty || 'clean');

  // nonce is inside the signature; replay is 401; 31s is refused; a new process forgets the nonce
  {
    let clock = 1_700_000_000_000; const dir = tmp('replay-'); const d = devKeys();
    const m1 = N.createNodeManager({ dir, now: () => clock, log: () => {} });
    const created = m1.enrollment.create({ role: 'news', name: 'iMac' });
    const e = m1.enrollment.enroll(enBody(created.code, d), '10.1.1.1');
    m1.enrollment.confirm(e.requestId);
    const nonce = crypto.randomBytes(18).toString('base64url');
    const st = m1.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts: clock, nonce, sig: EN.sign(d.key, `status:${e.requestId}:${clock}:${nonce}`) }, '10.1.1.1');
    const token = st.token;
    m1.submit({ capability: 'news.collect', input: {} }); m1.submit({ capability: 'news.collect', input: {} });
    const body = Buffer.from(JSON.stringify({ info: { agentVersion: '0.2.2' } }));
    const s1 = signed(d.key, 'POST', '/api/nodes/pull', body, clock);
    const a1 = m1.authNode('Bearer ' + token, s1);
    const pull1 = a1 && m1.pull(a1, { agentVersion: '0.2.2' });
    const again = {}; const a2 = m1.authNode('Bearer ' + token, s1, again);
    const late = signed(d.key, 'POST', '/api/nodes/pull', body, clock - 31000);
    const lateOut = {}; m1.authNode('Bearer ' + token, late, lateOut);
    const noNonce = { method: 'POST', path: '/api/nodes/pull', ts: clock, sig: EN.sign(d.key, `POST\n/api/nodes/pull\n${clock}\n${sha256(body)}`), body };
    const old = {}; m1.authNode('Bearer ' + token, noNonce, old);
    const m2 = N.createNodeManager({ dir, now: () => clock, log: () => {} });
    const restarted = m2.authNode('Bearer ' + token, s1);
    rec('nonce-in-signature-replay-401', !!pull1.job && a2 === null && again.code === 'E_REPLAY' && lateOut.code === 'E_UNAUTHORIZED' && old.code === 'E_AGENT_VERSION', { job: pull1 && pull1.job && pull1.job.id, replay: again.code, late: lateOut.code, noNonce: old.code, protocolField: st.protocol });
    rec('nonce-store-is-memory-only', !!restarted && restarted.id === 'imac', restarted ? 'second manager accepted the captured request' : 'refused');
    const self = m1.handler && null;
    void self;
    const rot = await new Promise((resolve) => {
      const srvP = N.ensureCert(dir);
      N.listen(m2, { host: '127.0.0.1', port: 0, tls: srvP }).then(srv => {
        const u = new URL(`https://127.0.0.1:${srv.address().port}`);
        const rb = Buffer.from('{}'); const sg = signed(d.key, 'POST', '/api/nodes/rotate', rb, clock);
        const q = https.request({ method: 'POST', host: u.hostname, port: u.port, path: '/api/nodes/rotate', ca: fs.readFileSync(path.join(dir, 'nodes-tls.crt')), checkServerIdentity: () => undefined, headers: { authorization: 'Bearer ' + token, 'x-node-ts': String(sg.ts), 'x-node-nonce': sg.nonce, 'x-node-sig': sg.sig, 'content-type': 'application/json' } }, rs => { let b = ''; rs.on('data', x => b += x); rs.on('end', () => { srv.close(() => resolve({ status: rs.statusCode, body: JSON.parse(b) })); }); });
        q.on('error', e => resolve({ error: e.message })); q.end(rb);
      });
    });
    rec('rotate-requires-owner-flag', rot.status === 409 && rot.body && rot.body.code === 'E_ROTATE_NOT_REQUESTED', rot);
    m2.requestRotate('imac');
    const rot2 = await new Promise((resolve) => {
      N.listen(m2, { host: '127.0.0.1', port: 0, tls: N.ensureCert(dir) }).then(srv => {
        const u = new URL(`https://127.0.0.1:${srv.address().port}`);
        const rb = Buffer.from('{}'); const sg = signed(d.key, 'POST', '/api/nodes/rotate', rb, clock);
        const q = https.request({ method: 'POST', host: u.hostname, port: u.port, path: '/api/nodes/rotate', ca: fs.readFileSync(path.join(dir, 'nodes-tls.crt')), checkServerIdentity: () => undefined, headers: { authorization: 'Bearer ' + token, 'x-node-ts': String(sg.ts), 'x-node-nonce': sg.nonce, 'x-node-sig': sg.sig, 'content-type': 'application/json' } }, rs => { let b = ''; rs.on('data', x => b += x); rs.on('end', () => { srv.close(() => resolve({ status: rs.statusCode, body: JSON.parse(b) })); }); });
        q.on('error', e => resolve({ error: e.message })); q.end(rb);
      });
    });
    rec('rotate-after-owner-flag', rot2.status === 200 && rot2.body && /^nk_imac\./.test(rot2.body.token || ''), { status: rot2.status, hasToken: !!(rot2.body && rot2.body.token) });
  }

  // peer buckets, XFF spoof, unknown fallback DoS
  {
    const whois = async ip => ({ '100.101.1.1': { id: 'nIMAC', name: 'imac', login: 'igor@x' }, '100.101.1.2': { id: 'nEVIL', name: 'other', login: 'guest@x' } }[ip] || null);
    const m = N.createNodeManager({ dir: tmp('peer-'), whois, log: () => {} });
    const loopXff = await m.peerOf(R('127.0.0.1', { 'x-forwarded-for': '100.101.1.1' }));
    const loopEvil = await m.peerOf(R('127.0.0.1', { 'x-forwarded-for': '100.101.1.2' }));
    const nonLoop = await m.peerOf(R('100.101.1.2', { 'x-forwarded-for': '100.101.1.1', 'tailscale-user-login': 'igor@x' }));
    const lan = await m.peerOf(R('10.9.9.9', { 'x-forwarded-for': '100.101.1.1' }));
    const unknown = await m.peerOf(R('127.0.0.1', {}));
    const login = await m.peerOf(R('127.0.0.1', { 'x-forwarded-for': '8.8.8.8', 'tailscale-user-login': 'Igor@X' }));
    rec('xff-trusted-on-loopback', loopXff.key === 'tsnode:nIMAC' && loopEvil.key === 'tsnode:nEVIL', { loopXff: loopXff.key, loopEvil: loopEvil.key });
    rec('xff-ignored-off-loopback', nonLoop.key === 'tsnode:nEVIL' && lan.key === 'ip:10.9.9.9', { nonLoop: nonLoop.key, lan: lan.key, login: login.key });
    const d = devKeys();
    for (let i = 0; i < 10; i++) errOf(() => m.enrollment.enroll(enBody('ZZZZZ-2222222222', d), unknown));
    const otherUnknown = await m.peerOf(R('::1', {}));
    const locked = errOf(() => m.enrollment.enroll(enBody('YYYYY-3333333333', d), otherUnknown));
    const created = m.enrollment.create({ role: 'news' });
    const still = m.enrollment.enroll(enBody(created.code, devKeys()), loopXff);
    rec('unknown-bucket-dos-is-shared', unknown.key === 'loopback' && otherUnknown.key === 'loopback' && locked.code === 'E_IP_LOCKED' && still.status === 'pending', { unknown: unknown.key, other: otherUnknown.key, locked: locked.code, identified: still.status });
    const dir = tmp('spoof-'); const ms = N.createNodeManager({ dir, whois, log: () => {} });
    const victim = await ms.peerOf(R('127.0.0.1', { 'x-forwarded-for': '100.101.1.1' }));
    for (let i = 0; i < 10; i++) errOf(() => ms.enrollment.enroll(enBody('ZZZZZ-2222222222', d), victim));
    const victimLocked = errOf(() => ms.enrollment.enroll(enBody('YYYYY-3333333333', d), victim));
    const other = await ms.peerOf(R('127.0.0.1', { 'x-forwarded-for': '100.101.1.2' }));
    const otherOk = ms.enrollment.create({ role: 'monitor', nodeId: 'macbook' });
    const otherEn = ms.enrollment.enroll(enBody(otherOk.code, devKeys()), other);
    rec('loopback-xff-can-lock-named-peer', victimLocked.code === 'E_IP_LOCKED' && otherEn.status === 'pending', { victim: victimLocked.code, other: otherEn.status });
  }

  // locks persist, nodes.lock
  {
    const dir = tmp('lock-'); const d = devKeys();
    const m1 = N.createNodeManager({ dir, log: () => {} });
    for (let i = 0; i < 10; i++) errOf(() => m1.enrollment.enroll(enBody('ZZZZZ-2222222222', d), '10.8.8.8'));
    const m2 = N.createNodeManager({ dir, log: () => {} });
    const made = m2.enrollment.create({ role: 'news', nodeId: 'imac' });
    const after = errOf(() => m2.enrollment.enroll(enBody(made.code, d), '10.8.8.8'));
    rec('ip-lock-persists-across-manager', after.code === 'E_IP_LOCKED', after.code);
    const held = tmp('held-');
    const child = spawn(process.execPath, ['-e', `require(${JSON.stringify(path.join(SRC, 'lib/ops/nodes.js'))}).createNodeManager({ dir: ${JSON.stringify(held)} }); setInterval(() => {}, 1000);`], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 400));
    let second = '';
    try { N.createNodeManager({ dir: held, log: () => {} }); second = 'opened'; } catch (e) { second = e.message; }
    child.kill('SIGKILL'); await new Promise(r => child.on('exit', r));
    let stale = 'threw';
    try { N.createNodeManager({ dir: held, log: () => {} }); stale = 'opened'; } catch (e) { stale = e.message; }
    rec('nodes-lock-blocks-second-process', /уже используется/.test(second) && stale === 'opened', { second: second.slice(0, 180), stale });
  }

  // screens, stdin, tls mode
  {
    const ui = fs.readFileSync(path.join(SRC, 'public/ops-ui.js'), 'utf8');
    const html = fs.readFileSync(path.join(SRC, 'node-agent/enroll.html'), 'utf8');
    rec('panel-shows-fingerprint-and-unverified', /pubKeyFingerprint/.test(ui) && /Ключ устройства: \$\{dv\.pubKeyShort\}/.test(ui) && /Сообщено устройством \(не проверено\)/.test(ui), 'ops-ui.js');
    rec('node-screen-shows-key', /s\.pubKeyShort/.test(html) && /s\.pubKeyFp/.test(html) && !/innerHTML/.test(html), 'enroll.html');
    const agent = path.join(SRC, 'node-agent/agent.js');
    const code = '23456-789GH-JKMNP';
    const bad = spawnSync(process.execPath, [agent, '--enroll', '--url', 'https://127.0.0.1:9', '--fingerprint', 'ab'.repeat(32), '--code', code], { encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: tmp('home-') } });
    const via = spawnSync(process.execPath, [agent, '--enroll', '--url', 'http://127.0.0.1:9', '--fingerprint', 'ab'.repeat(32)], { input: code + '\n', encoding: 'utf8', timeout: 10000, env: { ...process.env, HOME: tmp('home2-') } });
    rec('code-rejected-on-argv', bad.status === 2 && /не передавайте код/.test(bad.stderr), `status=${bad.status} ${bad.stderr.slice(0, 160)}`);
    rec('code-accepted-on-stdin', via.status === 2 && /только https/.test(via.stderr) && !(via.stdout + via.stderr).includes('JKMNP') && !via.stderr.includes('--code'), `status=${via.status} ${(via.stderr || '').slice(0, 180)}`);
    let tls = '';
    try { await EN.enroll({ url: 'https://10.0.0.5:9', tlsMode: 'tailscale', code: 'X', env: kcEnv(), home: tmp('en-') }); tls = 'allowed'; } catch (e) { tls = e.code || e.message; }
    let clientErr = '';
    try { A.client({ url: 'https://127.0.0.1:1', tlsMode: 'tailscale', token: 'x', fingerprint: 'ab'.repeat(32), certFile: '/tmp/nope' }); clientErr = 'allowed'; } catch (e) { clientErr = e.message; }
    rec('tailscale-mode-requires-ts-net', tls === 'E_TLS_MODE' && /ts\.net/.test(clientErr), { enroll: tls, client: clientErr.slice(0, 180) });
  }

  // funnel
  {
    const off = SC.funnelCheck({ serve: '{}', funnel: '{}' });
    const on = SC.funnelCheck({ serve: JSON.stringify({ AllowFunnel: { 'mac-mini.tailnet.ts.net:443': true } }), funnel: 'null' });
    const unk = SC.funnelCheck({ serve: null, funnel: null });
    const live = SC.securityAudit({ env: {}, list: () => [], q: { meta: { get: () => null } }, dataDir: tmp('aud-'), sec: require(path.join(SRC, 'lib/security.js')), caps: { can: () => false }, tailscaleStatus: () => ({ serve: null, funnel: null }) });
    const row = live.checks.find(c => c.id === 'funnel-not-used');
    rec('funnel-off-is-ok', off.ok === true, off.detail);
    rec('funnel-on-is-not-ok', on.ok === false && /ВКЛЮЧЁН/.test(on.detail), on.detail);
    rec('funnel-unknown-is-not-ok', unk.ok === false && row && row.ok === false, { direct: unk.detail, audit: row && row.detail });
  }

  // timing
  {
    let clock = Date.now(); const m = N.createNodeManager({ dir: tmp('time-'), now: () => clock, log: () => {} });
    const d = devKeys(); const r = m.enrollment.create({ role: 'news' }); const e = m.enrollment.enroll(enBody(r.code, d), '10.4.4.4');
    m.enrollment.confirm(e.requestId);
    const n = crypto.randomBytes(18).toString('base64url');
    const tok = m.enrollment.status({ requestId: e.requestId, requestSecret: e.requestSecret, ts: clock, nonce: n, sig: EN.sign(d.key, `status:${e.requestId}:${clock}:${n}`) }, '10.4.4.4').token;
    const sig = { method: 'GET', path: '/api/nodes/ping', ts: clock, nonce: 'n'.repeat(22), sig: 'AA==', body: Buffer.alloc(0) };
    const wrong = median(() => m.authNode('Bearer nk_imac.' + 'z'.repeat(32), sig));
    const right = median(() => m.authNode('Bearer ' + tok, { ...sig, nonce: crypto.randomBytes(18).toString('base64url') }));
    const ratio = right / wrong;
    rec('token-check-same-work', ratio < 3 && wrong / right < 3, { wrongNs: wrong, rightNs: right, ratio: Math.round(ratio * 100) / 100 });
  }

  // live server: legacy off, password step-up
  {
    const port = 19331, np = 19332;
    const s = await startServer({ port, cwd: SRC, env: { STUDIO_SQLITE: 'node', NODE_PATH: '/workspace/node_modules', STUDIO_OPS_NODES: '1', OPS_NODES_PORT: String(np) } });
    try {
      const legacy = await s.j('POST', '/api/ops/nodes', s.A, { id: 'imac', role: 'news' });
      const ct = (await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-legacy-token', password: 'fake-password-123' })).body;
      const legacy2 = await s.j('POST', '/api/ops/nodes', { ...s.A, 'x-studio-confirm': ct && ct.confirmToken }, { id: 'imac', role: 'news' });
      const en = await s.j('POST', '/api/ops/nodes/enroll', s.A, { role: 'news', name: 'iMac' });
      const confirm = await s.j('POST', `/api/ops/nodes/enroll/${en.body.requestId}/confirm`, s.A, {});
      const badPw = await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-confirm', password: 'wrong-password' });
      const good = await s.j('POST', '/api/ops/confirm', s.A, { action: 'node-confirm', password: 'fake-password-123' });
      const confirm2 = await s.j('POST', `/api/ops/nodes/enroll/${en.body.requestId}/confirm`, { ...s.A, 'x-studio-confirm': good.body.confirmToken }, {});
      const rev = await s.j('POST', '/api/ops/nodes/imac/revoke', s.A, {});
      const rot = await s.j('POST', '/api/ops/nodes/imac/rotate', s.A, {});
      rec('legacy-tokens-off-by-default', legacy2.status === 403 && legacy2.body && legacy2.body.code === 'E_LEGACY_DISABLED', { first: legacy.status, afterPassword: legacy2.status, code: legacy2.body && legacy2.body.code });
      rec('confirm-revoke-rotate-need-password', confirm.status === 428 && confirm.body.action === 'node-confirm' && badPw.status === 403 && confirm2.status === 400 && rev.status === 428 && rot.status === 428, { confirm: confirm.status, badPw: badPw.status, afterPassword: confirm2.status, revoke: rev.status, rotate: rot.status });
    } finally { await s.cleanup(); }
  }

  const dirtyAfter = execFileSync('git', ['-C', SRC, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  rec('worktree-clean-after', dirtyAfter === '', dirtyAfter || 'clean');
  const failed = rows.filter(r => !r.ok).map(r => r.id);
  fs.mkdirSync(path.join(HERE, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'logs', 'attack.json'), JSON.stringify({ commit, controls: rows.length, failed, rows }, null, 2));
  fs.writeFileSync(path.join(HERE, 'logs', 'attack.log'), rows.map(r => `${r.ok ? 'OK' : 'FAIL'}\t${r.id}\t${typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)}`).join('\n') + '\n');
  console.log(JSON.stringify({ commit, controls: rows.length, failed }));
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
