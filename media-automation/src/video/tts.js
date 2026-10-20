'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { run, probeDuration, hasBinary } = require('./exec');

/**
 * TTSProvider interface:
 *   name: string
 *   async synthesize(text, outWav) -> { file, durationSec }   (always writes PCM WAV)
 *   async listVoices?() -> [{ id, lang, sample? }]
 */
async function toWav(src, outWav, runFn) {
  await runFn('ffmpeg', ['-y', '-v', 'error', '-i', src, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
}
function assertText(text) { if (!text || !String(text).trim()) throw new Error('TTS: empty text'); }

/** macOS `say`. Exports AIFF, converts to WAV (and optionally M4A). Text passed after `--` via argv (no shell). */
class MacSayTTS {
  constructor({ voice = 'Samantha', rate = null, runFn = run, keepAiff = false } = {}) { Object.assign(this, { voice, rate, runFn, keepAiff }); this.name = 'macos-say'; }
  static parseVoices(stdout) {
    return String(stdout).split('\n').map(l => l.match(/^(.+?)\s{2,}([a-z]{2}[_-][A-Za-z0-9]+)\s+#\s?(.*)$/)).filter(Boolean)
      .map(m => ({ id: m[1].trim(), lang: m[2], sample: m[3].trim() }));
  }
  async listVoices() { const { stdout } = await this.runFn('say', ['-v', '?']); return MacSayTTS.parseVoices(stdout); }
  async exportAiff(text, outAiff) {
    assertText(text);
    const args = ['-v', this.voice, '-o', outAiff]; if (this.rate) args.push('-r', String(this.rate));
    args.push('--', String(text)); await this.runFn('say', args); return outAiff;
  }
  async synthesize(text, outWav) {
    const aiff = outWav.replace(/\.wav$/i, '') + '.aiff';
    await this.exportAiff(text, aiff); await toWav(aiff, outWav, this.runFn);
    if (!this.keepAiff) fs.rmSync(aiff, { force: true });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn) };
  }
  async exportM4a(text, outM4a) {
    const aiff = outM4a.replace(/\.m4a$/i, '') + '.aiff'; await this.exportAiff(text, aiff);
    await this.runFn('ffmpeg', ['-y', '-v', 'error', '-i', aiff, '-c:a', 'aac', '-b:a', '128k', outM4a]); fs.rmSync(aiff, { force: true }); return outM4a;
  }
}

/** espeak-ng (Linux/macOS via brew). Robotic but real speech. */
class EspeakTTS {
  constructor({ voice = 'en-us', rate = 160, pitch = 45, bin = 'espeak-ng', runFn = run } = {}) { Object.assign(this, { voice, rate, pitch, bin, runFn }); this.name = 'espeak-ng'; }
  async listVoices() {
    const { stdout } = await this.runFn(this.bin, ['--voices']);
    return stdout.split('\n').slice(1).map(l => l.trim().split(/\s+/)).filter(p => p.length >= 4).map(p => ({ id: p[4] || p[1], lang: p[1] }));
  }
  async synthesize(text, outWav) {
    assertText(text); const raw = outWav + '.raw.wav';
    await this.runFn(this.bin, ['-v', this.voice, '-s', String(this.rate), '-p', String(this.pitch), '-w', raw, '--', String(text)]);
    await toWav(raw, outWav, this.runFn); fs.rmSync(raw, { force: true });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn) };
  }
}

/** Piper neural TTS (local ONNX voice). Text via stdin. */
class PiperTTS {
  constructor({ model, bin = 'piper', lengthScale = 1.0, runFn = run, spawnFn = spawn } = {}) {
    if (!model) throw new Error('piper model path required'); Object.assign(this, { model, bin, lengthScale, runFn, spawnFn }); this.name = 'piper';
  }
  async listVoices() { return [{ id: path.basename(this.model, '.onnx'), lang: path.basename(this.model).split('-')[0] }]; }
  async synthesize(text, outWav) {
    assertText(text); const raw = outWav + '.raw.wav';
    await new Promise((res, rej) => {
      const p = this.spawnFn(this.bin, ['--model', this.model, '--output_file', raw, '--length_scale', String(this.lengthScale)]);
      let err = ''; p.stderr?.on('data', d => { err += d; }); p.on('error', rej);
      p.on('close', c => c ? rej(new Error(`piper exit ${c}: ${err.slice(-500)}`)) : res()); p.stdin.end(String(text));
    });
    await toWav(raw, outWav, this.runFn); fs.rmSync(raw, { force: true });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn) };
  }
}

/**
 * Pick a real engine: MA_TTS=say|piper|espeak forces one. Otherwise order: say (macOS) -> piper (if MA_PIPER_MODEL) -> espeak-ng.
 * Throws loudly when nothing is available — there is NO silent/tone fallback in the pipeline.
 */
async function detectTTS({ env = process.env, has = hasBinary } = {}) {
  const want = env.MA_TTS;
  const piperBin = env.MA_PIPER_BIN || 'piper'; const piperModel = env.MA_PIPER_MODEL;
  const cands = [
    ['say', async () => process.platform === 'darwin' && await has('say') && new MacSayTTS({ voice: env.MA_SAY_VOICE || 'Samantha', rate: env.MA_SAY_RATE || null })],
    ['piper', async () => piperModel && fs.existsSync(piperModel) && await has(piperBin) && new PiperTTS({ model: piperModel, bin: piperBin })],
    ['espeak', async () => await has('espeak-ng') && new EspeakTTS({ voice: env.MA_ESPEAK_VOICE || 'en-us' })],
  ];
  for (const [n, f] of cands) { if (want && want !== n) continue; const t = await f(); if (t) return t; }
  throw new Error(`No TTS engine available${want ? ` (MA_TTS=${want})` : ''}. Install macOS say, piper (+MA_PIPER_MODEL) or espeak-ng.`);
}
module.exports = { MacSayTTS, EspeakTTS, PiperTTS, detectTTS };
