'use strict';
// MONITOR NODE (MacBook Pro Retina 13" Early 2015, i5 2.7 GHz 2 cores, 8 GB DDR3, macOS Monterey 12.7.6, x86_64).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'); const { execFileSync, execFile } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const A = require('../../node-agent/agent.js'); const N = require('../../lib/ops/nodes.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'monnode-')); const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const env = o => ({ HOME: tmp(), NODE_AGENT_ENV: '/nonexistent', NODE_ID: 'macbook', NODE_TOKEN: 'nk_macbook.' + 'a'.repeat(32), COORDINATOR_URL: 'https://100.100.1.2:8790', NODE_TLS_MODE: 'pinned', ...o });

test('MacBook device profile = real hardware (Monterey 12.7.6, 2 cores, Node 22 not 24)', () => {
  const d = N.DEVICES.macbook; assert.equal(d.os, 'macOS Monterey 12.7.6'); assert.match(d.model, /MacBook Pro Retina 13" Early 2015/); assert.match(d.cpu, /i5 2\.7 GHz, 2 cores/);
  assert.equal(d.ram, '8 GB DDR3'); assert.match(d.gpu, /Iris Graphics 6100/); assert.equal(d.arch, 'x86_64'); assert.match(d.runtime, /Node\.js 22 LTS/); assert.match(d.runtime, /Node 24 needs 13\.5 — not allowed/);
  assert.equal(d.heavyAI, false); assert.equal(d.blender, false); assert.equal(d.xGrowth, false);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')); assert.equal(pkg.build.mac.minimumSystemVersion, '13.0', 'Electron 44 needs macOS 13 — studio app is Mac mini only');
});
test('monitor profile: heavy AI/Blender refused; X GROWTH off by default, only analytics/drafts when enabled', async () => {
  for (const c of ['blender.render', 'ollama.generate', 'llm.chat', 'ai.caption', 'opencode.run', 'x.post', 'x.like', 'x.follow', 'news.collect']) assert.ok(A.allowCap('monitor', c, { xGrowth: true }), c);
  assert.match(A.allowCap('monitor', 'x.draft'), /X GROWTH выключен/); assert.equal(A.allowCap('monitor', 'x.draft', { xGrowth: true }), null); assert.equal(A.allowCap('monitor', 'x.analytics', { xGrowth: true }), null);
  for (const c of ['studio.health', 'result.verify', 'ffprobe.check', 'site.check', 'notify.send']) assert.equal(A.allowCap('monitor', c), null, c);
  const c0 = await A.config(env()); assert.equal(c0.profileKey, 'monitor'); assert.equal(c0.xGrowth, false); assert.equal(c0.limits.softRssMB, 160); assert.equal(c0.limits.maxRssMB, 256); assert.equal(c0.limits.dutyCycle, 0.5);
  assert.equal((await A.config(env({ NODE_X_GROWTH: '1' }))).xGrowth, true); await assert.rejects(() => A.config(env({ NODE_ALLOW_HEAVY_AI: '1' })), /запрещены профилем/);
  const m = N.createNodeManager({ dir: tmp() }); const r = m.registerNode({ id: 'macbook', role: 'monitor' }); assert.ok(!r.caps.some(c => /^x\./.test(c)), 'X caps not granted by default'); assert.ok(r.caps.includes('studio.health'));
  assert.throws(() => m.registerNode({ id: 'mb2', role: 'monitor', caps: ['x.post'] }), /недопустимые/);
});
test('result.verify re-hashes artifacts from disk: tampering and wrong expected hash are detected', async () => {
  const d = tmp(); const good = Buffer.from('video'); const f1 = path.join(d, 'a.mp4'), f2 = path.join(d, 'b.mp4'); fs.writeFileSync(f1, good); fs.writeFileSync(f2, 'tampered');
  const H = A.makeHandlers({ limits: A.PROFILES.monitor.limits, archiveDir: d }, { progress() {}, stats: {} });
  const r = await H['result.verify']({ expect: { 'a.mp4': sha(good) } }, { localFiles: [{ name: 'a.mp4', sha256: sha(good), path: f1 }, { name: 'b.mp4', sha256: sha(good), path: f2 }] });
  assert.equal(r.ok, false); assert.equal(r.files[0].ok, true); assert.match(r.files[1].problem, /не совпадает/);
  const r2 = await H['result.verify']({ expect: { 'a.mp4': 'f'.repeat(64) } }, { localFiles: [{ name: 'a.mp4', sha256: sha(good), path: f1 }] }); assert.match(r2.files[0].problem, /ожидаемого/);
  assert.equal(await A.hashFile(f1), sha(good));
});
test('GET /api/nodes/ping is read-only and needs the node token', async () => {
  const m = N.createNodeManager({ dir: tmp() }); const { token } = m.registerNode({ id: 'macbook', role: 'monitor' }); const srv = await N.listen(m, { host: '127.0.0.1', port: 0, insecureHttpForTests: true });
  const url = `http://127.0.0.1:${srv.address().port}`; const before = JSON.stringify(m._state);
  const ok = await A.client({ url, token, allowHttpForTests: true })('GET', '/ping'); assert.equal(ok.status, 200); assert.equal(ok.body.node, 'macbook'); assert.equal(ok.body.title, 'MONITOR NODE');
  assert.equal((await A.client({ url, token: 'nk_macbook.wrongwrongwrongwrongwrong', allowHttpForTests: true })('GET', '/ping')).status, 401); assert.equal(JSON.stringify(m._state), before, 'state unchanged'); srv.close();
});
test('studio-connection-test: dry-run touches no network; real run over pinned TLS → all PASS, token masked', async () => {
  const run = (e, args) => new Promise(res => execFile(process.execPath, [path.join(ROOT, 'scripts/node/studio-connection-test.mjs'), ...args], { env: { PATH: process.env.PATH, ...e }, timeout: 30000 }, (err, out) => res({ code: err ? err.code : 0, out: String(out) })));
  const dry = await run(env(), ['--dry-run']); assert.equal(dry.code, 0); assert.match(dry.out, /DRY-RUN: сеть не трогали/); assert.match(dry.out, /PLAN с токеном GET \/api\/nodes\/ping/);
  const d = tmp(); const m = N.createNodeManager({ dir: d }); const { token } = m.registerNode({ id: 'macbook', role: 'monitor' }); const tls = N.ensureCert(d); const srv = await N.listen(m, { host: '127.0.0.1', port: 0, tls });
  const r = await run(env({ NODE_TOKEN: token, NODE_TLS_MODE: 'pinned', COORDINATOR_URL: `https://127.0.0.1:${srv.address().port}`, COORDINATOR_CERT: path.join(d, 'nodes-tls.crt'), COORDINATOR_FINGERPRINT: tls.fingerprint }), []);
  srv.close(); assert.equal(r.code, 0, r.out); for (const s of ['PASS config', 'PASS TLS', 'PASS без верного токена → 401', 'PASS с токеном GET /api/nodes/ping → 200', 'PASS capabilities', 'PASS X GROWTH — выключен', 'ИТОГ: OK']) assert.ok(r.out.includes(s), s + '\n' + r.out);
  assert.ok(!r.out.includes(token.split('.')[1]), 'token never printed');
});
test('LaunchAgent for monitor: install.sh sets heap 128 MB and profile monitor on macOS < 13; no sudo', () => {
  const inst = fs.readFileSync(path.join(ROOT, 'scripts/node/install.sh'), 'utf8'); assert.match(inst, /\[ "\$PROFILE" = "monitor" \] && HEAP=128/); assert.match(inst, /-lt 13 \] 2>\/dev\/null && DEF=monitor/);
  assert.doesNotMatch(inst.split('\n').filter(l => !/^\s*#/.test(l)).join('\n'), /\bsudo\b|LaunchDaemons/);
  const ff = fs.readFileSync(path.join(ROOT, 'scripts/node/fetch-ffprobe.sh'), 'utf8'); assert.match(ff, /ZIP_SHA=[a-f0-9]{64}/); assert.match(ff, /BIN_SHA=[a-f0-9]{64}/); assert.doesNotMatch(ff.split('\n').filter(l => !/^\s*#/.test(l)).join('\n'), /\bsudo\b|brew /);
});
test('monitor RAM/CPU simulation: real agent on 2 cores, streamed SHA-256 verify, under soft limit', () => {
  const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/node/monitor-load-sim.mjs'), '--rounds', '2', '--files', '1', '--file-mb', '32', '--timeout', '90000'], { cwd: ROOT, timeout: 120000 }).toString());
  assert.equal(out.verifySha256Ok, true); assert.equal(out.restarts, 0); assert.ok(out.rssMB.peak < A.PROFILES.monitor.limits.softRssMB, 'peak ' + out.rssMB.peak); for (const v of Object.values(out.byCapability)) assert.equal(v.fail, 0);
});
