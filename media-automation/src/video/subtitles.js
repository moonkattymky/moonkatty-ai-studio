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
/** segments: [{text, start, duration}] -> SRT string; timings distributed by chunk length. */
function buildSrt(segments, { maxChars = 42 } = {}) {
  const cues = [];
  for (const s of segments) {
    const parts = chunk(s.text, maxChars); const total = parts.reduce((a, p) => a + p.length, 0) || 1; let t = s.start;
    for (const p of parts) { const d = s.duration * p.length / total; cues.push({ start: t, end: t + d, text: p }); t += d; }
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
module.exports = { buildSrt, chunk, ts };
