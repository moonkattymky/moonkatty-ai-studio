#!/usr/bin/env node
// MOONKATTY NODE — one app, device profiles (NEWS NODE on iMac, MONITOR NODE on MacBook) — lightweight worker for Intel Macs
// (iMac Retina 5K 27" 2017, i5 3.4GHz 4c, 8 GB, macOS Ventura 13.7.1; MacBook Pro Retina 13" Early 2015, i5 2.7GHz 2c, 8 GB DDR3, macOS Monterey 12.7.6). Zero npm dependencies (only Node built-ins).
// Runtime: iMac → Node.js 24 LTS darwin-x64 (official min macOS 13.5, Tier 1); MacBook (Monterey 12.7.6) → Node.js 22 LTS x64 (min macOS 11; Node 24 NOT allowed there).
// Code is kept compatible with Node ≥ 16 (no fetch, no newer syntax-only APIs).
// NODE_TLS_MODE=tailscale: Mac mini runs `tailscale serve --bg --https=8443 https+insecure://127.0.0.1:8790` (tailnet only, never funnel).
// Pull-only: the agent connects OUT to the coordinator over HTTPS with a pinned self-signed certificate; it listens on no port.
// Never receives OpenCode/Studio credentials; X tasks are analytics/drafts only (never posting/liking/following).
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), https = require('https'), http = require('http');
const { execFile } = require('child_process');
const VERSION = '0.2.2';
const EN = require('./enroll.js');
// Device-profile policy, enforced HERE on the node (not only in docs / on the coordinator): even if a coordinator
// were compromised and leased a forbidden capability, the agent refuses it. NEWS NODE: no heavy AI, no Blender, no render.
const FORBIDDEN = /^(opencode|blender|render|ollama|llm|ai\.|model\.|whisper|sd\.|comfy|x\.(post|like|follow|repost|dm|reply)(\.|$))/;
const PROFILES = {
  news: { title: 'NEWS NODE', heavyAI: false, blender: false, caps: ['news.collect', 'rss.fetch', 'news.dedup', 'news.prepare', 'archive.store', 'image.light', 'transfer.push', 'schedule.tick', 'telegram.notify'],
    // limits from scripts/node/news-load-sim.mjs (Node 24.22, docs/ops/sim/*.json): realistic peak 176 MB, stress peak 280 MB → soft 260 (≈1.5× realistic), hard 384
    limits: { maxRssMB: 384, softRssMB: 260, maxHeapMB: 192, maxFeeds: 50, maxFeedBytes: 2e6, maxItemsPerJob: 5000, maxConcurrent: 1, outboxMax: 200, maxInlineResultBytes: 256 * 1024, bpRestartMs: 30000 } },
  // MONITOR NODE (MacBook Pro 13" 2015, 2 cores): X GROWTH caps (x.analytics/x.draft) are OFF unless NODE_X_GROWTH=1 — and even then
  // only analytics/drafts (never post/like/follow/repost/dm/reply; FORBIDDEN above). Limits from scripts/node/monitor-load-sim.mjs.
  monitor: { title: 'MONITOR NODE', heavyAI: false, blender: false, xGrowthDefault: false, xCaps: ['x.analytics', 'x.draft'],
    caps: ['monitor.check', 'site.check', 'studio.health', 'result.verify', 'ffprobe.check', 'stats.compute', 'notify.send', 'queue.inspect', 'backup.light', 'x.analytics', 'x.draft'],
    limits: { maxRssMB: 256, softRssMB: 160, maxHeapMB: 128, maxFeeds: 20, maxFeedBytes: 2e6, maxItemsPerJob: 2000, maxConcurrent: 1, outboxMax: 200, maxInlineResultBytes: 256 * 1024, bpRestartMs: 30000, maxUrls: 20, ffprobeTimeoutMs: 120000, dutyCycle: 0.5, maxFileBytes: 4 * 1024 ** 3 } },
};
const PROFILE_ALIAS = { imac: 'news', 'news node': 'news', macbook: 'monitor', 'monitor node': 'monitor' };
function profileOf(name) { const k = String(name || '').toLowerCase(); return PROFILES[PROFILE_ALIAS[k] || k] ? (PROFILE_ALIAS[k] || k) : null; }
function allowCap(profile, cap, opt = {}) { if (FORBIDDEN.test(String(cap))) return 'запрещено профилем (heavy AI / Blender / render / X-действия)'; const p = PROFILES[profile];
  if (p && p.xCaps && p.xCaps.includes(cap) && !opt.xGrowth) return 'X GROWTH выключен по умолчанию (NODE_X_GROWTH=1 — только аналитика/черновики по правилам X)'; if (p && !p.caps.includes(cap)) return `capability ${cap} не входит в профиль ${p.title}`; return null; }
function hashFile(f) { return new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', d => h.update(d)).on('error', rej).on('end', () => res(h.digest('hex'))); }); }
const rssMB = () => Math.round(process.memoryUsage().rss / 1048576);
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (cmd, args, opt = {}) => new Promise((res, rej) => execFile(cmd, args, { timeout: opt.timeout || 15000, maxBuffer: 8 * 1024 * 1024 }, (e, out) => e ? rej(e) : res(String(out))));
function loadEnvFile(f) { if (!f || !fs.existsSync(f)) return {}; const st = fs.statSync(f);
  if (process.platform !== 'win32' && (st.mode & 0o077)) throw new Error(`${f}: права ${(st.mode & 0o777).toString(8)} — выполните chmod 600 ${f}`);
  const o = {}; for (const l of fs.readFileSync(f, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l); if (m && !l.trim().startsWith('#')) o[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return o; }
async function keychainToken(service, env = process.env) { return EN.keychain(env).get(service, 'node-token'); }
async function keychainTokenLegacy(service) { if (process.platform !== 'darwin') return null; try { return (await run('/usr/bin/security', ['find-generic-password', '-s', service, '-a', 'node-token', '-w'])).trim() || null; } catch { return null; } }
// ---------- system self-report ----------
async function memAvailable() {
  if (process.platform === 'darwin') { try { const t = await run('/usr/bin/vm_stat', []); const ps = +(/page size of (\d+)/.exec(t) || [0, 4096])[1]; const g = k => +((new RegExp(k + ':\\s+(\\d+)').exec(t) || [0, 0])[1]);
    return (g('Pages free') + g('Pages inactive') + g('Pages speculative') + g('Pages purgeable')) * ps; } catch {} }
  if (process.platform === 'linux') { try { const m = /MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); if (m) return +m[1] * 1024; } catch {} }
  return os.freemem(); }
async function disk(dir) { try { const l = (await run('/bin/df', ['-k', dir])).trim().split('\n').pop().split(/\s+/); return { total: +l[1] * 1024, free: +l[3] * 1024 }; } catch { return { total: null, free: null }; } }
async function osVersion() { if (process.platform === 'darwin') { try { return 'macOS ' + (await run('/usr/bin/sw_vers', ['-productVersion'])).trim(); } catch {} } return os.type() + ' ' + os.release(); }
async function which(t, extra = []) { for (const d of [path.join(os.homedir(), 'moonkatty-node', 'tools'), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', ...extra]) if (fs.existsSync(path.join(d, t))) return path.join(d, t); return null; }
const TOOLS = { ffprobe: [], ffmpeg: [], python3: [], sips: [], magick: [], convert: [], curl: [] };
let toolCache = null; async function tools() { if (toolCache) return toolCache; const t = []; for (const k of Object.keys(TOOLS)) if (await which(k)) t.push(k); return (toolCache = t); }
async function sysInfo(cfg) { const d = await disk(cfg.workDir); const tl = await tools(); const cpu = cpuPct();
  return { hostname: os.hostname(), os: await osVersion(), arch: process.arch, cpuModel: (os.cpus()[0] || {}).model || '', cpus: os.cpus().length, memTotal: os.totalmem(), memAvailable: await memAvailable(),
    diskFree: d.free, diskTotal: d.total, load1: os.loadavg()[0], cpuPct: cpu, node: process.version, agentVersion: VERSION, tools: tl, model: await hwModel() }; }
let lastCpu = null; function cpuPct() { const c = os.cpus().reduce((a, x) => { const t = x.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 }); const p = lastCpu ? 100 * (1 - (c.idle - lastCpu.idle) / Math.max(1, c.total - lastCpu.total)) : null; lastCpu = c; return p == null ? null : Math.round(p); }
let modelCache; async function hwModel() { if (modelCache !== undefined) return modelCache; try { modelCache = process.platform === 'darwin' ? (await run('/usr/sbin/sysctl', ['-n', 'hw.model'])).trim() : null; } catch { modelCache = null; } return modelCache; }
// ---------- coordinator client (pinned TLS) ----------
// 0.2.1: an enrolled node signs every request with its device Ed25519 key (token is bound to that key on the coordinator)
// classify a transport error for the local status screen (no secrets: message text only)
function connErrorOf(e) { const m = String(e && (e.message || e.code) || ''); const at = new Date().toISOString();
  if (/pin mismatch|fingerprint|отпечат/i.test(m)) return { code: 'E_PIN', message: 'отпечаток сертификата Mac mini не совпадает — проверьте COORDINATOR_FINGERPRINT', at };
  if (/CERT|certificate|self.signed|SSL|TLS|alert/i.test(m) || /^ERR_TLS|^DEPTH_ZERO|^UNABLE_TO/.test(String(e && e.code))) return { code: 'E_TLS', message: 'ошибка TLS: ' + m.slice(0, 120), at };
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timeout|ENOTFOUND|ECONNRESET/i.test(m + ' ' + (e && e.code))) return { code: 'E_NETWORK', message: 'Mac mini недоступен: ' + m.slice(0, 120), at };
  return { code: 'E_CONNECT', message: m.slice(0, 160), at }; }
function signHeaders(cfg, method, p, data) { if (!cfg.deviceKey) return {}; const ts = Date.now(); const nonce = crypto.randomBytes(18).toString('base64url'); return { 'x-node-ts': String(ts), 'x-node-nonce': nonce, 'x-node-sig': EN.sign(cfg.deviceKey, `${method}\n${p}\n${ts}\n${nonce}\n${sha256(data || Buffer.alloc(0))}`) }; }
function client(cfg) {
  const u = new URL(cfg.url); const isHttps = u.protocol === 'https:';
  if (!isHttps && !cfg.allowHttpForTests) throw new Error('COORDINATOR_URL должен быть https:// (TLS с закреплённым сертификатом)');
  // TLS modes: 'tailscale' — coordinator behind `tailscale serve` (Let's Encrypt cert for <host>.<tailnet>.ts.net, normal CA
  // verification, tailnet-only, never funnel); 'pinned' (default) — self-signed coordinator cert pinned by SHA-256.
  if (cfg.tlsMode === 'tailscale') { if (!isHttps || !/\.ts\.net$/i.test(u.hostname)) throw new Error('NODE_TLS_MODE=tailscale: COORDINATOR_URL должен быть https://<mac-mini>.<tailnet>.ts.net (tailscale serve, без funnel)'); }
  const pinPem = isHttps && cfg.tlsMode !== 'tailscale' ? fs.readFileSync(cfg.certFile, 'utf8') : null; const pin = (cfg.fingerprint || '').replace(/:/g, '').toLowerCase();
  if (isHttps && cfg.tlsMode !== 'tailscale' && !/^[a-f0-9]{64}$/.test(pin)) throw new Error('COORDINATOR_FINGERPRINT (SHA-256, 64 hex) обязателен');
  const agent = isHttps && cfg.tlsMode === 'tailscale' ? new https.Agent({ keepAlive: true, minVersion: 'TLSv1.2' }) : isHttps ? new https.Agent({ ca: pinPem, keepAlive: true, checkServerIdentity: (h, cert) => { const fp = String(cert.fingerprint256 || '').replace(/:/g, '').toLowerCase(); return fp === pin ? undefined : new Error('TLS pin mismatch: ' + fp); } }) : new http.Agent({ keepAlive: true });
  return function req(method, p, body, { raw = false, timeout = 30000, toFile = null, maxBytes = Infinity } = {}) { return new Promise((res, rej) => {
    const data = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const r = (isHttps ? https : http).request({ method, hostname: u.hostname, port: u.port || (isHttps ? 443 : 80), path: '/api/nodes' + p, agent, timeout,
      headers: { authorization: 'Bearer ' + cfg.token, ...signHeaders(cfg, method, '/api/nodes' + p, data), 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json', ...(data ? { 'content-length': data.length } : {}) } }, resp => {
      if (toFile && resp.statusCode === 200) { const h = crypto.createHash('sha256'); let n = 0; const w = fs.createWriteStream(toFile, { mode: 0o600 }); // streamed: big videos never sit in RAM
        resp.on('data', d => { n += d.length; if (n > maxBytes) { resp.destroy(new Error('файл больше лимита')); return; } h.update(d); }); resp.on('error', rej); resp.pipe(w); w.on('error', rej); w.on('finish', () => res({ status: 200, sha256: h.digest('hex'), size: n })); return; }
      const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => { const b = Buffer.concat(c); if (raw && resp.statusCode === 200) return res({ status: 200, buf: b, headers: resp.headers }); let j = null; try { j = JSON.parse(b.toString()); } catch {} res({ status: resp.statusCode, body: j }); }); });
    r.on('timeout', () => r.destroy(new Error('timeout'))); r.on('error', rej); if (data) r.write(data); r.end(); }); };
}
// ---------- task handlers (allowlisted, light only) ----------
const norm = s => String(s || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function getUrl(url, max = 2e6) { return new Promise((res, rej) => { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return rej(new Error('only http(s)'));
  (u.protocol === 'https:' ? https : http).get(u, { timeout: 20000, headers: { 'user-agent': 'MOONKATTY-node/' + VERSION } }, r => { if (r.statusCode >= 300) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); } const c = []; let n = 0;
    r.on('data', d => { n += d.length; if (n > max) r.destroy(new Error('too large')); else c.push(d); }); r.on('end', () => res(Buffer.concat(c).toString('utf8'))); r.on('error', rej); }).on('error', rej).on('timeout', function () { this.destroy(new Error('timeout')); }); }); }
// nodes-022-final: linear block scan (indexOf) instead of /<(item|entry)\b[\s\S]*?<\/\1>/g — that regex was O(n²) on unclosed tags
// (100 KB of "<item>" ≈ 0.2 s, a 2 MB hostile feed ≈ minutes of blocked event loop → missed heartbeats). Same blocks, same 200-item cap.
function rssBlocks(xml) { const out = []; let pos = 0; const s = String(xml || ''); const next = { item: -2, entry: -2 }; // cached next '<tag' at/after pos; -1 = none left
  const find = tag => { if (next[tag] === -1) return -1; if (next[tag] < pos) next[tag] = s.indexOf('<' + tag, pos); return next[tag]; };
  while (out.length < 200) { const a = find('item'), b = find('entry'); if (a < 0 && b < 0) break; const tag = b < 0 || (a >= 0 && a < b) ? 'item' : 'entry'; const i = tag === 'item' ? a : b;
    if (/\w/.test(s.charAt(i + 1 + tag.length))) { pos = i + 1; continue; } // \b: <items>, <entryX> are not blocks
    const end = s.indexOf('</' + tag + '>', i); if (end < 0) { next[tag] = -1; continue; } // no closing after i → none of the later opens can close either
    out.push(s.slice(i, end + tag.length + 3)); pos = end + tag.length + 3; } return out; }
// linear field extraction (indexOf) — the former per-field lazy regexes were O(n²) on unclosed <title>/<link>/<pubDate> inside one block
function rssField(b, name) { let p = 0; for (;;) { const i = b.indexOf('<' + name, p); if (i < 0) return null; const c = b.charAt(i + 1 + name.length); if (c !== '>' && !/\s/.test(c)) { p = i + 1; continue; }
  const gt = b.indexOf('>', i); if (gt < 0) return null; const end = b.indexOf('</' + name + '>', gt); if (end < 0) return null; return { at: i, tag: b.slice(i, Math.min(gt + 1, i + 2048)), text: b.slice(gt + 1, end) }; } }
function parseRss(xml) { const items = []; for (const b0 of rssBlocks(xml)) { if (items.length >= 200) break; const b = b0.length > 65536 ? b0.slice(0, 65536) : b0; // an RSS item is small; cap hostile blocks
  const t = (rssField(b, 'title') || {}).text || ''; const lf = rssField(b, 'link'); let l = lf ? lf.text : '';
  if (!l) { const li = b.indexOf('<link'); if (li >= 0) { const gt = b.indexOf('>', li); const tag = b.slice(li, gt < 0 ? Math.min(b.length, li + 2048) : Math.min(gt + 1, li + 2048)); l = (/href="([^"]+)"/.exec(tag) || [])[1] || ''; } }
  const ds = ['pubDate', 'updated', 'published'].map(n => rssField(b, n)).filter(Boolean).sort((x, y) => x.at - y.at); const d = ds.length ? ds[0].text : '';
  items.push({ title: t.replace(/<!\[CDATA\[|\]\]>/g, '').trim().slice(0, 300), link: l.trim().slice(0, 500), date: d.trim(), untrusted: true }); } return items; }
const itemKey = it => sha256(norm(it.title) + '|' + norm(it.link).replace(/\s/g, ''));
function dedup(items) { const seen = new Set(), out = []; for (const it of items || []) { const k = itemKey(it); if (!seen.has(k)) { seen.add(k); out.push({ ...it, key: k.slice(0, 16) }); } } return out; }
const safeHost = u => { try { return new URL(u).hostname; } catch { return null; } };
function makeHandlers(cfg, ctx) {
  const inArchive = n => { const f = path.resolve(cfg.archiveDir, path.basename(String(n))); if (!f.startsWith(path.resolve(cfg.archiveDir) + path.sep)) throw new Error('путь'); return f; };
  return {
    'rss.fetch': async i => ({ feed: i.url, items: parseRss(await getUrl(i.url)) }),
    // streaming dedup per feed (no big "all" array), memory checked between feeds → partial result instead of OOM
    'news.collect': async i => { const L = cfg.limits; const seen = new Set(), items = [], errors = []; const feeds = (i.feeds || []).slice(0, L.maxFeeds); const bySource = {}; let truncated = null;
      for (let k = 0; k < feeds.length; k++) { if (rssMB() > L.maxRssMB) { truncated = `memory: RSS ${rssMB()} MB > ${L.maxRssMB} MB`; break; } if (items.length >= L.maxItemsPerJob) { truncated = 'maxItemsPerJob ' + L.maxItemsPerJob; break; }
        const f = feeds[k]; const u = typeof f === 'string' ? f : f.url; const src = String((typeof f === 'object' && f.source) || safeHost(u)).slice(0, 60); ctx.progress(Math.round(100 * k / feeds.length));
        try { let n = 0; for (const x of parseRss(await getUrl(u, L.maxFeedBytes))) { const key = itemKey(x); if (seen.has(key) || items.length >= L.maxItemsPerJob) continue; seen.add(key); items.push({ ...x, source: src, key: key.slice(0, 16) }); n++; } bySource[src] = (bySource[src] || 0) + n; } catch (e) { errors.push({ feed: u, error: e.message }); } }
      ctx.stats.collected += items.length; return { items, bySource, errors, truncated, rssMB: rssMB() }; },
    'news.dedup': async i => ({ items: dedup(i.items) }),
    'schedule.tick': async () => ({ at: new Date().toISOString() }),
    'stats.compute': async i => { const v = (Array.isArray(i.values) ? i.values : []).slice(0, 1e6).filter(x => (typeof x === 'number' || (typeof x === 'string' && x.trim() !== ''))).map(Number).filter(Number.isFinite).sort((a, b) => a - b); /* null/''/bool are not 0 */ const s = v.reduce((a, b) => a + b, 0);
      return { n: v.length, sum: s, mean: v.length ? s / v.length : null, min: v[0] ?? null, max: v[v.length - 1] ?? null, median: v.length ? v[Math.floor(v.length / 2)] : null }; },
    'monitor.check': async i => { const out = []; for (const u of (i.urls || []).slice(0, 20)) { const t = Date.now(); try { await getUrl(u, 1e5); out.push({ url: u, ok: true, ms: Date.now() - t }); } catch (e) { out.push({ url: u, ok: false, error: e.message }); } } return { checks: out }; },
    'queue.inspect': async () => ({ node: cfg.nodeId, running: ctx.running.size, info: await sysInfo(cfg) }),
    'ffprobe.check': async (i, job) => { const ff = await which('ffprobe'); if (!ff) throw Object.assign(new Error('ffprobe не установлен: bash ~/moonkatty-node/fetch-ffprobe.sh (сборка evermeet.cx, SHA-256 закреплён)'), { retryable: false }); const out = [];
      for (const f of job.localFiles) { const j = JSON.parse(await run(ff, ['-v', 'error', '-threads', '1', '-print_format', 'json', '-show_format', '-show_streams', f.path], { timeout: (cfg.limits && cfg.limits.ffprobeTimeoutMs) || 120000 }));
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
    // re-hashes every artifact from disk (streamed) and compares with the content address and an optional expected map {name: sha256}
    'result.verify': async (i, job) => { const out = []; for (const f of job.localFiles) { const h = await hashFile(f.path); const exp = (i.expect || {})[f.name]; const r = { name: f.name, sha256: h, ok: h === f.sha256 && (!exp || exp === h), size: fs.statSync(f.path).size };
        if (h !== f.sha256) r.problem = 'SHA-256 не совпадает с адресом'; else if (exp && exp !== h) r.problem = 'SHA-256 ≠ ожидаемого'; if (r.ok && i.minBytes && r.size < i.minBytes) { r.ok = false; r.problem = 'слишком маленький'; } out.push(r); } return { files: out, ok: out.every(r => r.ok) }; },
    // health of the central studio (Mac mini): authenticated read-only ping of the node API + optional URLs; never changes state
    'studio.health': async i => { const t = Date.now(); const r = await ctx.req('GET', '/ping'); const checks = [{ name: 'node-api', ok: r.status === 200, status: r.status, ms: Date.now() - t }];
      for (const u of (i.urls || []).slice(0, (cfg.limits || {}).maxUrls || 20)) { const t2 = Date.now(); try { await getUrl(u, 1e5); checks.push({ name: u, ok: true, ms: Date.now() - t2 }); } catch (e) { checks.push({ name: u, ok: false, error: e.message }); } }
      return { ok: checks.every(c => c.ok), checks }; },
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
  const tok = crypto.randomBytes(16).toString('hex'); const page = fs.readFileSync(path.join(__dirname, 'status.html'), 'utf8').replace('__TOKEN__', tok); let logo = Buffer.alloc(0); try { logo = fs.readFileSync(path.join(__dirname, 'logo.jpg')); } catch {}
  const srv = http.createServer((req, res) => { const host = String(req.headers.host || ''); if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) { res.writeHead(421); return res.end(); }
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", 'x-frame-options': 'DENY' }); return res.end(page); }
    if (req.method === 'GET' && req.url === '/logo.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' }); return res.end(logo); }
    if (req.method === 'GET' && req.url === '/status') { res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ node: cfg.nodeId, profile: cfg.profile, version: VERSION, state: ctx.state, command: ctx.command, online: !!ctx.online, connError: ctx.connError || null, current: ctx.current, stats: ctx.stats, mem: ctx.mem || null, lastError: ctx.lastError || null, info: ctx.info || null, recent: ctx.recent.slice(-20).reverse(), coordinator: cfg.url, lastNews: ctx.lastNews || null, qc: ctx.qc || [], history: ctx.history || [], localPause: ctx.state === 'paused' })); }
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
  ctx.req = req; const H = makeHandlers(cfg, ctx); fs.mkdirSync(cfg.workDir, { recursive: true }); const outbox = makeOutbox(cfg);
  ctx.mem = { rssMB: rssMB(), peakRssMB: rssMB(), backpressure: 0, limits: cfg.limits };
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  log(`node-agent ${VERSION} ${cfg.nodeId} → ${cfg.url} (Node ${process.version}, ${process.platform}/${process.arch})`);
  let bpSince = 0; let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
  while (!stop) {
    try {
      await outbox.flush(req, act);
      const m = rssMB(); ctx.mem.rssMB = m; ctx.mem.peakRssMB = Math.max(ctx.mem.peakRssMB, m);
      // backpressure: above soft RSS → GC, stop pulling; if RSS does not come back (V8 keeps pages) for bpRestartMs while IDLE
      // (no lease held) or exceeds the hard cap → exit 75, launchd KeepAlive restarts a clean process (ThrottleInterval 30 s).
      if (m > cfg.limits.softRssMB) { if (global.gc) global.gc(); const m2 = rssMB(); if (m2 > cfg.limits.softRssMB) { if (!bpSince) { bpSince = Date.now(); ctx.mem.backpressure++; act('backpressure: RSS ' + m2 + ' MB > ' + cfg.limits.softRssMB + ' MB — новые задачи не беру'); } ctx.state = 'backpressure';
        if (m2 > cfg.limits.maxRssMB || Date.now() - bpSince > cfg.limits.bpRestartMs) { act('перезапуск: RSS ' + m2 + ' MB'); log(`RSS ${m2} MB не снижается — выход 75, launchd перезапустит`); process.exit(75); } await sleep(cfg.pollMs); continue; } } bpSince = 0;
      if (outbox.size() >= cfg.limits.outboxMax) { ctx.state = 'backpressure'; await sleep(cfg.pollMs); continue; }
      if (localPause) { ctx.state = 'paused'; ctx.info = await sysInfo(cfg); await sleep(cfg.pollMs); continue; }
      const r = await req('POST', '/pull', { info: (ctx.info = await sysInfo(cfg)), state: ctx.state }); sample(ctx);
      if (!cfg.profile) { const hh = await req('POST', '/hello', { info: ctx.info }); if (hh.status === 200) { cfg.profile = hh.body.title || hh.body.role; } } if (r.status === 401) { ctx.online = false; ctx.state = 'error'; ctx.connError = { code: (r.body && r.body.code) || 'E_UNAUTHORIZED', message: 'координатор отклонил токен/подпись (узел отозван или токен устарел)', at: new Date().toISOString() }; log('токен отклонён (отозван?) — пауза 60 с'); await sleep(+process.env.NODE_AUTH_RETRY_MS || 60000); continue; }
      if (r.status === 426) { ctx.online = false; ctx.state = 'error'; ctx.connError = { code: 'E_AGENT_VERSION', message: 'координатор требует другую версию агента: ' + ((r.body && r.body.agentVersionRange) || ''), at: new Date().toISOString() }; log('координатор: ' + ((r.body && r.body.error) || 'несовместимая версия')); await sleep(60000); continue; }
      if (r.status === 200 && r.body.rotate) await rotate(cfg, req, act);
      if (r.status !== 200) throw new Error('pull HTTP ' + r.status); backoff = 1000; ctx.connError = null; const job = r.body.job; ctx.command = r.body.command || 'run'; ctx.online = true;
      if (ctx.command === 'stop') { act('остановка по команде координатора'); log('команда stop — выхожу'); break; }
      if (ctx.command !== 'run') { if (ctx.state !== ctx.command) act('команда ' + ctx.command); ctx.state = ctx.command === 'drain' ? 'drained' : 'paused'; await sleep(cfg.pollMs); continue; } ctx.state = job ? 'busy' : 'idle';
      if (!job) { await sleep(cfg.pollMs); continue; }
      log('задача', job.id, job.capability, 'попытка', job.attempt);
      if (fault === 'drop-after-lease') { log('FAULT: падаю после получения аренды'); process.exit(3); }
      ctx.current = { id: job.id, capability: job.capability, startedAt: new Date().toISOString(), progress: null }; act('задача ' + job.capability, { job: job.id });
      const hb = setInterval(() => req('POST', `/jobs/${job.id}/heartbeat`, { leaseId: job.leaseId, checkpoint: { progress: ctx.current && ctx.current.progress } }).then(h => { if (h.body && h.body.command) ctx.command = h.body.command; }).catch(() => {}), Math.max(1000, Math.floor(job.leaseMs / 3)));
      try {
        const deny = allowCap(cfg.profileKey, job.capability, { xGrowth: cfg.xGrowth }); if (deny) throw Object.assign(new Error(deny), { retryable: false });
        const h = H[job.capability]; if (!h) throw Object.assign(new Error('capability не поддерживается агентом: ' + job.capability), { retryable: false });
        const dir = fs.mkdtempSync(path.join(cfg.workDir, 'job-')); job.localFiles = [];
        for (const f of job.files || []) { const p = path.join(dir, path.basename(f.name || f.sha256)); const g = await req('GET', '/files/' + f.sha256, null, { toFile: p, timeout: 600000, maxBytes: cfg.limits.maxFileBytes || Infinity }); if (g.status !== 200) throw Object.assign(new Error('скачивание ' + f.sha256 + ': ' + g.status), { retryable: true });
          if (g.sha256 !== f.sha256) { fs.rmSync(p, { force: true }); throw Object.assign(new Error('SHA-256 скачанного файла не совпадает'), { retryable: true }); } job.localFiles.push({ ...f, path: p }); }
        if (cfg.slowMs) await sleep(cfg.slowMs);
        const out = await h(job.input || {}, job); fs.rmSync(dir, { recursive: true, force: true });
        if (job.capability === 'news.collect' || job.capability === 'news.prepare') ctx.lastNews = { at: new Date().toISOString(), bySource: out.bySource || null, headlines: (out.items || []).slice(0, 8).map(x => ({ title: x.title, source: x.source || null, date: x.date || null })), total: (out.items || []).length };
        if (job.capability === 'ffprobe.check' || job.capability === 'result.verify') { (ctx.qc ||= []).unshift(...(out.files || []).map(f => ({ at: new Date().toISOString(), name: f.name, ok: f.ok, problems: f.problems || (f.problem ? [f.problem] : []), codec: f.codec, width: f.width, height: f.height, durationSec: f.durationSec }))); ctx.qc = ctx.qc.slice(0, 20); }
        const artifacts = (out && out.artifacts) || []; let result = out, pending = null;
        // large results (big news batches) go as a gzip JSON artifact verified by SHA-256 instead of an inline body (coordinator caps JSON at 1 MB)
        const json = Buffer.from(JSON.stringify(out === undefined ? null : out)); if (json.length > cfg.limits.maxInlineResultBytes) { const gz = require('zlib').gzipSync(json); const h = sha256(gz);
          try { await ctx.upload(gz); } catch (e) { pending = gz; } artifacts.push({ sha256: h, name: `result-${job.id}.json.gz`, kind: 'result' });
          result = { resultArtifact: h, format: 'json+gzip', bytes: json.length, total: (out && out.items || []).length, bySource: out && out.bySource || null, errors: out && out.errors || [], truncated: out && out.truncated || null }; }
        const body = { leaseId: job.leaseId, result, artifacts };
        let c; if (pending) { outbox.add(job.id, body, pending); c = { status: 'queued-offline', body: {} }; act('нет связи — результат в offline-очереди', { job: job.id }); }
        else { try { c = await req('POST', `/jobs/${job.id}/complete`, body); } catch (e) { outbox.add(job.id, body); act('нет связи — результат в offline-очереди', { job: job.id }); c = { status: 'queued-offline', body: {} }; }
          if (c.status >= 500) { outbox.add(job.id, body); c = { status: 'queued-offline', body: {} }; } }
        if (fault === 'duplicate-complete') c = await req('POST', `/jobs/${job.id}/complete`, body);
        log('завершено', job.id, c.status, c.body && c.body.duplicate ? '(повтор подтверждения)' : ''); ctx.stats.done++; act('готово ' + job.capability, { job: job.id, status: c.status });
      } catch (e) { log('ошибка', job.id, e.message); ctx.stats.failed++; ctx.lastError = e.message; act('ошибка ' + job.capability, { job: job.id, error: e.message }); await req('POST', `/jobs/${job.id}/fail`, { leaseId: job.leaseId, error: e.message, retryable: !!e.retryable }).catch(() => {}); }
      finally { clearInterval(hb); const busyMs = Date.now() - Date.parse(ctx.current ? ctx.current.startedAt : new Date().toISOString()); ctx.current = null; if (global.gc) global.gc();
        // CPU budget (2-core MacBook): duty cycle — after a job of T ms rest T×(1/duty−1) ms, so the agent averages ≤ duty of one core
        const duty = cfg.limits.dutyCycle || 1; if (duty < 1 && busyMs > 50) await sleep(Math.min(60000, Math.round(busyMs * (1 / duty - 1)))); }
    } catch (e) { if (ctx.online !== false) act('нет связи: ' + e.message); ctx.online = false; ctx.state = 'offline'; ctx.connError = connErrorOf(e); log('нет связи с координатором:', e.message, `— повтор через ${backoff / 1000} с`); await sleep(backoff); backoff = Math.min(backoff * 2, 60000); }
  }
  log('остановлен');
}
// Offline queue: results that could not be delivered are kept on disk (0600, ~/.moonkatty-node/outbox) and re-sent
// with the same leaseId (coordinator acks duplicates idempotently). 409/404 = lease gone → dropped (job is requeued on the coordinator).
function makeOutbox(cfg, { maxAgeMs = 24 * 3600e3 } = {}) { const d = cfg.outboxDir; fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const list = () => fs.readdirSync(d).filter(f => /^nj_[a-f0-9]{16}\.json$/.test(f)).sort();
  const put = (f, b) => { fs.writeFileSync(f + '.tmp', b, { mode: 0o600 }); fs.renameSync(f + '.tmp', f); };
  return { size: () => list().length,
    add(id, body, blob) { const f = path.join(d, id + '.json'); if (blob) put(path.join(d, id + '.blob'), blob); put(f, JSON.stringify({ at: Date.now(), body, blob: !!blob })); },
    async flush(req, act = () => {}) { for (const f of list()) { const id = f.slice(0, -5); const F = path.join(d, f), B = path.join(d, id + '.blob'); let e; try { e = JSON.parse(fs.readFileSync(F, 'utf8')); } catch { fs.rmSync(F, { force: true }); continue; }
      const drop = why => { fs.rmSync(F, { force: true }); fs.rmSync(B, { force: true }); act(why, { job: id }); };
      if (Date.now() - (e.at || 0) > maxAgeMs) { drop('offline-результат старше 24 ч — удалён'); continue; }
      if (e.blob && fs.existsSync(B)) { const buf = fs.readFileSync(B); const u = await req('PUT', '/files/' + sha256(buf), buf); if (u.status !== 200) break; fs.rmSync(B, { force: true }); e.blob = false; put(F, JSON.stringify(e)); }
      const r = await req('POST', `/jobs/${id}/complete`, e.body); if (r.status === 200) drop('offline-результат доставлен'); else if (r.status === 409 || r.status === 404 || r.status === 413 || r.status === 400) drop('offline-результат отклонён координатором (' + r.status + ')'); else break; } } }; }
// token rotation (owner pressed "Ротация" or policy): new token → Keychain only; old one stops working immediately
async function rotate(cfg, req, act = () => {}) { const r = await req('POST', '/rotate', {}); if (r.status !== 200 || !r.body || !r.body.token) { act('ротация не удалась: HTTP ' + r.status); return false; }
  await EN.keychain(cfg.env).set('moonkatty-node-' + cfg.nodeId, 'node-token', r.body.token); cfg.token = r.body.token; act('токен обновлён (ротация)'); return true; }
async function config(env = process.env) {
  const fileEnv = loadEnvFile(env.NODE_AGENT_ENV || path.join(os.homedir(), '.moonkatty-node', 'node-agent.env')); const e = { ...fileEnv, ...env };
  const nodeId = e.NODE_ID; if (!/^[a-z0-9-]{2,32}$/.test(nodeId || '')) throw new Error('NODE_ID обязателен');
  const token = e.NODE_TOKEN || await keychainToken('moonkatty-node-' + nodeId, e); if (!token) throw new Error('нет токена: Keychain (moonkatty-node-' + nodeId + ') или NODE_TOKEN в node-agent.env (chmod 600)');
  const home = path.join(os.homedir(), '.moonkatty-node');
  const profileKey = profileOf(e.NODE_PROFILE || (nodeId === 'imac' ? 'news' : nodeId === 'macbook' ? 'monitor' : ''));
  if (profileKey && (e.NODE_ALLOW_HEAVY_AI === '1' || e.NODE_ALLOW_BLENDER === '1')) throw new Error(`профиль ${PROFILES[profileKey].title}: heavy AI / Blender запрещены профилем и не включаются переменными окружения`);
  const base = (PROFILES[profileKey] || PROFILES.news).limits; const limits = { ...base, ...(e.NODE_MAX_RSS_MB ? { maxRssMB: Math.min(1024, +e.NODE_MAX_RSS_MB) } : {}), ...(e.NODE_SOFT_RSS_MB ? { softRssMB: +e.NODE_SOFT_RSS_MB } : {}) };
  const xGrowth = profileKey === 'monitor' && e.NODE_X_GROWTH === '1';
  const tlsMode = e.NODE_TLS_MODE === 'tailscale' ? 'tailscale' : 'pinned';
  let deviceKey = null; try { const d = await EN.deviceIdentity(path.join(os.homedir(), '.moonkatty-node'), EN.keychain(e), { create: false }); if (d) deviceKey = d.key; } catch {}
  return { env: e, deviceKey, profileKey, limits, tlsMode, xGrowth, outboxDir: e.NODE_OUTBOX_DIR || path.join(e.NODE_WORK_DIR ? path.dirname(e.NODE_WORK_DIR) : home, 'outbox'), nodeId, token, url: e.COORDINATOR_URL, certFile: e.COORDINATOR_CERT || path.join(home, 'coordinator.crt'), fingerprint: e.COORDINATOR_FINGERPRINT, allowHttpForTests: e.NODE_AGENT_TEST_HTTP === '1',
    workDir: e.NODE_WORK_DIR || path.join(home, 'work'), actionLog: e.NODE_ACTION_LOG || path.join(e.NODE_WORK_DIR || path.join(home, 'work'), '..', 'actions.log'), statusPort: e.NODE_STATUS_PORT === '0' ? 0 : +(e.NODE_STATUS_PORT || 8791), profile: e.NODE_PROFILE || '', archiveDir: e.NODE_ARCHIVE_DIR || path.join(home, 'archive'), pollMs: +(e.NODE_POLL_MS || 5000), ntfyUrl: e.NODE_NTFY_URL || '', fault: e.NODE_AGENT_FAULT || '', slowMs: +(e.NODE_AGENT_SLOW_MS || 0) };
}
if (require.main === module) {
  if (process.argv.includes('--info')) config().catch(() => ({ workDir: os.tmpdir() })).then(c => sysInfo(c)).then(i => { console.log(JSON.stringify(i, null, 2)); });
  else if (process.argv.includes('--enroll')) { const a = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
    // the one-time code is never taken from argv/env (visible in ps / process env): typed at the prompt or piped via stdin
    if (process.argv.includes('--code')) { console.error('enroll: не передавайте код в командной строке (виден в ps) — введите его по запросу или через stdin'); process.exit(2); }
    const readCode = () => new Promise(res => { if (process.stdin.isTTY) process.stderr.write('Код подключения из панели Mac mini: '); let b = ''; process.stdin.setEncoding('utf8');
      process.stdin.on('data', d => { b += d; if (b.includes('\n')) { process.stdin.pause(); res(b.split('\n')[0].trim()); } }); process.stdin.on('end', () => res(b.trim())); });
    readCode().then(code => sysInfo({ workDir: os.homedir() }).then(info => EN.enroll({ url: a('url'), fingerprint: a('fingerprint'), code, info, onState: s => console.log('enroll:', s.step, s.requestId || '', s.nodeId || '', s.deviceId || '', s.pubKeyShort ? 'ключ ' + s.pubKeyShort + ' — сверьте с панелью' : '') })))
      .then(r => { console.log(`Подключено: узел ${r.nodeId} (${r.role}), устройство ${r.deviceId}, ключ ${r.pubKeyShort}. Токен сохранён в Keychain. Запустите агент или включите автозапуск.`); process.exit(0); })
      .catch(e => { console.error('enroll:', e.message); process.exit(2); }); }
  else config().then(main).catch(e => { if (/NODE_ID обязателен|нет токена/.test(e.message) && !process.argv.includes('--no-enroll-ui')) return enrollUi(); console.error('node-agent:', e.message); process.exit(1); });
}
// Enrollment screen on 127.0.0.1:8791 (only when the node is not configured yet). Same-origin token, Host check, no external access.
function enrollUi(port = +(process.env.NODE_STATUS_PORT || 8791)) { const tok = crypto.randomBytes(16).toString('hex'); let state = { step: 'idle' };
  const page = fs.readFileSync(path.join(__dirname, 'enroll.html'), 'utf8').replace('__TOKEN__', tok);
  const srv = http.createServer((q, s) => { if (!/^(127\.0\.0\.1|localhost):\d+$/.test(String(q.headers.host || ''))) { s.writeHead(421); return s.end(); }
    if (q.method === 'GET' && q.url === '/') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'", 'x-frame-options': 'DENY' }); return s.end(page); }
    if (q.method === 'GET' && q.url === '/enroll/state') { s.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return s.end(JSON.stringify(state)); }
    if (q.method === 'POST' && q.url === '/enroll') { if (q.headers['x-node-local'] !== tok) { s.writeHead(403); return s.end(); } let b = ''; q.on('data', d => { b += d; if (b.length > 4096) q.destroy(); }); q.on('end', async () => {
      let i; try { i = JSON.parse(b); } catch { s.writeHead(400); return s.end(); } if (state.step !== 'idle' && state.step !== 'error') { s.writeHead(409); return s.end('{}'); } s.writeHead(202); s.end('{}');
      state = { step: 'start' }; try { const info = await sysInfo({ workDir: os.homedir() }); const r = await EN.enroll({ url: i.url, fingerprint: i.fingerprint, code: i.code, info, onState: x => { state = x; } }); state = { step: 'enrolled', ...r }; console.log('Подключено:', r.nodeId, '— перезапуск агента'); setTimeout(() => process.exit(75), 1500); }
      catch (e) { state = { step: 'error', error: e.message, code: e.code || null }; console.error('enroll:', e.message); } }); return; }
    s.writeHead(404); s.end(); });
  srv.listen(port, '127.0.0.1', () => console.log(`Узел не подключён. Откройте http://127.0.0.1:${port} и введите код из панели Mac mini (или: agent.js --enroll --url … --fingerprint … --code …)`)); return srv; }
module.exports = { connErrorOf, enrollUi, rotate, signHeaders, hashFile, parseRss, dedup, sysInfo, config, loadEnvFile, makeHandlers, client, makeOutbox, allowCap, profileOf, PROFILES, FORBIDDEN, VERSION };
