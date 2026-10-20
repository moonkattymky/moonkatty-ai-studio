'use strict';
const ts = sec => { const ms = Math.round(sec * 1000); const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
/** Split text into subtitle chunks of <= maxChars at sentence/word boundaries. */
function chunk(text, maxChars = 42) {
  const out = [];
  for (const sent of String(text).split(/(?<=[.!?])\s+/)) {
    let cur = '';
    for (const w of sent.split(/\s+/).filter(Boolean)) { if ((cur + ' ' + w).trim().length > maxChars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) out.push(cur);
  }
  return out;
}
/** segments: [{text, start, duration}] -> SRT; up to 2 lines per cue, timing by text length, short cues borrow time from neighbours. */
function buildSrt(segments, { maxChars = 42, minDur = 0.8 } = {}) {
  const cues = [];
  for (const s of segments) {
    const lines = chunk(s.text, maxChars); const groups = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2));
    const total = groups.reduce((a, g) => a + g.join(' ').length, 0) || 1; let t = s.start; const local = [];
    for (const g of groups) { const d = s.duration * g.join(' ').length / total; local.push({ start: t, end: t + d, text: g.join('\n') }); t += d; }
    for (let i = 0; i < local.length; i++) {
      const c = local[i]; if (c.end - c.start >= minDur) continue;
      if (i > 0 && local[i - 1].end - local[i - 1].start - (minDur - (c.end - c.start)) >= minDur) { c.start = c.end - minDur; local[i - 1].end = c.start; }
      else if (i > 0) { local[i - 1].end = c.end; local[i - 1].text = (local[i - 1].text.replace('\n', ' ') + ' ' + c.text).trim(); local.splice(i, 1); i--; }
    }
    cues.push(...local);
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
module.exports = { buildSrt, chunk, ts };
