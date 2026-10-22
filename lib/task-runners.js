// QA-E2E step 2: real runners for job types opencode_task and render_segment (were stubs in 1.2.0).
// Honest failures: a missing tool fails the job with a clear error; nothing is faked as success.
// Cancel = AbortController (kills the child), timeout = checkpoint.timeoutSec, resume handled by services.resume().
'use strict';
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
function realDir(f) { try { return path.dirname(fs.realpathSync(f)); } catch { return path.dirname(f); } }
function sandboxed(bin, args, { workDir, ro = [] }) {
  const roDirs = [...new Set([realDir(bin), path.dirname(bin), ...ro].filter(Boolean))];
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) {
    const rd = ['/usr', '/bin', '/sbin', '/System', '/Library/Fonts', '/private/etc/ssl', '/private/var/db/timezone', '/dev'].concat(roDirs);
    const prof = ['(version 1)', '(deny default)', '(allow process-exec process-fork signal (target same-sandbox))', '(allow sysctl-read)', '(allow file-read-metadata)',
      `(allow file-read* ${rd.map(d => `(subpath ${sbStr(d)})`).join(' ')} (subpath ${sbStr(workDir)}))`,
      `(allow file-write* (subpath ${sbStr(workDir)}) (literal "/dev/null"))`].join('');
    return { bin: '/usr/bin/sandbox-exec', args: ['-p', prof, bin, ...args], kind: 'sandbox-exec', home: workDir };
  }
  if (process.platform === 'linux' && bwrapUsable()) {
    const a = bwrapBase();
    for (const d of roDirs) if (fs.existsSync(d)) a.push('--ro-bind', d, d);
    a.push('--bind', workDir, workDir, '--chdir', workDir, '--', bin, ...args);
    return { bin: which('bwrap'), args: a, kind: 'bwrap', home: SB_HOME };
  }
  return null;
}
// Packaged build (Electron asar / resourcesPath) never honours dev/test overrides such as MK_TEST_REAL_RUNNERS.
function isPackaged(dir = __dirname) {
  try { const e = process.versions.electron && require('electron'); if (e && e.app && e.app.isPackaged) return true; } catch {}
  if (/[\\/]app\.asar([\\/]|$)/.test(dir)) return true;
  return !!(process.resourcesPath && path.resolve(dir).startsWith(path.resolve(process.resourcesPath) + path.sep));
}
function resolveOpencode() { try { return require('./opencode-serve.js').resolveBin(); } catch { return which('opencode', process.env.OPENCODE_BIN); } }
// run a child; rejects on non-zero exit, abort (cancel) or timeout. Output goes to logFile (redacted by caller if needed).
function run(bin, args, { cwd, signal, timeoutMs, logFile, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    const out = logFile ? fs.openSync(logFile, 'a') : 'ignore';
    const p = spawn(bin, args, { cwd, env: env || safeEnv(), stdio: ['ignore', out, out], detached: process.platform !== 'win32' });
    const sig = s => { try { process.kill(-p.pid, s); } catch { try { p.kill(s); } catch {} } }; // whole process group (grandchildren too)
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
// NEW-3 TOCTOU: after the realpath check open the file ourselves (O_NOFOLLOW), verify fstat dev/inode equals the checked
// file, and copy the bytes into the job workDir. ffmpeg only ever sees the private copy. Uniform error on any mismatch.
function copyConfined(p, mediaRoot, destDir, { _afterCheck } = {}) {
  const rp = confineAudio(p, mediaRoot); if (!rp) throw new Error(AUDIO_ERR);
  let st1; try { st1 = fs.lstatSync(rp); } catch { throw new Error(AUDIO_ERR); }
  if (_afterCheck) _afterCheck(rp); // test hook (race window)
  let fd; try { fd = fs.openSync(rp, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch { throw new Error(AUDIO_ERR); }
  try { const st2 = fs.fstatSync(fd); if (!st2.isFile() || st2.ino !== st1.ino || st2.dev !== st1.dev) throw new Error(AUDIO_ERR);
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
async function runOpencode({ prompt, workDir, signal, timeoutMs = 1800000, ro = [] }) {
  prompt = checkPrompt(prompt);
  const bin = resolveOpencode(); if (!bin) throw new Error('opencode not installed: команда opencode не найдена (установите OpenCode или задайте OPENCODE_BIN). Задание не выполнялось.');
  fs.mkdirSync(workDir, { recursive: true }); const logFile = path.join(workDir, 'opencode.log');
  const sb = sandboxed(bin, ['run', '--', prompt], { workDir, ro }); if (!sb) throw new Error('sandbox unavailable: opencode_task не запускается без песочницы (нужен sandbox-exec на macOS или bwrap на Linux)');
  await run(sb.bin, sb.args, { cwd: workDir, signal, timeoutMs, logFile, env: safeEnv({ HOME: sb.home, TMPDIR: sb.kind === 'bwrap' ? '/tmp' : workDir }) });
  return { logFile, sandbox: sb.kind };
}
module.exports = { which, run, safeEnv, ENV_ALLOW, sandboxed, isPackaged, copyConfined, AUDIO_ERR, confineAudio, checkPrompt, validateSegment, renderSegment, runOpencode, resolveOpencode, ASPECT };
