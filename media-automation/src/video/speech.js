'use strict';
const fs = require('fs'); const path = require('path');
const { run, probeDuration } = require('./exec');
const DEFAULT_LEXICON = path.join(__dirname, '..', '..', 'assets', 'lexicon.json');
function loadLexicon(file = DEFAULT_LEXICON) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); delete j._comment; return j; } catch { return {}; } }
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function applyLexicon(text, lex) {
  let t = String(text);
  for (const [w, r] of Object.entries(lex).sort((a, b) => b[0].length - a[0].length)) t = t.replace(new RegExp(`(^|[^\\w])${esc(w)}(?=$|[^\\w])`, 'g'), `$1${r}`);
  return t;
}
/** SSML-like markup: "[pause 600]" or "[pause 600ms]" -> silence. Returns [{text}|{pauseMs}] */
function parseMarkup(text) {
  const out = []; let last = 0; const re = /\[pause\s+(\d+)\s*(ms)?\]/gi; let m;
  while ((m = re.exec(text))) { const t = text.slice(last, m.index).trim(); if (t) out.push({ text: t }); out.push({ pauseMs: +m[1] }); last = re.lastIndex; }
  const t = text.slice(last).trim(); if (t) out.push({ text: t }); return out;
}
/** Wraps any TTSProvider: lexicon + pauses; output is one WAV (44.1k mono). */
class SpeechComposer {
  constructor({ tts, lexicon = loadLexicon(), runFn = run, sentencePauseMs = 0 }) { Object.assign(this, { tts, lexicon, runFn, sentencePauseMs }); this.name = tts.name; }
  async synthesize(text, outWav) {
    const parts = parseMarkup(String(text)); if (!parts.some(p => p.text)) throw new Error('TTS: empty text');
    const files = []; const dir = outWav + '.parts'; fs.mkdirSync(dir, { recursive: true }); const spoken = [];
    for (const [i, p] of parts.entries()) {
      const f = path.join(dir, `${i}.wav`);
      if (p.pauseMs != null) await this.runFn('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', (p.pauseMs / 1000).toFixed(3), f]);
      else { const said = applyLexicon(p.text, this.lexicon); spoken.push(said); await this.tts.synthesize(said, f); }
      files.push(f);
    }
    if (files.length === 1) fs.copyFileSync(files[0], outWav);
    else await this.runFn('ffmpeg', ['-y', '-v', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', files.map((_, k) => `[${k}:a]aresample=44100,aformat=channel_layouts=mono[a${k}]`).join(';') + ';' + files.map((_, k) => `[a${k}]`).join('') + `concat=n=${files.length}:v=0:a=1[o]`, '-map', '[o]', outWav]);
    fs.rmSync(dir, { recursive: true, force: true });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn), spokenText: spoken.join(' ') };
  }
}
const stripMarkup = t => String(t).replace(/\[pause\s+\d+\s*(ms)?\]/gi, ' ').replace(/\s+/g, ' ').trim();
module.exports = { SpeechComposer, applyLexicon, parseMarkup, loadLexicon, stripMarkup };
