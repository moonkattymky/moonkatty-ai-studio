'use strict';
// NEWS NODE (iMac 2017, macOS Ventura 13.7.1, x86_64, 8 GB): profile enforcement, memory limits, streaming dedup,
// large-result delivery as SHA-256 artifact, offline outbox, Tailscale TLS mode, LaunchAgent plist, real iMac specs.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto'); const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const A = require('../../node-agent/agent.js'); const N = require('../../lib/ops/nodes.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'newsnode-')); const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const baseEnv = o => ({ HOME: tmp(), NODE_AGENT_ENV: '/nonexistent', NODE_ID: 'imac', NODE_TOKEN: 'nk_imac.' + 'a'.repeat(32), COORDINATOR_URL: 'https://100.100.1.2:8790', ...o });

test('iMac device profile = real hardware (Ventura 13.7.1), the wrong 12.5.1 is gone from code and docs', () => {
  const d = N.DEVICES.imac; assert.equal(d.os, 'macOS Ventura 13.7.1'); assert.equal(d.ramGB, 8); assert.match(d.cpu, /i5 3\.4 GHz, 4 cores/); assert.match(d.gpu, /Radeon Pro 570 4 GB/); assert.match(d.model, /Retina 5K 27" 2017/);
  assert.equal(d.arch, 'x86_64'); assert.equal(d.heavyAI, false); assert.equal(d.blender, false);
  const files = execFileSync('git', ['ls-files', 'lib', 'node-agent', 'docs/ops', 'scripts/node', 'deploy', 'test/ops'], { cwd: ROOT }).toString().trim().split('\n').filter(f => !f.endsWith('news-node.test.js'));
  const bad = files.filter(f => fs.existsSync(path.join(ROOT, f)) && /12\.5\.1/.test(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/[^\n]*(ошибочн|WRONG|wrong|неверн)[^\n]*/g, '')));
  assert.deepEqual(bad, []);
});
test('profile enforcement in the agent: no heavy AI / Blender / render / OpenCode for NEWS NODE, not even via env', async () => {
  for (const c of ['blender.render', 'render.segment', 'ollama.generate', 'llm.chat', 'ai.summarize', 'model.load', 'whisper.transcribe', 'opencode.run', 'x.post', 'monitor.check']) assert.ok(A.allowCap('news', c), c);
  for (const c of A.PROFILES.news.caps) assert.equal(A.allowCap('news', c), null, c);
  assert.equal(A.PROFILES.news.heavyAI, false); assert.equal(A.PROFILES.news.blender, false);
  await assert.rejects(() => A.config(baseEnv({ NODE_ALLOW_HEAVY_AI: '1' })), /запрещены профилем/); await assert.rejects(() => A.config(baseEnv({ NODE_ALLOW_BLENDER: '1' })), /запрещены профилем/);
  await assert.rejects(A.config(baseEnv({ NODE_TLS_MODE: 'tailscale' })), /не поддерживается/); const c = await A.config(baseEnv({ NODE_TLS_MODE: 'pinned' })); assert.equal(c.tlsMode, 'pinned'); assert.equal(c.profileKey, 'news'); assert.equal(c.limits.softRssMB, 260); assert.equal(c.limits.maxRssMB, 384);
  const m = N.createNodeManager({ dir: tmp() }); assert.throws(() => m.registerNode({ id: 'imac', role: 'news', caps: ['blender.render'] }), /недопустимые/);
  assert.throws(() => m.submit({ capability: 'ai.summarize', input: {} }), /не разрешена/); assert.equal(N.ROLES.news.policy.heavyAI, false);
});
test('r5: TLS is pinned only — tailscale (Serve / public CA) mode refused in client() and enroll(); pinned still requires a fingerprint', async () => {
  for (const url of ['https://mac-mini.tail1234.ts.net:8443', 'https://100.100.1.2:8790']) assert.throws(() => A.client({ url, tlsMode: 'tailscale', token: 't' }), /не поддерживается/);
  await assert.rejects(require('../../node-agent/enroll.js').enroll({ url: 'https://mac-mini.tail1234.ts.net:8443', tlsMode: 'tailscale', code: 'AAAAA-BBBBB-CCCCC', home: tmp() }), e => e.code === 'E_TLS_MODE');
  const d = tmp(); fs.writeFileSync(path.join(d, 'c.crt'), 'x'); assert.throws(() => A.client({ url: 'https://100.100.1.2:8790', certFile: path.join(d, 'c.crt'), fingerprint: '', token: 't' }), /FINGERPRINT/);
});
test('news.collect: streaming dedup across feeds, maxItemsPerJob and memory cap → partial result, never OOM', async () => {
  const xml = f => '<rss>' + Array.from({ length: 30 }, (_, i) => `<item><title>T ${i % 10 === 0 ? 'shared' + i : f + '-' + i}</title><link>https://n/${i % 10 === 0 ? 's' + i : f + i}</link></item>`).join('') + '</rss>';
  const srv = http.createServer((q, r) => r.end(xml(q.url))); await new Promise(r => srv.listen(0, '127.0.0.1', r)); const u = p => `http://127.0.0.1:${srv.address().port}/${p}`;
  const ctx = { progress() {}, stats: { collected: 0 } }; const lim = { ...A.PROFILES.news.limits };
  let H = A.makeHandlers({ limits: lim, archiveDir: tmp() }, ctx); let r = await H['news.collect']({ feeds: ['a', 'b', 'c'].map(u) });
  assert.equal(r.items.length, 3 * 27 + 3); assert.equal(new Set(r.items.map(x => x.key)).size, r.items.length); assert.equal(r.truncated, null);
  H = A.makeHandlers({ limits: { ...lim, maxItemsPerJob: 40 }, archiveDir: tmp() }, ctx); r = await H['news.collect']({ feeds: ['a', 'b', 'c'].map(u) }); assert.equal(r.items.length, 40); assert.match(r.truncated, /maxItemsPerJob/);
  H = A.makeHandlers({ limits: { ...lim, maxRssMB: 1 }, archiveDir: tmp() }, ctx); r = await H['news.collect']({ feeds: ['a'].map(u) }); assert.equal(r.items.length, 0); assert.match(r.truncated, /memory/);
  srv.close();
});
test('offline outbox: 0600 files, retried until delivered, blob uploaded first, stale (409) dropped, max age', async () => {
  const dir = path.join(tmp(), 'outbox'); const ob = A.makeOutbox({ outboxDir: dir }); const id1 = 'nj_' + 'a'.repeat(16), id2 = 'nj_' + 'b'.repeat(16);
  ob.add(id1, { leaseId: 'L1', result: { n: 1 } }); ob.add(id2, { leaseId: 'L2' }, Buffer.from('gz')); assert.equal(ob.size(), 2); assert.equal(fs.statSync(path.join(dir, id1 + '.json')).mode & 0o777, 0o600);
  let up = 0; let online = false; const req = async (m, p, b) => { if (!online) return { status: 503 }; if (m === 'PUT') { assert.equal(p, '/files/' + sha(Buffer.from('gz'))); up++; return { status: 200 }; } return { status: p.includes(id1) ? 200 : 409 }; };
  await ob.flush(req); assert.equal(ob.size(), 2, 'kept while coordinator offline'); online = true; await ob.flush(req); assert.equal(ob.size(), 0); assert.equal(up, 1);
  const ob2 = A.makeOutbox({ outboxDir: dir }, { maxAgeMs: -1 }); ob2.add(id1, {}); await ob2.flush(async () => ({ status: 200 })); assert.equal(ob2.size(), 0);
});
test('LaunchAgent plist: user agent (no root), KeepAlive, throttle, logs, heap cap', () => {
  const p = fs.readFileSync(path.join(ROOT, 'deploy/com.moonkatty.node-agent.plist'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  for (const re of [/<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/>/, /<key>ThrottleInterval<\/key><integer>30<\/integer>/, /<key>RunAtLoad<\/key><true\/>/, /StandardOutPath<\/key><string>\/Users\/YOURUSER\/\.moonkatty-node\/logs\/agent\.log/, /StandardErrorPath/, /--max-old-space-size=192/, /--expose-gc/, /<key>NODE_PROFILE<\/key><string>news<\/string>/]) assert.match(p, re);
  assert.doesNotMatch(p, /<key>(UserName|GroupName|InitGroups)<\/key>|LaunchDaemons|root/); assert.doesNotMatch(p, /Sockets|inetd/, 'no listening sockets');
  if (process.platform === 'darwin') execFileSync('plutil', ['-lint', path.join(ROOT, 'deploy/com.moonkatty.node-agent.plist')]); else assert.match(p, /^<\?xml[\s\S]*<\/dict><\/plist>\s*$/);
  const inst = fs.readFileSync(path.join(ROOT, 'scripts/node/install.sh'), 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n'); assert.doesNotMatch(inst, /\bsudo\b|LaunchDaemons/); assert.match(inst, /LaunchAgents/); assert.match(inst, /macOS ≥ \$NEED/);
});
test('RAM simulation: real agent process, 50 feeds × 200 items, big result delivered as SHA-256 artifact, RSS under soft limit', () => {
  const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'scripts/node/news-load-sim.mjs'), '--jobs', '4', '--timeout', '60000'], { cwd: ROOT, timeout: 90000 }).toString());
  assert.equal(out.succeeded, 4); assert.equal(out.uniqueItemsPerJob, 5000); assert.equal(out.resultAsArtifact, true); assert.equal(out.artifactOnCoordinator, true);
  assert.ok(out.rssMB.peak < A.PROFILES.news.limits.softRssMB, 'peak RSS ' + out.rssMB.peak + ' MB'); assert.equal(out.restarts, 0);
});
