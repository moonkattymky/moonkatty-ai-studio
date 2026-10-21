'use strict';
const { run } = require('../../../media-automation/src/video/exec');

const TARGET_LUFS = -16;

async function probeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  return parseFloat(JSON.parse(stdout).format.duration);
}

async function probeFormat(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name:format=duration,size', '-of', 'json', file]);
  return JSON.parse(stdout);
}

async function probeLoudness(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-f', 'lavfi', '-i', `amovie=${file},ebur128=peak=true:metadata=1`,
    '-show_frames', '-show_entries', 'frame_tags=lavfi.r128.I,lavfi.r128.true_peaks_ch0',
    '-of', 'json',
  ]);
  const frames = JSON.parse(stdout).frames || [];
  let integrated = null;
  let truePeak = null;
  for (const frame of frames) {
    const tags = frame.tags || {};
    if (tags['lavfi.r128.I'] != null) integrated = parseFloat(tags['lavfi.r128.I']);
    if (tags['lavfi.r128.true_peaks_ch0'] != null) {
      const linear = parseFloat(tags['lavfi.r128.true_peaks_ch0']);
      if (!(linear > 0)) continue;
      const db = linear < 20 ? 20 * Math.log10(linear) : linear;
      if (Number.isFinite(db)) truePeak = Math.max(truePeak == null ? -Infinity : truePeak, db);
    }
  }
  if (!Number.isFinite(integrated)) throw new Error(`no integrated loudness for ${file}`);
  return { integratedLufs: +integrated.toFixed(1), truePeakDb: truePeak == null ? null : +truePeak.toFixed(1) };
}

async function loudnorm(input, output) {
  const ln = `loudnorm=I=${TARGET_LUFS}:TP=-1.5:LRA=11`;
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', input, '-af', `${ln}:print_format=json`, '-f', 'null', '-']);
  const meas = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', input, '-af',
    `${ln}:measured_I=${meas.input_i}:measured_TP=${meas.input_tp}:measured_LRA=${meas.input_lra}:measured_thresh=${meas.input_thresh}:offset=${meas.target_offset}:linear=true`,
    '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
}

async function toMp3(wav, mp3) {
  await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '1', mp3]);
  let loud = await probeLoudness(mp3);
  if (Math.abs(loud.integratedLufs - TARGET_LUFS) > 0.4) {
    const gain = (TARGET_LUFS - loud.integratedLufs).toFixed(2);
    await run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', wav, '-af', `volume=${gain}dB`, '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '48000', '-ac', '1', mp3]);
    loud = await probeLoudness(mp3);
  }
  return loud;
}

async function silencedetect(file) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-']);
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]);
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map(m => ({ end: +m[1], duration: +m[2] }));
  const gaps = ends.map((e, i) => ({ start: starts[i], ...e }));
  const interior = gaps.filter(g => g.start > 0.15);
  const longest = interior.reduce((a, g) => Math.max(a, g.duration), 0);
  return { count: interior.length, longestSec: +longest.toFixed(2), gaps: interior.map(g => ({ start: +g.start.toFixed(2), duration: +g.duration.toFixed(2) })) };
}

module.exports = { TARGET_LUFS, probeDuration, probeFormat, probeLoudness, loudnorm, toMp3, silencedetect };
