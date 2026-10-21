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

/** Kokoro-82M via kokoro-onnx (python bridge tools/kokoro_tts.py). Apache-2.0 model; runs on Apple Silicon CPU. */
class KokoroTTS {
  constructor({ python = process.env.MA_KOKORO_PYTHON || 'python3', model = process.env.MA_KOKORO_MODEL, voices = process.env.MA_KOKORO_VOICES, voice = process.env.MA_KOKORO_VOICE || 'af_heart', speed = +(process.env.MA_TTS_RATE || 1.0), lang = 'en-us', runFn = run, spawnFn = spawn } = {}) {
    if (!model || !voices) throw new Error('kokoro model and voices paths required'); Object.assign(this, { python, model, voices, voice, speed, lang, runFn, spawnFn }); this.name = `kokoro:${voice}`;
  }
  async listVoices() { return ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_michael', 'am_adam', 'bf_emma', 'bm_george', 'bm_daniel'].map(id => ({ id, lang: id[0] === 'b' ? 'en-GB' : 'en-US' })); }
  async synthesize(text, outWav) {
    assertText(text); const raw = outWav + '.raw.wav'; const script = path.join(__dirname, '..', '..', 'tools', 'kokoro_tts.py');
    await new Promise((res, rej) => { const p = this.spawnFn(this.python, [script]); let err = ''; p.stderr?.on('data', d => { err += d; }); p.on('error', rej);
      p.on('close', c => c ? rej(new Error(`kokoro exit ${c}: ${err.slice(-400)}`)) : res()); p.stdin.end(JSON.stringify({ text: String(text), voice: this.voice, speed: this.speed, lang: this.lang, out: raw, model: this.model, voices: this.voices })); });
    await toWav(raw, outWav, this.runFn); fs.rmSync(raw, { force: true });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn) };
  }
}

/** Kokoro-82M style BLEND (tools/kokoro_cast.py). Emotion-aware: synthesize(text, out, {emotion}) applies Emotion Engine prosody
 * (speed, sentence pauses, small pitch post-shift). Returns measured sentence times for word timestamps. Base pitch/speed from master voice. */
class KokoroBlendTTS {
  constructor({ python = process.env.MA_KOKORO_PYTHON || 'python3', model, voices, blend, speed = 1, pitchSemitones = 0, lang = 'en-us', runFn = run, spawnFn = spawn, name } = {}) {
    if (!model || !voices || !blend) throw new Error('kokoro-blend: model, voices and blend required');
    Object.assign(this, { python, model, voices, blend, speed, pitchSemitones, lang, runFn, spawnFn }); this.name = name || `kokoro-blend:${Object.entries(blend).map(([v, w]) => `${v}@${w}`).join('+')}`;
  }
  async synthesize(text, outWav, { emotion = 'NEUTRAL' } = {}) {
    assertText(text); const { prosody, pitchFilter } = require('../anchor/emotion'); const p = prosody(emotion);
    const sents = String(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g).map(x => x.trim()).filter(Boolean);
    const segments = sents.map((t, i) => ({ text: t, pauseAfterMs: i < sents.length - 1 ? (emotion === 'WITTY' && i === sents.length - 2 ? p.punchlinePauseMs : p.sentencePauseMs) : 0 }));
    const raw = outWav + '.raw.wav'; const script = path.join(__dirname, '..', '..', 'tools', 'kokoro_cast.py');
    const res = await new Promise((ok, rej) => { const pr = this.spawnFn(this.python, [script]); let out = '', err = ''; pr.stdout?.on('data', d => { out += d; }); pr.stderr?.on('data', d => { err += d; }); pr.on('error', rej);
      pr.on('close', c => c ? rej(new Error(`kokoro-blend exit ${c}: ${err.slice(-400)}`)) : ok(JSON.parse(out.trim().split('\n').pop())));
      pr.stdin.end(JSON.stringify({ segments, blend: this.blend, speed: +(this.speed * p.speed).toFixed(3), lang: this.lang, out: raw, model: this.model, voices: this.voices })); });
    const pf = pitchFilter(+(this.pitchSemitones + p.pitchSemitones).toFixed(2), res.sr || 24000);
    const af = [pf, p.gainDb ? `volume=${p.gainDb}dB` : null].filter(Boolean);
    await this.runFn('ffmpeg', ['-y', '-v', 'error', '-i', raw, ...(af.length ? ['-af', af.join(',')] : []), '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outWav]); fs.rmSync(raw, { force: true });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn), sentences: res.segments, emotion };
  }
}

/**
 * Pick a real engine: MA_TTS=say|piper|espeak forces one. Otherwise order: kokoro (if MA_KOKORO_MODEL) -> say (macOS) -> piper (if MA_PIPER_MODEL) -> espeak-ng.
 * Throws loudly when nothing is available — there is NO silent/tone fallback in the pipeline.
 */
async function detectTTS({ env = process.env, has = hasBinary } = {}) {
  const want = env.MA_TTS;
  const piperBin = env.MA_PIPER_BIN || 'piper'; const piperModel = env.MA_PIPER_MODEL;
  const cands = [
    ['kokoro', async () => env.MA_KOKORO_MODEL && fs.existsSync(env.MA_KOKORO_MODEL) && env.MA_KOKORO_VOICES && new KokoroTTS({ python: env.MA_KOKORO_PYTHON || 'python3', model: env.MA_KOKORO_MODEL, voices: env.MA_KOKORO_VOICES, voice: env.MA_KOKORO_VOICE || 'af_heart', speed: +(env.MA_TTS_RATE || 1) })],
    ['say', async () => process.platform === 'darwin' && await has('say') && new MacSayTTS({ voice: env.MA_SAY_VOICE || 'Samantha', rate: env.MA_SAY_RATE || null })],
    ['piper', async () => piperModel && fs.existsSync(piperModel) && await has(piperBin) && new PiperTTS({ model: piperModel, bin: piperBin })],
    ['espeak', async () => await has('espeak-ng') && new EspeakTTS({ voice: env.MA_ESPEAK_VOICE || 'en-us' })],
  ];
  for (const [n, f] of cands) { if (want && want !== n) continue; const t = await f(); if (t) return t; }
  throw new Error(`No TTS engine available${want ? ` (MA_TTS=${want})` : ''}. Install macOS say, piper (+MA_PIPER_MODEL) or espeak-ng.`);
}
module.exports = { MacSayTTS, EspeakTTS, PiperTTS, KokoroTTS, KokoroBlendTTS, detectTTS };
