'use strict';
// nodes-022-final: node-side security review checks (Linux; macOS Keychain/launchd themselves are NOT exercised — test doubles / static checks).
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'); const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..', '..'); const EN = require('../../node-agent/enroll.js'); const A = require('../../node-agent/agent.js');
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p || 'nsec-')); const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('Keychain: secrets go to `security` via stdin (-i), never in argv; device key only in Keychain, device.json 0600 holds the public key only', async () => {
  const d = tmp(); const env = { NODE_KEYCHAIN_BIN: path.join(ROOT, 'test/fixtures/fake-security.js'), FAKE_KC_FILE: path.join(d, 'kc.json'), FAKE_KC_ARGV: path.join(d, 'argv.log') };
  const kc = EN.keychain(env); const secret = 'nk_imac.' + 'S'.repeat(32); await kc.set('moonkatty-node-imac', 'node-token', secret); assert.equal(await kc.get('moonkatty-node-imac', 'node-token'), secret);
  const home = path.join(d, '.moonkatty-node'); const dev = await EN.deviceIdentity(home, kc); assert.ok(dev.key);
  const argv = fs.readFileSync(env.FAKE_KC_ARGV, 'utf8'); assert.ok(!argv.includes(secret), 'token not in argv'); assert.ok(!/PRIVATE|MC4CAQ/.test(argv), 'device key not in argv');
  const dj = fs.readFileSync(path.join(home, 'device.json'), 'utf8'); assert.ok(!/PRIVATE/.test(dj)); assert.equal(fs.statSync(path.join(home, 'device.json')).mode & 0o777, 0o600); assert.equal(fs.statSync(home).mode & 0o777, 0o700);
  await assert.rejects(kc.set('s', 'a', 'bad value; rm -rf /'), /недопустимые символы/, 'no shell/stdin injection into `security -i`');
});

test('launchd plist: user LaunchAgent (no root/LaunchDaemon), KeepAlive on crash only, ThrottleInterval, Umask 077, heap cap, no network keys', () => {
  const p = read('deploy/com.moonkatty.node-agent.plist');
  for (const re of [/<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/>/, /<key>ThrottleInterval<\/key><integer>30<\/integer>/, /<key>Umask<\/key><integer>63<\/integer>/, /--max-old-space-size=192/, /<key>ProcessType<\/key><string>Background<\/string>/]) assert.match(p, re);
  assert.doesNotMatch(p, /<key>UserName<\/key>|<key>GroupName<\/key>|<key>Sockets<\/key>/);
  const inst = read('scripts/node/install.sh'); const code = inst.split('\n').filter(l => !/^\s*#/.test(l)).join('\n'); assert.doesNotMatch(code, /\bsudo\b|LaunchDaemons|spctl --master-disable|xattr -d?r? *com\.apple\.quarantine/); assert.match(inst, /shasum -a 256 -c MANIFEST\.sha256/); assert.match(inst, /chmod 600 "\$CONF\/node-agent\.env"/); assert.match(inst, /launchctl bootstrap "gui\/\$\(id -u\)"/);
});

test('install.sh / uninstall.sh on Linux with stub sw_vers/launchctl/security: files 0700/0600, rollback restores the previous version, --purge removes token AND device key', () => {
  const pkg = tmp('pkg-'); const home = tmp('home-'); const bin = tmp('stub-'); const kc = path.join(home, 'kc.json');
  fs.mkdirSync(path.join(pkg, 'bin')); fs.mkdirSync(path.join(pkg, 'app')); fs.writeFileSync(path.join(pkg, 'bin', 'node'), '#!/bin/sh\necho v22.0.0\n', { mode: 0o755 });
  for (const f of ['agent.js', 'enroll.js', 'enroll.html', 'status.html', 'node-agent.env.example']) fs.copyFileSync(path.join(ROOT, 'node-agent', f), path.join(pkg, 'app', f));
  fs.copyFileSync(path.join(ROOT, 'deploy/com.moonkatty.node-agent.plist'), path.join(pkg, 'app', 'com.moonkatty.node-agent.plist')); for (const f of ['install.sh', 'uninstall.sh']) fs.copyFileSync(path.join(ROOT, 'scripts/node', f), path.join(pkg, f));
  fs.writeFileSync(path.join(pkg, 'BUILDINFO'), 'MOONKATTY NODE 0.2.2\nruntime: Node.js v22 darwin-x64 (macOS >= 11.0), test\n');
  spawnSync('bash', ['-c', 'find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | xargs sha256sum > MANIFEST.sha256'], { cwd: pkg });
  fs.writeFileSync(path.join(bin, 'shasum'), '#!/bin/sh\nshift 2; exec sha256sum "$@"\n', { mode: 0o755 }); fs.writeFileSync(path.join(bin, 'sw_vers'), '#!/bin/sh\necho 12.7.6\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'launchctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 }); fs.writeFileSync(path.join(bin, 'security'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'test/fixtures/fake-security.js')}" "$@"\n`, { mode: 0o755 });
  const env = { PATH: bin + ':' + process.env.PATH, HOME: home, FAKE_KC_FILE: kc };
  const r1 = spawnSync('bash', [path.join(pkg, 'install.sh')], { env, encoding: 'utf8' }); assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const conf = path.join(home, '.moonkatty-node'); assert.equal(fs.statSync(conf).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(conf, 'node-agent.env')).mode & 0o777, 0o600); assert.equal(fs.statSync(path.join(conf, 'outbox')).mode & 0o777, 0o700);
  fs.writeFileSync(path.join(home, 'moonkatty-node', 'MARK'), 'v1'); const r2 = spawnSync('bash', [path.join(pkg, 'install.sh')], { env, encoding: 'utf8' }); assert.equal(r2.status, 0); assert.match(r2.stdout, /для отката/);
  assert.ok(!fs.existsSync(path.join(home, 'moonkatty-node', 'MARK'))); const rb = spawnSync('bash', [path.join(home, 'moonkatty-node', 'uninstall.sh'), '--rollback'], { env, encoding: 'utf8' }); assert.equal(rb.status, 0, rb.stdout + rb.stderr);
  assert.equal(fs.readFileSync(path.join(home, 'moonkatty-node', 'MARK'), 'utf8'), 'v1', 'rollback restored the previous install');
  fs.writeFileSync(path.join(conf, 'node-agent.env'), 'NODE_ID=macbook\n'); fs.writeFileSync(path.join(conf, 'device.json'), JSON.stringify({ deviceId: 'dev_' + 'a'.repeat(32), pubKey: 'x' }, null, 1));
  fs.writeFileSync(kc, JSON.stringify({ 'moonkatty-node-macbook|node-token': 'nk_macbook.x', ['moonkatty-node-device|dev_' + 'a'.repeat(32)]: 'KEY' }));
  const pu = spawnSync('bash', [path.join(home, 'moonkatty-node', 'uninstall.sh'), '--purge'], { env, encoding: 'utf8' }); assert.equal(pu.status, 0, pu.stdout + pu.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(kc, 'utf8')), {}, 'token and device key removed from the Keychain'); assert.ok(!fs.existsSync(conf));
});

test('agent: no network listeners except 127.0.0.1 status/enroll pages; memory limits per profile; FORBIDDEN caps; no shell execution of task input', () => {
  const src = read('node-agent/agent.js'); const listens = src.match(/\.listen\([^)]*\)/g) || []; assert.ok(listens.length >= 2 && listens.every(l => /'127\.0\.0\.1'/.test(l)), listens.join(' | '));
  assert.match(src, /const \{ execFile \} = require\('child_process'\)/); assert.doesNotMatch(src, /execSync|shell:\s*true|child_process'\)\.(exec|spawn)\b|\bspawn\(/); assert.doesNotMatch(src, /\beval\(|new Function\(/);
  assert.equal(A.PROFILES.news.limits.maxRssMB, 384); assert.equal(A.PROFILES.monitor.limits.maxRssMB, 256); assert.equal(A.PROFILES.monitor.limits.maxConcurrent, 1);
  for (const c of ['opencode.run', 'blender.x', 'render.video', 'ollama.chat', 'x.post', 'shell.exec']) assert.ok(A.allowCap('news', c), c);
});
