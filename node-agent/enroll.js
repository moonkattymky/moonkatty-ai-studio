// MOONKATTY NODE 0.2.1 — node-side enrollment (iMac Ventura / MacBook Monterey, x86_64). Zero dependencies.
// Secrets (device private key, request secret, node token) live ONLY in the macOS Keychain (via /usr/bin/security -i, value
// passed on stdin — never in argv, files or logs). Public data (deviceId, public key, coordinator cert, env without token) in ~/.moonkatty-node.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto'), tls = require('tls'), https = require('https'), { execFile, spawn } = require('child_process');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const shortFp = hex => String(hex || '').slice(0, 16).toUpperCase().match(/.{4}/g).join('-');
// ---------- Keychain ----------
function keychain(env = process.env) { const bin = env.NODE_KEYCHAIN_BIN || '/usr/bin/security'; const avail = env.NODE_KEYCHAIN_BIN || process.platform === 'darwin';
  const run = (args, input) => new Promise((res, rej) => { const p = spawn(bin, args, { env: env === process.env ? process.env : { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); let o = ''; p.stdout.on('data', d => o += d); p.on('error', rej); p.on('close', c => c === 0 ? res(o) : rej(new Error('keychain ' + c))); if (input) p.stdin.end(input); else p.stdin.end(); });
  const safe = v => { if (!/^[A-Za-z0-9_.+/=-]+$/.test(v)) throw new Error('keychain: недопустимые символы'); return v; };
  return { available: !!avail,
    async get(service, account) { if (!avail) return null; try { return (await run(['find-generic-password', '-s', service, '-a', account, '-w'])).trim() || null; } catch { return null; } },
    async set(service, account, value) { if (!avail) throw new Error('Keychain недоступен (только macOS)'); await run(['-i'], `add-generic-password -U -s ${safe(service)} -a ${safe(account)} -w ${safe(value)}\n`); },
    async del(service, account) { if (!avail) return; try { await run(['delete-generic-password', '-s', service, '-a', account]); } catch {} } }; }
// ---------- device identity (Ed25519) ----------
async function deviceIdentity(home, kc, { create = true } = {}) { const f = path.join(home, 'device.json');
  if (fs.existsSync(f)) { const d = JSON.parse(fs.readFileSync(f, 'utf8')); const der = await kc.get('moonkatty-node-device', d.deviceId); if (der) return { ...d, key: crypto.createPrivateKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'pkcs8' }) }; if (!create) return null; }
  if (!create) return null; const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); const deviceId = 'dev_' + crypto.randomBytes(16).toString('hex');
  await kc.set('moonkatty-node-device', deviceId, privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'));
  const d = { deviceId, pubKey: publicKey.export({ type: 'spki', format: 'pem' }), createdAt: new Date().toISOString() }; fs.mkdirSync(home, { recursive: true, mode: 0o700 }); fs.writeFileSync(f, JSON.stringify(d, null, 1), { mode: 0o600 }); return { ...d, key: privateKey }; }
const sign = (key, msg) => crypto.sign(null, Buffer.from(msg), key).toString('base64');
// ---------- pinned TLS: fetch the coordinator certificate and check its SHA-256 BEFORE sending anything ----------
function fetchPinnedCert(url, fingerprint) { return new Promise((res, rej) => { const u = new URL(url); const want = String(fingerprint || '').replace(/[:\s]/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(want)) return rej(new Error('отпечаток: нужен полный SHA-256 (64 hex) из панели Mac mini'));
  const s = tls.connect({ host: u.hostname, port: +u.port || 443, servername: /^[\d.]+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, minVersion: 'TLSv1.2', timeout: 15000 }, () => {
    const c = s.getPeerX509Certificate(); s.end(); const fp = c ? c.fingerprint256.replace(/:/g, '').toLowerCase() : '';
    if (fp !== want) return rej(Object.assign(new Error(`отпечаток сертификата не совпадает: получен ${shortFp(fp)}, ожидался ${shortFp(want)} — подключение прервано`), { code: 'E_PIN' })); res(c.toString()); });
  s.on('error', rej); s.on('timeout', () => { s.destroy(); rej(new Error('timeout')); }); }); }
function post(url, p, body, { ca, fingerprint, tlsMode }) { return new Promise((res, rej) => { const u = new URL(url); const data = Buffer.from(JSON.stringify(body)); const pin = String(fingerprint || '').toLowerCase();
  const opt = { method: 'POST', hostname: u.hostname, port: +u.port || 443, path: '/api/nodes' + p, timeout: 20000, minVersion: 'TLSv1.2', headers: { 'content-type': 'application/json', 'content-length': data.length } };
  Object.assign(opt, { ca, checkServerIdentity: (h, cert) => String(cert.fingerprint256 || '').replace(/:/g, '').toLowerCase() === pin ? undefined : new Error('TLS pin mismatch') });
  const r = https.request(opt, resp => { const c = []; resp.on('data', d => c.push(d)); resp.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(c).toString()); } catch {} res({ status: resp.statusCode, body: j || {} }); }); });
  r.on('error', rej); r.on('timeout', () => r.destroy(new Error('timeout'))); r.end(data); }); }
// ---------- enrollment flow ----------
async function enroll({ url, fingerprint, code, tlsMode, home = path.join(os.homedir(), '.moonkatty-node'), env = process.env, info = {}, onState = () => {}, pollMs, maxWaitMs = 30 * 60e3 }) {
  const u = new URL(String(url || '')); if (u.protocol !== 'https:') throw Object.assign(new Error('только https:// — подключение по открытому HTTP запрещено'), { code: 'E_TLS_REQUIRED' });
  tlsMode = tlsMode || 'pinned'; /* r5: always pinned — the Node API is reached on the coordinator's Tailscale address 100.x, not via Tailscale Serve */
  if (tlsMode !== 'pinned') throw Object.assign(new Error('режим tailscale не поддерживается: Node API координатора (v1.3.0-test) не стоит за Tailscale Serve — только закреплённый сертификат (NODE_TLS_MODE=pinned, https://100.x.y.z:<порт> + COORDINATOR_FINGERPRINT)'), { code: 'E_TLS_MODE' }); const kc = keychain(env); if (!kc.available) throw new Error('Keychain недоступен (только macOS)');
  let ca = null; if (tlsMode === 'pinned') { onState({ step: 'pin' }); ca = await fetchPinnedCert(url, fingerprint); }
  const dev = await deviceIdentity(home, kc); const pubKeyFp = sha256(crypto.createPublicKey(dev.pubKey).export({ type: 'spki', format: 'der' }));
  const base = { deviceId: dev.deviceId, pubKeyFp, pubKeyShort: shortFp(pubKeyFp) }; const emit = x => onState({ ...base, ...x }); emit({ step: 'device' });
  const o = { ca, fingerprint: String(fingerprint || '').replace(/[:\s]/g, '').toLowerCase(), tlsMode }; const rid = String(code || '').toUpperCase().replace(/[\s-]/g, '').slice(0, 5);
  const r = await post(url, '/enroll', { code, deviceId: dev.deviceId, devicePubKey: dev.pubKey, proof: sign(dev.key, `enroll:${rid}:${dev.deviceId}`), info }, o);
  if (r.status !== 200) throw Object.assign(new Error(`${r.body.code || 'HTTP ' + r.status}: ${r.body.error || ''}`), { code: r.body.code });
  await kc.set('moonkatty-node-enroll', r.body.requestId, r.body.requestSecret); emit({ step: 'pending', requestId: r.body.requestId, nodeId: r.body.nodeId });
  const t0 = Date.now(); for (;;) { if (Date.now() - t0 > maxWaitMs) throw new Error('владелец не подтвердил за 30 минут — создайте новый код');
    await new Promise(z => setTimeout(z, pollMs || r.body.pollMs || 3000)); const ts = Date.now(); const nonce = crypto.randomBytes(18).toString('base64url'); const secret = await kc.get('moonkatty-node-enroll', r.body.requestId);
    const s = await post(url, '/enroll/status', { requestId: r.body.requestId, requestSecret: secret, ts, nonce, sig: sign(dev.key, `status:${r.body.requestId}:${ts}:${nonce}`) }, o);
    if (s.status === 429 && s.body.code === 'E_RATE_LIMIT') { emit({ step: 'pending', requestId: r.body.requestId, nodeId: r.body.nodeId, backoff: true }); await new Promise(z => setTimeout(z, 5000)); continue; } // QA-NODE-004: back off, keep polling
    if (s.status !== 200) throw Object.assign(new Error(`${s.body.code || 'HTTP ' + s.status}: ${s.body.error || ''}`), { code: s.body.code });
    if (s.body.status === 'pending') { emit({ step: 'pending', requestId: r.body.requestId, nodeId: r.body.nodeId }); continue; }
    if (s.body.status === 'rejected') { await kc.del('moonkatty-node-enroll', r.body.requestId); throw Object.assign(new Error('владелец отклонил подключение'), { code: 'E_REJECTED' }); }
    if (s.body.status === 'enrolled' && s.body.token) { await kc.set('moonkatty-node-' + s.body.nodeId, 'node-token', s.body.token); await kc.del('moonkatty-node-enroll', r.body.requestId);
      fs.mkdirSync(home, { recursive: true, mode: 0o700 }); const certFile = path.join(home, 'coordinator.crt'); if (ca) fs.writeFileSync(certFile, ca, { mode: 0o644 });
      const envF = path.join(home, 'node-agent.env'); const lines = [`# MOONKATTY NODE 0.2.1 — создано при подключении ${new Date().toISOString()}. Токен — только в Keychain.`, `NODE_ID=${s.body.nodeId}`, `NODE_PROFILE=${s.body.role}`, `NODE_TLS_MODE=${tlsMode}`, `COORDINATOR_URL=${url}`,
        ...(tlsMode === 'pinned' ? [`COORDINATOR_CERT=${certFile}`, `COORDINATOR_FINGERPRINT=${o.fingerprint}`] : []), 'NODE_STATUS_PORT=8791'];
      fs.writeFileSync(envF + '.tmp', lines.join('\n') + '\n', { mode: 0o600 }); fs.renameSync(envF + '.tmp', envF); emit({ step: 'enrolled', nodeId: s.body.nodeId, role: s.body.role }); return { nodeId: s.body.nodeId, role: s.body.role, ...base }; }
    throw new Error('неожиданный статус: ' + s.body.status); } }
module.exports = { keychain, deviceIdentity, fetchPinnedCert, enroll, sign, shortFp };
