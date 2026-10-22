/**
 * Technical video QC via the system ffmpeg and ffprobe binaries.
 * No paid service. The caller passes the expected delivery spec.
 * Counts and LUFS values are measurements. Nothing here is a quality score.
 */
import fs from 'node:fs';
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

function lufs(text) {
  if (!text || /inf/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function measureLoudness(file, ffmpeg = 'ffmpeg') {
  const result = run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = result.stderr.split('Summary:').pop();
  const integrated = summary.match(/I:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS/i);
  const range = summary.match(/LRA:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+LU/i);
  const peak = summary.match(/Peak:\s*(-?(?:\d+(?:\.\d+)?|inf))\s+dBFS/i);
  return {
    standard: 'EBU R128',
    integratedLUFS: integrated ? lufs(integrated[1]) : null,
    loudnessRangeLU: range ? lufs(range[1]) : null,
    truePeakDBFS: peak ? lufs(peak[1]) : null
  };
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

export function detectFreeze(file, ffmpeg = 'ffmpeg') {
  const result = run(ffmpeg, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', 'freezedetect=n=0.003:d=0.5',
    '-an', '-f', 'null', '-'
  ]);
  const grab = name => [...result.stderr.matchAll(new RegExp(name + ':\\s*(\\S+)', 'g'))].map(item => Number(item[1]));
  const starts = grab('freeze_start');
  const ends = grab('freeze_end');
  const durations = grab('freeze_duration');
  const n = Math.max(starts.length, ends.length, durations.length);
  const spans = [];
  for (let i = 0; i < n; i++) {
    spans.push({
      start: Number.isFinite(starts[i]) ? starts[i] : null,
      end: Number.isFinite(ends[i]) ? ends[i] : null,
      duration: Number.isFinite(durations[i]) ? durations[i] : null
    });
  }
  return spans;
}

function srtClock(h, m, s, ms) {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(String(ms).padEnd(3, '0')) / 1000;
}

export function parseSrt(text) {
  const src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!src) return [];
  const cues = [];
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n');
    let i = 0;
    if (/^\d+$/.test((lines[0] || '').trim())) i = 1;
    const timing = (lines[i] || '').trim();
    const match = timing.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{1,3})/);
    if (!match) continue;
    cues.push({
      start: srtClock(match[1], match[2], match[3], match[4]),
      end: srtClock(match[5], match[6], match[7], match[8]),
      text: lines.slice(i + 1).join('\n').trim()
    });
  }
  return cues;
}

export const NEWS_RESOLUTIONS = Object.freeze([
  Object.freeze({ width: 1080, height: 1920 }),
  Object.freeze({ width: 1920, height: 1080 })
]);

export function resolutionAllowed(width, height, allowed = NEWS_RESOLUTIONS) {
  return allowed.some(item => item.width === width && item.height === height);
}

export function subtitleFindings(cues, durationSec, toleranceSec) {
  const findings = [];
  const tol = Number(toleranceSec) || 0;
  if (!cues.length) {
    findings.push({ kind: 'subtitle_missing', severity: 'major', summary: 'SRT has no cues', evidence: {} });
    return findings;
  }
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!(cue.end > cue.start)) {
      findings.push({ kind: 'subtitle_sync', severity: 'major', summary: `Cue ${i + 1} ends at or before it starts`, evidence: cue });
    }
    if (cue.start < -tol || (Number.isFinite(durationSec) && cue.end > durationSec + tol)) {
      findings.push({
        kind: 'subtitle_sync',
        severity: 'major',
        summary: `Cue ${i + 1} (${cue.start.toFixed(3)}–${cue.end.toFixed(3)}s) falls outside the media duration ${durationSec}s`,
        evidence: { cue, durationSec, toleranceSec: tol }
      });
    }
    if (!cue.text) {
      findings.push({ kind: 'subtitle_empty', severity: 'minor', summary: `Cue ${i + 1} has no text`, evidence: cue });
    }
    const next = cues[i + 1];
    if (next && cue.end - next.start > tol) {
      findings.push({ kind: 'subtitle_sync', severity: 'major', summary: `Cue ${i + 1} overlaps the next cue`, evidence: { cue, next } });
    }
  }
  return findings;
}

function freezeSpanSec(span, durationSec) {
  if (Number.isFinite(span.duration)) return span.duration;
  if (Number.isFinite(span.start) && Number.isFinite(span.end)) return Math.max(0, span.end - span.start);
  // ffmpeg 6 prints freeze_start and omits freeze_end when the freeze runs to EOF.
  if (Number.isFinite(span.start) && Number.isFinite(durationSec)) return Math.max(0, durationSec - span.start);
  return 0;
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
  const freezes = expected.maxFreezeSec != null ? detectFreeze(file, ffmpeg) : [];
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
    loudnessRangeLU: loud.loudnessRangeLU,
    truePeakDBFS: loud.truePeakDBFS,
    loudnessStandard: loud.standard,
    blackSec: +blackSec.toFixed(3),
    blackPct: +blackPct.toFixed(4),
    blackSpans: blacks,
    freezeSec: +freezes.reduce((sum, span) => sum + freezeSpanSec(span, duration), 0).toFixed(3),
    freezeSpans: freezes
  };
  const findings = [];
  if (!video) add(findings, 'video_missing', 'blocker', 'ffprobe found no video stream', { file });
  if (Array.isArray(expected.allowedResolutions) && expected.allowedResolutions.length && !resolutionAllowed(width, height, expected.allowedResolutions)) {
    const list = expected.allowedResolutions.map(item => `${item.width}x${item.height}`).join(' or ');
    add(findings, 'video_resolution', 'major', `Raster is ${width}x${height}; allowed ${list}`, { width, height, allowed: expected.allowedResolutions });
  }
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
  if (expected.maxFreezeSec != null) {
    const freezeSec = metrics.freezeSec;
    if (freezeSec > expected.maxFreezeSec) {
      add(findings, 'frozen_frames', 'major', `Frozen picture lasts ${freezeSec}s; limit is ${expected.maxFreezeSec}s`, { freezeSec, limit: expected.maxFreezeSec, spans: freezes });
    }
  }
  if (expected.srt || expected.srtText) {
    const srtText = expected.srtText != null ? expected.srtText : fs.readFileSync(expected.srt, 'utf8');
    const cues = parseSrt(srtText);
    metrics.subtitleCues = cues.length;
    for (const item of subtitleFindings(cues, metrics.durationSec, expected.subtitleToleranceSec ?? 0.4)) findings.push(item);
  }
  return { file, metrics, findings };
}
