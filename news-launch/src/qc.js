'use strict';
const fs = require('fs');
const { exec } = require('./loudness');
const { assertSchema, SCHEMAS } = require('./schemas');

function parseEbur(stderr) {
  const i = stderr.match(/Integrated loudness:\s+I:\s+(-?\d+(?:\.\d+)?)\s+LUFS/);
  const p = stderr.match(/True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/);
  return {
    loudnessLUFS: i ? parseFloat(i[1]) : null,
    truePeakDb: p ? parseFloat(p[1]) : null,
  };
}

function subtitleCues(file) {
  if (!file || !fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split(/\n\s*\n/).filter(b => /-->/.test(b)).length;
}

async function qcFile(file, {
  expectWidth, expectHeight, minDuration = 30, maxDuration = 60, subtitleFile, now = () => new Date().toISOString(),
} = {}) {
  const probe = JSON.parse((await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])).stdout);
  const video = (probe.streams || []).find(s => s.codec_type === 'video');
  const audio = (probe.streams || []).find(s => s.codec_type === 'audio');
  const black = await exec('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'blackdetect=d=0.10:pic_th=0.98:pix_th=0.10', '-an', '-f', 'null', '-']);
  const blackFrames = [...black.stderr.matchAll(/black_start:[\d.]+ black_end:[\d.]+ black_duration:[\d.]+/g)].map(m => m[0]);
  const loud = await exec('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const { loudnessLUFS, truePeakDb } = parseEbur(loud.stderr);
  const durationSec = probe.format && probe.format.duration ? parseFloat(probe.format.duration) : NaN;
  const failures = [];
  if (!video) failures.push('no video stream');
  if (!audio) failures.push('no audio stream');
  if (video && expectWidth && video.width !== expectWidth) failures.push(`width ${video.width} != ${expectWidth}`);
  if (video && expectHeight && video.height !== expectHeight) failures.push(`height ${video.height} != ${expectHeight}`);
  if (video && video.codec_name !== 'h264') failures.push(`video codec ${video && video.codec_name}`);
  if (audio && audio.codec_name !== 'aac') failures.push(`audio codec ${audio && audio.codec_name}`);
  if (!(durationSec >= minDuration && durationSec <= maxDuration)) failures.push(`duration ${durationSec}s outside ${minDuration}-${maxDuration}`);
  if (loudnessLUFS == null || loudnessLUFS < -16 || loudnessLUFS > -12) failures.push(`loudness ${loudnessLUFS} LUFS, target about -14`);
  const clipping = truePeakDb == null || truePeakDb > -1.0;
  if (clipping) failures.push(`true peak ${truePeakDb} dBTP`);
  if (blackFrames.length) failures.push(`black frames: ${blackFrames.length}`);
  const cues = subtitleCues(subtitleFile);
  if (subtitleFile && cues < 1) failures.push('subtitles missing');
  const result = {
    file, ok: failures.length === 0,
    width: video ? video.width : 0, height: video ? video.height : 0,
    durationSec, videoCodec: video ? video.codec_name : '', audioCodec: audio ? audio.codec_name : '',
    audioPresent: !!audio, loudnessLUFS, truePeakDb, clipping, blackFrames,
    subtitleFile: subtitleFile || '', subtitleCues: cues, failures, checkedAt: now(),
  };
  return assertSchema(result, SCHEMAS.qc, 'QcResult');
}

module.exports = { qcFile, parseEbur, subtitleCues };
