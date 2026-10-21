'use strict';
// 3 simulated nodes as separate processes: coordinator (Mac mini role) + iMac agent + MacBook agent, real TLS with pinned cert.
// Fault injection: node drop after lease, network loss (TCP proxy cut), bad checksum upload, duplicate delivery, wrong TLS pin.
const test = require('node:test'); const assert = require('node:assert/strict');
const { spawn } = require('child_process'); const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http');
const ROOT = path.join(__dirname, '..', '..'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const procs = []; test.after(() => { if (global.PX) global.PX.close(); }); test.after(() => { if (global.AN) console.error(global.AN.out.join('')); }); test.after(() => procs.forEach(p => { try { p.kill('SIGKILL'); } catch {} }));
function startCoord() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-')); const p = spawn(process.execPath, [path.join(ROOT, 'test/helpers/coordinator.js')], { env: { ...process.env, COORD_DIR: dir }, stdio: ['ignore', 'pipe', 'inherit'] }); procs.push(p);
  return new Promise(res => { let b = ''; p.stdout.on('data', d => { b += d; const i = b.indexOf('\n'); if (i >= 0 && !p._r) { p._r = 1; res({ ...JSON.parse(b.slice(0, i)), dir, p }); } }); }); }
const admin = (c, p, b = {}) => new Promise((res, rej) => { const r = http.request({ host: '127.0.0.1', port: c.admin, path: p, method: 'POST' }, x => { let d = ''; x.on('data', z => d += z); x.on('end', () => res(JSON.parse(d))); }); r.on('error', rej); r.end(JSON.stringify(b)); });
function agent(c, id, token, { port = c.port, fault = '', fingerprint = c.fingerprint, slow = 0 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-' + id + '-')); const out = [];
  const p = spawn(process.execPath, [path.join(ROOT, 'node-agent/agent.js')], { env: { PATH: process.env.PATH, HOME: home, NODE_AGENT_ENV: path.join(home, 'none.env'), NODE_ID: id, NODE_TOKEN: token, COORDINATOR_URL: `https://127.0.0.1:${port}`,
    COORDINATOR_CERT: c.cert, COORDINATOR_FINGERPRINT: fingerprint, NODE_POLL_MS: '150', NODE_X_GROWTH: id === 'macbook' ? '1' : '0', NODE_STATUS_PORT: '0', NODE_AGENT_FAULT: fault, NODE_AGENT_SLOW_MS: String(slow), NODE_ARCHIVE_DIR: path.join(home, 'archive') }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', d => out.push(String(d))); p.stderr.on('data', d => out.push(String(d))); procs.push(p); p.out = out; p.home = home; return p; }
async function until(fn, ms = 15000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(100); } throw new Error('timeout ' + fn.toString().slice(0, 80)); }
const job = async (c, id) => (await admin(c, '/status')).jobsFull[id];
function proxy(target) { const socks = new Set(); let up = true; const s = net.createServer(cl => { if (!up) return cl.destroy(); const t = net.connect(target, '127.0.0.1'); socks.add(cl); socks.add(t); cl.pipe(t).pipe(cl); const k = () => { cl.destroy(); t.destroy(); }; cl.on('error', k); t.on('error', k); cl.on('close', k); });
  return new Promise(r => s.listen(0, '127.0.0.1', () => r({ port: s.address().port, cut() { up = false; socks.forEach(x => x.destroy()); }, restore() { up = true; }, close: () => s.close() }))); }
test('3 processes: routing by capability, TLS pin, ffprobe file transfer, X drafts only', { timeout: 60000 }, async () => {
  const c = await startCoord(); const im = await admin(c, '/register', { id: 'imac', role: 'imac' }); const mb = await admin(c, '/register', { id: 'macbook', role: 'macbook', caps: require('../../lib/ops/nodes.js').ROLES.macbook.caps }); // X GROWTH explicitly enabled for this test
  const ai = agent(c, 'imac', im.token), am = agent(c, 'macbook', mb.token);
  await until(async () => (await admin(c, '/status')).nodes.every(n => n.status === 'online'));
  const st = await admin(c, '/status'); const n = st.nodes.find(x => x.id === 'imac'); assert.ok(n.info.cpus > 0 && n.info.memTotal > 0 && n.info.os, 'self-report');
  const d = await admin(c, '/submit', { capability: 'news.dedup', input: { items: [{ title: 'Мир: новость', link: 'a' }, { title: 'мир — НОВОСТЬ', link: 'a' }, { title: 'другая', link: 'b' }] } });
  const x = await admin(c, '/submit', { capability: 'x.draft', input: { topics: ['анонс'] } });
  const done = await until(async () => { const a = await job(c, d.jobId), b = await job(c, x.jobId); return a.status === 'succeeded' && b.status === 'succeeded' && [a, b]; });
  assert.equal(done[0].nodeId, 'imac'); assert.equal(done[0].result.items.length, 2); assert.equal(done[1].nodeId, 'macbook'); assert.equal(done[1].result.drafts[0].requiresHumanPost, true);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '1', path.join(c.dir, 'clip.mp4')]); await new Promise(r => ff.on('exit', r));
  if (fs.existsSync(path.join(c.dir, 'clip.mp4'))) { const f = await admin(c, '/put-file', { data: fs.readFileSync(path.join(c.dir, 'clip.mp4')).toString('base64') });
    const v = await admin(c, '/submit', { capability: 'ffprobe.check', input: { width: 320, height: 240, expectAudio: false }, files: [{ sha256: f.sha256, name: 'clip.mp4' }] });
    const r = await until(async () => { const j = await job(c, v.jobId); return ['succeeded', 'failed'].includes(j.status) && j; }); assert.equal(r.status, 'succeeded', JSON.stringify(r.error)); assert.equal(r.nodeId, 'macbook'); assert.equal(r.result.files[0].ok, true); }
  const bad = agent(c, 'macbook', mb.token, { fingerprint: 'a'.repeat(64) }); await until(() => bad.out.join('').includes('TLS pin mismatch'), 8000); bad.kill();
  ai.kill(); am.kill();
});
test('faults: node drop (safeToRetry requeued / unsafe → needs_approval), duplicate delivery, bad checksum, network loss', { timeout: 90000 }, async () => {
  const c = await startCoord(); const im = await admin(c, '/register', { id: 'imac', role: 'imac' }); const im2 = await admin(c, '/register', { id: 'imac2', role: 'imac' });
  // node drop right after lease
  const safe = await admin(c, '/submit', { capability: 'rss.fetch', input: { url: 'http://127.0.0.1:1/none' }, safeToRetry: true, maxAttempts: 3 });
  const dropper = agent(c, 'imac', im.token, { fault: 'drop-after-lease' }); await new Promise(r => dropper.on('exit', r));
  const unsafe = await admin(c, '/submit', { capability: 'archive.store', input: {} }); const dropper2 = agent(c, 'imac', im.token, { fault: 'drop-after-lease' }); await new Promise(r => dropper2.on('exit', r));
  assert.equal((await until(async () => { const j = await job(c, unsafe.jobId); return j.status === 'needs_approval' && j; })).attempt, 1, 'not retried automatically');
  const healthy = agent(c, 'imac2', im2.token); const s = await until(async () => { const j = await job(c, safe.jobId); return ['failed', 'succeeded'].includes(j.status) && j; });
  assert.ok(s.attempt >= 2 && s.events.some(e => e.type === 'requeued'), 'safe job requeued after drop'); assert.equal((await job(c, unsafe.jobId)).status, 'needs_approval');
  healthy.kill(); await new Promise(r => healthy.exitCode !== null ? r() : healthy.on('exit', r));
  // duplicate delivery of completion → idempotent ack
  const dup = await admin(c, '/submit', { capability: 'schedule.tick', input: {}, idempotencyKey: 'tick-1' }); assert.equal((await admin(c, '/submit', { capability: 'schedule.tick', input: {}, idempotencyKey: 'tick-1' })).duplicate, true);
  const ad = agent(c, 'imac', im.token, { fault: 'duplicate-complete' }); await until(async () => (await job(c, dup.jobId)).status === 'succeeded'); await until(() => ad.out.join('').includes('повтор подтверждения'), 5000);
  assert.equal((await job(c, dup.jobId)).events.filter(e => e.type === 'succeeded').length, 1); ad.kill(); await new Promise(r => ad.exitCode !== null ? r() : ad.on('exit', r));
  // bad checksum upload rejected; job fails (not safe to retry) — corrupted data never accepted
  const ab = agent(c, 'imac', im.token, { fault: 'bad-checksum' }); fs.mkdirSync(path.join(ab.home, 'archive'), { recursive: true }); fs.writeFileSync(path.join(ab.home, 'archive', 'a.json'), '{"news":1}');
  const tp = await admin(c, '/submit', { capability: 'transfer.push', input: { name: 'a.json' } });
  const r = await until(async () => { const j = await job(c, tp.jobId); return j.status === 'failed' && j; }); assert.match(r.error, /SHA-256 не совпадает/); assert.equal(r.artifacts.length, 0); ab.kill(); await new Promise(r => ab.exitCode !== null ? r() : ab.on('exit', r));
  // network loss: proxy cut while job is running (slow) → lease expires → safe job requeued, agent reconnects with backoff and finishes
  const px = await proxy(c.port); var an; an = agent(c, 'imac', im.token, { port: px.port, slow: 2500 }); global.AN = an; global.PX = px;
  const nj = await admin(c, '/submit', { capability: 'news.dedup', input: { items: [{ title: 'a', link: '1' }, { title: 'A', link: '1' }] }, safeToRetry: true, maxAttempts: 5 });
  await until(async () => (await job(c, nj.jobId)).status === 'leased'); px.cut(); await until(async () => (await job(c, nj.jobId)).events.some(e => e.type === 'requeued'), 10000); px.restore();
  const fin = await until(async () => { const j = await job(c, nj.jobId); return j.status === 'succeeded' && j; }, 20000); assert.equal(fin.result.items.length, 1); assert.ok(fin.attempt >= 2);
  assert.ok(/завершено nj_[a-f0-9]+ 409|нет связи/.test(an.out.join('')), 'stale completion after network loss rejected (409) or agent saw loss'); an.kill(); px.close();
  const st = await admin(c, '/status'); assert.ok(st.alerts.some(a => /требует решения/.test(a.title)));
});
