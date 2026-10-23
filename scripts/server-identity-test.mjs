// Studio 4 F-3/F-4: port conflict text and PID check. Self-check, not an independent audit.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const id = require('../lib/server-identity.js');
const expect = { version: '1.3.4-test', commit: 'abc1234def5678' };
let pass = 0, fail = 0;
const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };

t('missing version is stale and prints ?', id.classify({ app: 'moonkatty-ai-studio', flavor: 'test', pid: 9 }, expect, 'test').version === '?');
const bare = id.portConflict(8687, { app: 'moonkatty-ai-studio', flavor: 'test', pid: 9 }, expect, 'test');
t('F-3: message says v? and not vundefined', bare.exitCode === 3 && /v\?/.test(bare.message) && !/vundefined/.test(bare.message), bare.message);
t('same version and commit exits 0', id.portConflict(8687, { app: 'moonkatty-ai-studio', flavor: 'test', version: expect.version, commit: expect.commit, pid: 4 }, expect, 'test').exitCode === 0);
t('same version, different commit exits 3', id.portConflict(8687, { app: 'moonkatty-ai-studio', flavor: 'test', version: expect.version, commit: 'deadbee', pid: 4 }, expect, 'test').exitCode === 3);
t('other flavor is foreign exit 3', id.portConflict(8687, { app: 'moonkatty-ai-studio', flavor: 'prod', version: expect.version, pid: 4 }, expect, 'test').exitCode === 3);
t('no health body is foreign exit 3', id.portConflict(8687, null, expect, 'test').exitCode === 3);
t('commit missing on the listener is not a mismatch', id.classify({ app: 'moonkatty-ai-studio', flavor: 'test', version: expect.version, pid: 4 }, expect, 'test').kind === 'same');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sid-'));
t('pid file mismatch refuses', id.pidMatchesServerFile(dir, 42) === false);
fs.writeFileSync(path.join(dir, 'server.pid'), '42\n');
t('pid file match accepts', id.pidMatchesServerFile(dir, 42) === true);
t('spoofed health pid is refused', id.pidMatchesServerFile(dir, 99) === false);
fs.writeFileSync(path.join(dir, 'server.pid'), '0\n');
t('pid 0 is refused', id.pidMatchesServerFile(dir, 0) === false);

function occupy(body) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}
function boot(port, extra = {}) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sid-srv-'));
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'),
      env: { ...process.env, NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_DATA_DIR: data, HOST: '127.0.0.1', PORT: String(port), ...extra },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let err = ''; child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, err: err + '\nTIMEOUT' }); }, 25000);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, err }); });
  });
}
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const none = await occupy({ app: 'moonkatty-ai-studio', flavor: 'test', pid: 4242 });
const r1 = await boot(none.port);
none.server.close();
t('live: health without version → exit 3 and v?', r1.code === 3 && /v\?/.test(r1.err) && !/vundefined/.test(r1.err), r1.code + ' ' + r1.err.slice(-300));
const other = await occupy({ app: 'moonkatty-ai-studio', flavor: 'test', version: pkg, commit: 'not-this-build', pid: 7 });
const r2 = await boot(other.port);
other.server.close();
t('live: listener commit ignored when this build has no commit → exit 0', r2.code === 0 && /уже запущен/.test(r2.err), r2.code + ' ' + r2.err.slice(-300));
const same = await occupy({ app: 'moonkatty-ai-studio', flavor: 'test', version: pkg, pid: 8 });
const r3 = await boot(same.port);
same.server.close();
t('live: same version, no commit on either side → exit 0', r3.code === 0 && /уже запущен/.test(r3.err), r3.code + ' ' + r3.err.slice(-300));
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
