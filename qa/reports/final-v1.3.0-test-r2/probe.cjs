'use strict';
// Focused checks for c24f756. Fake password only. No publish, no social, no Azure.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = process.env.PROBE_ROOT || '/tmp/mk-v130r2';
const PORT = Number(process.env.PROBE_PORT || 8931);
const out = [];
function check(name, ok, extra) {
  out.push({ name, ok: !!ok, extra: extra === undefined ? null : extra });
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
}
function walkModes(node, at, bad) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.dataMode === 'string' && node.dataMode !== 'mock') bad.push(at + ' dataMode=' + node.dataMode);
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') walkModes(v, at + '.' + k, bad);
  }
}
function moneyLabels(summary) {
  const rows = [];
  for (const p of summary.platforms || []) {
    for (const field of ['confirmed', 'estimate']) {
      const v = p[field];
      if (v && typeof v === 'object') rows.push({ id: p.id, field, dataMode: p.dataMode, label: v.label, demo: v.demo, excludedFromActual: v.excludedFromActual, usd: v.usd });
    }
  }
  return rows;
}
const snapPath = path.join(ROOT, 'media-automation/fixtures/platforms-snapshot.sample.json');
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const badModes = [];
walkModes(snap, 'fixture', badModes);
check('fixture dataMode is mock everywhere', badModes.length === 0, badModes);
check('fixture note says mock and no real revenue', /dataMode=mock/.test(snap.note) && /no real publishing or revenue/.test(snap.note), snap.note);

const read = require(path.join(ROOT, 'lib/world/platform-read.js'));
const opened = read.openPlatformRead();
const summary = read.summarize(opened);
check('source openPlatformRead is studio2-read-api and publish false', opened.path === 'studio2-read-api' && opened.publish === false, opened.path);
const labels = moneyLabels(summary);
const realish = labels.filter(r => r.label && (r.demo === false || r.excludedFromActual === false || r.usd != null || !String(r.label).startsWith('DEMO') || r.dataMode === 'real'));
const nd = (summary.platforms || []).filter(p => p.confirmed !== 'НЕТ ДАННЫХ' && !(p.confirmed && String(p.confirmed.label || '').startsWith('DEMO')));
check('source fixture money is DEMO or НЕТ ДАННЫХ', realish.length === 0 && nd.length === 0 && summary.publish === false && summary.viewsAreRevenue === false, { realish, nd: nd.map(p => p.id), demo: summary.demo });

function relRequires(file) {
  const text = fs.readFileSync(file, 'utf8');
  const found = [];
  const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(text))) found.push(path.normalize(path.join(path.dirname(file), m[1] + (m[1].endsWith('.js') ? '' : '.js'))));
  return found;
}
function closure(start) {
  const seen = new Set();
  const stack = [path.resolve(start)];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    for (const n of relRequires(f)) if (!seen.has(n)) stack.push(n);
  }
  return [...seen];
}
const banned = ['ledger.js', 'promotion.js', 'meta.js', 'formats.js', 'scheduling.js', 'index.js'];
const roots = [
  'media-automation/src/platforms/read-api.js',
  'media-automation/src/platforms/registry.js',
  'media-automation/src/platforms/capabilities.js',
].map(f => path.join(ROOT, f));
const closed = new Set();
for (const r of roots) for (const f of closure(r)) closed.add(path.relative(ROOT, f));
const hitBanned = [...closed].filter(f => banned.some(b => f.endsWith('/' + b) || f.endsWith(b) && f.includes('platforms')));
const adapterHit = [...closed].filter(f => f.includes('/publish/adapters/') || f.endsWith('/adapters.js'));
check('read-api closure does not load ledger, promotion, adapters, or meta.js', hitBanned.length === 0 && adapterHit.length === 0, { files: [...closed], hitBanned, adapterHit });

const cap = fs.readFileSync(path.join(ROOT, 'media-automation/src/platforms/capabilities.js'), 'utf8');
const reg = fs.readFileSync(path.join(ROOT, 'media-automation/src/platforms/registry.js'), 'utf8');
check('capabilities.js has no fs, net, http, or child_process', !/require\(\s*['"](fs|http|https|net|child_process|dgram)['"]\s*\)/.test(cap), null);
check('registry.js requires only capabilities and experimental', (reg.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []).join(' ') === "require('./capabilities') require('../experimental')", reg.match(/require\(\s*['"][^'"]+['"]\s*\)/g));
const callers = [];
function walkDir(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'qa') continue;
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkDir(p);
    else if (/\.(js|mjs|cjs)$/.test(name) && p !== path.join(ROOT, 'media-automation/src/platforms/registry.js')) {
      const text = fs.readFileSync(p, 'utf8');
      if (text.includes('requestLiveMode')) callers.push(path.relative(ROOT, p));
    }
  }
}
walkDir(ROOT);
check('requestLiveMode is referenced only by the platforms test', callers.length === 1 && callers[0] === 'media-automation/test/platforms.test.js', callers);

const { createReadApi } = require(path.join(ROOT, 'media-automation/src/platforms/read-api.js'));
const api = createReadApi();
let liveCalls = 0;
const poisoned = createReadApi({
  publisher: { posts: () => { liveCalls += 1; return []; } },
  ledger: { all: () => { liveCalls += 1; return [{ status: 'confirmed', amount: 99, currency: 'USD', payoutId: 'REAL' }]; }, totals: () => ({ confirmed: { USD: 99 }, estimated: {} }) },
});
check('default createReadApi does not call a publisher or ledger', liveCalls === 0 && api.getRevenue('youtube-news').dataMode === 'mock', api.getRevenue('youtube-news').dataMode);
const injected = poisoned.getRevenue('youtube-news');
check('injected ledger is not the command-center path', injected.dataMode === 'real' && liveCalls === 1 && opened.path === 'studio2-read-api', { liveCalls, mode: injected.dataMode });

function boot() {
  const dir = fs.mkdtempSync(path.join('/tmp', 'mk-r2-probe-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      STUDIO_FLAVOR: 'test',
      STUDIO_SQLITE: 'node',
      STUDIO_DATA_DIR: dir,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      MA_EXPERIMENTAL: '',
      STUDIO_PLATFORM_SNAPSHOT: '',
      STUDIO_MEDIA_ROOT: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  return { child, dir, log: () => log };
}
async function up(state) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/api/health');
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(state.log().slice(-500));
  return false;
}
(async () => {
  const state = boot();
  const booted = await up(state);
  check('source server boots', booted, null);
  if (booted) {
    const health = await (await fetch('http://127.0.0.1:' + PORT + '/api/health')).json();
    check('health flavor test version 1.3.0-test', health.flavor === 'test' && health.version === '1.3.0-test', health.flavor + ' ' + health.version);
    const tok = fs.readFileSync(path.join(state.dir, 'app-token'), 'utf8').trim();
    const H = { 'content-type': 'application/json', 'x-studio-request': '1', 'x-studio-app-token': tok };
    const setup = await fetch('http://127.0.0.1:' + PORT + '/api/auth/setup', { method: 'POST', headers: H, body: JSON.stringify({ username: 'igor', password: 'fake-admin-pw-1' }) });
    check('setup accepts the fake password', setup.status === 200, setup.status);
    const ccRes = await fetch('http://127.0.0.1:' + PORT + '/api/world/command-center', { headers: H });
    const cc = await ccRes.json();
    check('command-center source is studio2-read-api and publish is false', ccRes.status === 200 && cc.readApi && cc.readApi.source === 'studio2-read-api' && cc.readApi.publish === false && cc.readApi.viewsAreRevenue === false, cc.readApi);
    const httpLabels = moneyLabels({ platforms: cc.readPlatforms });
    const httpReal = httpLabels.filter(r => r.label && (!String(r.label).startsWith('DEMO') || r.demo === false || r.excludedFromActual === false || r.usd != null || r.dataMode === 'real'));
    const yn = (cc.readPlatforms || []).find(p => p.id === 'youtube-news');
    check('HTTP fixture money is DEMO', httpReal.length === 0 && yn && String(yn.confirmed.label).startsWith('DEMO') && yn.confirmed.excludedFromActual === true && yn.dataMode === 'mock', { label: yn && yn.confirmed, httpReal });
    check('directors do not publish', cc.directors && cc.directors.marketing.publishes === false && cc.publishing && cc.publishing.touched === false && cc.publishing.testDisabled === true, cc.publishing);
    const pub = await fetch('http://127.0.0.1:' + PORT + '/api/queue', { method: 'POST', headers: H, body: JSON.stringify({ title: 'probe', body: 'probe', status: 'published', project: 'news' }) });
    const pubBody = await pub.json();
    check('POST published is stored pending_approval', pub.status === 201 && pubBody.status === 'pending_approval' && !pubBody.externalId, { status: pub.status, stored: pubBody.status });
    const id = pubBody.id;
    const again = await fetch('http://127.0.0.1:' + PORT + '/api/queue/' + id + '/publish', { method: 'POST', headers: H, body: '{}' });
    const againBody = await again.json().catch(() => ({}));
    check('TEST publish route stays disabled', again.status === 403 && againBody.code === 'publishing_disabled', { status: again.status, code: againBody.code });
  }
  state.child.kill('SIGTERM');
  await new Promise(r => state.child.once('exit', r));
  const failed = out.filter(x => !x.ok).length;
  fs.writeFileSync('/tmp/v130r2-logs/probe.json', JSON.stringify({ failed, out }, null, 2));
  console.log('FAILED ' + failed + ' / ' + out.length);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
