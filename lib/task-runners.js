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
// Sandbox for opencode: darwin -> sandbox-exec (writes only in workDir, no reads of hidden dirs); linux -> bwrap
// (read-only root, hidden data dirs, writable workDir only, own pid/ipc/user ns). No sandbox -> refuse to run.
let bwrapOk = null;
function bwrapUsable() { if (bwrapOk !== null) return bwrapOk; const b = which('bwrap'); if (!b) return (bwrapOk = false);
  try { bwrapOk = require('child_process').spawnSync(b, ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-all', '--die-with-parent', '--', '/bin/true'], { timeout: 5000 }).status === 0; } catch { bwrapOk = false; } return bwrapOk; }
function sbStr(p) { return '"' + String(p).replace(/[\\"]/g, '\\$&') + '"'; }
function sandboxed(bin, args, { workDir, hide = [] }) {
  if (process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec')) {
    const prof = ['(version 1)', '(allow default)', '(deny file-write*)', `(allow file-write* (subpath ${sbStr(workDir)}) (literal "/dev/null") (literal "/dev/tty"))`]
      .concat(hide.map(h => `(deny file-read* (subpath ${sbStr(h)}))`), [`(allow file-read* (subpath ${sbStr(workDir)}))`]).join('');
    return { bin: '/usr/bin/sandbox-exec', args: ['-p', prof, bin, ...args], kind: 'sandbox-exec' };
  }
  if (process.platform === 'linux' && bwrapUsable()) {
    const a = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc'];
    for (const h of hide) if (fs.existsSync(h)) a.push('--tmpfs', h);
    a.push('--bind', workDir, workDir, '--chdir', workDir, '--unshare-all', '--share-net', '--die-with-parent', '--new-session', '--', bin, ...args);
    return { bin: which('bwrap'), args: a, kind: 'bwrap' };
  }
  return null;
}
function resolveOpencode() { try { return require('./opencode-serve.js').resolveBin(); } catch { return which('opencode', process.env.OPENCODE_BIN); } }
// run a child; rejects on non-zero exit, abort (cancel) or timeout. Output goes to logFile (redacted by caller if needed).
function run(bin, args, { cwd, signal, timeoutMs, logFile, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    const out = logFile ? fs.openSync(logFile, 'a') : 'ignore';
    const p = spawn(bin, args, { cwd, env: env || safeEnv(), stdio: ['ignore', out, out] });
    let why = null; const kill = r => { if (why) return; why = r; try { p.kill('SIGTERM'); } catch {} setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 3000).unref(); };
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
// Renders a real mp4 segment with ffmpeg: background (solid colour or a Blender still), script as burnt-in text when a font exists, audio or silence.
async function renderSegment({ script = '', audioPath = null, durationSec, aspect = '16:9', outPath, stillPath = null, signal, timeoutMs = 600000, mediaRoot = null }) {
  if (audioPath != null) { audioPath = confineAudio(audioPath, mediaRoot); if (!audioPath) throw new Error(AUDIO_ERR); } // re-checked at run time (TOCTOU)
  const ff = which('ffmpeg', process.env.FFMPEG_BIN); if (!ff) throw new Error('ffmpeg not installed: render_segment невозможен (установите ffmpeg или задайте FFMPEG_BIN)');
  const [w, h] = ASPECT[aspect] || ASPECT['16:9']; fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const txt = outPath.replace(/\.mp4$/, '') + '.script.txt'; fs.writeFileSync(txt, script);
  const font = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf', '/Library/Fonts/Arial Unicode.ttf'].find(f => fs.existsSync(f));
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (stillPath) args.push('-loop', '1', '-t', String(durationSec), '-i', stillPath); else args.push('-f', 'lavfi', '-i', `color=c=0x101018:s=${w}x${h}:d=${durationSec}:r=25`);
  if (audioPath) args.push('-i', audioPath); else args.push('-f', 'lavfi', '-t', String(durationSec), '-i', 'anullsrc=r=48000:cl=stereo');
  let vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
  if (font && script.trim()) vf += `,drawtext=fontfile=${font}:textfile=${txt}:fontcolor=white:fontsize=${Math.round(h / 20)}:x=(w-text_w)/2:y=h-text_h-${Math.round(h / 10)}:box=1:boxcolor=black@0.5`;
  args.push('-vf', vf, '-t', String(durationSec), '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', outPath);
  await run(ff, args, { signal, timeoutMs, logFile: outPath.replace(/\.mp4$/, '') + '.ffmpeg.log' });
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) throw new Error('ffmpeg не создал файл');
  return { videoPath: outPath, scriptPath: txt, textBurned: !!(font && script.trim()) };
}
function checkPrompt(prompt) { const pr = String(prompt == null ? '' : prompt).trim(); if (!pr || pr.length > 10000) throw new Error('opencode_task: prompt 1–10000 символов'); if (pr.startsWith('-')) throw new Error('opencode_task: prompt не может начинаться с "-"'); return pr; }
async function runOpencode({ prompt, workDir, signal, timeoutMs = 1800000, hide = [] }) {
  prompt = checkPrompt(prompt);
  const bin = resolveOpencode(); if (!bin) throw new Error('opencode not installed: команда opencode не найдена (установите OpenCode или задайте OPENCODE_BIN). Задание не выполнялось.');
  fs.mkdirSync(workDir, { recursive: true }); const logFile = path.join(workDir, 'opencode.log');
  const sb = sandboxed(bin, ['run', '--', prompt], { workDir, hide }); if (!sb) throw new Error('sandbox unavailable: opencode_task не запускается без песочницы (нужен sandbox-exec на macOS или bwrap на Linux)');
  await run(sb.bin, sb.args, { cwd: workDir, signal, timeoutMs, logFile, env: safeEnv({ HOME: workDir, TMPDIR: workDir }) });
  return { logFile, sandbox: sb.kind };
}
module.exports = { which, run, safeEnv, ENV_ALLOW, sandboxed, confineAudio, checkPrompt, validateSegment, renderSegment, runOpencode, resolveOpencode, ASPECT };
