'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { PiperTTS } = require('../../media-automation/src/video/tts');

const ROOT = path.join(__dirname, '..');
const MODEL_DIR = path.join(ROOT, 'models', 'piper');
const VOICE = 'en_US-ljspeech-high';
const VOICE_BASE = `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ljspeech/high/${VOICE}`;
const CARD_URL = 'https://huggingface.co/rhasspy/piper-voices/raw/main/en/en_US/ljspeech/high/MODEL_CARD';
const PIPER_RELEASE = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2';

function assertVoiceCard(text) {
  const t = String(text || '').toLowerCase();
  if (!t.includes('public domain')) throw new Error('LJ Speech model card does not say public domain');
  if (!t.includes('lj speech') && !t.includes('lj-speech')) throw new Error('model card is not the LJ Speech voice');
  if (/lessac|non-commercial|by-nc|research licence|research license/.test(t)) {
    throw new Error('voice license is not commercial-use permissive');
  }
}

function piperAsset() {
  if (process.platform === 'linux' && process.arch === 'x64') return 'piper_linux_x86_64.tar.gz';
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'piper_macos_aarch64.tar.gz';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'piper_macos_x64.tar.gz';
  throw new Error(`No Piper build is pinned for ${process.platform} ${process.arch}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-fsSL', '--retry', '3', '-o', dest, '-L', url], { maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) { err.message += `\n${stderr || stdout}`; return reject(err); }
      resolve(dest);
    });
  });
}

async function ensureTts() {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
  const bin = path.join(MODEL_DIR, 'piper');
  if (!fs.existsSync(bin)) {
    const tar = path.join(MODEL_DIR, 'piper.tar.gz');
    await download(`${PIPER_RELEASE}/${piperAsset()}`, tar);
    await new Promise((resolve, reject) => {
      execFile('tar', ['-xzf', tar, '-C', MODEL_DIR, '--strip-components=1'], (err) => err ? reject(err) : resolve());
    });
    fs.rmSync(tar, { force: true });
  }
  const model = path.join(MODEL_DIR, `${VOICE}.onnx`);
  const json = model + '.json';
  const cardPath = path.join(MODEL_DIR, `${VOICE}.MODEL_CARD`);
  if (!fs.existsSync(model)) await download(`${VOICE_BASE}.onnx`, model);
  if (!fs.existsSync(json)) await download(`${VOICE_BASE}.onnx.json`, json);
  if (!fs.existsSync(cardPath)) await download(CARD_URL, cardPath);
  const card = fs.readFileSync(cardPath, 'utf8');
  assertVoiceCard(card);
  const wrapper = path.join(ROOT, 'bin', 'piper-wrapper');
  const tts = new PiperTTS({ model, bin: wrapper });
  tts.voiceId = VOICE;
  tts.license = 'Piper MIT; voice en_US-ljspeech-high trained from scratch on the public-domain LJ Speech dataset';
  tts.commercialUse = true;
  return tts;
}

module.exports = { ensureTts, assertVoiceCard, VOICE, piperAsset };
