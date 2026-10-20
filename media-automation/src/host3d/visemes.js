'use strict';
const { run } = require('../video/exec');
/** IPA phoneme -> viseme (Oculus/MPEG-4 style 15-set). */
const MAP = [[/^(p|b|m)$/, 'PP'], [/^(f|v)$/, 'FF'], [/^(θ|ð)$/, 'TH'], [/^(t|d|n|l|ɾ)$/, 'DD'], [/^(k|ɡ|g|ŋ|h)$/, 'kk'], [/^(tʃ|dʒ|ʃ|ʒ)$/, 'CH'], [/^(s|z)$/, 'SS'], [/^(ɹ|r)$/, 'RR'],
  [/^(j|i|iː|ɪ)$/, 'I'], [/^(e|eɪ|ɛ|æ)$/, 'E'], [/^(ɑ|ɑː|a|aɪ|aʊ|ʌ|ə|ɚ|ɜ|ɜː)$/, 'aa'], [/^(o|oʊ|ɔ|ɔː|ɔɪ)$/, 'O'], [/^(u|uː|ʊ|w)$/, 'U']];
const toViseme = ph => { for (const [re, v] of MAP) if (re.test(ph)) return v; return 'sil'; };
/** Phonemize with espeak-ng (IPA). Returns [[phonemes of word]]. */
async function phonemize(text, { runFn = run, voice = 'en-us' } = {}) {
  const { stdout } = await runFn('espeak-ng', ['-q', '--ipa', '--sep=_', '-v', voice, '--', String(text)]);
  return stdout.replace(/[ˈˌ\u200d]/g, '').split(/\s+/).filter(Boolean).map(w => w.split('_').filter(Boolean));
}
/**
 * Viseme timeline over the measured audio duration. Timing is APPROXIMATE (uniform per phoneme, short gaps at punctuation);
 * Studio can refine with forced alignment. Returns [{ t, d, viseme, phoneme }].
 */
async function visemeTimeline(text, durationSec, { leadSec = 0.25, tailSec = 0.35, runFn = run } = {}) {
  const words = await phonemize(text, { runFn }); const phones = words.flatMap((w, i) => [...w, ...(i < words.length - 1 ? ['_'] : [])]);
  const speech = Math.max(0.1, durationSec - leadSec - tailSec); const n = phones.length || 1; const unit = speech / (n - phones.filter(p => p === '_').length * 0.5);
  const out = [{ t: 0, d: leadSec, viseme: 'sil', phoneme: '' }]; let t = leadSec;
  for (const p of phones) { const d = p === '_' ? unit * 0.5 : unit; out.push({ t: +t.toFixed(3), d: +d.toFixed(3), viseme: p === '_' ? 'sil' : toViseme(p), phoneme: p === '_' ? '' : p }); t += d; }
  out.push({ t: +t.toFixed(3), d: tailSec, viseme: 'sil', phoneme: '' }); return out;
}
module.exports = { visemeTimeline, phonemize, toViseme };
