'use strict';
// Route/view registry: every NAV route (app.js + routes added by ops-ui.js) must have a VIEWS function. Regression: «Computers (Nodes)»
// was added to NAV without VIEWS.computers → TypeError «VIEWS[ROUTE] is not a function». Also: render() must not throw on unknown views.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'), path = require('path'), vm = require('vm');
const P = f => fs.readFileSync(path.join(__dirname, '../../public', f), 'utf8');
test('every sidebar route has a view function (static registry check)', () => {
  const app = P('app.js'), ops = P('ops-ui.js'), social = P('social-ui.js'); const navBlock = app.slice(app.indexOf('const NAV = ['), app.indexOf('];', app.indexOf('const NAV = [')));
  const routes = [...navBlock.matchAll(/\['([a-z0-9]+)',/g)].map(m => m[1]).concat([...ops.matchAll(/NAV\.splice\([^[]*\['([a-z0-9]+)'/g)].map(m => m[1]));
  const views = new Set([...(app + ops + social).matchAll(/VIEWS\.([a-z0-9]+)\s*=/g)].map(m => m[1])); assert.ok(routes.includes('computers') && routes.includes('ops'));
  for (const r of routes) assert.ok(views.has(r), `route «${r}» has no VIEWS.${r}`);
  assert.match(app, /typeof VIEWS\[ROUTE\] !== 'function'/, 'render() guards a missing view'); assert.ok(!/location\.href = '\/studio\.html'/.test(ops), 'no redirect race from #computers');
  assert.match(P('studio.js'), /'Computers \(Nodes\)', '🖥', '\/#computers'/);
});
test('ops-ui view functions render without throwing (Computers with online / offline / 426 / revoked / unverified peer)', () => {
  const ctx = { VIEWS: {}, BIND: {}, NAV: [], DB: {}, ROUTE: 'computers', esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    api: async () => ({}), render() {}, fetch: async () => ({ status: 500, ok: false, json: async () => null }), window: { addEventListener() {} }, location: { hash: '' }, document: { hidden: false }, setInterval() {}, setTimeout() {}, console };
  vm.createContext(ctx); vm.runInContext(P('ops-ui.js'), ctx); assert.equal(typeof ctx.VIEWS.computers, 'function'); assert.equal(typeof ctx.VIEWS.ops, 'function');
  const t = new Date().toISOString(); const node = (id, role, o) => ({ id, name: id, role, title: role === 'news' ? 'NEWS NODE' : 'MONITOR NODE', caps: [], status: 'online', lastSeen: t, info: { os: 'macOS', cpus: 4, memTotal: 8e9, memAvailable: 4e9, agentVersion: '0.2.2' }, running: 0, errors: 0, ...o });
  const ago = new Date(Date.now() - 600e3).toISOString();
  const data = { sys: { platform: 'darwin', cpus: 8, memory: { total: 16e9, usedPct: 40, pressure: 'green' } }, nodes: { fingerprint: 'ab'.repeat(32), counts: {}, jobs: [], tlsErrors: [{ at: t, addr: '100.101.1.9', code: 'ECONNRESET' }], nodes: [
      node('imac', 'news', { deviceKeyShort: '51CA-F55A-C21C-E86B' }), node('macbook', 'monitor', { status: 'down', lastSeen: ago }), node('old', 'news', { status: 'online', lastConnError: { code: 'E_AGENT_VERSION', detail: 'агент 0.3.0, нужен >=0.2.0 <0.3.0', at: t } }),
      node('gone', 'monitor', { revoked: true, status: 'revoked', lastConnError: { code: 'E_REVOKED', at: t } }), node('bad', 'news', { status: 'down', lastSeen: ago, lastConnError: { code: 'E_UNAUTHORIZED', at: t } })] },
    enroll: [{ requestId: 'R7K2Q', state: 'pending', role: 'news', name: 'iMac <script>x</script>', nodeId: 'imac', device: { deviceId: 'dev_1', pubKeyShort: 'AAAA-BBBB-CCCC-DDDD', pubKeyFingerprint: 'aa'.repeat(32), hostname: '<img src=x onerror=alert(1)>', model: 'm', os: 'o', arch: 'x64', agentVersion: '0.2.2', peer: 'адрес Tailscale не определён (запрос через локальный прокси)', peerVerified: false, peerInfo: { ip: null } } },
      { requestId: 'Q2W3E', state: 'pending', role: 'monitor', name: 'MacBook', nodeId: 'macbook', device: { deviceId: 'dev_2', pubKeyShort: 'EEEE-FFFF-0000-1111', pubKeyFingerprint: 'bb'.repeat(32), hostname: 'mb', model: 'm', os: 'o', arch: 'x64', agentVersion: '0.2.2', peer: 'macbook · 100.101.1.2', peerVerified: true, peerInfo: { ip: '100.101.1.2', name: 'macbook', login: 'igor@x' } } }], audit: [] };
  const out = ctx.VIEWS.computers.with(data); const st = id => (out.match(new RegExp(`node-\\w+ st-(\\w+)"><h3>${id} `)) || [])[1];
  assert.equal(st('imac'), 'online'); assert.equal(st('macbook'), 'offline'); assert.equal(st('old'), 'error'); assert.equal(st('gone'), 'revoked'); assert.equal(st('bad'), 'error');
  assert.match(out, /Mac mini/); assert.match(out, /координатор/); assert.match(out, /Offline<\/span>/); assert.match(out, /Ошибка: версия \(426\)/); assert.match(out, /Отозван/); assert.match(out, /токен или подпись отклонены/); assert.match(out, /TLS-ошибки/);
  assert.match(out, /⚠ адрес Tailscale не определён/); assert.match(out, /Tailscale<\/span> macbook · 100\.101\.1\.2 · igor@x/); assert.ok(!/127\.0\.0\.1/.test(out));
  assert.ok(!out.includes('<script>x') && !out.includes('<img src=x'), 'device-reported strings escaped'); assert.match(out, /AAAA-BBBB-CCCC-DDDD/);
  assert.match(ctx.VIEWS.computers(), /Загрузка/);
});
