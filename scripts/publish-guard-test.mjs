// Security recheck v1.2.2-test: publishing provenance, restore sanitizing, baked flavor, TEST publisher/egress lockdown.
// Usage: node scripts/publish-guard-test.mjs   (fake credentials only, temp dirs)
import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os';
const res = []; const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms)); const kids = [];
async function studio(flavor, port) {
  const UD = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-pub-' + flavor + '-'));
  const p = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: flavor, STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: UD, PORT: String(port), HOME: UD }, stdio: 'ignore' }); kids.push(p);
  const B = `http://127.0.0.1:${port}`; for (let i = 0; i < 40; i++) { try { if ((await fetch(B + '/api/health')).ok) break; } catch {} await sleep(250); }
  const R = { 'x-studio-request': '1', 'content-type': 'application/json' };
  const s = await fetch(B + '/api/auth/setup', { method: 'POST', headers: R, body: JSON.stringify({ username: 'qa', password: 'fake-password-123' }) });
  const A = { ...R, cookie: (s.headers.get('set-cookie') || '').split(';')[0] };
  const api = async (m, u, b) => { const r = await fetch(B + u, { method: m, headers: A, body: b === undefined ? undefined : JSON.stringify(b) }); let j = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  return { api, UD };
}
try {
  for (const [flavor, port] of [['prod', 8841], ['test', 8842]]) {
    const { api } = await studio(flavor, port); const T = `[${flavor}] `;
    const it = (await api('POST', '/api/queue', { title: 'QA post', text: 'hello', platform: 'facebook', channelId: 'c1', status: 'published', externalId: '111_222' })).j;
    ok(T + 'POST cannot create published/externalId', it.status === 'pending_approval' && !it.externalId);
    for (const body of [{ status: 'published' }, { status: 'published', externalId: '123456_789012' }, { externalId: '123456_789012' }, { publication: { platform: 'facebook', responseId: '123456', callerModule: 'meta-publisher', seal: 'ab'.repeat(32) } }, { status: 'published', publication: { seal: 'x' } }]) {
      const r = await api('PUT', '/api/queue/' + it.id, body); ok(T + 'PUT ' + JSON.stringify(body).slice(0, 70) + ' → 403', r.s === 403 && r.j?.code === 'published_internal_only', 'HTTP ' + r.s); }
    const cur = (await api('GET', '/api/queue/' + it.id)).j; ok(T + 'item still pending_approval, no externalId', cur.status === 'pending_approval' && !cur.externalId);
    // restore with forged statuses / externalId / forged seal
    const forged = [{ id: 'q1', title: 'a', status: 'published', externalId: '999_888', publishedAt: '2026-01-01T00:00:00Z', publication: { platform: 'facebook', responseId: '999_888', callerModule: 'meta-publisher', at: 'x', seal: '00'.repeat(32) } },
      { id: 'q2', title: 'b', status: 'approved' }, { id: 'q3', title: 'c', status: 'retry', nextRetryAt: '2026-01-01T00:00:00Z' }, { id: 'q4', title: 'd', status: 'scheduled' }, { id: 'q5', title: 'e', status: 'pending_approval' }];
    const pr = await api('POST', '/api/restore/prepare', { data: { queue: forged } }); const rr = await api('POST', '/api/restore', { token: pr.j.token, confirm: 'ЗАМЕНИТЬ' });
    ok(T + 'restore succeeds', rr.s === 200, 'HTTP ' + rr.s);
    const q = (await api('GET', '/api/queue')).j; const by = Object.fromEntries(q.map(x => [x.id, x]));
    ok(T + 'restore: every queue item enters pending_approval', q.length === 5 && q.every(x => x.status === 'pending_approval'));
    ok(T + 'restore: forged externalId/publishedAt/publication dropped', !by.q1.externalId && !by.q1.publishedAt && !by.q1.publication && !by.q3.nextRetryAt);
    ok(T + 'restore: historical status kept read-only for audit', by.q1.historical_status === 'published' && by.q1.historical_externalId === '999_888' && by.q2.historical_status === 'approved' && by.q3.historical_status === 'retry');
    const h = await api('PUT', '/api/queue/q2', { historical_status: 'x', title: 'b2' }); ok(T + 'historical_* not writable via CRUD', h.s === 200 && h.j.historical_status === 'approved');
    const ap = await api('PUT', '/api/queue/q1', { status: 'approved' }); ok(T + 'historical status never authorises publishing (approval still goes through guardrails, not published)', (await api('GET', '/api/queue/q1')).j.status !== 'published', 'HTTP ' + ap.s);
    const pub = await api('POST', '/api/queue/q1/publish');
    if (flavor === 'test') ok(T + '/publish → 403 publishing_disabled', pub.s === 403 && pub.j?.code === 'publishing_disabled');
    else ok(T + '/publish on non-approved restored item does not publish', pub.s >= 400 && (await api('GET', '/api/queue/q1')).j.status !== 'published', 'HTTP ' + pub.s);
    const eg = await api('POST', '/api/integrations', { id: 'meta', name: 'Meta', url: 'https://graph.facebook.com/v19.0/me' });
    const et = await api('POST', '/api/integrations/meta/test');
    if (flavor === 'test') ok(T + 'egress: graph.facebook.com not reachable (not in allowlist)', !et.j?.ok && /список|allow|Хост/i.test(JSON.stringify(et.j)), JSON.stringify(et.j).slice(0, 120));
  }
  // TEST: publisher module not loaded, egress allowlist without social hosts
  const env = { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test' };
  const e = spawnSync(process.execPath, ['-e', 'const e=require("./lib/egress.js");console.log(JSON.stringify({pub:[...e.PUBLIC_HOSTS],soc:e.SOCIAL_HOSTS}))'], { env }); const ej = JSON.parse(e.stdout);
  ok('TEST egress allowlist excludes all social APIs', ej.soc.length >= 3 && ej.soc.every(h => !ej.pub.includes(h)), ej.pub.join(','));
  const src = fs.readFileSync('server.js', 'utf8'); ok('TEST: meta.js (publisher) is not required in TEST builds', /CFG\.IS_TEST \? \(\(\) => \{ metaCtx\.keySource/.test(src) && /: require\('\.\/meta\.js'\)/.test(src));
  ok('meta.js publishes only via sealPublication(…, "meta-publisher") after platform response', /ctx\.sealPublication\(it, \{ platform: it\.platform, responseId/.test(fs.readFileSync('meta.js', 'utf8')) && !/status: 'published'/.test(fs.readFileSync('meta.js', 'utf8')));
  // Baked flavor cannot be overridden (env / CLI / settings)
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-baked-')); fs.mkdirSync(T + '/lib'); fs.copyFileSync('lib/studio-config.js', T + '/lib/studio-config.js');
  fs.writeFileSync(T + '/package.json', JSON.stringify({ name: 'x', studioFlavor: 'test' })); fs.writeFileSync(T + '/lib/flavor.baked.js', "module.exports = 'test';\n");
  fs.mkdirSync(T + '/home/Library/Application Support/MOONKATTY AI STUDIO TEST', { recursive: true }); fs.writeFileSync(T + '/home/Library/Application Support/MOONKATTY AI STUDIO TEST/desktop.json', JSON.stringify({ flavor: 'prod', studioFlavor: 'prod' }));
  const probe = (envx, args = []) => String(spawnSync(process.execPath, ['-e', 'const c=require(process.argv[1]+"/lib/studio-config.js");console.log(c.FLAVOR+"|"+c.appId+"|"+c.defaultPort+"|"+c.FLAVOR_SOURCE)', T, ...args], { env: { ...process.env, HOME: T + '/home', ...envx } }).stdout).trim();
  for (const [n, envx, args] of [['STUDIO_FLAVOR=prod NODE_ENV=test', { STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' }], ['STUDIO_FLAVOR=prod NODE_ENV=production', { STUDIO_FLAVOR: 'prod', NODE_ENV: 'production' }], ['MK_FLAVOR/FLAVOR=prod', { MK_FLAVOR: 'prod', FLAVOR: 'prod', NODE_ENV: 'test' }], ['CLI --flavor=prod --prod', {}, ['--flavor=prod', '--prod']], ['settings desktop.json flavor:prod', {}]])
    ok('baked TEST flavor not overridable: ' + n, probe(envx, args) === 'test|com.moonkatty.aistudio.test|8687|baked', probe(envx, args));
  fs.writeFileSync(T + '/lib/flavor.baked.js', "module.exports = 'staging';\n"); ok('invalid baked flavor → null (fail-closed), env cannot rescue', probe({ STUDIO_FLAVOR: 'prod', NODE_ENV: 'test' }).startsWith('null|com.moonkatty.aistudio.test'));
  // packaged bundle check, if a test build exists
  const asar = 'dist/mac-arm64/MOONKATTY AI STUDIO TEST.app/Contents/Resources/app.asar';
  if (fs.existsSync(asar)) { const X = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-asar-')); spawnSync('npx', ['--yes', '@electron/asar', 'extract', asar, X], { stdio: 'ignore' });
    const pj = JSON.parse(fs.readFileSync(X + '/package.json', 'utf8')); ok('bundle: package.json studioFlavor = test', pj.studioFlavor === 'test');
    ok('bundle: lib/flavor.baked.js = test', /module\.exports = 'test'/.test(fs.readFileSync(X + '/lib/flavor.baked.js', 'utf8')));
    const b = String(spawnSync(process.execPath, ['-e', 'const c=require(process.argv[1]+"/lib/studio-config.js");console.log(c.FLAVOR+"|"+c.appId)', X, '--flavor=prod'], { env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'prod' } }).stdout).trim();
    ok('bundle: STUDIO_FLAVOR=prod + --flavor=prod cannot switch packaged TEST to prod', b === 'test|com.moonkatty.aistudio.test', b); }
  else console.log('SKIP: packaged bundle checks (no dist build)');
} finally { for (const k of kids) k.kill(); }
const failed = res.filter(x => !x[1]).map(x => x[0]); console.log(JSON.stringify({ passed: res.length - failed.length, failed })); process.exit(failed.length ? 1 : 0);
