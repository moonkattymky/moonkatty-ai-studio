// QA-NV-006 regression: long/slow cues are split (never "cue N: too long"), every cue validates.
import { createRequire } from 'module'; const require = createRequire(import.meta.url);
const { buildSrt } = require('../media-automation/src/video/subtitles'); const { validateSrt, parseSrt } = require('../media-automation/src/video/srtcheck');
let pass = 0, fail = 0; const t = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x ? ' — ' + x : '')); };
const cases = [['short text, slow speech', 'NASA tested the engine today.', 20, 46], ['one word, long', 'Mississippi', 12, 46],
  ['long sentence without pauses (vertical)', 'the engine ran for five hundred seconds at stennis space center in mississippi while engineers watched every sensor closely and recorded data for future artemis missions', 30, 28],
  ['two lines merged, 7.62 s (reported case)', 'NASA conducted the RS-25 engine test at Stennis Space Center', 7.62 + 0.6, 46], ['normal', 'One. Two words here. And a third sentence follows now.', 6, 46]];
for (const [n, text, dur, mc] of cases) { const srt = buildSrt([{ text, start: 0.25, duration: dur }], { maxChars: mc }); const v = validateSrt(srt, { maxChars: mc });
  t(n, v.ok, v.ok ? parseSrt(srt).length + ' cues' : v.errors.join('; ')); }
const srt = buildSrt([{ text: 'alpha beta gamma delta', start: 0, duration: 30 }]); const words = parseSrt(srt).flatMap(c => c.lines.join(' ').split(' '));
t('no words lost when splitting', words.join(' ') === 'alpha beta gamma delta', words.join(' '));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
