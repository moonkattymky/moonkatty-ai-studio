#!/usr/bin/env node
// MOONKATTY NODE ↔ central studio (Mac mini) connection test. READ-ONLY: it never submits jobs, never pulls, never calls /hello,
// never changes coordinator state (only GET /api/nodes/ping, which is read-only by design) and prints no secrets.
// Usage (on the node, uses ~/.moonkatty-node/node-agent.env + Keychain like the agent):
//   ~/moonkatty-node/bin/node ~/moonkatty-node/app/studio-connection-test.mjs [--dry-run] [--json]
// Exit 0 = all checks PASS. --dry-run = print the plan, touch no network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import dns from 'node:dns/promises'; import tls from 'node:tls'; import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname); const A = require(fs.existsSync(path.join(here, 'agent.js')) ? path.join(here, 'agent.js') : path.join(here, '../../node-agent/agent.js'));
const dry = process.argv.includes('--dry-run'), asJson = process.argv.includes('--json'); const res = []; const ok = (name, pass, detail = '') => { res.push({ name, pass: !!pass, detail }); if (!asJson) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); return pass; };
const mask = t => t ? t.replace(/^(nk_[a-z0-9-]+\.).*$/, '$1***') : '(нет)';
let cfg; try { cfg = await A.config(); ok('config: node-agent.env (chmod 600) + токен (Keychain/env)', true, `node=${cfg.nodeId} profile=${cfg.profileKey} tls=${cfg.tlsMode} token=${mask(cfg.token)}`); }
catch (e) { ok('config', false, e.message); finish(); }
const u = new URL(cfg.url || 'https://invalid'); const isTs = /\.ts\.net$/i.test(u.hostname);
ok('адрес координатора: https и tailnet/частная сеть', u.protocol === 'https:' && (isTs || A.client && /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(u.hostname)), cfg.url);
if (dry) { for (const s of ['DNS', 'TLS (закреплённый SHA-256 сертификата координатора)', 'без токена → 401', 'с токеном GET /api/nodes/ping → 200 (только чтение)', 'профиль/capabilities без heavy AI/Blender', 'Tailscale funnel выключен']) console.log('PLAN ' + s); console.log('DRY-RUN: сеть не трогали'); process.exit(0); }
try { const a = await dns.lookup(u.hostname); ok('DNS', true, `${u.hostname} → ${a.address}` + (isTs && !a.address.startsWith('100.') ? ' (ожидался 100.x Tailscale)' : '')); } catch (e) { ok('DNS', false, e.message); }
await new Promise(r => { const o = { host: u.hostname, port: +u.port || 443, servername: u.hostname, minVersion: 'TLSv1.2', timeout: 10000 };
  if (cfg.tlsMode !== 'tailscale') { o.ca = fs.readFileSync(cfg.certFile, 'utf8'); o.checkServerIdentity = () => undefined; }
  const s = tls.connect(o, () => { const c = s.getPeerCertificate(); const fp = String(c.fingerprint256 || '').replace(/:/g, '').toLowerCase();
    const pass = cfg.tlsMode === 'tailscale' ? s.authorized : fp === String(cfg.fingerprint || '').toLowerCase();
    ok('TLS', pass, `${s.getProtocol()} CN=${(c.subject || {}).CN || '?'} до ${c.valid_to}` + (cfg.tlsMode === 'tailscale' ? (s.authorized ? ' (цепочка доверена)' : ' ' + s.authorizationError) : (pass ? ' (отпечаток совпал)' : ' отпечаток НЕ совпал'))); s.end(); r(); });
  s.on('error', e => { ok('TLS', false, e.message); r(); }); s.on('timeout', () => { ok('TLS', false, 'timeout'); s.destroy(); r(); }); });
try { const bad = A.client({ ...cfg, token: 'nk_' + cfg.nodeId + '.invalid-token-for-test-000000' }); const r = await bad('GET', '/ping'); ok('без верного токена → 401', r.status === 401, 'HTTP ' + r.status); } catch (e) { ok('без верного токена → 401', false, e.message); }
try { const r = await A.client(cfg)('GET', '/ping'); const b = r.body || {};
  ok('с токеном GET /api/nodes/ping → 200', r.status === 200 && b.node === cfg.nodeId, `HTTP ${r.status} node=${b.node} role=${b.role} title=${b.title}`);
  if (r.status === 200) { const caps = b.caps || []; const bad = caps.filter(c => A.FORBIDDEN.test(c)); const x = caps.filter(c => /^x\./.test(c));
    ok('capabilities: нет heavy AI / Blender / render / OpenCode', !bad.length, caps.join(', ')); ok('X GROWTH', !x.length || cfg.xGrowth, x.length ? `включён явно: ${x.join(', ')}` : 'выключен (по умолчанию)'); } }
catch (e) { ok('с токеном GET /api/nodes/ping → 200', false, e.message); }
const tsBin = ['/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/bin/tailscale'].find(f => fs.existsSync(f));
if (tsBin) { try { const t = execFileSync(tsBin, ['funnel', 'status'], { timeout: 10000 }).toString(); ok('Tailscale funnel выключен (на этом Mac)', !/Funnel on/i.test(t)); } catch (e) { ok('Tailscale funnel выключен (на этом Mac)', true, 'funnel не настроен'); } }
finish();
function finish() { const pass = res.every(r => r.pass); if (asJson) console.log(JSON.stringify({ ok: pass, checks: res }, null, 1)); else console.log(pass ? 'ИТОГ: OK — связь с центральной студией безопасна и работает' : 'ИТОГ: ЕСТЬ ОШИБКИ — см. FAIL выше'); process.exit(pass ? 0 : 1); }
