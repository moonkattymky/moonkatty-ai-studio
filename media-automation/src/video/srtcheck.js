'use strict';
const toSec = t => { const m = t.match(/(\d+):(\d+):(\d+),(\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : NaN; };
function parseSrt(srt) {
  return String(srt).trim().split(/\n\s*\n/).filter(Boolean).map(b => { const l = b.split('\n'); const [a, z] = (l[1] || '').split(' --> ');
    return { index: +l[0], start: toSec(a || ''), end: toSec(z || ''), lines: l.slice(2) }; });
}
/** Validate subtitles: numbering, timing order, no overlaps, min/max duration, line length, max lines, within video duration. */
function validateSrt(srt, { maxChars = 42, maxLines = 2, minDur = 0.6, maxDur = 7.5, totalSec = Infinity } = {}) {
  const cues = parseSrt(srt); const errors = [];
  if (!cues.length) errors.push('no cues');
  cues.forEach((c, i) => {
    const id = `cue ${i + 1}`;
    if (c.index !== i + 1) errors.push(`${id}: bad index ${c.index}`);
    if (!(c.end > c.start)) errors.push(`${id}: end <= start`);
    const d = c.end - c.start; if (d < minDur) errors.push(`${id}: too short ${d.toFixed(2)}s`); if (d > maxDur) errors.push(`${id}: too long ${d.toFixed(2)}s`);
    if (i && c.start < cues[i - 1].end - 1e-3) errors.push(`${id}: overlaps previous`);
    if (c.end > totalSec + 0.05) errors.push(`${id}: beyond video end`);
    if (c.lines.length > maxLines) errors.push(`${id}: ${c.lines.length} lines`);
    c.lines.forEach(l => { if (l.length > maxChars) errors.push(`${id}: line ${l.length} chars > ${maxChars}`); });
    if (!c.lines.join('').trim()) errors.push(`${id}: empty text`);
  });
  return { ok: errors.length === 0, errors, cues: cues.length };
}
module.exports = { parseSrt, validateSrt };
