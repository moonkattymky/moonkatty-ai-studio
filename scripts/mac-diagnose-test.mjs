#!/usr/bin/env node
// The diagnose script is read-only: it must not print secrets, read a keychain file, or stop a process.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
const res = [];
const ok = (n, c, x = '') => { res.push([n, !!c]); console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + String(x).slice(0, 300) : '')); };
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sh = fs.readFileSync(path.join(root, 'scripts/mac-diagnose.sh'), 'utf8');
const cmd = fs.readFileSync(path.join(root, 'scripts/mac-diagnose.command'), 'utf8');
ok('command file execs the shell script beside it', cmd.startsWith('#!/bin/bash') && cmd.includes('mac-diagnose.sh') && /exec \/bin\/bash/.test(cmd));
ok('script source does not stop processes, call the keychain tool, or delete files', !/\b(kill|pkill|security|launchctl)\b/.test(sh) && !/defaults write/.test(sh) && !/\brm\b/.test(sh));

const T = '/tmp/mk-diag-' + process.pid;
fs.rmSync(T, { recursive: true, force: true });
const home = path.join(T, 'home');
const bin = path.join(T, 'bin');
const desk = path.join(home, 'Desktop');
const data = path.join(home, 'Library/Application Support/MOONKATTY AI STUDIO TEST');
const backups = path.join(data, 'backups');
const keys = path.join(home, 'Library/Keychains');
fs.mkdirSync(desk, { recursive: true });
fs.mkdirSync(backups, { recursive: true });
fs.mkdirSync(keys, { recursive: true });
fs.mkdirSync(bin, { recursive: true });
const ENVSECRET = 'ENVSECRETVALUE-do-not-print';
const FILESECRET = 'FILECONTENTSECRET-do-not-print';
const NAMESECRET = 'BACKUPNAMESECRET';
fs.writeFileSync(path.join(backups, `backup-${NAMESECRET}.json`), FILESECRET, { mode: 0o600 });
const keyFile = path.join(keys, 'login.keychain-db');
fs.writeFileSync(keyFile, 'KEYCHAINSECRET-do-not-print', { mode: 0o600 });
const keyBefore = fs.statSync(keyFile).mtimeMs;
const marker = path.join(T, 'killed');

const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
stub('vm_stat', `echo 'Mach Virtual Memory Statistics: (page size of 16384 bytes)'
echo 'Pages free: 1000.'
echo 'Pages inactive: 2000.'
echo 'Swapins: 3.'
echo 'Swapouts: 4.'`);
stub('memory_pressure', `echo 'System-wide memory free percentage: 71%'
echo 'The system has 2 swap files'`);
stub('uptime', `echo 'load averages: 0.20 0.10 0.05'`);
stub('ps', `echo '  11  12000  0.4 ollama'
echo '  12  8000  0.2 opencode'
echo '  13  9000  1.1 Blender'
echo '  14  7000  0.3 MOONKATTY'
echo '  15  1000  0.0 unrelated'`);
stub('df', `echo 'Filesystem Size Used Avail Capacity'
echo '/dev/disk1 200Gi 80Gi 120Gi 40%'`);
stub('lsof', `port=''
for a in "$@"; do case "$a" in -iTCP:*) port=\${a#-iTCP:} ;; esac; done
if [ "$port" = "8687" ]; then echo "node 4242 ubuntu 15u IPv4 TCP 127.0.0.1:8687 (LISTEN)"; exit 0; fi
exit 1`);
stub('curl', `url=''
for a in "$@"; do case "$a" in http://*) url="$a" ;; esac; done
case "$url" in
  *127.0.0.1:4097/global/health|*127.0.0.1:4097/session) echo 401 ;;
  *127.0.0.1:8687/api/health) echo 200 ;;
  *) echo 000 ;;
esac`);
stub('tailscale', `echo '{"BackendState":"Running","AuthKey":"${ENVSECRET}","Peer":{"x":"y"}}'`);
stub('security', `echo SECRET_FROM_SECURITY > '${marker}'`);
stub('kill', `echo killed > '${marker}'`);
stub('pkill', `echo killed > '${marker}'`);

const out = path.join(T, 'report.txt');
const run = spawnSync('/bin/bash', [path.join(root, 'scripts/mac-diagnose.command')], {
  env: { ...process.env, HOME: home, MK_DIAG_OUT: out, MK_DIAG_PATH_PREFIX: bin, OPENCODE_SERVER_PASSWORD: ENVSECRET, PATH: bin + ':/usr/bin:/bin' },
  encoding: 'utf8'
});
ok('command exits 0 and names the report', run.status === 0 && fs.existsSync(out), run.stderr || run.stdout);
const report = fs.readFileSync(out, 'utf8');
ok('report has vm_stat, swap, memory_pressure, load, processes and free disk', /Pages free: 1000/.test(report) && /Swapins: 3/.test(report) && /free percentage: 71%/.test(report) && /load averages/.test(report) && /ollama/.test(report) && /opencode/.test(report) && /Blender/.test(report) && /MOONKATTY/.test(report) && /120Gi/.test(report) && !/unrelated/.test(report));
ok('ports and unauthenticated 4097 are status codes only', /8687/.test(report) && /8787/.test(report) && /4096/.test(report) && /4097\/global\/health no Authorization -> 401/.test(report) && /reject: да \(401\)/.test(report) && /8687\/api\/health -> 200/.test(report));
ok('tailscale up is reported without the status payload', /BackendState: Running/.test(report) && /status: up/.test(report) && !/AuthKey/.test(report) && !/"Peer"/.test(report));
ok('test data dir and backup count are present', /data dir: существует/.test(report) && /файлов 1/.test(report));
ok('secrets from the environment, backup contents, backup name and keychain are absent', ![ENVSECRET, FILESECRET, NAMESECRET, 'KEYCHAINSECRET', 'SECRET_FROM_SECURITY'].some(s => report.includes(s)));
ok('keychain file was not touched and nothing was stopped', fs.statSync(keyFile).mtimeMs === keyBefore && !fs.existsSync(marker));
const extra = fs.readdirSync(home).filter(n => !['Desktop', 'Library'].includes(n));
ok('home gained no files besides the requested report path', extra.length === 0, extra.join(','));

const failed = res.filter(x => !x[1]).length;
console.log(`\n${res.length - failed}/${failed}`);
process.exit(failed ? 1 : 0);
