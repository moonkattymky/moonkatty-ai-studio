// Distributed Node Manager (coordinator side, runs inside the Mac mini server). OFF unless STUDIO_OPS_NODES=1.
// Pull-based queue: nodes poll; the coordinator never connects to nodes. Per-node scoped tokens (sha256 stored),
// per-node capability allowlist, lease + heartbeat, ack, idempotency keys, SHA-256 verified file transfer,
// requeue on node loss ONLY for safeToRetry jobs, resource-aware fit check, alerts via the existing notifier.
// Plain node:http handler: served on the separate LAN listener (TLS, pinned cert) — the full app is NOT exposed on LAN.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
const { stateFile } = require('./state.js');
const GB = 1024 ** 3;
// Role presets (Igor's spec). Heavy AI / 3D / render never on Intel nodes; OpenCode never leaves the Mac mini.
const NEWS_CAPS = ['news.collect', 'rss.fetch', 'news.dedup', 'news.prepare', 'archive.store', 'image.light', 'transfer.push', 'schedule.tick', 'telegram.notify'];
const MONITOR_CAPS = ['monitor.check', 'site.check', 'studio.health', 'result.verify', 'ffprobe.check', 'stats.compute', 'notify.send', 'queue.inspect', 'backup.light', 'x.analytics', 'x.draft'];
// One app "MOONKATTY NODE", device profiles: news (iMac) / monitor (MacBook). imac/macbook kept as aliases.
// policy is enforced in code (registerNode/submit here AND allowCap() in node-agent/agent.js), not only in docs.
const POLICY = Object.freeze({ heavyAI: false, blender: false, render: false, maxClass: 'light' });
const ROLES = {
  news: { title: 'NEWS NODE', caps: NEWS_CAPS, maxClass: 'light', policy: POLICY }, monitor: { title: 'MONITOR NODE', caps: MONITOR_CAPS, maxClass: 'light', policy: POLICY },
  imac: { title: 'NEWS NODE', caps: NEWS_CAPS, maxClass: 'light', policy: POLICY }, macbook: { title: 'MONITOR NODE', caps: MONITOR_CAPS, maxClass: 'light', policy: POLICY },
};
// Real hardware (confirmed by owner 2026-10-21). Earlier docs said macOS 12.5.1 — that was wrong.
const DEVICES = Object.freeze({
  imac: Object.freeze({ model: 'iMac Retina 5K 27" 2017 (iMac18,3)', cpu: 'Intel Core i5 3.4 GHz, 4 cores', ramGB: 8, gpu: 'Radeon Pro 570 4 GB', os: 'macOS Ventura 13.7.1', arch: 'x86_64',
    runtime: 'Node.js 24 LTS darwin-x64 (min macOS 13.5)', profile: 'news', heavyAI: false, blender: false, limits: { maxRssMB: 384, softRssMB: 260, maxHeapMB: 192 } }),
  macbook: Object.freeze({ model: 'MacBook Pro Retina 13" Early 2015 (MacBookPro12,1)', cpu: 'Intel Core i5 2.7 GHz, 2 cores', ramGB: 8, ram: '8 GB DDR3', gpu: 'Intel Iris Graphics 6100', os: 'macOS Monterey 12.7.6', arch: 'x86_64',
    runtime: 'Node.js 22 LTS darwin-x64 (min macOS 11.0); Node 24 needs 13.5 — not allowed', profile: 'monitor', heavyAI: false, blender: false, xGrowth: false, limits: { maxRssMB: 256, softRssMB: 160, maxHeapMB: 128 } }),
});
const COMMANDS = ['run', 'pause', 'drain', 'stop'];
const FORBIDDEN_CAPS = /^(opencode|blender|render|ollama|llm|ai\.|model\.|whisper|sd\.|comfy|x\.(post|like|follow|repost|dm|reply)(\.|$))/; // X: analytics/drafts only (platform rules)
const SECRET_KEY = /pass(word)?|secret|token|api[-_]?key|credential|authorization|cookie|private[-_]?key/i;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const now0 = () => Date.now();
function scanSecrets(o, p = '') { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (SECRET_KEY.test(k)) throw new Error(`input содержит поле-секрет «${p + k}» — секреты (в т.ч. пароль OpenCode) не передаются на другие машины`); scanSecrets(v, p + k + '.'); }
  if (typeof o === 'string' && /Basic [A-Za-z0-9+/=]{12,}|sk-[A-Za-z0-9]{16,}|nk_[a-z0-9-]+\.[A-Za-z0-9_-]{20,}/.test(o)) throw new Error('input похож на секрет — не передаётся на узлы'); }
const PROTOCOL = 2, AGENT_RANGE = '>=0.2.0 <0.3.0'; // protocol 2 (0.2.2): signed requests carry x-node-nonce; enrolled nodes need agent >= 0.2.2
const SIG_WINDOW_MS = 30e3, NONCE_MAX = 20000;
// fixed-work auth: a dummy key/hash is used when the node/token does not match, so wrong and right tokens cost the same (no timing oracle)
const DUMMY = (() => { const k = crypto.generateKeyPairSync('ed25519'); return { pub: k.publicKey.export({ type: 'spki', format: 'pem' }), hash: '0'.repeat(64) }; })();
const agentOk = v => { if (!v) return true; const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v)); return !!m && +m[1] === 0 && +m[2] === 2; }; // >=0.2.0 <0.3.0; missing = legacy test clients
function createNodeManager({ dir, notify = async () => {}, now = now0, log = () => {}, leaseMs = 60000, nodeDownMs = 90000, maxFileBytes = 512 * 1024 * 1024, allowPlainEnrollForTests = false, whois = defaultWhois } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); lockDir(dir); const filesDir = path.join(dir, 'node-files'); fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  const st = stateFile(path.join(dir, 'nodes.json'), { nodes: {}, jobs: {}, idem: {}, alerts: {} }); const S = st.load(); S.nodes ||= {}; S.jobs ||= {}; S.idem ||= {}; S.alerts ||= {};
  const save = () => st.save(S); const waiters = new Map();
  // ---- audit log (no secrets: never codes, tokens, request secrets, private keys) ----
  S.audit ||= []; const audit = (type, d = {}) => { S.audit.push({ at: new Date(now()).toISOString(), type, ...d }); if (S.audit.length > 1000) S.audit.splice(0, S.audit.length - 1000); save(); log('info', 'nodes-audit', type + ' ' + JSON.stringify(d)); };
  S.enrollKey ||= crypto.randomBytes(32).toString('base64');
  function issueToken({ id, role, name, device }) { const preset = ROLES[role]; const secret = crypto.randomBytes(24).toString('base64url'); const token = `nk_${id}.${secret}`;
    S.nodes[id] = { ...(S.nodes[id] || {}), id, name: String(name || id).slice(0, 64), role, caps: S.nodes[id]?.role === role && S.nodes[id]?.caps ? S.nodes[id].caps : preset.caps.filter(c => !/^x\./.test(c)), tokenHash: sha256(token),
      createdAt: S.nodes[id]?.createdAt || new Date(now()).toISOString(), revoked: false, status: 'never-seen', enrolled: true, deviceId: device.deviceId, devicePubKey: device.pubKey, devicePubFp: device.pubFp, rotatePending: false };
    save(); return token; }
  const E = require('./node-enroll.js'); const enrollment = E.createEnrollment({ S, save, now, issueToken, audit, serverKey: Buffer.from(S.enrollKey, 'base64'), useNonce: (rid, nonce, ts) => useNonce('e:' + rid, nonce, ts), sigWindowMs: SIG_WINDOW_MS });
  function rotateToken(n) { const secret = crypto.randomBytes(24).toString('base64url'); const token = `nk_${n.id}.${secret}`; n.tokenHash = sha256(token); n.rotatePending = false; save(); audit('rotated', { nodeId: n.id }); return { token }; }
  function requestRotate(id) { const n = S.nodes[id]; if (!n || n.revoked) throw new Error('not found'); n.rotatePending = true; save(); audit('rotate_requested', { nodeId: id }); return { ok: true }; }
  const ev = (j, type, extra = {}) => { (j.events ||= []).push({ at: new Date(now()).toISOString(), type, ...extra }); if (j.events.length > 50) j.events.splice(0, j.events.length - 50); j.updatedAt = new Date(now()).toISOString(); };
  // ---- nodes / tokens ----
  function registerNode({ id, name, role, caps }) {
    if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(id || '')) throw new Error('id: a-z0-9-, 2..32'); if (id === 'mac-mini') throw new Error('mac-mini — это координатор');
    const preset = ROLES[role]; if (!preset) throw new Error('role: ' + Object.keys(ROLES).join('|'));
    const allowed = (caps && caps.length ? caps : preset.caps.filter(c => !/^x\./.test(c))).filter(c => typeof c === 'string'); // X GROWTH only when listed explicitly
    const bad = allowed.filter(c => FORBIDDEN_CAPS.test(c) || !preset.caps.includes(c)); if (bad.length) throw new Error('недопустимые capability для роли ' + role + ': ' + bad.join(', '));
    const secret = crypto.randomBytes(24).toString('base64url'); const token = `nk_${id}.${secret}`;
    S.nodes[id] = { ...(S.nodes[id] || {}), id, name: String(name || id).slice(0, 64), role, caps: allowed, tokenHash: sha256(token), createdAt: S.nodes[id]?.createdAt || new Date(now()).toISOString(), revoked: false, status: 'never-seen' };
    save(); return { id, token, caps: allowed };
  }
  function setCommand(id, command) { const n = S.nodes[id]; if (!n) throw new Error('not found'); if (!COMMANDS.includes(command)) throw new Error('command: ' + COMMANDS.join('|')); n.command = command; ev2(n, 'command:' + command); save(); return publicNode(n); }
  const ev2 = (n, a) => { (n.activity ||= []).push({ at: new Date(now()).toISOString(), a }); if (n.activity.length > 30) n.activity.splice(0, n.activity.length - 30); };
  function revokeNode(id) { const n = S.nodes[id]; if (!n) throw new Error('not found'); n.revoked = true; n.tokenHash = null; n.status = 'revoked'; n.devicePubKey = null; save(); audit('revoked', { nodeId: id }); sweep(); return { ok: true }; }
  // sig = { method, path, ts, sig, body } — REQUIRED for enrolled nodes (token bound to the device Ed25519 key); legacy 0.2.0 direct-token nodes: bearer only
  // ---- peer identity for rate-limit buckets (audit M2) ----
  // Behind `tailscale serve` every peer arrives from 127.0.0.1. Proxy headers are trusted ONLY when the socket is loopback (serve runs on this Mac):
  // X-Forwarded-For with a tailnet address → `tailscale whois` → bucket per tailnet device; else Tailscale-User-Login → bucket per tailnet user;
  // else one shared 'loopback' bucket (safe fallback). Direct tailnet peers (listener bound on 100.x) → whois of the socket address. Headers from
  // non-loopback sockets are ignored (cannot be spoofed by peers).
  const whoisCache = new Map();
  async function whoisCached(ip) { const c = whoisCache.get(ip); if (c && c.exp > now()) return c.v; let v = null; try { v = await whois(ip); } catch {} whoisCache.set(ip, { v, exp: now() + (v ? 300e3 : 30e3) }); if (whoisCache.size > 500) whoisCache.delete(whoisCache.keys().next().value); return v; }
  async function peerOf(req) { const ra = String(req.socket.remoteAddress || '').replace(/^::ffff:/, ''); let ip = ra; let via = 'direct';
    if (ra === '127.0.0.1' || ra === '::1') { const xff = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).pop();
      if (xff && isTailnet(xff)) { ip = xff; via = 'tailscale serve'; } else { const login = String(req.headers['tailscale-user-login'] || '').trim().toLowerCase().slice(0, 128);
        if (/^[^\s]+$/.test(login)) return { key: 'tsuser:' + login, label: login + ' (tailscale serve)', ip: ra, verified: true }; return { key: 'loopback', label: '127.0.0.1 (без идентификатора Tailscale)', ip: ra, verified: false }; } }
    if (isTailnet(ip)) { const w = await whoisCached(ip); if (w && w.id) return { key: 'tsnode:' + w.id, label: `${w.name || w.id}${w.login ? ' · ' + w.login : ''} (${ip}, ${via})`, ip, verified: true }; }
    return { key: 'ip:' + ip, label: ip, ip, verified: false }; }
  // anti-replay: every signed request carries a single-use nonce; used nonces are kept (bounded) until their timestamp leaves the ±30 s window
  const nonces = new Map(); // `${scope}:${nonce}` → expiry
  function useNonce(scope, nonce, ts) { const t = now(); if (nonces.size > NONCE_MAX / 2) for (const [k, exp] of nonces) if (exp < t) nonces.delete(k);
    if (nonces.size >= NONCE_MAX) return 'E_RATE_LIMIT'; const k = scope + ':' + nonce; if (nonces.has(k)) return 'E_REPLAY'; nonces.set(k, ts + SIG_WINDOW_MS + 1000); return null; }
  const NONCE_RE = /^[A-Za-z0-9_-]{22,64}$/;
  // sig = { method, path, ts, nonce, sig, body }. Enrolled nodes: bearer + Ed25519 over METHOD\nPATH\nts\nnonce\nsha256(body), ±30 s, nonce single use.
  // Legacy 0.2.0 direct-token nodes (no device key): bearer only. Fixed work on every path (hash compare + one signature verify).
  function authNode(header, sig, out = {}) { const m = /^Bearer (nk_([a-z0-9-]+)\.[A-Za-z0-9_-]+)$/.exec(header || ''); const n = m ? S.nodes[m[2]] : null;
    const live = !!(n && !n.revoked && n.tokenHash); const a = Buffer.from(sha256(m ? m[1] : 'x'), 'hex'), b = Buffer.from(live ? n.tokenHash : DUMMY.hash, 'hex');
    const tokOk = crypto.timingSafeEqual(a, b) && live; const s = sig || {}; const ts = +s.ts;
    const sigOk = E.verifySig(live && n.devicePubKey ? n.devicePubKey : DUMMY.pub, `${s.method}\n${s.path}\n${ts}\n${s.nonce || ''}\n${sha256(s.body || Buffer.alloc(0))}`, s.sig || 'AA==');
    if (!tokOk) { out.code = 'E_UNAUTHORIZED'; return null; }
    if (!n.devicePubKey) return n; // legacy 0.2.0
    if (s.sig && !s.nonce) { out.code = 'E_AGENT_VERSION'; return null; } // 0.2.1 agent: no nonce → must update to 0.2.2
    if (!sigOk || !(Math.abs(now() - ts) <= SIG_WINDOW_MS) || !NONCE_RE.test(s.nonce || '')) { out.code = 'E_UNAUTHORIZED'; return null; }
    const r = useNonce('n:' + n.id, s.nonce, ts); if (r) { out.code = r; if (r === 'E_REPLAY') audit('replay_rejected', { nodeId: n.id }); return null; }
    return n; }
  const publicNode = n => ({ id: n.id, name: n.name, role: n.role, caps: n.caps, status: n.status, lastSeen: n.lastSeen || null, info: n.info || null, revoked: !!n.revoked,
    running: Object.values(S.jobs).filter(j => j.nodeId === n.id && j.status === 'leased').length, command: n.command || 'run', title: (ROLES[n.role] || {}).title, activity: (n.activity || []).slice(-10), agentState: n.agentState || null, errors: n.errors || 0, lastError: n.lastError || null });
  function sanitizeInfo(i = {}) { const num = v => (Number.isFinite(+v) && +v >= 0 ? +v : null);
    return { hostname: String(i.hostname || '').slice(0, 64), os: String(i.os || '').slice(0, 64), arch: String(i.arch || '').slice(0, 16), cpuModel: String(i.cpuModel || '').slice(0, 96), cpus: num(i.cpus),
      memTotal: num(i.memTotal), memAvailable: num(i.memAvailable), diskFree: num(i.diskFree), diskTotal: num(i.diskTotal), load1: num(i.load1), cpuPct: i.cpuPct == null ? null : Math.min(100, num(i.cpuPct)), model: String(i.model || '').slice(0, 48), node: String(i.node || '').slice(0, 16), agentVersion: String(i.agentVersion || '').slice(0, 16), tools: Array.isArray(i.tools) ? i.tools.slice(0, 20).map(String) : [] }; }
  // ---- jobs ----
  function submit(spec) {
    const { toNodeJob } = require('./jobs-adapter.js'); const r = spec.capability ? { local: false, job: spec } : toNodeJob(spec); if (r.local) return { local: true, reason: r.reason };
    const j0 = r.job; if (!j0.capability || FORBIDDEN_CAPS.test(j0.capability)) throw new Error('capability не разрешена для узлов: ' + j0.capability);
    if ((j0.resourceClass || 'light') !== 'light') throw new Error('на Intel-узлы отправляются только light-задачи'); scanSecrets(j0.input);
    if (j0.idempotencyKey) { const ex = S.idem[j0.idempotencyKey]; if (ex && S.jobs[ex]) return { jobId: ex, duplicate: true }; }
    const id = 'nj_' + crypto.randomBytes(8).toString('hex');
    const j = { id, type: j0.type || j0.capability, capability: j0.capability, input: j0.input || {}, resourceClass: 'light', requires: j0.requires || {}, preferNode: j0.preferNode || null,
      idempotencyKey: j0.idempotencyKey || null, safeToRetry: j0.safeToRetry === true, maxAttempts: Math.max(1, Math.min(10, j0.maxAttempts | 0 || 1)), timeoutSec: Math.max(10, Math.min(86400, j0.timeoutSec | 0 || 900)),
      files: (j0.files || []).filter(f => /^[a-f0-9]{64}$/.test(f.sha256 || '')).map(f => ({ sha256: f.sha256, name: String(f.name || f.sha256).slice(0, 128) })),
      status: 'queued', attempt: 0, nodeId: null, lease: null, artifacts: [], result: null, error: null, studioJobId: j0.studioJobId || null, createdAt: new Date(now()).toISOString() };
    ev(j, 'created'); S.jobs[id] = j; if (j.idempotencyKey) S.idem[j.idempotencyKey] = id; save(); return { jobId: id };
  }
  const nodeAlive = n => !n.revoked && n.lastSeen && now() - Date.parse(n.lastSeen) < nodeDownMs;
  // resource-aware fit: capability allowlist + requires {ramGB, diskGB, cpus, tools} vs. node self-report
  function fits(n, j) { if (!n.caps.includes(j.capability)) return 'нет capability'; const i = n.info || {}, r = j.requires || {};
    if (j.preferNode && j.preferNode !== n.id) { const pn = S.nodes[j.preferNode]; if (pn && nodeAlive(pn)) return 'назначено на ' + j.preferNode; }
    if (r.ramGB && !(i.memAvailable >= r.ramGB * GB)) return 'мало RAM'; if (r.diskGB && !(i.diskFree >= r.diskGB * GB)) return 'мало диска'; if (r.cpus && !(i.cpus >= r.cpus)) return 'мало CPU';
    if (r.tools && r.tools.some(t => !(i.tools || []).includes(t))) return 'нет инструмента'; if (i.diskFree != null && i.diskFree < 2 * GB) return 'диск < 2 ГБ'; return null; }
  function route(j) { return Object.values(S.nodes).filter(nodeAlive).map(n => ({ node: n.id, reason: fits(n, j), score: ((n.info?.memAvailable || 0) / GB) - (n.info?.load1 || 0) - 2 * publicNode(n).running }))
    .sort((a, b) => (a.reason ? 1 : 0) - (b.reason ? 1 : 0) || b.score - a.score); }
  function hello(n, info) { n.info = sanitizeInfo(info); n.lastSeen = new Date(now()).toISOString(); if (n.status !== 'online') { if (n.status === 'down') notifyOnce('down:' + n.id, false); n.status = 'online'; } save(); return { ok: true, protocol: PROTOCOL, agentVersionRange: AGENT_RANGE, node: n.id, role: n.role, title: (ROLES[n.role] || {}).title, caps: n.caps, leaseMs, command: n.command || 'run', enrolled: !!n.enrolled, rotate: !!n.rotatePending }; }
  function pull(n, info, agentState) {
    hello(n, info); if (agentState) n.agentState = String(agentState).slice(0, 16); const command = n.command || 'run'; if (command !== 'run') return { job: null, command }; if (publicNode(n).running >= 2) return { job: null, command };
    for (const j of Object.values(S.jobs).filter(j => j.status === 'queued').sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)) {
      if (fits(n, j)) continue; const best = route(j).find(r => !r.reason); if (best && best.node !== n.id && best.score - 4 > route(j).find(r => r.node === n.id).score) continue; // a much better idle node exists
      j.status = 'leased'; j.attempt++; j.nodeId = n.id; j.lease = { id: crypto.randomBytes(12).toString('hex'), until: now() + leaseMs, startedAt: now() }; j.heartbeatAt = new Date(now()).toISOString(); ev(j, 'leased', { node: n.id, attempt: j.attempt }); save();
      ev2(n, 'взял ' + j.capability); return { command, job: { id: j.id, leaseId: j.lease.id, capability: j.capability, input: j.input, files: j.files, timeoutSec: j.timeoutSec, attempt: j.attempt, leaseMs } };
    }
    return { job: null, command };
  }
  function own(n, id, leaseId) { const j = S.jobs[id]; if (!j) return [null, 404, 'нет задачи'];
    if (j.status === 'leased' && j.nodeId === n.id && j.lease && j.lease.id === leaseId) return [j];
    if (j.done && j.done.leaseId === leaseId && j.nodeId === n.id) return [j, 200, 'duplicate'];
    return [null, 409, 'аренда недействительна (истекла или задача передана другому узлу)']; }
  function heartbeat(n, id, { leaseId, checkpoint } = {}) { n.lastSeen = new Date(now()).toISOString(); const [j, code, msg] = own(n, id, leaseId); if (!j) return { code, error: msg }; if (msg) return { ok: true, duplicate: true };
    j.lease.until = now() + leaseMs; j.heartbeatAt = new Date(now()).toISOString(); if (checkpoint !== undefined) { j.checkpoint = String(JSON.stringify(checkpoint)).slice(0, 4000); if (checkpoint && Number.isFinite(+checkpoint.progress)) j.progress = Math.max(0, Math.min(100, +checkpoint.progress)); } save(); return { ok: true, cancel: j.status === 'cancelled', command: n.command || 'run' }; }
  function complete(n, id, { leaseId, result, artifacts = [] } = {}) {
    const [j, code, msg] = own(n, id, leaseId); if (!j) return { code, error: msg }; if (msg) return { ok: true, duplicate: true, status: j.status };
    const arts = []; for (const a of Array.isArray(artifacts) ? artifacts : []) { if (!/^[a-f0-9]{64}$/.test(a.sha256 || '')) return { code: 400, error: 'artifact.sha256' };
      const f = path.join(filesDir, a.sha256); if (!fs.existsSync(f)) return { code: 409, error: 'артефакт не загружен: ' + a.sha256 };
      if (sha256(fs.readFileSync(f)) !== a.sha256) { fs.rmSync(f, { force: true }); return { code: 422, error: 'SHA-256 артефакта не совпадает' }; } arts.push({ sha256: a.sha256, name: String(a.name || '').slice(0, 128), kind: a.kind || 'file', size: fs.statSync(f).size }); }
    Object.assign(j, { status: 'succeeded', result: result === undefined ? null : JSON.parse(JSON.stringify(result).slice(0, 200000) || 'null'), artifacts: arts, done: { leaseId, at: now() }, lease: null }); ev(j, 'succeeded', { node: n.id }); ev2(n, 'готово ' + j.capability); j.progress = 100; save(); wake(j); return { ok: true }; }
  function fail(n, id, { leaseId, error, retryable } = {}) { const [j, code, msg] = own(n, id, leaseId); if (!j) return { code, error: msg }; if (msg) return { ok: true, duplicate: true };
    n.errors = (n.errors || 0) + 1; n.lastError = String(error || '').slice(0, 300); j.done = { leaseId, at: now() }; j.lease = null; j.error = String(error || 'ошибка').slice(0, 1000);
    if (retryable && j.safeToRetry && j.attempt < j.maxAttempts) { j.status = 'queued'; j.nodeId = null; ev(j, 'requeued', { why: 'node error' }); } else { j.status = 'failed'; ev(j, 'failed', { node: n.id }); wake(j); } save(); return { ok: true }; }
  function cancel(id) { const j = S.jobs[id]; if (!j) throw new Error('not found'); if (['succeeded', 'failed', 'cancelled'].includes(j.status)) return j; j.status = 'cancelled'; j.lease = null; ev(j, 'cancelled'); save(); wake(j); return j; }
  // ---- files (content-addressed, SHA-256 verified) ----
  function putFile(n, hash, buf) { if (!/^[a-f0-9]{64}$/.test(hash)) return { code: 400, error: 'sha256' }; if (buf.length > maxFileBytes) return { code: 413, error: 'слишком большой файл' };
    if (sha256(buf) !== hash) { n.errors = (n.errors || 0) + 1; n.lastError = 'bad checksum upload'; save(); return { code: 422, error: 'SHA-256 не совпадает — файл отклонён' }; }
    const f = path.join(filesDir, hash); const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, buf, { mode: 0o600 }); fs.renameSync(tmp, f); return { ok: true, sha256: hash, size: buf.length }; }
  function putLocalFile(buf) { const h = sha256(buf); fs.writeFileSync(path.join(filesDir, h), buf, { mode: 0o600 }); return h; }
  function getFile(n, hash) { if (!/^[a-f0-9]{64}$/.test(hash)) return { code: 400 }; // a node may download only files of jobs leased to it
    if (!Object.values(S.jobs).some(j => j.nodeId === n.id && j.status === 'leased' && j.files.some(f => f.sha256 === hash))) return { code: 403 };
    const f = path.join(filesDir, hash); return fs.existsSync(f) ? { buf: fs.readFileSync(f) } : { code: 404 }; }
  // ---- recovery & monitoring ----
  function notifyOnce(key, on, title, body) { if (on && !S.alerts[key]) { S.alerts[key] = now(); notify({ title, body, priority: 'high' }).catch(() => {}); log('warn', 'nodes', `${title}: ${body}`); } if (!on && S.alerts[key]) { delete S.alerts[key]; } }
  function sweep() {
    for (const n of Object.values(S.nodes)) { if (n.revoked || !n.lastSeen) continue; const down = !nodeAlive(n); if (down && n.status !== 'down') n.status = 'down'; notifyOnce('down:' + n.id, down, 'Узел недоступен', `${n.name} (${n.id}) не выходил на связь > ${Math.round(nodeDownMs / 1000)} с`);
      const i = n.info || {}; notifyOnce('lowres:' + n.id, !down && ((i.memTotal && i.memAvailable / i.memTotal < 0.08) || (i.diskFree != null && i.diskFree < 5 * GB)), 'Мало ресурсов на узле', `${n.name}: RAM свободно ${((i.memAvailable || 0) / GB).toFixed(1)} ГБ, диск ${((i.diskFree || 0) / GB).toFixed(1)} ГБ`); }
    for (const j of Object.values(S.jobs)) { if (j.status !== 'leased') continue; const n = S.nodes[j.nodeId];
      const lost = now() > j.lease.until || !n || n.revoked || !nodeAlive(n); const stuck = now() - j.lease.startedAt > j.timeoutSec * 1000;
      if (!lost && !stuck) continue; const why = stuck ? 'таймаут' : 'узел потерян / аренда истекла'; j.lease = null; j.error = why;
      if (j.safeToRetry && j.attempt < j.maxAttempts) { j.status = 'queued'; j.nodeId = null; ev(j, 'requeued', { why }); }
      else { j.status = 'needs_approval'; ev(j, 'needs_approval', { why: why + (j.safeToRetry ? ' (попытки исчерпаны)' : ' (задача не помечена safeToRetry — повтор только вручную)') }); notifyOnce('stuck:' + j.id, true, 'Задача узла требует решения', `${j.capability} (${j.id}): ${why}`); wake(j); } }
    save(); }
  function retry(id) { const j = S.jobs[id]; if (!j || !['needs_approval', 'failed'].includes(j.status)) throw new Error('повтор возможен только для needs_approval/failed'); j.status = 'queued'; j.nodeId = null; j.maxAttempts = Math.max(j.maxAttempts, j.attempt + 1); ev(j, 'manual-retry'); save(); return j; }
  function wake(j) { const w = waiters.get(j.id); if (w) { waiters.delete(j.id); w.forEach(f => f(j)); } }
  const waitFor = (id, signal) => new Promise((res, rej) => { const j = S.jobs[id]; if (!j) return rej(new Error('not found')); if (['succeeded', 'failed', 'cancelled', 'needs_approval'].includes(j.status)) return res(j);
    const a = waiters.get(id) || []; a.push(res); waiters.set(id, a); if (signal) signal.addEventListener('abort', () => { rej(new Error('aborted')); cancel(id); }, { once: true }); });
  // Runner hook: a Studio task with t.node (target capability) is executed via a node, but through runner.js (status/logs/stop stay in runner)
  async function runViaNode(agent, t, signal) {
    const r = submit({ capability: t.node.capability, input: t.node.input || { title: t.title, description: t.description || '' }, idempotencyKey: 'task:' + t.id + ':' + (t.node.rev || 0), safeToRetry: !!t.node.safeToRetry, maxAttempts: t.node.maxAttempts, timeoutSec: t.node.timeoutSec, preferNode: t.node.preferNode, studioJobId: t.id });
    const j = await waitFor(r.jobId, signal);
    if (j.status !== 'succeeded') { const e = new Error(`Узел: ${j.status} — ${j.error || ''}`); if (j.status === 'needs_approval') e.blocked = true; throw e; }
    return { status: 'waiting_approval', result: `Выполнено на узле ${j.nodeId}:\n${typeof j.result === 'string' ? j.result : JSON.stringify(j.result, null, 1)}${j.artifacts.length ? '\nФайлы: ' + j.artifacts.map(a => `${a.name || ''} sha256:${a.sha256}`).join(', ') : ''}` };
  }
  const status = () => ({ nodes: Object.values(S.nodes).map(publicNode), jobs: Object.values(S.jobs).sort((a, b) => a.createdAt < b.createdAt ? 1 : -1).slice(0, 100).map(({ input, events, done, lease, ...j }) => ({ ...j, leaseUntil: lease ? new Date(lease.until).toISOString() : null })),
    counts: Object.values(S.jobs).reduce((a, j) => (a[j.status] = (a[j.status] || 0) + 1, a), {}), alerts: Object.keys(S.alerts) });
  // ---- HTTP (node API) ----
  function handler() { const { readBody, send } = httpUtil(maxFileBytes);
    return async (req, res) => { try {
      const u = new URL(req.url, 'http://x'); const p = u.pathname.replace(/^\/api\/nodes/, ''); if (!u.pathname.startsWith('/api/nodes/')) return send(res, 404, { error: 'not found' });
      const raw = req.method === 'GET' ? Buffer.alloc(0) : await readBody(req, req.method === 'PUT');
      // ---- enrollment (no token yet): TLS only, rate-limited, code alone grants nothing ----
      if (p === '/enroll' || p === '/enroll/status') { if (req.method !== 'POST') return send(res, 405, { error: 'method', code: 'E_METHOD' });
        if (!req.socket.encrypted && !allowPlainEnrollForTests) return send(res, 426, { error: 'enrollment requires TLS', code: 'E_TLS_REQUIRED' });
        try { const b = JSON.parse(raw.toString() || '{}'); const peer = await peerOf(req); return send(res, 200, p === '/enroll' ? enrollment.enroll(b, peer) : enrollment.status(b, peer)); }
        catch (e) { return send(res, e.status || 400, { error: e.code ? e.message : 'bad request', code: e.code || 'E_BAD_REQUEST' }); } }
      const ao = {}; const n = authNode(req.headers.authorization, { method: req.method, path: u.pathname, ts: req.headers['x-node-ts'], nonce: req.headers['x-node-nonce'], sig: req.headers['x-node-sig'], body: raw }, ao);
      if (!n) return ao.code === 'E_AGENT_VERSION' ? send(res, 426, { error: 'обновите агент до 0.2.2 (protocol 2: x-node-nonce)', code: 'E_AGENT_VERSION', protocol: PROTOCOL }) : ao.code === 'E_RATE_LIMIT' ? send(res, 429, { error: 'busy', code: 'E_RATE_LIMIT' }) : send(res, 401, { error: 'unauthorized', code: ao.code === 'E_REPLAY' ? 'E_REPLAY' : 'E_UNAUTHORIZED' });
      if (req.method === 'POST' && (p === '/hello' || p === '/pull')) { const ver = (JSON.parse(raw.toString() || '{}').info || {}).agentVersion; if (!agentOk(ver)) return send(res, 426, { error: 'agentVersion вне диапазона ' + AGENT_RANGE, code: 'E_AGENT_VERSION', protocol: PROTOCOL, agentVersionRange: AGENT_RANGE }); }
      let m;
      if (req.method === 'PUT' && (m = /^\/files\/([a-f0-9]{64})$/.exec(p))) { const r = putFile(n, m[1], raw); return send(res, r.code || 200, r); }
      if (req.method === 'GET' && (m = /^\/files\/([a-f0-9]{64})$/.exec(p))) { const r = getFile(n, m[1]); if (r.code) return send(res, r.code, { error: 'forbidden/not found' }); res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-sha256': m[1] }); return res.end(r.buf); }
      if (req.method === 'GET' && p === '/ping') return send(res, 200, { ok: true, node: n.id, role: n.role, title: (ROLES[n.role] || {}).title, caps: n.caps, revoked: false, time: new Date(now()).toISOString() }); // read-only: changes nothing
      if (req.method !== 'POST') return send(res, 405, { error: 'method', code: 'E_METHOD' }); const b = JSON.parse(raw.toString() || '{}');
      if (p === '/rotate') { if (!n.enrolled) return send(res, 409, { error: 'rotation only for enrolled nodes', code: 'E_NOT_ENROLLED' }); if (!n.rotatePending) return send(res, 409, { error: 'ротацию запускает только владелец (кнопка «Ротация»)', code: 'E_ROTATE_NOT_REQUESTED' }); return send(res, 200, rotateToken(n)); }
      if (p === '/hello') return send(res, 200, hello(n, b.info)); if (p === '/pull') return send(res, 200, { ...pull(n, b.info, b.state), rotate: !!n.rotatePending });
      if ((m = /^\/jobs\/(nj_[a-f0-9]{16})\/(heartbeat|complete|fail)$/.exec(p))) { const r = { heartbeat, complete, fail }[m[2]](n, m[1], b); return send(res, r.code || 200, r); }
      return send(res, 404, { error: 'not found' });
    } catch (e) { send(res, e.status || 400, { error: e.status === 413 ? 'too large' : 'bad request' }); } }; }
  return { peerOf, enrollment, audit: () => S.audit.slice(-200).reverse(), requestRotate, rotateToken, PROTOCOL, AGENT_RANGE, registerNode, revokeNode, setCommand, authNode, submit, pull, hello, heartbeat, complete, fail, cancel, retry, putFile, putLocalFile, getFile, sweep, route, status, runViaNode, waitFor, handler, ROLES, filesDir, _state: S };
}
function httpUtil(max) { return {
  readBody: (req, raw) => new Promise((res, rej) => { const c = []; let n = 0; req.on('data', d => { n += d.length; if (n > (raw ? max : 1e6)) { const e = new Error('big'); e.status = 413; req.destroy(); rej(e); } else c.push(d); }); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); }),
  send: (res, code, obj) => { if (res.headersSent) return; res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); } }; }
// LAN listener: HTTPS with a self-signed cert (nodes pin its SHA-256 fingerprint). Refuses public addresses.
// LAN, loopback, Tailscale CGNAT 100.64.0.0/10 (100.64.0.0–100.127.255.255) and Tailscale IPv6 ULA fd7a:115c:a1e0::/48.
// 0.2.1 fix: octets are now validated (0..255); before, e.g. "100.64.999.1" / "192.168.1.300" passed the regex.
function isPrivateIPv4(h) { const s = String(h || ''); if (/^fd7a:115c:a1e0:/i.test(s) && require('net').isIPv6(s)) return true; if (!require('net').isIPv4(s)) return false; const [a, b] = s.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127); }
const isTailnet = ip => { if (net.isIPv4(ip)) { const o = ip.split('.').map(Number); return o[0] === 100 && o[1] >= 64 && o[1] <= 127; } return net.isIPv6(ip) && /^fd7a:115c:a1e0:/i.test(ip); };
// read-only `tailscale whois --json <ip>` (no state change); null when Tailscale is absent or the peer is unknown
function defaultWhois(ip) { return new Promise(res => { if (!isTailnet(ip)) return res(null); const bins = [process.env.TAILSCALE_BIN, 'tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'].filter(Boolean);
  const tryBin = i => { if (i >= bins.length) return res(null); require('child_process').execFile(bins[i], ['whois', '--json', ip], { timeout: 2000, maxBuffer: 1 << 20 }, (e, out) => { if (e) return tryBin(i + 1);
    try { const j = JSON.parse(out); const nd = j.Node || {}; res({ id: String(nd.StableID || nd.ID || ''), name: String(nd.ComputedName || nd.Name || '').replace(/\.$/, '').slice(0, 64), login: String((j.UserProfile || {}).LoginName || '').slice(0, 128) }); } catch { res(null); } }); }; tryBin(0); }); }
// one coordinator process per state dir (audit LOW: two processes on one nodes.json could each issue a token)
function lockDir(dir) { const f = path.join(dir, 'nodes.lock'); for (let i = 0; i < 2; i++) { try { fs.writeFileSync(f, String(process.pid), { flag: 'wx', mode: 0o600 }); process.once('exit', () => { try { if (fs.readFileSync(f, 'utf8') === String(process.pid)) fs.rmSync(f); } catch {} }); return; }
  catch (e) { if (e.code !== 'EEXIST') throw e; const pid = +fs.readFileSync(f, 'utf8') || 0; if (pid === process.pid) return; let alive = false; try { process.kill(pid, 0); alive = true; } catch (k) { alive = k.code === 'EPERM'; }
    if (alive) throw new Error(`каталог узлов ${dir} уже используется процессом ${pid} (второй координатор запрещён)`); fs.rmSync(f, { force: true }); } } }
function ensureCert(dir, { exec = require('child_process').execFileSync } = {}) {
  const key = path.join(dir, 'nodes-tls.key'), cert = path.join(dir, 'nodes-tls.crt');
  if (!fs.existsSync(key) || !fs.existsSync(cert)) { exec('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '825', '-subj', '/CN=moonkatty-coordinator', '-keyout', key, '-out', cert], { stdio: 'ignore' }); fs.chmodSync(key, 0o600); }
  const pem = fs.readFileSync(cert, 'utf8'); return { key: fs.readFileSync(key), cert: pem, fingerprint: fingerprintOf(pem) };
}
const fingerprintOf = pem => new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
async function listen(mgr, { host = '127.0.0.1', port = 8790, tls, insecureHttpForTests = false } = {}) {
  if (!isPrivateIPv4(host)) throw new Error('Node API слушает только 127.0.0.1 или частный LAN-адрес (10/8, 172.16/12, 192.168/16) или адрес Tailscale (100.64/10), не 0.0.0.0 и не публичный: ' + host);
  const h = mgr.handler(); const srv = insecureHttpForTests ? require('http').createServer(h) : require('https').createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, h);
  return new Promise((res, rej) => { srv.once('error', rej); srv.listen(port, host, () => res(srv)); });
}
module.exports = { isTailnet, defaultWhois, SIG_WINDOW_MS, PROTOCOL, AGENT_RANGE, DEVICES, POLICY, COMMANDS, createNodeManager, listen, ensureCert, fingerprintOf, isPrivateIPv4, ROLES, FORBIDDEN_CAPS, scanSecrets };
