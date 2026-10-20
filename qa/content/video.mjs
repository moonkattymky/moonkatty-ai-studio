/**
 * Technical video QC via the system ffmpeg and ffprobe binaries.
 * No paid service. The caller passes the expected delivery spec.
 */
import { spawnSync } from 'node:child_process';

function run(bin, args) {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  if (result.error) {
    const error = new Error(`${bin} failed to start: ${result.error.message}`);
    error.cause = result.error;
    throw error;
  }
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

export function probeMedia(file, ffprobe = 'ffprobe') {
  const result = run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `ffprobe exited ${result.status}`);
  return JSON.parse(result.stdout);
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function aspectLabel(width, height) {
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

export function measureLoudness(file, ffmpeg = 'ffmpeg') {
  const result = run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = result.stderr.split('Summary:').pop();
  const match = summary.match(/I:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS/i);
  if (!match) return { integratedLUFS: null };
  if (match[1].toLowerCase() === '-inf' || match[1].toLowerCase() === 'inf') return { integratedLUFS: null };
  const value = Number(match[1]);
  return { integratedLUFS: Number.isFinite(value) ? value : null };
}

export function detectBlack(file, ffmpeg = 'ffmpeg') {
  const result = run(ffmpeg, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', 'blackdetect=d=0.05:pic_th=0.98:pix_th=0.10',
    '-an', '-f', 'null', '-'
  ]);
  const spans = [];
  const re = /black_start:(\S+)\s+black_end:(\S+)\s+black_duration:(\S+)/g;
  let match;
  while ((match = re.exec(result.stderr))) {
    spans.push({ start: Number(match[1]), end: Number(match[2]), duration: Number(match[3]) });
  }
  return spans;
}

function add(findings, kind, severity, summary, evidence) {
  findings.push({ kind, severity, summary, evidence });
}

/**
 * expected: { width, height, aspect, minDurationSec, maxDurationSec, requireAudio,
 *             loudnessLUFS: { min, max }, maxBlackFramePct }
 * Numbers are measured. Nothing here is a quality score.
 */
export function inspectVideo(file, expected = {}, bins = {}) {
  const ffprobe = bins.ffprobe || 'ffprobe';
  const ffmpeg = bins.ffmpeg || 'ffmpeg';
  const info = probeMedia(file, ffprobe);
  const video = (info.streams || []).find(stream => stream.codec_type === 'video') || null;
  const audio = (info.streams || []).find(stream => stream.codec_type === 'audio') || null;
  const width = video ? video.width : null;
  const height = video ? video.height : null;
  const duration = Number(info.format && info.format.duration);
  const aspect = width && height ? aspectLabel(width, height) : null;
  const loud = measureLoudness(file, ffmpeg);
  const blacks = detectBlack(file, ffmpeg);
  const blackSec = blacks.reduce((sum, span) => sum + (Number.isFinite(span.duration) ? span.duration : 0), 0);
  const blackPct = duration > 0 ? blackSec / duration : (blacks.length ? 1 : 0);
  const metrics = {
    width,
    height,
    aspect,
    durationSec: Number.isFinite(duration) ? +duration.toFixed(3) : null,
    videoCodec: video ? video.codec_name : null,
    audio: audio ? {
      codec: audio.codec_name,
      channels: audio.channels,
      sampleRate: Number(audio.sample_rate)
    } : null,
    integratedLUFS: loud.integratedLUFS,
    blackSec: +blackSec.toFixed(3),
    blackPct: +blackPct.toFixed(4),
    blackSpans: blacks
  };
  const findings = [];
  if (!video) add(findings, 'video_missing', 'blocker', 'ffprobe found no video stream', { file });
  if (expected.width != null && width !== expected.width) {
    add(findings, 'video_resolution', 'major', `Width is ${width}, expected ${expected.width}`, { width, expected: expected.width });
  }
  if (expected.height != null && height !== expected.height) {
    add(findings, 'video_resolution', 'major', `Height is ${height}, expected ${expected.height}`, { height, expected: expected.height });
  }
  if (expected.aspect && aspect !== expected.aspect) {
    add(findings, 'video_aspect', 'major', `Aspect is ${aspect}, expected ${expected.aspect}`, { aspect, expected: expected.aspect });
  }
  if (expected.minDurationSec != null && !(duration >= expected.minDurationSec)) {
    add(findings, 'video_duration', 'major', `Duration ${duration}s is below ${expected.minDurationSec}s`, { duration, min: expected.minDurationSec });
  }
  if (expected.maxDurationSec != null && !(duration <= expected.maxDurationSec)) {
    add(findings, 'video_duration', 'major', `Duration ${duration}s is above ${expected.maxDurationSec}s`, { duration, max: expected.maxDurationSec });
  }
  if (expected.requireAudio && !audio) {
    add(findings, 'audio_missing', 'major', 'Expected an audio stream and ffprobe did not find one', { file });
  }
  if (expected.loudnessLUFS) {
    const { min, max } = expected.loudnessLUFS;
    const value = loud.integratedLUFS;
    if (value == null || (min != null && value < min) || (max != null && value > max)) {
      add(findings, 'loudness', 'major', `Integrated loudness is ${value == null ? 'unmeasurable' : value + ' LUFS'}; expected ${min} to ${max} LUFS`, {
        integratedLUFS: value, min, max
      });
    }
  }
  if (expected.maxBlackFramePct != null && blackPct > expected.maxBlackFramePct) {
    add(findings, 'black_frames', 'major', `Black picture is ${(blackPct * 100).toFixed(1)}% of the duration; limit is ${(expected.maxBlackFramePct * 100).toFixed(1)}%`, {
      blackPct, blackSec, limit: expected.maxBlackFramePct
    });
  }
  return { file, metrics, findings };
}
