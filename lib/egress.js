// SSRF guard for the server-side "integration test" request (POST /api/integrations/:id/test).
// Policy (v1.2.2):
//  • Each integration id has an allowlist of hosts/ports. Local services (Ollama, Open WebUI, Docker, OpenCode) may only
//    be reached on LOOPBACK on their known port; anything else must be a known public integration host over https.
//  • DNS is resolved by us and EVERY resolved address is checked; the socket connects to the vetted address only
//    (pinned lookup → no DNS-rebinding between check and connect).
//  • Private (RFC1918, CGNAT, ULA), link-local (169.254/16, fe80::/10), cloud metadata (169.254.169.254, fd00:ec2::254,
//    100.100.100.200), multicast, unspecified and reserved ranges are always blocked; loopback only for local services.
//  • Redirects are never followed (reported as an error).
'use strict';
const net = require('net'), dns = require('dns'), http = require('http'), https = require('https');
const LOCAL = { ollama: [11434], openwebui: [3000, 8080], docker: [2375], opencode: [4096, 4097], comfyui: [8188] };
// TEST build: NO social platform is reachable at all (Meta Graph / Instagram / Telegram excluded from the allowlist).
const SOCIAL_HOSTS = Object.freeze(['graph.facebook.com', 'graph.instagram.com', 'api.telegram.org']);
const PUBLIC_HOSTS = new Set([...(require('./studio-config.js').IS_TEST ? [] : SOCIAL_HOSTS), 'api.github.com', 'ollama.com', 'registry.ollama.ai']);
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
function v4num(a) { return a.split('.').reduce((n, x) => n * 256 + (+x), 0); }
const R4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]].map(([b, m]) => [v4num(b), m]);
function classify(ip) { // → 'loopback' | 'blocked' | 'public'
  let a = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a); if (m) a = m[1];
  if (net.isIPv4(a)) { const n = v4num(a); if ((n >>> 24) === 127) return 'loopback';
    return R4.some(([b, bits]) => (n >>> (32 - bits)) === (b >>> (32 - bits))) ? 'blocked' : 'public'; }
  if (net.isIPv6(a)) { if (a === '::1') return 'loopback';
    if (a === '::' || /^(fe[89ab]|fc|fd|ff)/.test(a) || /^(64:ff9b|2001:db8|2001:0?:|100::)/.test(a) || a.startsWith('::ffff:') || /^::(\d|[a-f])/.test(a)) return 'blocked'; return 'public'; }
  return 'blocked';
}
function policyFor(id, url) {
  let u; try { u = new URL(url); } catch { return { error: 'Неверный URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { error: 'Разрешены только http(s) URL' };
  if (u.username || u.password) return { error: 'Логин/пароль в URL запрещены' };
  const host = u.hostname.toLowerCase(), port = +u.port || (u.protocol === 'https:' ? 443 : 80);
  if (LOCAL[id]) { if (!LOOPBACK_NAMES.has(host)) return { error: `«${id}» — локальная служба: разрешён только 127.0.0.1/localhost` };
    if (!LOCAL[id].includes(port)) return { error: `«${id}»: разрешённые порты ${LOCAL[id].join(', ')}` }; return { u, allow: 'loopback' }; }
  if (!PUBLIC_HOSTS.has(host)) return { error: `Хост ${host} не входит в список известных интеграций` };
  if (u.protocol !== 'https:' || port !== 443) return { error: 'Внешние интеграции — только https:443' };
  return { u, allow: 'public' };
}
const resolveAll = host => new Promise((res, rej) => net.isIP(host.replace(/^\[|\]$/g, '')) ? res([{ address: host.replace(/^\[|\]$/g, ''), family: net.isIPv6(host.replace(/^\[|\]$/g, '')) ? 6 : 4 }]) : dns.lookup(host, { all: true }, (e, a) => e ? rej(e) : res(a)));
async function vet(id, url, { resolver = resolveAll } = {}) {
  const p = policyFor(id, url); if (p.error) return { ok: false, code: 'blocked_url', error: p.error };
  let addrs; try { addrs = await resolver(p.u.hostname); } catch (e) { return { ok: false, code: 'dns', error: 'DNS: ' + (e.code || e.message) }; }
  if (!addrs.length) return { ok: false, code: 'dns', error: 'DNS: нет адресов' };
  for (const a of addrs) { const c = classify(a.address);
    if (!(c === p.allow)) return { ok: false, code: 'blocked_ip', error: `Адрес ${a.address} запрещён (${c === 'loopback' ? 'loopback' : c === 'blocked' ? 'частная/служебная сеть' : 'внешний адрес'} для «${id}»)` }; }
  return { ok: true, u: p.u, addr: addrs[0] };
}
// GET with the vetted address pinned; never follows redirects.
async function safeGet(id, url, { timeoutMs = 5000, resolver } = {}) {
  const v = await vet(id, url, { resolver }); if (!v.ok) return v;
  const mod = v.u.protocol === 'https:' ? https : http;
  return new Promise(resolve => {
    const rq = mod.request(v.u, { method: 'GET', timeout: timeoutMs, headers: { accept: 'application/json', 'user-agent': 'moonkatty-studio-integration-test' },
      lookup: (h, o, cb) => o && o.all ? cb(null, [v.addr]) : cb(null, v.addr.address, v.addr.family) }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400) { r.resume(); return resolve({ ok: false, code: 'redirect', status: r.statusCode, error: 'Перенаправление не выполняется (защита от SSRF)' }); }
      let d = ''; r.setEncoding('utf8'); r.on('data', c => { if (d.length < 65536) d += c; }); r.on('end', () => resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, text: d }));
    });
    rq.on('timeout', () => rq.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    rq.on('error', e => resolve({ ok: false, code: 'network', status: null, error: String(e.code || e.message) })); rq.end();
  });
}
module.exports = { classify, policyFor, vet, safeGet, LOCAL, PUBLIC_HOSTS, SOCIAL_HOSTS };
