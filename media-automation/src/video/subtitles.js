'use strict';
const ts = sec => { const ms = Math.round(sec * 1000); const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
/** S5-NV-01: hard-split a single token longer than max (URLs, hashtags, compound/Cyrillic words) into pieces <= max code points.
 *  Prefers natural break points (/ - _ . ? & = # :) in the second half of the window, otherwise cuts at max-1 and adds '-'. */
function hardSplit(word, max) {
  const cs = Array.from(String(word)); if (max < 2 || cs.length <= max) return [String(word)];
  const out = []; let i = 0;
  while (cs.length - i > max) { let cut = -1;
    for (let k = i + max - 1; k > i + Math.floor(max / 2); k--) if ('/-_.?&=#:'.includes(cs[k])) { cut = k + 1; break; }
    if (cut > 0) { out.push(cs.slice(i, cut).join('')); i = cut; } else { out.push(cs.slice(i, i + max - 1).join('') + '-'); i += max - 1; } }
  out.push(cs.slice(i).join('')); return out; }
const splitWords = (text, max) => String(text).split(/\s+/).filter(Boolean).flatMap(w => hardSplit(w, max));
/** Split text into subtitle chunks of <= maxChars at sentence/word boundaries. */
function chunk(text, maxChars = 42) {
  const out = [];
  for (const sent of String(text).split(/(?<=[.!?])\s+/)) {
    let cur = '';
    for (const w of splitWords(sent, maxChars)) { if ((cur + ' ' + w).trim().length > maxChars && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) out.push(cur);
  }
  return out;
}
/** segments: [{text, start, duration}] -> SRT; up to 2 lines per cue, timing by text length, short cues borrow time from neighbours. */
function buildSrt(segments, { maxChars = 42, minDur = 0.8, maxDur = 6.5 } = {}) {
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
    for (let i = 0; i < local.length; i++) { const c = local[i]; const ls = c.text.split('\n');
      if (c.end - c.start > maxDur && ls.length === 2) { const tot = ls[0].length + ls[1].length; const mid = c.start + (c.end - c.start) * ls[0].length / tot;
        local.splice(i, 1, { start: c.start, end: mid, text: ls[0] }, { start: mid, end: c.end, text: ls[1] }); } }
    // QA-NV-006: any cue still longer than maxDur (slow speech, few words, merged short cue) is split into equal-time
    // parts at word boundaries; a single word is capped at maxDur (a gap is valid SRT). Never fail the render on length.
    for (let i = 0; i < local.length; i++) { const c = local[i], d = c.end - c.start; if (d <= maxDur) continue;
      const words = c.text.replace(/\n/g, ' ').split(/\s+/).filter(Boolean); const n = Math.ceil(d / maxDur);
      if (words.length < 2) { c.end = c.start + maxDur; continue; }
      const k = Math.min(n, words.length), per = d / k, parts = [];
      for (let j = 0; j < k; j++) { const ws = words.slice(Math.round(j * words.length / k), Math.round((j + 1) * words.length / k));
        parts.push({ start: c.start + j * per, end: c.start + (j + 1) * per, text: chunk(ws.join(' '), maxChars).slice(0, 2).join('\n') }); }
      if (k < n) parts.forEach(p => { p.end = Math.min(p.end, p.start + maxDur); });
      local.splice(i, 1, ...parts); i += parts.length - 1; }
    cues.push(...local);
  }
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
module.exports = { buildSrt, chunk, ts, hardSplit, splitWords };
