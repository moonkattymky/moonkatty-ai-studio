#!/usr/bin/env node
'use strict';
/** News 2.0 voice casting + emotion demo renderer (local Kokoro-82M only, no network, no paid APIs).
 * Env: MA_KOKORO_PY (venv python), MA_KOKORO_MODEL, MA_KOKORO_VOICES. Usage: node bin/voice-casting.js <outDir> */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { execFileSync } = require('child_process');
const { prosody, pitchFilter } = require('../src/anchor/emotion');
const PY = process.env.MA_KOKORO_PY || '/workspace/tools/kokoro-venv/bin/python';
const MODEL = process.env.MA_KOKORO_MODEL || '/workspace/tools/kokoro-v1.0.onnx';
const VOICES = process.env.MA_KOKORO_VOICES || '/workspace/tools/voices-v1.0.bin';
const BRIDGE = path.join(__dirname, '../tools/kokoro_cast.py');
const VARIANTS = {
  A: { id: 'A-smart-charming', label: 'Smart & Charming', blend: { am_michael: 0.7, am_puck: 0.3 }, speedMul: 1.0, pitchAdd: 0 },
  B: { id: 'B-energetic-playful', label: 'Energetic & Playful', blend: { am_puck: 0.6, am_michael: 0.4 }, speedMul: 1.06, pitchAdd: 0.4 },
  C: { id: 'C-professional-witty', label: 'Professional & Witty', blend: { am_michael: 0.75, am_fenrir: 0.25 }, speedMul: 0.98, pitchAdd: -0.2 },
};
const CLIPS = {
  serious: { mode: 'SERIOUS', text: 'Good evening. Officials have confirmed that the national power grid will undergo scheduled maintenance this weekend. Residents in affected areas have been advised to prepare for short outages, and updates will be published every two hours.' },
  light: { mode: 'PLAYFUL', text: 'And now, some good news. A local library has launched a reading program for dogs, where shy pups listen while children practice reading aloud. Organizers say both the kids and the dogs are making excellent progress.' },
  joke: { mode: 'WITTY', text: 'Scientists have developed a robot that can prepare coffee. Finally, a robot with the right priorities. Now, if it could just answer my emails.' },
};
const EMO_TEXT = {
  SERIOUS: 'The committee confirmed the decision this morning. A full report is expected next week.',
  NEUTRAL: 'Here is a quick look at today\'s headlines, starting with markets and the weather.',
  EXCITED: 'The rocket launched right on time, and the landing was perfect. What a moment for the whole team!',
  CURIOUS: 'So why does the moon look bigger near the horizon? Scientists have a few interesting ideas.',
  PLAYFUL: 'A penguin at the city aquarium has learned to open its own snack box. Honestly, respect.',
  WITTY: 'Engineers built a smart fridge that reminds you to eat vegetables. It has already been unplugged twice.',
  EMPATHETIC: 'Communities along the coast are rebuilding after the storm. Volunteers are offering food and shelter to families in need.',
};
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function synth(text, blend, speed, out) {
  return JSON.parse(execFileSync(PY, [BRIDGE], { input: JSON.stringify({ text, blend, speed, out, model: MODEL, voices: VOICES, lang: 'en-us' }) }).toString());
}
function render(text, mode, v, outMp3, tmp) {
  const p = prosody(mode); const speed = +(p.speed * v.speedMul).toFixed(3); const semis = +(p.pitchSemitones + v.pitchAdd).toFixed(2);
  const sents = text.match(/[^.!?]+[.!?]+/g).map(s => s.trim());
  const parts = []; sents.forEach((s, i) => {
    const w = path.join(tmp, `s${i}.wav`); synth(s, v.blend, speed, w); parts.push(w);
    const isPunch = mode === 'WITTY' && i === sents.length - 2; const ms = isPunch ? p.punchlinePauseMs : p.sentencePauseMs;
    if (i < sents.length - 1) { const sil = path.join(tmp, `p${i}.wav`);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono`, '-t', String(ms / 1000), sil]); parts.push(sil); }
  });
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, parts.map(f => `file '${f}'`).join('\n'));
  const pre = [pitchFilter(semis), p.gainDb ? `volume=${p.gainDb}dB` : null].filter(Boolean);
  const mid = path.join(tmp, 'mid.wav'); execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...(pre.length ? ['-af', pre.join(',')] : []), '-ac', '1', mid]);
  // two-pass loudnorm (linear) so short clips actually land at -16 LUFS

  const err = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-i', mid, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr.toString();
  const m = JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1));
  const af = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=44100`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', mid, '-af', af, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '160k', outMp3]); fs.unlinkSync(mid);
  parts.forEach(f => fs.unlinkSync(f));
  return { mode, speed, pitchSemitones: semis, sentencePauseMs: p.sentencePauseMs, gainDb: p.gainDb, loudnorm: 'two-pass linear I=-16:TP=-1.5:LRA=11', sentences: sents.length };
}
const outDir = process.argv[2] || '/workspace/ma-out/voice-casting-v2'; const emoDir = path.join(outDir, 'emotions'); const tmp = fs.mkdtempSync('/tmp/vc-');
fs.mkdirSync(emoDir, { recursive: true });
const LIC = { engine: 'Kokoro-82M v1.0 via kokoro-onnx', modelLicense: 'Apache-2.0 (hexgrad/Kokoro-82M; voices included)', runtimeLicense: 'kokoro-onnx MIT; onnxruntime MIT; espeak-ng phonemizer GPL-3.0 (separate process/library — review distribution)', commercialUse: 'permitted by Apache-2.0' };
const casting = { generatedAt: new Date().toISOString(), pinned: false, note: 'Original synthetic blends of stock Kokoro voices. No cloning, no imitation of real people.', ...LIC, variants: [], emotionDemo: { variant: 'A', clips: [] } };
for (const [k, v] of Object.entries(VARIANTS)) {
  const ent = { key: k, ...v, clips: [] };
  for (const [name, c] of Object.entries(CLIPS)) { const f = path.join(outDir, `${k}-${name}.mp3`); const params = render(c.text, c.mode, v, f, tmp);
    ent.clips.push({ file: f, content: name, text: c.text, params, sha256: sha(f) }); console.log(f); }
  casting.variants.push(ent);
}
for (const [mode, text] of Object.entries(EMO_TEXT)) { const f = path.join(emoDir, `A-${mode}.mp3`); const params = render(text, mode, VARIANTS.A, f, tmp);
  casting.emotionDemo.clips.push({ file: f, text, params, sha256: sha(f) }); console.log(f); }
fs.writeFileSync(path.join(outDir, 'casting.json'), JSON.stringify(casting, null, 2));
console.log(path.join(outDir, 'casting.json'));
