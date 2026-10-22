'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const APP = '/tmp/mk-v130r3-build/dist/mac-arm64/MOONKATTY AI STUDIO TEST.app';
const RES = path.join(APP, 'Contents/Resources');
const UNP = path.join(RES, 'app.asar.unpacked');
const ZIP = '/tmp/mk-v130r3-build/dist/MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip';
const PORT = 8941;
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
const zipHash = sha256(ZIP);
check('zip exists and has a sha256', /^[0-9a-f]{64}$/.test(zipHash), zipHash);
const info = JSON.parse(fs.readFileSync(path.join(UNP, 'desktop/build-info.json'), 'utf8'));
check('build-info is unpacked for this commit and the test flavor', info.commit === 'd1adf4d86d09384d2cc322920d360eb87797c1de' && info.flavor === 'test' && info.appId === 'com.moonkatty.aistudio.test' && info.version === '1.3.0-test', info);
const cfg = require(path.join(UNP, 'lib/studio-config.js'));
check('baked flavor stays test', cfg.FLAVOR === 'test' && cfg.IS_TEST === true && cfg.FLAVOR_SOURCE === 'baked' && cfg.appId === 'com.moonkatty.aistudio.test', cfg.FLAVOR);
const UC = require(path.join(UNP, 'lib/ops/update-center.js'));
check('packaged HARD_GATE.closed is true', UC.HARD_GATE.closed === true, UC.HARD_GATE.reason);
const read = require(path.join(UNP, 'lib/world/platform-read.js'));
const opened = read.openPlatformRead();
check('packaged reader is studio2-read-api', opened.path === 'studio2-read-api' && opened.publish === false, opened.path);
function boot() {
  const dir = fs.mkdtempSync(path.join('/tmp', 'mk-r3-pkg-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: UNP,
    env: { ...process.env, STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: dir, PORT: String(PORT), HOST: '127.0.0.1', STUDIO_FLAVOR: 'prod', STUDIO_OPS_UPDATE: '', OPS_UPDATE_DOWNLOAD_ENABLED: '', STUDIO_MEDIA_ROOT: '', STUDIO_PLATFORM_SNAPSHOT: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  return { child, dir, log: () => log };
}
(async () => {
  const state = boot();
  let booted = false;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch('http://127.0.0.1:' + PORT + '/api/health')).ok) { booted = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  check('packaged server boots', booted, booted ? null : state.log().slice(-400));
  if (booted) {
    const health = await (await fetch('http://127.0.0.1:' + PORT + '/api/health')).json();
    check('health stays test when STUDIO_FLAVOR=prod', health.flavor === 'test' && health.version === '1.3.0-test', health);
    const tok = fs.readFileSync(path.join(state.dir, 'app-token'), 'utf8').trim();
    const H = { 'content-type': 'application/json', 'x-studio-request': '1', 'x-studio-app-token': tok };
    await fetch('http://127.0.0.1:' + PORT + '/api/auth/setup', { method: 'POST', headers: H, body: JSON.stringify({ username: 'igor', password: 'fake-admin-pw-1' }) });
    const upd = await fetch('http://127.0.0.1:' + PORT + '/api/ops/update-center', { headers: H });
    const updBody = await upd.json().catch(() => ({}));
    check('STUDIO_OPS_UPDATE unset is 404', upd.status === 404, upd.status + ' ' + JSON.stringify(updBody).slice(0, 180));
    const cc = await (await fetch('http://127.0.0.1:' + PORT + '/api/world/command-center', { headers: H })).json();
    const yn = (cc.readPlatforms || []).find(p => p.id === 'youtube-news');
    check('command center is studio2-read-api with publish false and DEMO money', cc.readApi && cc.readApi.source === 'studio2-read-api' && cc.readApi.publish === false && cc.readApi.demo === true && yn && yn.confirmed.label === 'DEMO USD 12.50' && yn.confirmed.excludedFromActual === true && yn.dataMode === 'mock', { read: cc.readApi, label: yn && yn.confirmed });
    const pub = await fetch('http://127.0.0.1:' + PORT + '/api/queue', { method: 'POST', headers: H, body: JSON.stringify({ title: 'probe', body: 'probe', status: 'published', project: 'news' }) });
    const pubBody = await pub.json();
    const again = await fetch('http://127.0.0.1:' + PORT + '/api/queue/' + pubBody.id + '/publish', { method: 'POST', headers: H, body: '{}' });
    const againBody = await again.json().catch(() => ({}));
    check('TEST publish stays 403', pub.status === 201 && pubBody.status === 'pending_approval' && again.status === 403 && againBody.code === 'publishing_disabled', againBody.code);
  }
  state.child.kill('SIGTERM');
  await new Promise(r => state.child.once('exit', r));
  const failed = out.filter(x => !x.ok).length;
  fs.writeFileSync('/tmp/v130r3-logs/zip-probe.json', JSON.stringify({ failed, zipHash, out }, null, 2));
  console.log('ZIP ' + zipHash);
  console.log('FAILED ' + failed + ' / ' + out.length);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
