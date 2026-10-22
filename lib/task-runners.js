// QA-E2E step 2: real runners for job types opencode_task and render_segment (were stubs in 1.2.0).
// Honest failures: a missing tool fails the job with a clear error; nothing is faked as success.
// Cancel = AbortController (kills the child), timeout = checkpoint.timeoutSec, resume handled by services.resume().
'use strict';
const os = require('os');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const ASPECT = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080] };
function which(name, explicit) {
  const list = [explicit].filter(Boolean);
  for (const d of String(process.env.PATH || '').split(path.delimiter)) if (d) list.push(path.join(d, name));
  for (const p of list) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  return null;
}
// Child env allowlist: no STUDIO_SECRET_KEY, tokens, API keys or other server secrets ever reach a runner.
const ENV_ALLOW = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM', 'USER', 'LOGNAME', 'TZ'];
function safeEnv(extra = {}) { const e = {}; for (const k of ENV_ALLOW) if (process.env[k] != null) e[k] = process.env[k];
  for (const [k, v] of Object.entries(extra)) if (!/SECRET|TOKEN|KEY|PASS|COOKIE|AUTH/i.test(k)) e[k] = v; return e; }
// Sandbox (deny by default) for opencode AND ffmpeg.
// linux: bwrap with --unshare-all (no network at all, so no localhost Studio API / Ollama), empty root; only ro binds of
//   /usr, /bin, /sbin, /lib*, /etc/{ssl,fonts,ld.so.cache,alternatives}, the tool's own dir (+ extra ro dirs/files),
//   rw bind of workDir only, tmpfs /tmp and HOME (/home/sandbox), --die-with-parent, --new-session.
// darwin: sandbox-exec profile (deny default): reads only system dirs + tool dir + workDir, writes only workDir, no network.
// No usable sandbox -> null -> caller refuses to run.
const SB_HOME = '/home/sandbox';
let bwrapOk = null;
function bwrapBase() { const a = [];
  for (const d of ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/lib32', '/libx32']) { let st; try { st = fs.lstatSync(d); } catch { continue; }
    if (st.isSymbolicLink()) a.push('--symlink', fs.readlinkSync(d), d); else a.push('--ro-bind', d, d); }
  for (const e of ['/etc/ssl', '/etc/fonts', '/etc/ld.so.cache', '/etc/alternatives', '/etc/ca-certificates', '/etc/localtime']) if (fs.existsSync(e)) a.push('--ro-bind', e, e);
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', SB_HOME, '--unshare-all', '--die-with-parent', '--new-session');
  return a; }
function bwrapUsable() { if (bwrapOk !== null) return bwrapOk; const b = which('bwrap'); if (!b) return (bwrapOk = false);
  try { bwrapOk = require('child_process').spawnSync(b, [...bwrapBase(), '--', '/bin/sh', '-c', 'true'], { timeout: 5000 }).status === 0; } catch { bwrapOk = false; } return bwrapOk; }
function sbStr(p) { return '"' + String(p).replace(/[\\"]/g, '\\$&') + '"'; }
// L-1: bind the binary FILE only (plus its resolved real file). Its install dir is bound only when it is a dedicated dir
// (an ancestor whose name contains the tool name, e.g. ~/.opencode for ~/.opencode/bin/opencode) that is neither $HOME
// nor an ancestor of $HOME. A binary located directly in $HOME (or whose real file is) is refused.
const SYS_DIRS = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/System', '/opt/homebrew/Cellar', '/usr/local/Cellar'];
const inSys = f => SYS_DIRS.some(d => f === d || f.startsWith(d + '/'));
function binBinds(bin) {
  const home = path.resolve(os.homedir()); let real = bin; try { real = fs.realpathSync(bin); } catch {}
  const files = [...new Set([path.resolve(bin), real])];
  if (files.some(f => path.dirname(f) === home)) return null; // refuse binaries in the $HOME root
  const name = path.basename(real).replace(/\.[a-z]+$/i, '').toLowerCase(); let dir = null;
  for (let d = path.dirname(real); d !== path.dirname(d); d = path.dirname(d)) {
    if (d === home || home.startsWith(d + path.sep)) break;
    if (path.basename(d).replace(/^\./, '').toLowerCase().includes(name)) { dir = d; break; } }
  return { files: files.filter(f => !inSys(f)), dir: dir && !inSys(dir) ? dir : null, real };
}
// macOS profile (M-2, verified on a Mac only — see docs/media-automation/MAC_VERIFY.md + scripts/mac-sandbox-check.sh):
// no "(target same-sandbox)" filters; process-exec only for the binary's path literals; minimal mach-lookup list:
//   com.apple.system.logger (os_log/asl), com.apple.system.opendirectoryd.libinfo (getpwuid/getpwnam),
//   com.apple.system.notification_center (notify_*), com.apple.coreservices.launchservicesd is NOT granted.
// file-read-metadata only for the readable subpaths and the literal ancestors of them (path resolution).
const MAC_MACH = ['com.apple.system.logger', 'com.apple.system.opendirectoryd.libinfo', 'com.apple.system.notification_center'];
function macProfile({ execs, readDirs, readFiles, workDir }) {
  const anc = new Set(); for (const p of [...readDirs, ...readFiles, workDir]) for (let d = path.dirname(p); ; d = path.dirname(d)) { anc.add(d); if (d === path.dirname(d)) break; }
  const sp = d => `(subpath ${sbStr(d)})`, lit = f => `(literal ${sbStr(f)})`;
  return ['(version 1)', '(deny default)', '(allow process-fork)', `(allow process-exec ${execs.map(lit).join(' ')})`, '(allow signal (target self))', '(allow sysctl-read)',
    `(allow mach-lookup ${MAC_MACH.map(n => `(global-name ${sbStr(n)})`).join(' ')})`,
    `(allow file-read-metadata ${[...anc].map(lit).join(' ')} ${readDirs.map(sp).join(' ')} ${readFiles.map(lit).join(' ')} ${sp(workDir)})`,
    `(allow file-read* ${readDirs.map(sp).join(' ')} ${readFiles.map(lit).join(' ')} ${sp(workDir)})`,
    `(allow file-write* ${sp(workDir)} (literal "/dev/null"))`].join('\n');
}
function sandboxed(bin, args, { workDir, ro = [] }) {
  const bb = binBinds(bin); if (!bb) return null;
  const roDirs = [...new Set([bb.dir, ...ro].filter(Boolean))];
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) {
    const rd = ['/usr/lib', '/usr/share', '/System/Library', '/Library/Fonts', '/private/etc/ssl', '/private/var/db/timezone', '/private/var/db/dyld', '/dev'].concat(['/opt/homebrew/lib', '/opt/homebrew/Cellar', '/opt/homebrew/opt', '/usr/local/lib', '/usr/local/Cellar', '/usr/local/opt'].filter(d => fs.existsSync(d)), roDirs);
    const prof = macProfile({ execs: [...new Set([path.resolve(bin), bb.real])], readDirs: rd, readFiles: [...bb.files, '/usr/bin/sandbox-exec'].filter(f => !rd.some(d => f.startsWith(d + '/'))), workDir });
    return { bin: '/usr/bin/sandbox-exec', args: ['-p', prof, bin, ...args], kind: 'sandbox-exec', home: workDir, profile: prof };
  }
  if (process.platform === 'linux' && bwrapUsable()) {
    const a = bwrapBase();
    for (const d of roDirs) if (fs.existsSync(d)) a.push('--ro-bind', d, d);
    for (const f of bb.files) if (fs.existsSync(f) && !roDirs.some(d => f.startsWith(d + '/'))) a.push('--ro-bind', f, f);
    a.push('--bind', workDir, workDir, '--chdir', workDir, '--', bin, ...args);
    return { bin: which('bwrap'), args: a, kind: 'bwrap', home: SB_HOME };
  }
  return null;
}
// M-1: dev/test overrides (MK_TEST_REAL_RUNNERS, MK_TEST_LLM_STUB) are honoured ONLY in a source checkout. Fail closed:
// packaged = flavor baked into the bundle (FLAVOR_SOURCE==='baked', as in every built .app), OR Electron app.isPackaged, OR
// code running from app.asar / app.asar.unpacked (desktop/main.js runs Resources/app.asar.unpacked/server.js), OR under
// process.resourcesPath, OR anything unknown/erroring. Only FLAVOR_SOURCE starting with 'env' + a plain path counts as dev.
const PKG_RE = /[\\/]app\.asar(\.unpacked)?([\\/]|$)|[\\/]Contents[\\/]Resources[\\/]/i;
function isPackaged(dir = __dirname, flavorSource) {
  try {
    if (flavorSource === undefined) flavorSource = require('./studio-config.js').FLAVOR_SOURCE;
    if (!String(flavorSource || '').startsWith('env')) return true;
    try { const e = process.versions.electron && require('electron'); if (e && e.app && e.app.isPackaged) return true; } catch {}
    const d = path.resolve(String(dir)); let r = d; try { r = fs.realpathSync(d); } catch {}
    if (PKG_RE.test(d) || PKG_RE.test(r)) return true;
    if (process.resourcesPath) { const rp = path.resolve(process.resourcesPath); if ([d, r].some(x => x === rp || x.startsWith(rp + path.sep))) return true; }
    return false;
  } catch { return true; }
}
const devOverride = name => !isPackaged() && process.env.NODE_ENV === 'test' && process.env[name] === '1';
function resolveOpencode() { try { return require('./opencode-serve.js').resolveBin(); } catch { return which('opencode', process.env.OPENCODE_BIN); } }
function descendants(root) { // ps walk: pid/ppid table, BFS from root (works on Linux and macOS)
  let rows; try { rows = require('child_process').execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8', timeout: 3000 }); } catch { return []; }
  const kids = new Map(); for (const l of rows.split('\n')) { const [a, b] = l.trim().split(/\s+/).map(Number); if (a && b >= 0) { if (!kids.has(b)) kids.set(b, []); kids.get(b).push(a); } }
  const out = [], q = [root]; while (q.length) { const x = q.shift(); for (const c of kids.get(x) || []) if (!out.includes(c)) { out.push(c); q.push(c); } } return out; }
// run a child; rejects on non-zero exit, abort (cancel) or timeout. Output goes to logFile (redacted by caller if needed).
function run(bin, args, { cwd, signal, timeoutMs, logFile, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    const out = logFile ? fs.openSync(logFile, 'a') : 'ignore';
    const p = spawn(bin, args, { cwd, env: env || safeEnv(), stdio: ['ignore', out, out], detached: process.platform !== 'win32' });
    // M-2: kill the process group AND every descendant found by walking the process tree (setsid escapes the pgid on macOS).
    let known = new Set(); const sig = s => { for (const d of descendants(p.pid)) known.add(d); try { process.kill(-p.pid, s); } catch {}
      for (const d of known) { try { process.kill(d, s); } catch {} } try { p.kill(s); } catch {} };
    let why = null; const kill = r => { if (why) return; why = r; sig('SIGTERM'); setTimeout(() => sig('SIGKILL'), 3000).unref(); };
    const onAbort = () => kill('cancelled'); if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const t = timeoutMs ? setTimeout(() => kill('timeout'), timeoutMs) : null;
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); if (typeof out === 'number') fs.closeSync(out);
      if (why === 'cancelled') return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
      if (why === 'timeout') return reject(new Error(`timeout после ${Math.round(timeoutMs / 1000)} с`));
      code === 0 ? resolve() : reject(new Error(`${path.basename(bin)} завершился с кодом ${code}`)); });
  });
}
// audioPath must resolve (realpath, symlinks followed) to a regular file inside mediaRoot. One uniform error for
// missing / outside / not-a-file, so the API is not an existence oracle for arbitrary paths.
function confineAudio(p, mediaRoot) {
  if (typeof p !== 'string' || !p || !mediaRoot) return null;
  try { const root = fs.realpathSync(mediaRoot), rp = fs.realpathSync(path.resolve(root, p));
    if (!rp.startsWith(root + path.sep) || !fs.statSync(rp).isFile()) return null; return rp; } catch { return null; }
}
const AUDIO_ERR = 'audioPath: недопустимый путь (только файл внутри media/)';
function validateSegment(i = {}, mediaRoot = null) {
  const e = []; const d = Number(i.durationSec);
  if (!Number.isFinite(d) || d <= 0 || d > 600) e.push('durationSec: 0 < d ≤ 600');
  if (i.aspect != null && !ASPECT[i.aspect]) e.push('aspect: ' + Object.keys(ASPECT).join('|'));
  if (i.script != null && typeof i.script !== 'string') e.push('script: строка');
  let audio = null; if (i.audioPath != null) { audio = confineAudio(i.audioPath, mediaRoot); if (!audio) e.push(AUDIO_ERR); }
  if (i.engine != null && !['ffmpeg', 'blender'].includes(i.engine)) e.push('engine: ffmpeg|blender');
  return e.length ? { ok: false, errors: e } : { ok: true, input: { script: String(i.script || '').slice(0, 5000), audioPath: audio, durationSec: d, aspect: i.aspect || '16:9', engine: i.engine || 'ffmpeg' } };
}
// NEW-3 + L-2 TOCTOU: Node has no openat(), so emulate it: after the realpath check every path component from the media
// root down to the file is lstat'ed (must be a real dir, no symlink) and its dev/ino recorded; the file is opened with
// O_NOFOLLOW and fstat must equal the checked file; then every component is lstat'ed again and must be unchanged, and
// realpath must still be the same. A parent-dir swap (dir -> symlink) between check and open is therefore detected.
// The bytes are copied into the job workDir; ffmpeg only sees the private copy. Uniform error on any mismatch.
function chainStat(root, rp) { const out = []; let cur = root;
  for (const c of ['', ...path.relative(root, path.dirname(rp)).split(path.sep).filter(Boolean)]) { cur = c ? path.join(cur, c) : cur;
    const st = fs.lstatSync(cur); if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(AUDIO_ERR); out.push(st.dev + ':' + st.ino); }
  return out.join('/'); }
function copyConfined(p, mediaRoot, destDir, { _afterCheck } = {}) {
  const rp = confineAudio(p, mediaRoot); if (!rp) throw new Error(AUDIO_ERR);
  let root, chain, st1; try { root = fs.realpathSync(mediaRoot); chain = chainStat(root, rp); st1 = fs.lstatSync(rp); if (!st1.isFile()) throw 0; } catch { throw new Error(AUDIO_ERR); }
  if (_afterCheck) _afterCheck(rp); // test hook (race window)
  let fd; try { fd = fs.openSync(rp, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch { throw new Error(AUDIO_ERR); }
  try { const st2 = fs.fstatSync(fd); if (!st2.isFile() || st2.ino !== st1.ino || st2.dev !== st1.dev) throw new Error(AUDIO_ERR);
    try { if (chainStat(root, rp) !== chain || fs.realpathSync(rp) !== rp) throw 0; } catch { throw new Error(AUDIO_ERR); }
    const dest = path.join(destDir, 'audio' + (path.extname(rp).replace(/[^.A-Za-z0-9]/g, '').slice(0, 8) || '.bin'));
    const out = fs.openSync(dest, 'wx', 0o600); try { const buf = Buffer.allocUnsafe(1 << 16); let n, pos = 0; while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) { fs.writeSync(out, buf, 0, n); pos += n; } } finally { fs.closeSync(out); }
    return dest; } finally { fs.closeSync(fd); }
}
// Renders a real mp4 segment with ffmpeg inside the same deny-by-default sandbox: background (solid colour or a Blender
// still), script as burnt-in text when a font exists, audio (private copy) or silence.
async function renderSegment({ script = '', audioPath = null, durationSec, aspect = '16:9', outPath, stillPath = null, signal, timeoutMs = 600000, mediaRoot = null }) {
  const ff = which('ffmpeg', process.env.FFMPEG_BIN); if (!ff) throw new Error('ffmpeg not installed: render_segment невозможен (установите ffmpeg или задайте FFMPEG_BIN)');
  const [w, h] = ASPECT[aspect] || ASPECT['16:9']; fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const wd = outPath.replace(/\.mp4$/, '') + '.work'; fs.rmSync(wd, { recursive: true, force: true }); fs.mkdirSync(wd, { recursive: true, mode: 0o700 });
  const audio = audioPath != null ? copyConfined(audioPath, mediaRoot, wd) : null;
  let still = null; if (stillPath) { still = path.join(wd, 'still.png'); fs.copyFileSync(stillPath, still); }
  const txt = path.join(wd, 'script.txt'); fs.writeFileSync(txt, script); const tmpOut = path.join(wd, 'out.mp4');
  const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf'].find(f => fs.existsSync(f));
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (still) args.push('-loop', '1', '-t', String(durationSec), '-i', still); else args.push('-f', 'lavfi', '-i', `color=c=0x101018:s=${w}x${h}:d=${durationSec}:r=25`);
  if (audio) args.push('-i', audio); else args.push('-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=r=48000:cl=stereo');
  let vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
  if (font && script.trim()) vf += `,drawtext=fontfile=${font}:textfile=${txt}:fontcolor=white:fontsize=${Math.round(h / 20)}:x=(w-text_w)/2:y=h-text_h-${Math.round(h / 10)}:box=1:boxcolor=black@0.5`;
  args.push('-vf', vf, '-t', String(durationSec), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', tmpOut);
  const sb = sandboxed(ff, args, { workDir: wd, ro: font ? [path.dirname(font)] : [] }); if (!sb) throw new Error('sandbox unavailable: render_segment не запускается без песочницы (нужен sandbox-exec на macOS или bwrap на Linux)');
  await run(sb.bin, sb.args, { cwd: wd, signal, timeoutMs, logFile: outPath.replace(/\.mp4$/, '') + '.ffmpeg.log', env: safeEnv({ HOME: sb.home, TMPDIR: wd }) });
  if (!fs.existsSync(tmpOut) || fs.statSync(tmpOut).size === 0) throw new Error('ffmpeg не создал файл');
  fs.renameSync(tmpOut, outPath); fs.copyFileSync(txt, outPath.replace(/\.mp4$/, '') + '.script.txt'); fs.rmSync(wd, { recursive: true, force: true });
  return { videoPath: outPath, scriptPath: outPath.replace(/\.mp4$/, '') + '.script.txt', textBurned: !!(font && script.trim()), sandbox: sb.kind };
}
function checkPrompt(prompt) { const pr = String(prompt == null ? '' : prompt).trim(); if (!pr || pr.length > 10000) throw new Error('opencode_task: prompt 1–10000 символов'); if (pr.startsWith('-')) throw new Error('opencode_task: prompt не может начинаться с "-"'); return pr; }
// opencode needs an LLM (Ollama). The sandbox has NO network (--unshare-all / deny network*), and no allowed channel
// (e.g. a filtered Ollama proxy socket bound into the sandbox) exists yet, so the job fails fast with 'llm_unavailable'
// instead of hanging until the timeout while holding the heavy lock. Test-only stub: MK_TEST_LLM_STUB=1 (dev checkout only).
function llmChannel() { if (devOverride('MK_TEST_LLM_STUB')) return { kind: 'test-stub' }; return null; }
async function runOpencode({ prompt, workDir, signal, timeoutMs = 1800000, ro = [] }) {
  prompt = checkPrompt(prompt);
  const bin = resolveOpencode(); if (!bin) throw new Error('opencode not installed: команда opencode не найдена (установите OpenCode или задайте OPENCODE_BIN). Задание не выполнялось.');
  if (!llmChannel()) throw Object.assign(new Error('llm_unavailable: нет разрешённого канала к Ollama/LLM из песочницы (сеть отключена). Задание не выполнялось.'), { code: 'llm_unavailable' });
  fs.mkdirSync(workDir, { recursive: true }); const logFile = path.join(workDir, 'opencode.log');
  const sb = sandboxed(bin, ['run', '--', prompt], { workDir, ro }); if (!sb) throw new Error('sandbox unavailable: opencode_task не запускается без песочницы (нужен sandbox-exec на macOS или bwrap на Linux)');
  await run(sb.bin, sb.args, { cwd: workDir, signal, timeoutMs, logFile, env: safeEnv({ HOME: sb.home, TMPDIR: sb.kind === 'bwrap' ? '/tmp' : workDir }) });
  return { logFile, sandbox: sb.kind };
}
module.exports = { llmChannel, descendants, binBinds, macProfile, devOverride, which, run, safeEnv, ENV_ALLOW, sandboxed, isPackaged, copyConfined, AUDIO_ERR, confineAudio, checkPrompt, validateSegment, renderSegment, runOpencode, resolveOpencode, ASPECT };
