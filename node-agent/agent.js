#!/usr/bin/env node
// MOONKATTY NODE — one app, device profiles (NEWS NODE on iMac, MONITOR NODE on MacBook) — lightweight worker for Intel Macs (iMac Monterey 12.5.1, MacBook 2015). Zero dependencies.
// Runtime: Node.js 22 LTS x64 (official binaries need macOS ≥ 11) — works on Monterey 12; if a Mac is on 10.15 use Node 18 (EOL, last resort).
// Code is kept compatible with Node ≥ 16 (no fetch, no newer syntax-only APIs).
// Pull-only: the agent connects OUT to the coordinator over HTTPS with a pinned self-signed certificate; it listens on no port.
// Never receives OpenCode/Studio credentials; X tasks are analytics/drafts only (never posting/liking/following).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), https = require('https'), http = require('http');
const { execFile } = require('child_process');
const VERSION = '0.1.0';
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, opt = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: opt.timeout || 15000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => e ? rej(e) : res(String(out))));
function loadEnvFile(f) { if (!f || !fs.existsSync(f)) return {}; const st = fs.statSync(f);
  if (process.platform !== 'win32' && (st.mode & 0o077)) throw new Error(`${f}: права ${(st.mode & 0o777).toString(8)} — выполните chmod 600 ${f}`);
  const o = {}; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) o[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return o; }
async function keychainToken(service) { if (process.platform !== 'darwin') return null; try { return (await run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', 'node-token', '-w'])).trim() || null; } catch { return null; } }
// ---------- system self-report ----------
async function memAvailable() {
  if (process.platform === 'darwin') { try { const t = await run('/usr/bin/vm_stat', []); const ps = +(/page size of (\d+)/.exec(t) || [0, 4096])[1]; const g = k => +((new RegExp(k + ':\\s+(\\d+)').exec(t) || [0, 0])[1]);
    return (g('Pages free') + g('Pages inactive') + g('Pages speculative') + g('Pages purgeable')) * ps; } catch {} }
  if (process.platform === 'linux') { try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) return +m[1] * 1024; } catch {} }
  return os.freemem(); }
async function disk(dir) { try { const l = (await run('/bin/df', ['-k', dir])).trim().split('\n').pop().split(/\s+/); return { total: +l[1] * 1024, free: +l[3] * 1024 }; } catch { return { total: null, free: null }; } }
async function osVersion() { if (process.platform === 'darwin') { try { return 'macOS ' + (await run('/usr/bin/sw_vers', ['-productVersion'])).trim(); } catch {} } return os.type() + ' ' + os.release(); }
async function which(t, extra = []) { for (const d of ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', ...extra]) if (fs.existsSync(path.join(d, t))) return path.join(d, t); return null; }
const TOOLS = { ffprobe: [], ffmpeg: [], python3: [], sips: [], magick: [], convert: [], curl: [] };
let toolCache = null; async function tools() { if (toolCache) return toolCache; const t = []; for (const k of Object.keys(TOOLS)) if (await which(k)) t.push(k); return (toolCache = t); }
async function sysInfo(cfg) { const d = await disk(cfg.workDir); const tl = await tools(); const cpu = cpuPct();
  return { hostname: os.hostname(), os: await osVersion(), arch: process.arch, cpuModel: (os.cpus()[0] || {}).model || '', cpus: os.cpus().length, memTotal: os.totalmem(), memAvailable: await memAvailable(),
    diskFree: d.free, diskTotal: d.total, load1: os.loadavg()[0], cpuPct: cpu, node: process.version, agentVersion: VERSION, tools: tl, model: await hwModel() }; }
let lastCpu = null; function cpuPct() { const c = os.cpus().reduce((a, x) => { const t = x.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 }); const p = lastCpu ? 100 * (1 - (c.idle - lastCpu.idle) / Math.max(1, c.total - lastCpu.total)) : null; lastCpu = c; return p == null ? null : Math.round(p); }
let modelCache; async function hwModel() { if (modelCache !== undefined) return modelCache; try { modelCache = process.platform === 'darwin' ? (await run('/usr/sbin/sysctl', ['-n', 'hw.model'])).trim() : null; } catch { modelCache = null; } return modelCache; }
// ---------- coordinator client (pinned TLS) ----------
function client(cfg) {
  const u = new URL(cfg.url); const isHttps = u.protocol === 'https:';
  if (!isHttps && !cfg.allowHttpForTests) throw new Error('COORDINATOR_URL должен быть https:// (TLS с закреплённым сертификатом)');
  const pinPem = isHttps ? fs.readFileSync(cfg.certFile, 'utf8') : null; const pin = (cfg.fingerprint || '').replace(/:/g, '').toLowerCase();
  if (isHttps && !/^[a-f0-9]{64}$/.test(pin)) throw new Error('COORDINATOR_FINGERPRINT (SHA-256, 64 hex) обязателен');
  const agent = isHttps ? new https.Agent({ ca: pinPem, keepAlive: true, checkServerIdentity: (h, cert) => { const fp = String(cert.fingerprint256 || '').replace(/:/g, '').toLowerCase(); return fp === pin ? undefined : new Error('TLS pin mismatch: ' + fp); } }) : new http.Agent({ keepAlive: true });
  return function req(method, p, body, { raw = false, timeout = 30000 } = {}) { return new Promise((res, rej) => {
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const r = (isHttps ? https : http).request({ method, hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: '/api/nodes' + p, agent, timeout,
      headers: { authorization: 'Bearer ' + cfg.token, 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', ...(data ? { 'content-length': data.length } : {}) } }, resp => {
      const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => { const b = Buffer.concat(c); if (raw && resp.statusCode === 200) return res({ status: 200, buf: b, headers: resp.headers }); let j = null; try { j = JSON.parse(b.toString()); } catch {} res({ status: resp.statusCode, body: j }); }); });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', rej); if (data) r.write(data); r.end(); }); };
}
// ---------- task handlers (allowlisted, light only) ----------
const norm = s => String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function getUrl(url, max = 5e6) { return new Promise((res, rej) => { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return rej(new Error('only http(s)'));
  (u.protocol === 'https:' ? https : http).get(u, { timeout: 20000, headers: { 'user-agent': 'MOONKATTY-node/' + VERSION } }, r => { if (r.statusCode >= 300) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); } const c = []; let n = 0;
    r.on('data', d => { n += d.length; if (n > max) r.destroy(new Error('too large')); else c.push(d); }); r.on('end', () => res(Buffer.concat(c).toString('utf8'))); r.on('error', rej); }).on('error', rej).on('timeout', function () { this.destroy(new Error('timeout')); }); }); }
function parseRss(xml) { const items = []; const re = /<(item|entry)\b[\s\S]*?<\/\1>/g; let m; while ((m = re.exec(xml)) && items.length < 200) { const b = m[0]; const t = (/<title[^>]*>([\s\S]*?)<\/title>/.exec(b) || [])[1] || '';
  const l = (/<link[^>]*>([\s\S]*?)<\/link>/.exec(b) || [])[1] || (/<link[^>]*href="([^"]+)"/.exec(b) || [])[1] || ''; const d = (/<(pubDate|updated|published)>([\s\S]*?)<\/\1>/.exec(b) || [])[2] || '';
  items.push({ title: t.replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 300), link: l.trim().slice(0, 500), date: d.trim(), untrusted: true }); } return items; }
function dedup(items) { const seen = new Set(), out = []; for (const it of items || []) { const k = sha256(norm(it.title) + '|' + norm(it.link).replace(/\s/g, '')); if (!seen.has(k)) { seen.add(k); out.push({ ...it, key: k.slice(0, 16) }); } } return out; }
const safeHost = u => { try { return new URL(u).hostname; } catch { return null; } };
function makeHandlers(cfg, ctx) {
  const inArchive = n => { const f = path.resolve(cfg.archiveDir, path.basename(String(n))); if (!f.startsWith(path.resolve(cfg.archiveDir) + path.sep)) throw new Error('путь'); return f; };
  return {
    'rss.fetch': async i => ({ feed: i.url, items: parseRss(await getUrl(i.url)) }),
    'news.collect': async i => { const all = []; const errors = []; const feeds = (i.feeds || []).slice(0, 50); const bySource = {}; for (let k = 0; k < feeds.length; k++) { const f = feeds[k]; const u = typeof f === 'string' ? f : f.url; const src = String((typeof f === 'object' && f.source) || safeHost(u)).slice(0, 60); ctx.progress(Math.round(100 * k / feeds.length)); try { const it = parseRss(await getUrl(u)).map(x => ({ ...x, source: src })); bySource[src] = (bySource[src] || 0) + it.length; all.push(...it); } catch (e) { errors.push({ feed: u, error: e.message }); } } const items = dedup(all); ctx.stats.collected += items.length; return { items, bySource, errors }; },
    'news.dedup': async i => ({ items: dedup(i.items) }),
    'schedule.tick': async () => ({ at: new Date().toISOString() }),
    'stats.compute': async i => { const v = (i.values || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b); const s = v.reduce((a, b) => a + b, 0);
      return { n: v.length, sum: s, mean: v.length ? s / v.length : null, min: v[0] ?? null, max: v[v.length - 1] ?? null, median: v.length ? v[Math.floor(v.length / 2)] : null }; },
    'monitor.check': async i => { const out = []; for (const u of (i.urls || []).slice(0, 20)) { const t = Date.now(); try { await getUrl(u, 1e5); out.push({ url: u, ok: true, ms: Date.now() - t }); } catch (e) { out.push({ url: u, ok: false, error: e.message }); } } return { checks: out }; },
    'queue.inspect': async () => ({ node: cfg.nodeId, running: ctx.running.size, info: await sysInfo(cfg) }),
    'ffprobe.check': async (i, job) => { const ff = await which('ffprobe'); if (!ff) throw Object.assign(new Error('ffprobe не установлен (brew install ffmpeg)'), { retryable: false }); const out = [];
      for (const f of job.localFiles) { const j = JSON.parse(await run(ff, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f.path], { timeout: 120000 }));
        const v = (j.streams || []).find(s => s.codec_type === 'video'); const a = (j.streams || []).find(s => s.codec_type === 'audio'); const problems = [];
        if (!v) problems.push('нет видеодорожки'); if (i.expectAudio !== false && !a) problems.push('нет аудио'); if (i.width && v && v.width !== i.width) problems.push(`ширина ${v.width} ≠ ${i.width}`); if (i.height && v && v.height !== i.height) problems.push(`высота ${v.height} ≠ ${i.height}`);
        const dur = +(j.format || {}).duration; if (i.maxDurationSec && dur > i.maxDurationSec) problems.push(`длительность ${dur} > ${i.maxDurationSec}`);
        out.push({ name: f.name, sha256: f.sha256, ok: !problems.length, problems, codec: v && v.codec_name, width: v && v.width, height: v && v.height, fps: v && v.r_frame_rate, durationSec: dur, audio: a && a.codec_name }); } return { files: out }; },
    'archive.store': async (i, job) => { fs.mkdirSync(cfg.archiveDir, { recursive: true }); const saved = []; for (const f of job.localFiles) { const dst = inArchive(f.sha256.slice(0, 12) + '-' + f.name); fs.copyFileSync(f.path, dst); saved.push({ name: path.basename(dst), sha256: f.sha256 }); } return { saved }; },
    'backup.light': async (i, job) => { const d = path.join(cfg.workDir, 'backup'); fs.mkdirSync(d, { recursive: true }); const keep = []; for (const f of job.localFiles) { fs.copyFileSync(f.path, path.join(d, f.sha256)); keep.push(f.sha256); } return { stored: keep }; },
    'transfer.push': async i => { const f = inArchive(i.name); const buf = fs.readFileSync(f); const h = await ctx.upload(buf); return { artifacts: [{ sha256: h, name: path.basename(f), kind: 'archive' }] }; },
    'x.analytics': async i => { const posts = (i.posts || []).slice(0, 1000); const er = p => ((+p.likes || 0) + (+p.reposts || 0) + (+p.replies || 0)) / Math.max(1, +p.impressions || 0);
      const ranked = posts.map(p => ({ id: p.id, er: +er(p).toFixed(4), hour: p.createdAt ? new Date(p.createdAt).getUTCHours() : null })).sort((a, b) => b.er - a.er);
      const byHour = {}; for (const r of ranked) if (r.hour != null) (byHour[r.hour] ||= []).push(r.er); const bestHours = Object.entries(byHour).map(([h, v]) => [+h, v.reduce((a, b) => a + b, 0) / v.length]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
      return { top: ranked.slice(0, 10), bestHoursUTC: bestHours, note: 'Только аналитика по выгрузке. Никаких автоматических действий в X.' }; },
    'x.draft': async i => ({ drafts: (i.topics || []).slice(0, 10).map(t => ({ text: String(t).slice(0, 270), status: 'draft', requiresHumanPost: true })), note: 'Черновики. Публикует только человек вручную (правила X).' }),
    'news.prepare': async i => ({ items: dedup(i.items).map(it => ({ title: String(it.title || '').replace(/\s+/g, ' ').trim(), link: it.link, date: it.date || null, source: it.source || (it.link ? safeHost(it.link) : null), key: it.key, untrusted: true })).filter(x => x.title) }),
    'image.light': async (i, job) => { const sips = await which('sips'); if (!sips) throw Object.assign(new Error('sips недоступен (только macOS)'), { retryable: false }); const out = []; const max = Math.max(64, Math.min(4096, i.maxPx | 0 || 1280));
      for (const f of job.localFiles) { if (!/\.(jpe?g|png|heic|tiff?|gif)$/i.test(f.name)) throw Object.assign(new Error('не изображение: ' + f.name), { retryable: false }); const dst = path.join(path.dirname(f.path), 'out-' + path.basename(f.name).replace(/\.[^.]+$/, '') + '.jpg');
        await run(sips, ['-Z', String(max), '-s', 'format', 'jpeg', f.path, '--out', dst], { timeout: 60000 }); const h = await ctx.upload(fs.readFileSync(dst)); out.push({ sha256: h, name: path.basename(dst), kind: 'image' }); } return { artifacts: out }; },
    'site.check': async i => { const out = []; for (const u of (i.urls || []).slice(0, 20)) { const t = Date.now(); try { const b = await getUrl(u, 2e5); out.push({ url: u, ok: !i.expectText || b.includes(i.expectText), ms: Date.now() - t }); } catch (e) { out.push({ url: u, ok: false, error: e.message }); } } return { checks: out, ok: out.every(c => c.ok) }; },
    'result.verify': async (i, job) => { const out = job.localFiles.map(f => ({ name: f.name, sha256: f.sha256, ok: true, size: fs.statSync(f.path).size })); for (const r of out) { if (i.minBytes && r.size < i.minBytes) { r.ok = false; r.problem = 'слишком маленький'; } } return { files: out, ok: out.every(r => r.ok) }; },
    'notify.send': async i => localNotify(cfg, i), 'telegram.notify': async i => localNotify(cfg, i),
  };
}
async function localNotify(cfg, i) { // credentials live ONLY on this node (its own env/Keychain), never in the task
  if (!cfg.ntfyUrl) throw Object.assign(new Error('уведомления на узле не настроены (NODE_NTFY_URL)'), { retryable: false });
  await new Promise((res, rej) => { const u = new URL(cfg.ntfyUrl); const r = https.request(u, { method: 'POST', timeout: 10000, headers: { title: String(i.title || 'MOONKATTY').slice(0, 100) } }, x => { x.resume(); x.statusCode < 300 ? res() : rej(new Error('ntfy ' + x.statusCode)); }); r.on('error', rej); r.end(String(i.text || '').slice(0, 2000)); });
  return { sent: true };
}
function sample(ctx) { const i = ctx.info || {}; (ctx.history ||= []).push({ t: Date.now(), cpu: i.cpuPct, mem: i.memTotal ? Math.round(100 * (1 - i.memAvailable / i.memTotal)) : null, disk: i.diskTotal ? Math.round(100 * (1 - i.diskFree / i.diskTotal)) : null }); if (ctx.history.length > 120) ctx.history.shift(); }
// ---------- local status page (127.0.0.1 only; Pause needs a per-start random token, same-origin) ----------
function startStatusPage(cfg, ctx, { pause }) {
  const tok = crypto.randomBytes(16).toString('hex'); const page = fs.readFileSync(path.join(__dirname, 'status.html'), 'utf8').replace('__TOKEN__', tok);
  const srv = http.createServer((req, res) => { const host = String(req.headers.host || ''); if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(421); return res.end(); }
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", 'x-frame-options': 'DENY' }); return res.end(page); }
    if (req.method === 'GET' && req.url === '/status') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ node: cfg.nodeId, profile: cfg.profile, version: VERSION, state: ctx.state, command: ctx.command, online: !!ctx.online, current: ctx.current, stats: ctx.stats, lastError: ctx.lastError || null, info: ctx.info || null, recent: ctx.recent.slice(-20).reverse(), coordinator: cfg.url, lastNews: ctx.lastNews || null, qc: ctx.qc || [], history: ctx.history || [], localPause: ctx.state === 'paused' })); }
    if (req.method === 'POST' && (req.url === '/pause' || req.url === '/resume')) { if (req.headers['x-node-local'] !== tok) { res.writeHead(403); return res.end(); } pause(req.url === '/pause'); res.writeHead(200); return res.end('{}'); }
    res.writeHead(404); res.end(); });
  srv.on('error', e => console.error('status page:', e.message)); srv.listen(cfg.statusPort, '127.0.0.1'); srv.unref(); return srv;
}
// ---------- main loop ----------
async function main(cfg) {
  const req = client(cfg); const ctx = { running: new Map(), stats: { collected: 0, done: 0, failed: 0 }, recent: [], state: 'starting', command: 'run', current: null, progressVal: null, progress: p => { ctx.progressVal = p; if (ctx.current) ctx.current.progress = p; } };
  const act = (a, extra = {}) => { const e = { at: new Date().toISOString(), a, ...extra }; ctx.recent.push(e); if (ctx.recent.length > 50) ctx.recent.shift(); try { fs.mkdirSync(path.dirname(cfg.actionLog), { recursive: true }); fs.appendFileSync(cfg.actionLog, JSON.stringify(e) + '\n', { mode: 0o600 }); } catch {} };
  ctx.act = act; let localPause = false; if (cfg.statusPort) startStatusPage(cfg, ctx, { pause: v => { localPause = v; act(v ? 'локальная пауза' : 'продолжить'); } }); act('старт ' + VERSION); const fault = cfg.fault || ''; let backoff = 1000;
  ctx.upload = async buf => { let h = sha256(buf); const body = fault === 'bad-checksum' ? Buffer.concat([buf, Buffer.from('X')]) : buf; const r = await req('PUT', '/files/' + h, body); if (r.status !== 200) throw Object.assign(new Error('upload: ' + (r.body && r.body.error)), { retryable: true }); return h; };
  const H = makeHandlers(cfg, ctx); fs.mkdirSync(cfg.workDir, { recursive: true });
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  log(`node-agent ${VERSION} ${cfg.nodeId} → ${cfg.url} (Node ${process.version}, ${process.platform}/${process.arch})`);
  let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
  while (!stop) {
    try {
      if (localPause) { ctx.state = 'paused'; ctx.info = await sysInfo(cfg); await sleep(cfg.pollMs); continue; }
      const r = await req('POST', '/pull', { info: (ctx.info = await sysInfo(cfg)), state: ctx.state }); sample(ctx);
      if (!cfg.profile) { const hh = await req('POST', '/hello', { info: ctx.info }); if (hh.status === 200) { cfg.profile = hh.body.title || hh.body.role; } } if (r.status === 401) { log('токен отклонён (отозван?) — пауза 60 с'); await sleep(60000); continue; }
      if (r.status !== 200) throw new Error('pull HTTP ' + r.status); backoff = 1000; const job = r.body.job; ctx.command = r.body.command || 'run'; ctx.online = true;
      if (ctx.command === 'stop') { act('остановка по команде координатора'); log('команда stop — выхожу'); break; }
      if (ctx.command !== 'run') { if (ctx.state !== ctx.command) act('команда ' + ctx.command); ctx.state = ctx.command === 'drain' ? 'drained' : 'paused'; await sleep(cfg.pollMs); continue; } ctx.state = job ? 'busy' : 'idle';
      if (!job) { await sleep(cfg.pollMs); continue; }
      log('задача', job.id, job.capability, 'попытка', job.attempt);
      if (fault === 'drop-after-lease') { log('FAULT: падаю после получения аренды'); process.exit(3); }
      ctx.current = { id: job.id, capability: job.capability, startedAt: new Date().toISOString(), progress: null }; act('задача ' + job.capability, { job: job.id });
      const hb = setInterval(() => req('POST', `/jobs/${job.id}/heartbeat`, { leaseId: job.leaseId, checkpoint: { progress: ctx.current && ctx.current.progress } }).then(h => { if (h.body && h.body.command) ctx.command = h.body.command; }).catch(() => {}), Math.max(1000, Math.floor(job.leaseMs / 3)));
      try {
        const h = H[job.capability]; if (!h) throw Object.assign(new Error('capability не поддерживается агентом: ' + job.capability), { retryable: false });
        const dir = fs.mkdtempSync(path.join(cfg.workDir, 'job-')); job.localFiles = [];
        for (const f of job.files || []) { const g = await req('GET', '/files/' + f.sha256, null, { raw: true, timeout: 600000 }); if (g.status !== 200) throw Object.assign(new Error('скачивание ' + f.sha256 + ': ' + g.status), { retryable: true });
          if (sha256(g.buf) !== f.sha256) throw Object.assign(new Error('SHA-256 скачанного файла не совпадает'), { retryable: true }); const p = path.join(dir, path.basename(f.name || f.sha256)); fs.writeFileSync(p, g.buf, { mode: 0o600 }); job.localFiles.push({ ...f, path: p }); }
        if (cfg.slowMs) await sleep(cfg.slowMs);
        const out = await h(job.input || {}, job); fs.rmSync(dir, { recursive: true, force: true });
        if (job.capability === 'news.collect' || job.capability === 'news.prepare') ctx.lastNews = { at: new Date().toISOString(), bySource: out.bySource || null, headlines: (out.items || []).slice(0, 8).map(x => ({ title: x.title, source: x.source || null, date: x.date || null })), total: (out.items || []).length };
        if (job.capability === 'ffprobe.check' || job.capability === 'result.verify') { (ctx.qc ||= []).unshift(...(out.files || []).map(f => ({ at: new Date().toISOString(), name: f.name, ok: f.ok, problems: f.problems || (f.problem ? [f.problem] : []), codec: f.codec, width: f.width, height: f.height, durationSec: f.durationSec }))); ctx.qc = ctx.qc.slice(0, 20); }
        const artifacts = (out && out.artifacts) || []; const body = { leaseId: job.leaseId, result: out, artifacts };
        let c = await req('POST', `/jobs/${job.id}/complete`, body); if (fault === 'duplicate-complete') c = await req('POST', `/jobs/${job.id}/complete`, body);
        log('завершено', job.id, c.status, c.body && c.body.duplicate ? '(повтор подтверждения)' : ''); ctx.stats.done++; act('готово ' + job.capability, { job: job.id, status: c.status });
      } catch (e) { log('ошибка', job.id, e.message); ctx.stats.failed++; ctx.lastError = e.message; act('ошибка ' + job.capability, { job: job.id, error: e.message }); await req('POST', `/jobs/${job.id}/fail`, { leaseId: job.leaseId, error: e.message, retryable: !!e.retryable }).catch(() => {}); }
      finally { clearInterval(hb); ctx.current = null; }
    } catch (e) { if (ctx.online !== false) act('нет связи: ' + e.message); ctx.online = false; ctx.state = 'offline'; log('нет связи с координатором:', e.message, `— повтор через ${backoff / 1000} с`); await sleep(backoff); backoff = Math.min(backoff * 2, 60000); }
  }
  log('остановлен');
}
async function config(env = process.env) {
  const fileEnv = loadEnvFile(env.NODE_AGENT_ENV || path.join(os.homedir(), '.moonkatty-node', 'node-agent.env')); const e = { ...fileEnv, ...env };
  const nodeId = e.NODE_ID; if (!/^[a-z0-9-]{2,32}$/.test(nodeId || '')) throw new Error('NODE_ID обязателен');
  const token = e.NODE_TOKEN || await keychainToken('moonkatty-node-' + nodeId); if (!token) throw new Error('нет токена: Keychain (moonkatty-node-' + nodeId + ') или NODE_TOKEN в node-agent.env (chmod 600)');
  const home = path.join(os.homedir(), '.moonkatty-node');
  return { nodeId, token, url: e.COORDINATOR_URL, certFile: e.COORDINATOR_CERT || path.join(home, 'coordinator.crt'), fingerprint: e.COORDINATOR_FINGERPRINT, allowHttpForTests: e.NODE_AGENT_TEST_HTTP === '1',
    workDir: e.NODE_WORK_DIR || path.join(home, 'work'), actionLog: e.NODE_ACTION_LOG || path.join(e.NODE_WORK_DIR || path.join(home, 'work'), '..', 'actions.log'), statusPort: e.NODE_STATUS_PORT === '0' ? 0 : +(e.NODE_STATUS_PORT || 8791), profile: e.NODE_PROFILE || '', archiveDir: e.NODE_ARCHIVE_DIR || path.join(home, 'archive'), pollMs: +(e.NODE_POLL_MS || 5000), ntfyUrl: e.NODE_NTFY_URL || '', fault: e.NODE_AGENT_FAULT || '', slowMs: +(e.NODE_AGENT_SLOW_MS || 0) };
}
if (require.main === module) {
  if (process.argv.includes('--info')) config().catch(() => ({ workDir: os.tmpdir() })).then(c => sysInfo(c)).then(i => { console.log(JSON.stringify(i, null, 2)); });
  else config().then(main).catch(e => { console.error('node-agent:', e.message); process.exit(1); });
}
module.exports = { parseRss, dedup, sysInfo, config, loadEnvFile, makeHandlers, client, VERSION };
