'use strict';
const fs = require('fs');
const { execFile } = require('child_process');

function exec(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 32 << 20 }, (err, stdout, stderr) => {
      if (err) {
        err.message += `\n${String(stderr).slice(-1500)}`;
        return reject(err);
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function parsePeak(stderr) {
  const p = String(stderr).match(/True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?)\s+dBFS/);
  return p ? parseFloat(p[1]) : null;
}

/**
 * Two-pass EBU R128 loudnorm to about -14 LUFS.
 * The limiter target is -3 dBTP because AAC encoding can raise the true peak
 * after the PCM measurement. A short follow-up trim covers whatever is left.
 * Video stream is copied.
 */
async function normalizeLoudness(file) {
  const measured = await exec('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-14:TP=-3:LRA=11:print_format=json', '-f', 'null', '-']);
  const json = measured.stderr.slice(measured.stderr.lastIndexOf('{'), measured.stderr.lastIndexOf('}') + 1);
  const m = JSON.parse(json);
  if (!Number.isFinite(parseFloat(m.input_i))) throw new Error('loudnorm: input loudness is not finite');
  const af = [
    'loudnorm=I=-14:TP=-3:LRA=11',
    `measured_I=${m.input_i}`,
    `measured_TP=${m.input_tp}`,
    `measured_LRA=${m.input_lra}`,
    `measured_thresh=${m.input_thresh}`,
    `offset=${m.target_offset}`,
    'linear=true',
  ].join(':');
  const tmp = `${file}.norm.mp4`;
  await exec('ffmpeg', ['-y', '-hide_banner', '-i', file, '-c:v', 'copy', '-af', af, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmp]);
  fs.renameSync(tmp, file);
  const check = await exec('ffmpeg', ['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const peak = parsePeak(check.stderr);
  if (peak != null && peak > -1.5) {
    const trim = (peak + 1.5).toFixed(2);
    const quieter = `${file}.trim.mp4`;
    await exec('ffmpeg', ['-y', '-hide_banner', '-i', file, '-c:v', 'copy', '-af', `volume=-${trim}dB`, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', quieter]);
    fs.renameSync(quieter, file);
  }
  return file;
}

module.exports = { normalizeLoudness, exec };
