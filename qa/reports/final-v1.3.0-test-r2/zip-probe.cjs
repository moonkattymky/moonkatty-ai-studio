'use strict';
// Inspect the rebuilt TEST app. No network publish. Fake password only.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const APP = '/tmp/mk-v130r2-build/dist/mac-arm64/MOONKATTY AI STUDIO TEST.app';
const RES = path.join(APP, 'Contents/Resources');
const UNP = path.join(RES, 'app.asar.unpacked');
const ZIP = '/tmp/mk-v130r2-build/dist/MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip';
const CLAIM = 'd512263ef450bf9ca82297108d4b61c84c779f777665707559f32b52af603b5e';
const PORT = 8933;
const out = [];
function check(name, ok, extra) {
  out.push({ name, ok: !!ok, extra: extra === undefined ? null : extra });
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
}
function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) { acc.push(p); continue; }
    if (st.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
const files = walk(RES);
const rel = files.map(p => path.relative(RES, p));
const zipHash = sha256(ZIP);
check('zip sha256 matches the claim', zipHash === CLAIM, zipHash);
const info = JSON.parse(fs.readFileSync(path.join(UNP, 'desktop/build-info.json'), 'utf8'));
check('build-info is unpacked and names this commit and the test flavor', info.commit === 'c24f7569301dbc5fe3cfe2a58143890c9ef74133' && info.flavor === 'test' && info.appId === 'com.moonkatty.aistudio.test', info);
const agentSrc = fs.readFileSync('/tmp/mk-v130r2-build/node-agent/agent.js');
const agentPkg = fs.readFileSync(path.join(UNP, 'node-agent/agent.js'));
const ver = agentPkg.toString('utf8').match(/const VERSION = '([^']+)'/);
check('packaged node-agent is 0.2.2 and matches the source bytes', ver && ver[1] === '0.2.2' && agentSrc.equals(agentPkg), { version: ver && ver[1], sha: crypto.createHash('sha256').update(agentPkg).digest('hex') });
const cfg = require(path.join(UNP, 'lib/studio-config.js'));
check('unpacked config is baked test', cfg.FLAVOR_SOURCE === 'baked' && cfg.IS_TEST === true && cfg.FLAVOR === 'test' && cfg.appId === 'com.moonkatty.aistudio.test' && cfg.defaultPort === 8687 && cfg.keychainService === 'MOONKATTY AI STUDIO.test', { source: cfg.FLAVOR_SOURCE, flavor: cfg.FLAVOR, appId: cfg.appId });
const wanted = [
  'app.asar.unpacked/media-automation/src/platforms/read-api.js',
  'app.asar.unpacked/media-automation/src/platforms/registry.js',
  'app.asar.unpacked/media-automation/src/platforms/capabilities.js',
  'app.asar.unpacked/media-automation/fixtures/platforms-snapshot.sample.json',
];
check('the four new files are unpacked', wanted.every(w => rel.includes(w)), wanted.filter(w => !rel.includes(w)));
const bannedName = /(^|\/)meta\.js$|platforms\/ledger\.js$|platforms\/promotion\.js$|publish\/adapters\/|analytics\/adapters\.js$|platforms\/index\.js$|platforms\/formats\.js$|platforms\/scheduling\.js$|platforms\/meta-analytics\.js$|platforms\/meta-oauth-bridge\.js$/;
const banned = rel.filter(r => bannedName.test(r));
check('zip resources contain no meta.js, adapters, ledger, or promotion module', banned.length === 0, banned);
const preExistingLedger = [
  'app.asar.unpacked/studio-intelligence/contracts/studio3-ledger-entry.schema.json',
  'app.asar.unpacked/studio-intelligence/src/ledger-adapter.js',
  'app.asar.unpacked/studio-intelligence/src/ledger-stub.js',
];
const named = rel.filter(r => /promotion/i.test(r) || /ledger/i.test(r));
check('the only ledger paths are the unchanged Studio 5 files', named.length === preExistingLedger.length && preExistingLedger.every(p => named.includes(p)) && !named.some(p => p.includes('media-automation')), named);

const read = require(path.join(UNP, 'lib/world/platform-read.js'));
const opened = read.openPlatformRead();
const summary = read.summarize(opened);
function badMoney(summary) {
  const rows = [];
  for (const p of summary.platforms || []) {
    if (p.dataMode === 'real') rows.push({ id: p.id, why: 'dataMode real' });
    for (const field of ['confirmed', 'estimate']) {
      const v = p[field];
      if (v && typeof v === 'object') {
        if (!String(v.label || '').startsWith('DEMO') || v.demo === false || v.excludedFromActual === false || v.usd != null) rows.push({ id: p.id, field, v });
      }
    }
  }
  return rows;
}
check('packaged adapter is studio2-read-api and fixture money is DEMO', opened.path === 'studio2-read-api' && opened.publish === false && summary.publish === false && badMoney(summary).length === 0, { path: opened.path, bad: badMoney(summary), yn: (summary.platforms || []).find(p => p.id === 'youtube-news') });

function boot(root) {
  const dir = fs.mkdtempSync(path.join('/tmp', 'mk-r2-pkg-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      STUDIO_SQLITE: 'node',
      STUDIO_DATA_DIR: dir,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      STUDIO_FLAVOR: 'prod',
      STUDIO_PLATFORM_SNAPSHOT: '',
      STUDIO_MEDIA_ROOT: '',
      MA_EXPERIMENTAL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  return { child, dir, log: () => log };
}
(async () => {
  const state = boot(UNP);
  let booted = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:' + PORT + '/api/health')).ok) { booted = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  check('packaged server boots', booted, booted ? null : state.log().slice(-400));
  if (booted) {
    const health = await (await fetch('http://127.0.0.1:' + PORT + '/api/health')).json();
    check('packaged health stays test when STUDIO_FLAVOR=prod', health.flavor === 'test' && health.version === '1.3.0-test', health);
    const tok = fs.readFileSync(path.join(state.dir, 'app-token'), 'utf8').trim();
    const H = { 'content-type': 'application/json', 'x-studio-request': '1', 'x-studio-app-token': tok };
    await fetch('http://127.0.0.1:' + PORT + '/api/auth/setup', { method: 'POST', headers: H, body: JSON.stringify({ username: 'igor', password: 'fake-admin-pw-1' }) });
    const cc = await (await fetch('http://127.0.0.1:' + PORT + '/api/world/command-center', { headers: H })).json();
    const yn = (cc.readPlatforms || []).find(p => p.id === 'youtube-news');
    const rows = [];
    for (const p of cc.readPlatforms || []) {
      for (const field of ['confirmed', 'estimate']) {
        const v = p[field];
        if (v && typeof v === 'object' && (!String(v.label).startsWith('DEMO') || v.demo === false || v.excludedFromActual !== true || v.usd != null || p.dataMode === 'real')) rows.push({ id: p.id, field, v, dataMode: p.dataMode });
      }
    }
    check('packaged command-center source is studio2-read-api and publish is false', cc.readApi && cc.readApi.source === 'studio2-read-api' && cc.readApi.publish === false && cc.readApi.demo === true, cc.readApi);
    check('packaged HTTP fixture money is DEMO and excluded from the real total', rows.length === 0 && yn && yn.confirmed.label === 'DEMO USD 12.50' && yn.confirmed.excludedFromActual === true && yn.confirmed.demo === true, { label: yn && yn.confirmed, bad: rows });
    const pub = await fetch('http://127.0.0.1:' + PORT + '/api/queue', { method: 'POST', headers: H, body: JSON.stringify({ title: 'probe', body: 'probe', status: 'published', project: 'news' }) });
    const pubBody = await pub.json();
    const again = await fetch('http://127.0.0.1:' + PORT + '/api/queue/' + pubBody.id + '/publish', { method: 'POST', headers: H, body: '{}' });
    const againBody = await again.json().catch(() => ({}));
    check('packaged TEST publish stays 403', pub.status === 201 && pubBody.status === 'pending_approval' && again.status === 403 && againBody.code === 'publishing_disabled', { stored: pubBody.status, publish: again.status, code: againBody.code });
  }
  state.child.kill('SIGTERM');
  await new Promise(r => state.child.once('exit', r));
  const failed = out.filter(x => !x.ok).length;
  fs.writeFileSync('/tmp/v130r2-logs/zip-probe.json', JSON.stringify({ failed, zipHash, out }, null, 2));
  console.log('FAILED ' + failed + ' / ' + out.length);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
