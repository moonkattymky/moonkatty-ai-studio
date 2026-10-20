'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { probeDuration } = require('../../media-automation/src/video/exec');
const { applyLexicon } = require('./lexicon');

const ROOT = path.join(__dirname, '..');
const MODEL = path.join(ROOT, 'models', 'kokoro', 'kokoro-v1.0.onnx');
const VOICES = path.join(ROOT, 'models', 'kokoro', 'voices-v1.0.bin');

/**
 * Provisional male US voices. Apache-2.0 weights. Not locked.
 * am_michael is the provisional default until the owner listens.
 */
const PROVISIONAL = {
  locked: false,
  defaultVoice: 'am_michael',
  candidates: ['am_michael', 'am_adam', 'am_fenrir'],
  speed: 1,
  license: 'Apache-2.0 (Kokoro-82M v1.0 weights and ONNX export). Training card also names CC BY audio; see news-launch/VOICE_REPORT.md.',
};

function cacheFile(voice, speed, spoken) {
  const id = crypto.createHash('sha256').update(`${voice}\n${speed}\n${spoken}`).digest('hex');
  return path.join(ROOT, 'work', 'tts-cache', `${id}.wav`);
}

function synthesizeBatch(items) {
  if (!fs.existsSync(MODEL) || !fs.existsSync(VOICES)) {
    throw new Error('Kokoro model is missing. Download stays out of git. See news-launch/VOICE_REPORT.md.');
  }
  const payload = JSON.stringify({ model: MODEL, voices: VOICES, items });
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [path.join(ROOT, 'bin', 'kokoro_synth.py')], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code) return reject(new Error(`kokoro exit ${code}: ${err.slice(-800)}`));
      try { resolve(JSON.parse(out)); }
      catch (e) { reject(new Error(`kokoro output was not JSON: ${out.slice(0, 200)} ${err.slice(-200)}`)); }
    });
    child.stdin.end(payload);
  });
}

class KokoroTTS {
  constructor({ voice = PROVISIONAL.defaultVoice, speed = PROVISIONAL.speed } = {}) {
    this.voiceId = voice;
    this.speed = speed;
    this.name = 'kokoro';
    this.license = PROVISIONAL.license;
    this.commercialUse = true;
    this.provisional = true;
  }
  async synthesize(text, outWav) {
    const spoken = applyLexicon(text);
    const cached = cacheFile(this.voiceId, this.speed, spoken);
    if (!fs.existsSync(cached)) {
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      await synthesizeBatch([{ text: spoken, voice: this.voiceId, speed: this.speed, out: cached }]);
    }
    fs.mkdirSync(path.dirname(outWav), { recursive: true });
    fs.copyFileSync(cached, outWav);
    return { file: outWav, durationSec: await probeDuration(outWav) };
  }
}

async function prewarm(voice, speed, texts) {
  const items = [];
  for (const text of texts) {
    const spoken = applyLexicon(text);
    const out = cacheFile(voice, speed, spoken);
    if (!fs.existsSync(out)) items.push({ text: spoken, voice, speed, out });
  }
  if (!items.length) return [];
  fs.mkdirSync(path.dirname(items[0].out), { recursive: true });
  return synthesizeBatch(items);
}

module.exports = { KokoroTTS, synthesizeBatch, prewarm, cacheFile, PROVISIONAL, MODEL, VOICES };
