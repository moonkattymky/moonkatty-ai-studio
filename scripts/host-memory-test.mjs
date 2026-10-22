#!/usr/bin/env node
// Dashboard RAM: macOS os.freemem() is Pages free only. The snapshot must prefer vm_stat / MemAvailable and say so.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const mem = require('../lib/host-memory.js');
const res = [];
const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 240) : '')); };
const GB = 1024 ** 3;

const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                32768.
Pages active:                            800000.
Pages inactive:                          400000.
Pages speculative:                        50000.
Pages wired down:                        200000.
Pages purgeable:                          30000.
`;
const parsed = mem.parseVmStat(vm);
const pages = 32768 + 400000 + 50000 + 30000;
ok('vm_stat parser sums free+inactive+speculative+purgeable and ignores the trailing dot', parsed.found && parsed.pageSize === 16384 && parsed.bytes === pages * 16384);
const total = 16 * GB, osFree = 32768 * 16384;
const usedOs = Math.round(100 * (1 - osFree / total));
const usedVm = Math.round(100 * (1 - parsed.bytes / total));
ok('fixture that looks like ~97% via os.freemem is much lower via vm_stat', usedOs >= 95 && usedVm < 60 && usedVm < usedOs, `os ${usedOs}% vm_stat ${usedVm}%`);

const info = mem.parseMeminfo('MemTotal:       16000000 kB\nMemFree:         200000 kB\nMemAvailable:    8000000 kB\n');
ok('MemAvailable is parsed in bytes', info.available === 8000000 * 1024 && info.total === 16000000 * 1024);
ok('memory_pressure free percentage', mem.parsePressure('System-wide memory free percentage: 62%\n') === 62 && mem.parsePressure('nope') === null);

const snap = await mem.snapshot({
  platform: 'darwin', osTotal: total, osFree,
  exec: async cmd => cmd.endsWith('vm_stat') ? vm : 'System-wide memory free percentage: 62%\n',
  readFile: () => { throw new Error('not linux'); }
});
ok('darwin snapshot uses vm_stat, keeps os.freemem aside, and labels the source', snap.memSource === 'vm_stat' && snap.memAvailable === parsed.bytes && snap.memOsFree === osFree && snap.memLabel.includes('vm_stat') && snap.memPressureFreePct === 62);

const linux = await mem.snapshot({
  platform: 'linux', osTotal: total, osFree: 200000 * 1024,
  readFile: () => 'MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n',
  exec: async () => { throw new Error('no vm_stat'); }
});
ok('linux snapshot uses MemAvailable and says so', linux.memSource === 'meminfo' && linux.memAvailable === 8000000 * 1024 && linux.memLabel.includes('MemAvailable'));

const huge = await mem.snapshot({
  platform: 'darwin', osTotal: 1000, osFree: 10,
  exec: async cmd => cmd.endsWith('vm_stat') ? 'page size of 4096 bytes\nPages free: 100.\nPages inactive: 100.\nPages speculative: 100.\nPages purgeable: 100.\n' : '',
});
ok('available memory is clamped to the total', huge.memAvailable === 1000 && huge.memSource === 'vm_stat');

const down = await mem.snapshot({ platform: 'darwin', osTotal: total, osFree, exec: async () => { throw new Error('missing'); } });
ok('when vm_stat fails the label says os.freemem overstates usage', down.memSource === 'os.freemem' && down.memAvailable === osFree && /завышает/.test(down.memLabel));

mem.resetCache();
let calls = 0;
const counting = async cmd => { if (String(cmd).endsWith('vm_stat')) calls++; return cmd.endsWith('vm_stat') ? vm : 'System-wide memory free percentage: 10%\n'; };
await mem.liveSnapshot({ platform: 'darwin', osTotal: total, osFree, exec: counting, now: 1_000 });
await mem.liveSnapshot({ platform: 'darwin', osTotal: total, osFree, exec: counting, now: 2_000 });
ok('injected snapshots are not cached across calls', calls === 2);
mem.resetCache();
calls = 0;
const realish = async () => { calls++; return ''; };
await mem.liveSnapshot({ platform: 'linux', osTotal: total, osFree, readFile: () => { calls++; return 'MemAvailable: 10 kB\n'; }, now: 5_000 });
ok('a caller that supplies readFile does not poison the live cache', calls === 1 && mem.parseMeminfo);
mem.resetCache();
const cachedA = await mem.liveSnapshot();
const cachedB = await mem.liveSnapshot();
ok('live snapshot is reused inside the cache window', cachedA === cachedB && cachedA.memSource === 'meminfo' && cachedA.memLabel.includes('MemAvailable'));

const src = fs.readFileSync(new URL('../lib/host-memory.js', import.meta.url), 'utf8').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok('host memory module has no prod port, prod OpenCode URL, or keychain account literal', !/'MOONKATTY AI STUDIO|com\.moonkatty\.aistudio|\b8787\b|'opencode-server-password'|127\.0\.0\.1:4096/.test(src));
const ui = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
ok('dashboard prefers memAvailable and prints memLabel', ui.includes('memAvailable') && ui.includes('memLabel') && ui.includes('ramNote'));

const T = '/tmp/mk-mem-http-' + process.pid;
fs.rmSync(T, { recursive: true, force: true }); fs.mkdirSync(T, { recursive: true });
const PORT = 18690, B = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, HOME: T + '/home', NODE_ENV: 'test', STUDIO_FLAVOR: 'test', STUDIO_SQLITE: 'node', STUDIO_DATA_DIR: T + '/data', PORT: String(PORT), STUDIO_TEST_SECURITY_BIN: path.resolve('scripts/test-fixtures/fake-security.mjs') };
fs.mkdirSync(env.HOME, { recursive: true });
const child = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let up = false;
for (let i = 0; i < 50; i++) { try { if ((await fetch(B + '/api/health')).ok) { up = true; break; } } catch {} await sleep(200); }
ok('test server started for /api/system', up, log.slice(-200));
if (up) {
  const bare = await fetch(B + '/api/system');
  ok('system snapshot requires auth', bare.status === 401);
  const setup = await fetch(B + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ username: 'igor', password: 'fake-password-123' }) });
  const cookie = (setup.headers.get('set-cookie') || '').split(';')[0];
  const r = await fetch(B + '/api/system', { headers: { cookie } });
  const j = await r.json();
  const live = fs.readFileSync('/proc/meminfo', 'utf8');
  const expectAvail = mem.parseMeminfo(live).available;
  ok('live /api/system keeps memFree and adds a labelled available figure', r.status === 200 && j.memFree > 0 && j.memSource === 'meminfo' && j.memAvailable === expectAvail && j.memAvailable <= j.memTotal && /MemAvailable/.test(j.memLabel), JSON.stringify({ source: j.memSource, label: j.memLabel, avail: j.memAvailable, free: j.memFree }));
  ok('on this Linux host the available figure is not the raw freemem field', j.memOsFree === j.memFree && j.memSource !== 'os.freemem');
}
child.kill('SIGTERM');
await sleep(300);
const failed = res.filter(x => !x[1]).length;
console.log(`\n${res.length - failed}/${failed}`);
process.exit(failed ? 1 : 0);
