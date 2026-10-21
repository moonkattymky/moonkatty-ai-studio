'use strict';
const { chunk } = require('./subtitles');
const t = s => { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
/** Styled ASS subtitles (cosmic palette). cues: [{start,end,text}] */
function buildAss(cues, { W, H, font = 'Inter', marginV }) {
  const v = H > W; const size = Math.round(H * (v ? 0.03 : 0.045)); const mv = marginV ?? Math.round(H * (v ? 0.13 : 0.045));
  const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n` +
    `Style: Default,${font},${size},&H00FFFFFF,&H00FFFFFF,&H006E1F3B,&H96000000,-1,0,0,0,100,100,0,0,1,${Math.max(2, Math.round(size / 14))},${Math.max(1, Math.round(size / 24))},2,${Math.round(W * 0.06)},${Math.round(W * 0.06)},${mv},1\n` + extraStyles(size, W, mv) + `\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return head + cues.map(c => `Dialogue: 0,${t(c.start)},${t(c.end)},${c.style || 'Default'},,0,0,0,,{\\fad(${c.style === 'Serious' ? '200,200' : '120,120'})}${c.text.replace(/\n/g, '\\N').replace(/[{}]/g, '')}`).join('\n') + '\n';
}
/** Emotion-aware caption styles: Serious (white, no accent, slower fade), Curious (lavender outline), Bright (gold outline, slightly larger). */
function extraStyles(size, W, mv) { const m = Math.round(W * 0.06); const o = Math.max(2, Math.round(size / 14)); const sh = Math.max(1, Math.round(size / 24));
  return [`Style: Serious,Inter,${size},&H00FFFFFF,&H00FFFFFF,&H00202020,&H96000000,-1,0,0,0,100,100,0,0,1,${o},${sh},2,${m},${m},${mv},1`,
    `Style: Curious,Inter,${size},&H00FFFFFF,&H00FFFFFF,&H00F6B5C4,&H96000000,-1,0,0,0,100,100,0,0,1,${o},${sh},2,${m},${m},${mv},1`,
    `Style: Bright,Inter,${Math.round(size * 1.06)},&H00FFFFFF,&H00FFFFFF,&H0042C5F5,&H96000000,-1,0,0,0,100,100,0,0,1,${o + 1},${sh},2,${m},${m},${mv},1`].join('\n') + '\n'; }
module.exports = { buildAss };
