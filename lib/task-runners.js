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
function resolveOpencode() { try { return require('./opencode-serve.js').resolveBin(); } catch { return which('opencode', process.env.OPENCODE_BIN); } }
// run a child; rejects on non-zero exit, abort (cancel) or timeout. Output goes to logFile (redacted by caller if needed).
function run(bin, args, { cwd, signal, timeoutMs, logFile, env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
    const out = logFile ? fs.openSync(logFile, 'a') : 'ignore';
    const p = spawn(bin, args, { cwd, env: env || process.env, stdio: ['ignore', out, out] });
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
function validateSegment(i = {}) {
  const e = []; const d = Number(i.durationSec);
  if (!Number.isFinite(d) || d <= 0 || d > 600) e.push('durationSec: 0 < d ≤ 600');
  if (i.aspect != null && !ASPECT[i.aspect]) e.push('aspect: ' + Object.keys(ASPECT).join('|'));
  if (i.script != null && typeof i.script !== 'string') e.push('script: строка');
  if (i.audioPath != null && (typeof i.audioPath !== 'string' || !fs.existsSync(i.audioPath))) e.push('audioPath: файл не найден');
  if (i.engine != null && !['ffmpeg', 'blender'].includes(i.engine)) e.push('engine: ffmpeg|blender');
  return e.length ? { ok: false, errors: e } : { ok: true, input: { script: String(i.script || '').slice(0, 5000), audioPath: i.audioPath || null, durationSec: d, aspect: i.aspect || '16:9', engine: i.engine || 'ffmpeg' } };
}
// Renders a real mp4 segment with ffmpeg: background (solid colour or a Blender still), script as burnt-in text when a font exists, audio or silence.
async function renderSegment({ script = '', audioPath = null, durationSec, aspect = '16:9', outPath, stillPath = null, signal, timeoutMs = 600000 }) {
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
async function runOpencode({ prompt, workDir, signal, timeoutMs = 1800000 }) {
  const bin = resolveOpencode(); if (!bin) throw new Error('opencode not installed: команда opencode не найдена (установите OpenCode или задайте OPENCODE_BIN). Задание не выполнялось.');
  fs.mkdirSync(workDir, { recursive: true }); const logFile = path.join(workDir, 'opencode.log');
  await run(bin, ['run', String(prompt)], { cwd: workDir, signal, timeoutMs, logFile });
  return { logFile };
}
module.exports = { which, run, validateSegment, renderSegment, runOpencode, resolveOpencode, ASPECT };
