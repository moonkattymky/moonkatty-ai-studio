// MOONKATTY NODE 0.2.1 — enrollment by one-time code (coordinator side, Mac mini).
// Flow: owner creates request (role, name) → one-time code (10 chars, 31-symbol alphabet without 0/O/1/I/L, ≈49.5 bit), TTL 5 min,
// stored only as HMAC(serverKey, requestId:code), bound to that request, single use → node POSTs code + Ed25519 device public key
// (+ proof-of-possession signature) over pinned TLS / Tailscale Serve → request 'pending' → OWNER CONFIRMS in the panel →
// node polls with its request secret + device signature → receives token nk_<id>.<secret> ONCE (only sha256 stored; token is bound to
// the device key: every node API call of an enrolled node must carry an Ed25519 signature). The code alone never grants access.
// Brute force: 5 wrong codes per request → request locked; per-IP: 10 failures / 15 min → IP locked 15 min; ≤ 30 enroll calls / min / IP.
'use strict';
const crypto = require('crypto');
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 symbols, no 0 O 1 I L
const CODE_LEN = 10, TTL_MS = 5 * 60e3, MAX_ATTEMPTS = 5, IP_FAIL_MAX = 10, IP_WINDOW_MS = 15 * 60e3, IP_LOCK_MS = 15 * 60e3, IP_RATE_PER_MIN = 30, REQ_TTL_MS = 24 * 3600e3;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
function randomCode(n = CODE_LEN) { let s = ''; while (s.length < n) { const b = crypto.randomBytes(16); for (const x of b) if (x < 248 && s.length < n) s += ALPHA[x % 31]; } return s; } // 248 = 8×31 → no modulo bias
const normCode = c => String(c || '').toUpperCase().replace(/[\s-]/g, '');
const eq = (a, b) => { const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex'); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };
function pubKeyFromPem(pem) { const k = crypto.createPublicKey(String(pem || '')); if (k.asymmetricKeyType !== 'ed25519') throw new Error('devicePubKey: нужен Ed25519'); return k; }
const pubFingerprint = pem => sha256(pubKeyFromPem(pem).export({ type: 'spki', format: 'der' }));
const shortFp = hex => String(hex || '').slice(0, 16).toUpperCase().match(/.{4}/g).join('-'); // short visual check string, e.g. 3F2A-91C0-7B44-0E1D
function verifySig(pem, msg, sigB64) { try { return crypto.verify(null, Buffer.from(msg), pubKeyFromPem(pem), Buffer.from(String(sigB64 || ''), 'base64')); } catch { return false; } }
const ERR = { E_RATE_LIMIT: 429, E_IP_LOCKED: 429, E_CODE_INVALID: 403, E_CODE_EXPIRED: 410, E_CODE_USED: 409, E_REQUEST_LOCKED: 423, E_BAD_REQUEST: 400, E_BAD_SIGNATURE: 401, E_NOT_FOUND: 404, E_REJECTED: 403, E_REPLAY: 401, E_PEER_UNVERIFIED: 409 };
const fail = (code, msg) => Object.assign(new Error(msg || code), { code, status: ERR[code] || 400 });

function createEnrollment({ S, save, now, issueToken, audit, serverKey, useNonce = () => null, sigWindowMs = 30e3 }) {
  S.enroll ||= {}; const ip = S.enrollLimits ||= {}; // per-peer counters (key = Tailscale device/user or IP) persisted in nodes.json (0600): locks survive restart
  const peerKey = a => typeof a === 'object' && a ? a.key : 'ip:' + String(a); const peerLabel = a => typeof a === 'object' && a ? a.label : String(a);
  function prune() { const t = now(); for (const [k, r] of Object.entries(ip)) if (r.lockedUntil <= t && !r.fails.some(x => t - x < IP_WINDOW_MS) && !r.calls.some(x => t - x < 60e3)) delete ip[k]; }
  const hmac = (rid, code) => crypto.createHmac('sha256', serverKey).update(rid + ':' + normCode(code)).digest('hex');
  function ipCheck(peer) { const addr = peerKey(peer); const t = now(); if (Object.keys(ip).length > 2000) prune(); const r = ip[addr] ||= { calls: [], fails: [], lockedUntil: 0 }; r.calls = r.calls.filter(x => t - x < 60e3); r.fails = r.fails.filter(x => t - x < IP_WINDOW_MS);
    if (r.lockedUntil > t) throw fail('E_IP_LOCKED', 'слишком много неверных попыток с этого адреса — подождите 15 минут');
    if (r.calls.length >= IP_RATE_PER_MIN) throw fail('E_RATE_LIMIT', 'слишком часто'); r.calls.push(t); save(); return r; }
  function ipFail(peer, r) { r.fails.push(now()); if (r.fails.length >= IP_FAIL_MAX) { r.lockedUntil = now() + IP_LOCK_MS; audit('ip_locked', { peer: peerKey(peer) }); } save(); }
  function expire() { const t = now(); for (const q of Object.values(S.enroll)) { if (q.state === 'awaiting_code' && t > q.expiresAt) { q.state = 'expired'; q.codeHash = null; }
      if (t - q.createdAt > REQ_TTL_MS && ['expired', 'rejected', 'locked', 'enrolled'].includes(q.state)) delete S.enroll[q.id]; } }
  // ---- owner (panel) ----
  function create({ role, name, nodeId }) { expire(); if (!['news', 'monitor'].includes(role)) throw fail('E_BAD_REQUEST', 'role: news|monitor');
    const id = nodeId || (role === 'news' ? 'imac' : 'macbook'); if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(id) || id === 'mac-mini') throw fail('E_BAD_REQUEST', 'nodeId');
    for (const q of Object.values(S.enroll)) if (q.nodeId === id && ['awaiting_code', 'pending'].includes(q.state)) { q.state = 'superseded'; q.codeHash = null; }
    const rid = randomCode(5); const code = randomCode(); const q = { id: rid, role, name: String(name || id).slice(0, 64), nodeId: id, state: 'awaiting_code', codeHash: hmac(rid, code), attempts: 0,
      createdAt: now(), expiresAt: now() + TTL_MS, reenroll: !!(S.nodes[id] && !S.nodes[id].revoked) }; S.enroll[rid] = q; save(); audit('request_created', { requestId: rid, nodeId: id, role });
    return { requestId: rid, code: `${rid}-${code.slice(0, 5)}-${code.slice(5)}`, expiresAt: new Date(q.expiresAt).toISOString(), ttlSec: TTL_MS / 1000, nodeId: id, role, reenroll: q.reenroll }; }
  const view = q => ({ requestId: q.id, state: q.state, role: q.role, name: q.name, nodeId: q.nodeId, reenroll: q.reenroll, attempts: q.attempts, createdAt: new Date(q.createdAt).toISOString(), expiresAt: new Date(q.expiresAt).toISOString(),
    device: q.device ? { deviceId: q.device.deviceId, pubKeyFingerprint: q.device.pubFp, pubKeyShort: shortFp(q.device.pubFp), hostname: q.device.info.hostname, model: q.device.info.model, os: q.device.info.os, arch: q.device.info.arch, agentVersion: q.device.info.agentVersion, ip: q.device.ip, peer: q.device.ip, peerVerified: !!q.device.peerVerified, peerInfo: q.device.peerInfo || null } : null });
  function list() { expire(); return Object.values(S.enroll).sort((a, b) => b.createdAt - a.createdAt).map(view); }
  function decide(rid, ok, { acknowledgeUnverifiedPeer = false } = {}) { const q = S.enroll[rid]; if (!q) throw fail('E_NOT_FOUND'); if (q.state !== 'pending') throw fail('E_BAD_REQUEST', 'подтверждать можно только pending (сейчас ' + q.state + ')');
    if (ok && !q.device.peerVerified && !acknowledgeUnverifiedPeer) throw fail('E_PEER_UNVERIFIED', 'адрес Tailscale не определён — нужно отдельное подтверждение владельца (acknowledgeUnverifiedPeer)');
    if (ok && !q.device.peerVerified) audit('peer_unverified_acknowledged', { requestId: rid, nodeId: q.nodeId });
    q.state = ok ? 'confirmed' : 'rejected'; q.decidedAt = now(); if (ok && q.reenroll && S.nodes[q.nodeId]) { S.nodes[q.nodeId].tokenHash = null; audit('token_invalidated', { nodeId: q.nodeId, why: 're-enroll' }); }
    save(); audit(ok ? 'confirmed' : 'rejected', { requestId: rid, nodeId: q.nodeId, deviceId: q.device.deviceId }); return view(q); }
  // ---- node (unauthenticated, rate-limited) ----
  function enroll(body, peer) { const r = ipCheck(peer); const addr = peerLabel(peer); expire(); const raw = normCode(body.code); const m = /^([2-9A-HJKMNP-Z]{5})([2-9A-HJKMNP-Z]{10})$/.exec(raw);
    if (!m) { ipFail(peer, r); audit('code_failed', { ip: addr, why: 'format' }); throw fail('E_CODE_INVALID', 'неверный код'); }
    const q = S.enroll[m[1]]; if (!q) { ipFail(peer, r); audit('code_failed', { ip: addr, why: 'unknown request' }); throw fail('E_CODE_INVALID', 'неверный код'); }
    if (q.state === 'locked') throw fail('E_REQUEST_LOCKED', 'запрос заблокирован после неверных попыток — создайте новый код');
    if (q.state === 'expired') throw fail('E_CODE_EXPIRED', 'код истёк — создайте новый'); if (q.state !== 'awaiting_code') throw fail('E_CODE_USED', 'код уже использован или запрос закрыт');
    if (!eq(hmac(q.id, m[2]), q.codeHash)) { q.attempts++; ipFail(peer, r); audit('code_failed', { requestId: q.id, ip: addr, attempts: q.attempts });
      if (q.attempts >= MAX_ATTEMPTS) { q.state = 'locked'; q.codeHash = null; audit('request_locked', { requestId: q.id, ip: addr }); } save(); throw fail(q.state === 'locked' ? 'E_REQUEST_LOCKED' : 'E_CODE_INVALID', 'неверный код'); }
    const deviceId = String(body.deviceId || ''); if (!/^dev_[a-f0-9]{32}$/.test(deviceId)) throw fail('E_BAD_REQUEST', 'deviceId');
    let pubFp; try { pubFp = pubFingerprint(body.devicePubKey); } catch (e) { throw fail('E_BAD_REQUEST', e.message); }
    if (!verifySig(body.devicePubKey, `enroll:${q.id}:${deviceId}`, body.proof)) throw fail('E_BAD_SIGNATURE', 'нет доказательства владения ключом устройства');
    const secret = crypto.randomBytes(32).toString('base64url'); const i = body.info || {}; const s = (v, n) => String(v || '').slice(0, n);
    Object.assign(q, { state: 'pending', codeHash: null, usedAt: now(), secretHash: sha256(secret), device: { deviceId, pubKey: String(body.devicePubKey), pubFp, ip: addr, peerVerified: !!(peer && peer.verified), peerInfo: peer && typeof peer === 'object' ? { ip: peer.ip || null, name: peer.name || null, login: peer.login || null, via: peer.via || null } : { ip: String(peer), name: null, login: null, via: 'direct' }, info: { hostname: s(i.hostname, 64), model: s(i.model, 48), os: s(i.os, 64), arch: s(i.arch, 16), agentVersion: s(i.agentVersion, 16) } } });
    save(); audit('code_accepted', { requestId: q.id, nodeId: q.nodeId, deviceId, ip: addr }); return { requestId: q.id, status: 'pending', requestSecret: secret, pollMs: 3000, nodeId: q.nodeId, role: q.role }; }
  function status(body, peer) { const r = ipCheck(peer); const addr = peerLabel(peer); const q = S.enroll[String(body.requestId || '')];
    if (!q || !q.secretHash || !eq(sha256(String(body.requestSecret || '')), q.secretHash)) { ipFail(peer, r); throw fail('E_NOT_FOUND', 'нет такого запроса'); }
    const ts = +body.ts; const nonce = String(body.nonce || ''); if (!/^[A-Za-z0-9_-]{22,64}$/.test(nonce) || !(Math.abs(now() - ts) <= sigWindowMs) || !verifySig(q.device.pubKey, `status:${q.id}:${ts}:${nonce}`, body.sig)) throw fail('E_BAD_SIGNATURE', 'подпись устройства неверна');
    if (useNonce(q.id, nonce, ts)) throw fail('E_REPLAY', 'повтор запроса отклонён');
    if (q.state === 'pending') return { status: 'pending' }; if (q.state === 'rejected') return { status: 'rejected' };
    if (q.state === 'confirmed') { const tok = issueToken({ id: q.nodeId, role: q.role, name: q.name, device: q.device }); q.state = 'enrolled'; q.enrolledAt = now(); q.secretHash = null; save();
      audit('enrolled', { requestId: q.id, nodeId: q.nodeId, deviceId: q.device.deviceId }); return { status: 'enrolled', nodeId: q.nodeId, role: q.role, token: tok, protocol: 1 }; }
    return { status: q.state }; }
  return { create, list, confirm: (rid, o) => decide(rid, true, o), reject: rid => decide(rid, false), enroll, status, _ip: ip };
}
module.exports = { createEnrollment, randomCode, ALPHA, CODE_LEN, TTL_MS, MAX_ATTEMPTS, IP_FAIL_MAX, shortFp, pubFingerprint, verifySig, ERR };
