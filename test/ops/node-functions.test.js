'use strict';
// nodes-022-final: functional checks of every NEWS / MONITOR handler the agent implements (node-agent/agent.js makeHandlers), on Linux.
// Local test servers only (127.0.0.1). The "Telegram" path of the agent is NOT the Telegram Bot API: telegram.notify and notify.send POST to the
// node-local NODE_NTFY_URL (ntfy-compatible, https only). Here that endpoint is a LOCAL MOCK (self-signed TLS, test CA) — a test harness, not Telegram.
// image.light needs macOS `sips` → on Linux the test asserts the explicit refusal (needs macOS for a real run).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), https = require('https'), crypto = require('crypto'); const { execFileSync, spawnSync } = require('child_process');
const A = require('../../node-agent/agent.js');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'nf-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const listen = (srv, host = '127.0.0.1') => new Promise(r => srv.listen(0, host, () => r(srv.address().port)));
function setup(profile) { const home = tmp('nf-home-'); const cfg = { nodeId: profile === 'news' ? 'imac' : 'macbook', profile, archiveDir: path.join(home, 'archive'), workDir: path.join(home, 'work'), limits: A.PROFILES[profile].limits, ntfyUrl: '' };
  fs.mkdirSync(cfg.workDir, { recursive: true }); const uploads = []; const ctx = { progress() {}, stats: { collected: 0 }, running: new Set(), upload: async buf => { uploads.push(buf); return sha(buf); }, req: async () => ({ status: 200, body: { ok: true } }) };
  return { cfg, ctx, H: A.makeHandlers(cfg, ctx), uploads, home }; }
const fileJob = (dir, name, buf) => { const f = path.join(dir, 'in-' + crypto.randomBytes(4).toString('hex')); /* job file name may be hostile; the local path is ours */ fs.writeFileSync(f, buf); return { localFiles: [{ name, path: f, sha256: sha(buf) }] }; };

test('NEWS: rss.fetch, news.collect (cross-feed dedup, per-source counts, feed errors captured), news.dedup, news.prepare, schedule.tick', async () => {
  const feeds = { '/a': '<rss><item><title>Мир: новость</title><link>http://n/1</link><pubDate>Mon</pubDate></item><item><title>Вторая</title><link>http://n/2</link></item></rss>',
    '/b': '<feed><entry><title>мир — НОВОСТЬ</title><link href="http://n/1"/></entry><entry><title>Третья</title><link href="http://n/3"/></entry></feed>', '/big': 'x'.repeat(2.1e6) };
  const srv = http.createServer((q, r) => { if (q.url === '/500') { r.statusCode = 500; return r.end(); } r.end(feeds[q.url] || ''); }); const port = await listen(srv); const u = p => `http://127.0.0.1:${port}${p}`;
  try { const { H, ctx } = setup('news');
    const f = await H['rss.fetch']({ url: u('/a') }); assert.equal(f.items.length, 2); assert.equal(f.items[0].untrusted, true);
    const c = await H['news.collect']({ feeds: [u('/a'), { url: u('/b'), source: 'B' }, u('/500'), u('/big')] }); assert.equal(c.items.length, 3, JSON.stringify(c.items.map(x => x.title))); assert.equal(c.bySource.B, 1);
    assert.equal(c.errors.length, 2); assert.ok(c.errors.some(e => /HTTP 500/.test(e.error)) && c.errors.some(e => /too large/.test(e.error))); assert.equal(ctx.stats.collected, 3);
    const d = await H['news.dedup']({ items: [{ title: 'A b', link: 'x' }, { title: 'a  B', link: 'x' }, { title: 'c', link: 'y' }] }); assert.equal(d.items.length, 2);
    const p = await H['news.prepare']({ items: [{ title: '  Заголовок \n с  пробелами ', link: 'https://site.example/p' }, { title: '', link: 'z' }] }); assert.deepEqual(p.items.map(x => [x.title, x.source, x.untrusted]), [['Заголовок с пробелами', 'site.example', true]]);
    assert.ok(Date.parse((await H['schedule.tick']({})).at), 'schedule.tick only returns a timestamp (no scheduler in the agent)');
  } finally { srv.close(); }
});

test('NEWS: archive.store (path-safe names), transfer.push (upload from archive, traversal refused), image.light refuses without macOS sips', async () => {
  const { H, cfg, uploads, home } = setup('news'); const buf = Buffer.from('{"news":1}'); const job = fileJob(home, '../../evil.json', buf);
  const s = await H['archive.store']({}, job); assert.equal(s.saved.length, 1); assert.ok(fs.existsSync(path.join(cfg.archiveDir, s.saved[0].name))); assert.ok(!s.saved[0].name.includes('/'));
  const t = await H['transfer.push']({ name: s.saved[0].name }); assert.equal(t.artifacts[0].sha256, sha(buf)); assert.equal(uploads.length, 1);
  await assert.rejects(H['transfer.push']({ name: '../../../etc/passwd' }), /ENOENT|путь/, 'basename only: cannot leave the archive dir');
  if (process.platform !== 'darwin') await assert.rejects(H['image.light']({}, fileJob(home, 'a.png', Buffer.from('x'))), /sips недоступен/);
});

test('notify.send / telegram.notify → node-local ntfy endpoint (LOCAL MOCK over TLS); not configured → explicit error; credentials never in the task', async () => {
  const d = tmp('nf-tls-'); execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(d, 'k.pem'), '-out', path.join(d, 'c.pem')], { stdio: 'ignore' });
  const got = []; const srv = https.createServer({ key: fs.readFileSync(path.join(d, 'k.pem')), cert: fs.readFileSync(path.join(d, 'c.pem')) }, (q, r) => { let b = ''; q.on('data', x => b += x); q.on('end', () => { got.push({ url: q.url, title: q.headers.title, body: b }); r.end('ok'); }); });
  const port = await listen(srv); const prevCa = https.globalAgent.options.ca; https.globalAgent.options.ca = fs.readFileSync(path.join(d, 'c.pem')); // trust the TEST CA only (verification stays on)
  try { const { H, cfg } = setup('news'); await assert.rejects(H['telegram.notify']({ text: 'x' }), /не настроены/);
    cfg.ntfyUrl = `https://127.0.0.1:${port}/moonkatty-test`; assert.deepEqual(await H['telegram.notify']({ title: 'NEWS', text: 'тест' }), { sent: true });
    const m = setup('monitor'); m.cfg.ntfyUrl = cfg.ntfyUrl; assert.deepEqual(await m.H['notify.send']({ text: 'monitor ok' }), { sent: true });
    assert.equal(got.length, 2); assert.equal(got[0].body, 'тест'); assert.equal(got[0].url, '/moonkatty-test');
    https.globalAgent.options.ca = undefined; await assert.rejects(m.H['notify.send']({ text: 'x' }), /self.signed|certificate/i, 'an untrusted certificate is refused');
  } finally { https.globalAgent.options.ca = prevCa; srv.close(); }
});

test('MONITOR: site.check, monitor.check, studio.health, result.verify, ffprobe.check (real ffprobe), stats.compute, queue.inspect, backup.light; X off by default', async () => {
  const srv = http.createServer((q, r) => { if (q.url === '/down') { r.statusCode = 503; return r.end(); } r.end('<html>MOONKATTY ok</html>'); }); const port = await listen(srv); const u = p => `http://127.0.0.1:${port}${p}`;
  try { const { H, home, cfg } = setup('monitor');
    const sc = await H['site.check']({ urls: [u('/'), u('/down')], expectText: 'MOONKATTY' }); assert.deepEqual(sc.checks.map(c => c.ok), [true, false]); assert.equal(sc.ok, false);
    assert.deepEqual((await H['monitor.check']({ urls: [u('/'), 'ftp://x/'] })).checks.map(c => c.ok), [true, false]);
    const sh = await H['studio.health']({ urls: [u('/')] }); assert.equal(sh.ok, true); assert.equal(sh.checks[0].name, 'node-api');
    const buf = Buffer.from('artifact'); const job = fileJob(home, 'r.bin', buf); assert.equal((await H['result.verify']({ expect: { 'r.bin': sha(buf) } }, job)).ok, true);
    job.localFiles[0].sha256 = 'f'.repeat(64); assert.equal((await H['result.verify']({}, job)).ok, false);
    const ffprobe = ['/usr/bin/ffprobe', '/usr/local/bin/ffprobe'].find(f => fs.existsSync(f)); const ffmpeg = ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(f => fs.existsSync(f));
    if (ffprobe && ffmpeg) { const clip = path.join(home, 'clip.mp4'); spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10', '-t', '1', clip]);
      const fj = { localFiles: [{ name: 'clip.mp4', path: clip, sha256: sha(fs.readFileSync(clip)) }] }; const r = await H['ffprobe.check']({ width: 320, height: 240, expectAudio: false }, fj); assert.equal(r.files[0].ok, true, JSON.stringify(r));
      const r2 = await H['ffprobe.check']({ width: 640 }, fj); assert.deepEqual(r2.files[0].problems.sort(), ['нет аудио', 'ширина 320 ≠ 640'].sort()); }
    else assert.fail('ffprobe/ffmpeg not installed on this box — real ffprobe check not run');
    assert.deepEqual(await H['stats.compute']({ values: [3, '1', 'x', null, 2] }), { n: 3, sum: 6, mean: 2, min: 1, max: 3, median: 2 });
    const qi = await H['queue.inspect']({}); assert.equal(qi.node, 'macbook'); assert.ok(qi.info.cpus > 0);
    const bl = await H['backup.light']({}, fileJob(home, 'b.json', Buffer.from('{}'))); assert.ok(fs.existsSync(path.join(cfg.workDir, 'backup', bl.stored[0])));
    assert.match(A.allowCap('monitor', 'x.draft'), /X GROWTH выключен/); assert.match(A.allowCap('monitor', 'x.analytics'), /X GROWTH выключен/); assert.equal(A.allowCap('monitor', 'x.draft', { xGrowth: true }), null);
    for (const c of ['x.post', 'x.like', 'x.follow', 'x.dm', 'ollama.run', 'blender.render', 'opencode.run']) assert.ok(A.allowCap('monitor', c, { xGrowth: true }), c + ' must be refused');
    assert.ok(A.allowCap('news', 'ffprobe.check'), 'NEWS profile has no monitor caps');
  } finally { srv.close(); }
});

test('fuzz: malformed / hostile inputs never hang or crash the handlers (bounded time, structured results or explicit errors)', async () => {
  const { H } = setup('news'); const m = setup('monitor'); let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pieces = ['<item>', '</item>', '<entry>', '</entry>', '<title>', '</title>', '<link href="', '"/>', '<link>', '</link>', '<pubDate>', '<![CDATA[', ']]>', '<', '>', '&amp;', '\u0000', 'é', '"'];
  const t0 = Date.now(); for (let i = 0; i < 300; i++) { let s = ''; const n = Math.floor(rnd() * 3000); for (let k = 0; k < n; k++) s += pieces[Math.floor(rnd() * pieces.length)]; const r = A.parseRss(s); assert.ok(Array.isArray(r) && r.length <= 200); }
  for (const s of ['<item>'.repeat(333333), '<item>' + '<link href="'.repeat(150000) + '</item>', ('<item>' + '<title>'.repeat(2000) + '</item>').repeat(150)]) A.parseRss(s);
  assert.ok(Date.now() - t0 < 10000, 'parser stays linear: ' + (Date.now() - t0) + ' ms');
  for (const bad of [undefined, null, 5, 'str', [1, 2], { title: {} }, [{ title: 1e400 }, null, 'x']]) { try { const r = await H['news.dedup']({ items: bad }); assert.ok(Array.isArray(r.items)); } catch (e) { assert.ok(e instanceof Error); } }
  for (const bad of [{ feeds: 'notarray' }, { feeds: [null, 5, {}, 'not a url', 'file:///etc/passwd', 'ftp://x'] }]) { try { const r = await H['news.collect'](bad); assert.ok(Array.isArray(r.items)); } catch (e) { assert.ok(e instanceof Error); } }
  const fc = await H['news.collect']({ feeds: ['file:///etc/passwd'] }); assert.equal(fc.items.length, 0); assert.match(fc.errors[0].error, /only http/);
  assert.equal((await m.H['stats.compute']({ values: 'x' })).n, 0); assert.deepEqual((await m.H['site.check']({ urls: Array(50).fill('http://127.0.0.1:1/') })).checks.length, 20, 'maxUrls 20');
});
