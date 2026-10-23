'use strict';
const { run } = require('./exec');
/** Measure integrated loudness (LUFS) and true peak via ffmpeg ebur128. */
async function measureLoudness(file, runFn = run) {
  const { stderr } = await runFn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = stderr.slice(stderr.lastIndexOf('Summary:'));
  const I = parseFloat((sum.match(/I:\s+(-?[\d.]+) LUFS/) || [])[1]); const TP = parseFloat((sum.match(/Peak:\s+(-?[\d.]+) dBFS/) || [])[1]);
  return { integratedLufs: I, truePeakDb: TP };
}
/** Final MP4 QA via ffprobe. Returns { ok, checks:[{name, ok, actual, expected}] , info }. */
/**
 * Pair freezedetect log lines. ffmpeg emits freeze_end only when motion resumes.
 * A span that stays frozen through the last frame has freeze_start and no freeze_end;
 * dropping it would hide a hold that runs to EOF. Threshold is unchanged (n=-60dB, d=2.5s).
 */
function parseFreezes(stderr) {
  const freezes = [];
  let open = null;
  for (const m of String(stderr).matchAll(/freeze_(start|end): ([\d.]+)/g)) {
    if (m[1] === 'start') {
      if (open) freezes.push(open);
      open = { start: +m[2], end: null };
    } else if (open) {
      open.end = +m[2];
      freezes.push(open);
      open = null;
    }
  }
  if (open) freezes.push(open);
  return freezes;
}
/** Black / frozen frame detection via ffmpeg blackdetect + freezedetect. */
async function detectVisualIssues(file, { blackMin = 0.5, freezeMin = 2.5, runFn = run } = {}) {
  const { stderr } = await runFn('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', `blackdetect=d=${blackMin}:pix_th=0.08,freezedetect=n=-60dB:d=${freezeMin}`, '-an', '-f', 'null', '-']);
  const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => ({ start: +m[1], end: +m[2] }));
  return { black, freezes: parseFreezes(stderr) };
}
async function qaVideo(file, { width, height, fps = 30, durationSec, durationTol = 0.6, vcodec = 'h264', acodec = 'aac', targetLufs = -16, lufsTol = 1.5, runFn = run, visual = false, avSyncTol = 0.1 } = {}) {
  const { stdout } = await runFn('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const info = JSON.parse(stdout); const v = info.streams.find(s => s.codec_type === 'video'); const a = info.streams.find(s => s.codec_type === 'audio');
  const dur = parseFloat(info.format.duration); const [fn, fd] = (v?.avg_frame_rate || '0/1').split('/').map(Number); const realFps = fd ? fn / fd : 0;
  const checks = [];
  const c = (name, ok, actual, expected) => checks.push({ name, ok: !!ok, actual, expected });
  c('video_stream', v, !!v, true); c('video_codec', v?.codec_name === vcodec, v?.codec_name, vcodec);
  c('resolution', v && v.width === width && v.height === height, v && `${v.width}x${v.height}`, `${width}x${height}`);
  c('fps', Math.abs(realFps - fps) < 0.5, +realFps.toFixed(2), fps);
  c('pix_fmt', v?.pix_fmt === 'yuv420p', v?.pix_fmt, 'yuv420p');
  c('audio_present', a, !!a, true); c('audio_codec', a?.codec_name === acodec, a?.codec_name, acodec);
  if (durationSec != null) c('duration', Math.abs(dur - durationSec) <= durationTol, +dur.toFixed(2), +durationSec.toFixed(2));
  if (v && a) { const vd = parseFloat(v.duration), ad = parseFloat(a.duration), vs = parseFloat(v.start_time || 0), as = parseFloat(a.start_time || 0);
    c('av_sync_start', Math.abs(vs - as) <= 0.05, +(vs - as).toFixed(3), '|Δstart| <= 0.05s'); c('av_sync_duration', Math.abs(vd - ad) <= avSyncTol, +(vd - ad).toFixed(3), `|Δdur| <= ${avSyncTol}s`); }
  if (visual) { const vi = await detectVisualIssues(file, { runFn }); c('no_black_frames', vi.black.length === 0, vi.black, 'none >= 0.5s'); c('no_frozen_frames', vi.freezes.length === 0, vi.freezes, 'none >= 2.5s'); }
  if (a) { const L = await measureLoudness(file, runFn); c('loudness_lufs', Math.abs(L.integratedLufs - targetLufs) <= lufsTol, L.integratedLufs, targetLufs); c('true_peak', L.truePeakDb <= -0.5, L.truePeakDb, '<= -0.5 dBFS'); }
  return { ok: checks.every(x => x.ok), checks, info: { durationSec: dur, fps: realFps } };
}
module.exports = { qaVideo, measureLoudness, detectVisualIssues, parseFreezes };
