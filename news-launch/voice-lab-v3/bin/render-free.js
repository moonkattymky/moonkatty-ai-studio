'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { KokoroTTS } = require('../../../media-automation/src/video/tts');
const { loudnorm, toMp3, probeDuration, probeLoudness, silencedetect } = require('../lib/audio_util');

const ROOT = path.join(__dirname, '..');
const AUDIO = path.join(ROOT, 'audio');
const TEXT = fs.readFileSync(path.join(ROOT, 'script.txt'), 'utf8').trim();
const WORDS = TEXT.split(/\s+/).length;
const MODEL = path.join(ROOT, '..', 'models', 'kokoro', 'kokoro-v1.0.onnx');
const VOICES = path.join(ROOT, '..', 'models', 'kokoro', 'voices-v1.0.bin');

function runPy(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('python3', args, { env: { ...process.env, LD_LIBRARY_PATH: '' } });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => code ? reject(new Error(err || out || `exit ${code}`)) : resolve(out.trim()));
  });
}

async function finalize(id, raw, meta) {
  const wav = path.join(AUDIO, `${id}.wav`);
  const mp3 = path.join(AUDIO, `${id}.mp3`);
  await loudnorm(raw, wav);
  const mp3Loud = await toMp3(wav, mp3);
  const durationSec = await probeDuration(wav);
  const wavLoud = await probeLoudness(wav);
  const pauses = await silencedetect(wav);
  fs.rmSync(raw, { force: true });
  return {
    ...meta,
    id,
    words: WORDS,
    wav: path.relative(ROOT, wav),
    mp3: path.relative(ROOT, mp3),
    durationSec: +durationSec.toFixed(2),
    wpm: Math.round(WORDS / (durationSec / 60)),
    wavLufs: wavLoud.integratedLufs,
    wavTruePeakDb: wavLoud.truePeakDb,
    mp3Lufs: mp3Loud.integratedLufs,
    mp3TruePeakDb: mp3Loud.truePeakDb,
    pauses,
    rtf: +(meta.genSec / durationSec).toFixed(3),
  };
}

async function kokoro() {
  const raw = path.join(AUDIO, '.kokoro.raw.wav');
  const tts = new KokoroTTS({ python: 'python3', model: MODEL, voices: VOICES, voice: 'am_michael', speed: 1, lang: 'en-us' });
  const t0 = process.hrtime.bigint();
  await tts.synthesize(TEXT, raw);
  const genSec = Number(process.hrtime.bigint() - t0) / 1e9;
  return finalize('kokoro-am_michael', raw, {
    engine: 'kokoro-onnx',
    voice: 'am_michael',
    speed: 1,
    lang: 'en-us',
    genSec: +genSec.toFixed(3),
    device: 'cpu',
  });
}

async function edge(voice, id) {
  const raw = path.join(AUDIO, `.${id}.raw.mp3`);
  const out = await runPy([path.join(__dirname, 'render_edge.py'), TEXT, voice, raw]);
  const info = JSON.parse(out.split('\n').pop());
  return finalize(id, raw, {
    engine: 'edge-tts',
    voice,
    rate: info.rate,
    genSec: info.genSec,
    device: 'network',
  });
}

async function main() {
  fs.mkdirSync(AUDIO, { recursive: true });
  const rows = [];
  rows.push(await kokoro());
  console.error(JSON.stringify(rows.at(-1)));
  for (const [voice, id] of [
    ['en-US-AndrewMultilingualNeural', 'edge-andrew'],
    ['en-US-BrianNeural', 'edge-brian'],
    ['en-US-ChristopherNeural', 'edge-christopher'],
  ]) {
    rows.push(await edge(voice, id));
    console.error(JSON.stringify(rows.at(-1)));
  }
  fs.writeFileSync(path.join(ROOT, 'measurements-free.json'), JSON.stringify(rows, null, 2));
}

main().catch(err => { console.error(err.stack || err.message); process.exit(1); });
