/**
 * News-launch video QC.
 *   node qa/content/video-qc.mjs --self-test [--out file.json]
 *   node qa/content/video-qc.mjs --dir <folder> [--out file.json]
 * A folder of renders: each .mp4/.mov/.webm may have a sibling .srt.
 * --self-test builds short synthetic files and checks that the gates fire.
 * It does not invent a score.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectVideo, NEWS_RESOLUTIONS } from './video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SPEC_PATH = path.join(root, 'qa/content/news-launch-spec.json');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function encode(args, dest) {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args, dest], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited ${result.status}`);
}

function specExpected(spec, srt) {
  const target = spec.loudness.integratedLUFS.target;
  const tol = spec.loudness.integratedLUFS.tolerance;
  return {
    allowedResolutions: spec.resolutions,
    minDurationSec: spec.minDurationSec,
    maxDurationSec: spec.maxDurationSec,
    requireAudio: spec.requireAudio,
    loudnessLUFS: { min: target - tol, max: target + tol },
    maxBlackFramePct: spec.maxBlackPct,
    maxFreezeSec: spec.maxFreezeSec,
    subtitleToleranceSec: spec.subtitleToleranceSec,
    srt
  };
}

function row(name, file, expected, wantPass) {
  const result = inspectVideo(file, expected);
  const pass = result.findings.length === 0;
  return {
    name,
    file: path.basename(file),
    pass,
    expectedPass: wantPass,
    ok: pass === wantPass,
    findings: result.findings.map(item => ({ kind: item.kind, summary: item.summary })),
    metrics: {
      width: result.metrics.width,
      height: result.metrics.height,
      durationSec: result.metrics.durationSec,
      integratedLUFS: result.metrics.integratedLUFS,
      loudnessRangeLU: result.metrics.loudnessRangeLU,
      truePeakDBFS: result.metrics.truePeakDBFS,
      blackPct: result.metrics.blackPct,
      freezeSec: result.metrics.freezeSec,
      subtitleCues: result.metrics.subtitleCues ?? null
    }
  };
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-news-'));
  const moving = path.join(dir, 'moving.mp4');
  const still = path.join(dir, 'still.mp4');
  const black = path.join(dir, 'black.mp4');
  const small = path.join(dir, 'small.mp4');
  encode([
    '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'
  ], moving);
  encode([
    '-f', 'lavfi', '-i', 'color=c=red:s=1920x1080:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'
  ], still);
  encode([
    '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:d=1',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'
  ], black);
  encode([
    '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'
  ], small);
  const fit = '1\n00:00:00,200 --> 00:00:01,200\nHello\n\n';
  const late = '1\n00:00:09,000 --> 00:00:10,000\nToo late\n\n';
  const measured = inspectVideo(moving, {});
  const lufs = measured.metrics.integratedLUFS;
  const around = { min: lufs - 3, max: lufs + 3 };
  const cases = [
    row('1920x1080 moving picture is an allowed raster and the SRT fits', moving, {
      allowedResolutions: NEWS_RESOLUTIONS,
      minDurationSec: 1,
      maxDurationSec: 5,
      requireAudio: true,
      loudnessLUFS: around,
      maxBlackFramePct: 0.5,
      maxFreezeSec: 0.5,
      srtText: fit,
      subtitleToleranceSec: 0.4
    }, true),
    row('static picture is frozen', still, { maxFreezeSec: 0.2 }, false),
    row('black 1080x1920 fails the black-frame limit', black, { maxBlackFramePct: 0 }, false),
    row('320x240 is not a news raster', small, { allowedResolutions: NEWS_RESOLUTIONS }, false),
    row('SRT cue past the end fails sync', moving, { srtText: late, subtitleToleranceSec: 0.4 }, false),
    row('loudness outside the measured window fails', moving, { loudnessLUFS: { min: -70, max: -60 } }, false)
  ];
  const pass = cases.filter(item => item.ok).length;
  const fail = cases.length - pass;
  return {
    contract: 'moonkatty.qa.video.self-test/1',
    mode: 'self-test',
    note: 'Synthetic files. News-launch renders were not in this run. Counts are checks, not a score.',
    newsLaunchFiles: 0,
    pass,
    fail,
    not_tested: 0,
    cases
  };
}

function scanDir(dir) {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const files = fs.readdirSync(dir).filter(name => /\.(mp4|mov|webm)$/i.test(name)).sort();
  const cases = files.map(name => {
    const file = path.join(dir, name);
    const srt = path.join(dir, name.replace(/\.(mp4|mov|webm)$/i, '.srt'));
    const result = row(name, file, specExpected(spec, fs.existsSync(srt) ? srt : undefined), true);
    if (!fs.existsSync(srt)) {
      result.findings.push({ kind: 'subtitle_missing', summary: 'No sibling SRT' });
      result.pass = false;
      result.ok = false;
    }
    return result;
  });
  return {
    contract: 'moonkatty.qa.video.news-launch-run/1',
    mode: 'news-launch',
    dir,
    spec: spec.contract,
    note: spec.note,
    newsLaunchFiles: files.length,
    pass: cases.filter(item => item.pass).length,
    fail: cases.filter(item => !item.pass).length,
    not_tested: files.length ? 0 : 1,
    cases
  };
}

const outPath = arg('--out');
let report;
if (process.argv.includes('--self-test')) report = selfTest();
else if (arg('--dir')) report = scanDir(path.resolve(arg('--dir')));
else {
  const fallback = process.env.QA_NEWS_DIR || path.join(root, 'news-launch');
  if (fs.existsSync(fallback)) report = scanDir(fallback);
  else {
    report = {
      contract: 'moonkatty.qa.video.news-launch-run/1',
      mode: 'no-artifacts',
      dir: fallback,
      note: 'No news-launch folder. Run with --self-test to exercise the checks, or pass --dir.',
      newsLaunchFiles: 0,
      pass: 0,
      fail: 0,
      not_tested: 1,
      cases: []
    };
  }
}
const text = JSON.stringify(report, null, 2);
if (outPath) {
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, text + '\n');
}
console.log(text);
const failed = report.mode === 'self-test' ? report.fail : report.fail;
process.exit(failed ? 1 : 0);
