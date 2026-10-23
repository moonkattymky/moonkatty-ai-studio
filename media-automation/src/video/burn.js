'use strict';
// Burn subtitles onto a picture.
// libass path uses ass=filename=… (never ass='file'). On ffmpeg builds that dropped the
// filename shorthand, ass='subs.ass' is parsed as a bare option and fails with
// "No option name near 'subs.ass'" / "Error parsing filter description" / "Invalid argument".
// When the ass filter is not compiled in, cues are drawn as SVG and overlaid with rsvg-convert.
const fs = require('fs');
const path = require('path');
const { buildAss } = require('./ass');
const { chunk } = require('./subtitles');
const G = require('./graphics');

/** Escape one filtergraph option value. No surrounding quotes — quotes made ffmpeg 7+ treat the filename as an option name. */
function escapeFilterValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/ /g, '\\ ');
}
function assFilter(filename) { return `ass=filename=${escapeFilterValue(filename)}`; }
function filtersHaveAss(text) { return /^ .{3}\s+ass\s+V->V\b/m.test(String(text)); }

async function detectSubtitleMethod(runFn, env = process.env) {
  const forced = env.MA_SUBTITLE_METHOD;
  if (forced === 'libass' || forced === 'svg') return forced;
  let text = '';
  try { const r = await runFn('ffmpeg', ['-hide_banner', '-filters']); text = (r.stdout || '') + '\n' + (r.stderr || ''); }
  catch (e) { text = String(e.stdout || '') + '\n' + String(e.stderr || '') + '\n' + String(e.message || ''); }
  return filtersHaveAss(text) ? 'libass' : 'svg';
}

const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function fitCue(text, maxChars) { return chunk(String(text || '').replace(/\n/g, ' '), maxChars).slice(0, 2).join('\n'); }
function subtitleSvg({ W, text, fontSize }) {
  const lines = String(text || ' ').split('\n').slice(0, 2);
  const h = Math.round(fontSize * (lines.length * 1.35 + 0.7));
  const sw = Math.max(2, Math.round(fontSize / 12));
  const body = lines.map((l, i) => `<text x="50%" y="${Math.round(fontSize * (1.2 + i * 1.3))}" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-weight="600" font-size="${fontSize}" fill="#ffffff" stroke="#000000" stroke-width="${sw}" paint-order="stroke fill">${xml(l)}</text>`).join('');
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}">${body}</svg>`, h };
}
function demoBannerSvg(W) {
  const h = Math.max(40, Math.round(W * 0.028));
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}"><rect width="100%" height="100%" fill="#7f1d1d"/><text x="50%" y="${Math.round(h * 0.68)}" text-anchor="middle" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-weight="700" font-size="${Math.round(h * 0.42)}" fill="#ffffff">ДЕМО · ТЕСТОВЫЕ ДАННЫЕ · ФАКТЫ НЕ ПРОВЕРЯЛИСЬ</text></svg>`, h };
}

function libassBroken(err) {
  const m = String(err && (err.message || err) || '');
  return /No option name near|No such filter: 'ass'|No such filter: 'subtitles'|Error parsing filter description/.test(m);
}

/**
 * Mux video+audio, burn cues, and attach the SRT as a mov_text track so ffprobe shows a subtitle stream.
 * Returns { method, file }.
 */
async function burnSubtitles(o) {
  const forced = o.method || ((process.env.MA_SUBTITLE_METHOD === 'libass' || process.env.MA_SUBTITLE_METHOD === 'svg') ? process.env.MA_SUBTITLE_METHOD : null);
  const method = forced || await detectSubtitleMethod(o.runFn, {}); // {} so an ambient MA_SUBTITLE_METHOD is not applied twice
  try { return await encode(o, method); }
  catch (e) {
    if (method === 'libass' && !forced && libassBroken(e)) return encode(o, 'svg');
    throw e;
  }
}

async function encode(o, method) {
  const { runFn, video, audio, out, cues = [], W, H, work, crf = 21, fps = 30, duration, srtPath, demo = false } = o;
  const vcodec = o.vcodec || 'libx264'; const presetName = o.presetName || 'medium'; const profile = o.profile || 'high';
  const abitrate = o.abitrate || '192k'; const pixfmt = o.pixfmt || 'yuv420p';
  fs.mkdirSync(work, { recursive: true });
  const maxChars = H > W ? 26 : 42;
  const fontSize = Math.round(H * (H > W ? 0.032 : 0.042));
  const margin = Math.round(H * (H > W ? 0.14 : 0.07));
  const args = ['-i', path.resolve(video), '-i', path.resolve(audio)];
  const overlays = [];
  const png = async (name, svg) => { const f = path.join(work, name + '.png'); await G.svgToPng(svg, f, runFn); return f; };
  if (demo) { const b = demoBannerSvg(W); overlays.push({ file: await png('demo-banner', b.svg), x: '(main_w-overlay_w)/2', y: '24', enable: `between(t,0,${Number(duration).toFixed(3)})` }); }
  if (method === 'svg') {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i]; if (!(c.end > c.start)) continue;
      const drawn = subtitleSvg({ W, text: fitCue(c.text, maxChars), fontSize });
      overlays.push({ file: await png('sub' + i, drawn.svg), x: '(main_w-overlay_w)/2', y: `main_h-overlay_h-${margin}`, enable: `between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})` });
    }
  } else {
    fs.writeFileSync(path.join(work, 'subs.ass'), buildAss(cues, { W, H }));
  }
  let idx = 2;
  for (const ov of overlays) args.push('-loop', '1', '-framerate', String(fps), '-i', ov.file);
  let srtIndex = null;
  if (srtPath) { srtIndex = idx + overlays.length; args.push('-i', path.resolve(srtPath)); }
  const parts = []; let last = '0:v';
  if (method === 'libass') { parts.push(`[0:v]${assFilter('subs.ass')}[va]`); last = 'va'; }
  overlays.forEach((ov, i) => {
    const lab = 'ov' + i;
    parts.push(`[${last}][${idx + i}:v]overlay=x='${ov.x}':y='${ov.y}':enable='${ov.enable}'[${lab}]`);
    last = lab;
  });
  parts.push(`[${last}]scale=out_range=tv,format=${pixfmt}[vburn]`);
  const fc = parts.join(';');
  const map = ['-map', '[vburn]', '-map', '1:a'];
  if (srtIndex != null) map.push('-map', `${srtIndex}:0`);
  await runFn('ffmpeg', ['-y', '-v', 'error', ...args, '-filter_complex', fc, ...map,
    '-c:v', vcodec, '-preset', presetName, '-crf', String(crf), '-profile:v', profile, '-pix_fmt', pixfmt, '-r', String(fps),
    '-c:a', 'aac', '-b:a', abitrate, '-ar', '48000', ...(srtIndex != null ? ['-c:s', 'mov_text'] : []),
    '-t', Number(duration).toFixed(3), '-movflags', '+faststart', path.resolve(out)], { cwd: work });
  return { method, file: path.resolve(out) };
}

module.exports = { escapeFilterValue, assFilter, filtersHaveAss, detectSubtitleMethod, burnSubtitles, fitCue, libassBroken };
