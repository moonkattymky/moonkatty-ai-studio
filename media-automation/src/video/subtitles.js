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
/** segments: [{text, start, duration}] -> SRT; up to 2 lines per cue, timing by text length, short cues fixed by normalizeCues (borrow time / merge). */
function buildSrt(segments, { maxChars = 42, minDur = 0.8, maxDur = 6.5 } = {}) {
  const cues = [];
  for (const s of segments) {
    const lines = chunk(s.text, maxChars); const groups = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2));
    const total = groups.reduce((a, g) => a + g.join(' ').length, 0) || 1; let t = s.start; const local = [];
    for (const g of groups) { const d = s.duration * g.join(' ').length / total; local.push({ start: t, end: t + d, text: g.join('\n') }); t += d; }
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
  // F-1: short cues (e.g. pieces of a hard-split long word) are fixed over the WHOLE timeline (borrow / merge), not per segment.
  const end = segments.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
  return normalizeCues(cues, { minDur, maxChars, totalStart: segments.length ? Math.min(...segments.map(s => s.start)) : 0, totalEnd: end }).map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
/** F-1: make every cue >= minDur without overlaps. Order of remedies for a short cue:
 *  1) grow into the free gap after it (up to the next cue / totalEnd), then before it (down to the previous cue / totalStart);
 *  2) borrow from a growing window of neighbours: their surplus over minDur and the gaps inside the window are shrunk
 *     proportionally, the window span stays fixed (so nothing outside moves, no overlap, donors never drop below minDur);
 *  3) if even the whole timeline cannot give enough, merge with a neighbour whose merged text still fits maxLines × maxChars
 *     (word timings for karaoke are concatenated) and retry. Cues are {start,end,text[,words][,style]}; returns a new array. */
function normalizeCues(input, { minDur = 0.8, maxChars = 42, maxLines = 2, totalStart = 0, totalEnd = Infinity } = {}) {
  const cues = input.map(c => ({ ...c })).sort((a, b) => a.start - b.start); const EPS = 1e-6;
  const fitLines = text => chunk(String(text).replace(/\n/g, ' '), maxChars);
  const merge = (a, b) => { const lines = fitLines(a.text + ' ' + b.text); if (lines.length > maxLines) return null;
    const m = { ...a, start: Math.min(a.start, b.start), end: Math.max(a.end, b.end), text: lines.join('\n') };
    if (a.words || b.words) { const ws = [...(a.words || []).flat(), ...(b.words || []).flat()]; const L = [[]];
      for (const w of ws) { const l = L[L.length - 1]; if (l.length && [...l, w].map(x => x.w).join(' ').length > maxChars) L.push([w]); else l.push(w); } m.words = L; }
    return m; };
  for (let guard = 0, i = 0; i < cues.length && guard < 10000; guard++) {
    const c = cues[i]; let need = minDur - (c.end - c.start); if (need <= EPS) { i++; continue; }
    const nextStart = i < cues.length - 1 ? cues[i + 1].start : totalEnd, prevEnd = i > 0 ? cues[i - 1].end : totalStart;
    let take = Math.max(0, Math.min(need, nextStart - c.end)); c.end += take; need -= take;
    take = Math.max(0, Math.min(need, c.start - prevEnd)); c.start -= take; need -= take;
    if (need <= EPS) { i++; continue; }
    let done = false;
    for (let w = 1; !done && (i - w >= 0 || i + w < cues.length); w++) {
      const a = Math.max(0, i - w), b = Math.min(cues.length - 1, i + w); const items = [];
      for (let j = a; j <= b; j++) { if (j > a) items.push({ gap: true, len: Math.max(0, cues[j].start - cues[j - 1].end), floor: 0 });
        items.push({ j, len: cues[j].end - cues[j].start, floor: j === i ? Infinity : minDur }); }
      const S = items.reduce((s, x) => s + (x.floor === Infinity ? 0 : Math.max(0, x.len - x.floor)), 0); if (S + EPS < need) continue;
      let t = cues[a].start; for (const x of items) { const len = x.floor === Infinity ? x.len + need : x.len - need * Math.max(0, x.len - x.floor) / S;
        if (!x.gap) { cues[x.j].start = t; cues[x.j].end = t + len; } t += len; }
      done = true; }
    if (done) { i++; continue; }
    // whole timeline too tight → merge with the neighbour that fits (prefer the shorter one)
    const opts = [i > 0 ? [i - 1, merge(cues[i - 1], c)] : null, i < cues.length - 1 ? [i + 1, merge(c, cues[i + 1])] : null].filter(o => o && o[1])
      .sort((x, y) => (cues[x[0]].end - cues[x[0]].start) - (cues[y[0]].end - cues[y[0]].start));
    if (!opts.length) { i++; continue; } // cannot fix without breaking line limits; validateSrt reports it
    const [k, m] = opts[0]; cues.splice(Math.min(i, k), 2, m); i = Math.max(0, Math.min(i, k) - 1); }
  return cues;
}
module.exports = { buildSrt, chunk, ts, hardSplit, splitWords, normalizeCues };
