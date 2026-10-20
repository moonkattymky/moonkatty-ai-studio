'use strict';
const { run, probeDuration } = require('./exec');
/** TTSProvider interface: async synthesize(text, outWav) -> { file, durationSec } */
class StubTTS {
  constructor({ wordsPerSec = 2.6, runFn = run } = {}) { this.wordsPerSec = wordsPerSec; this.runFn = runFn; this.name = 'stub'; }
  estimate(text) { return Math.max(1.5, String(text).split(/\s+/).filter(Boolean).length / this.wordsPerSec); }
  async synthesize(text, outWav) {
    const d = this.estimate(text).toFixed(2);
    // Quiet tone instead of speech so the audio track is audibly present. NOT real speech.
    await this.runFn('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${d}:sample_rate=22050`, '-af', 'volume=0.05', '-ac', '1', outWav]);
    return { file: outWav, durationSec: +d };
  }
}
class MacSayTTS {
  constructor({ voice = 'Samantha', rate, runFn = run } = {}) { Object.assign(this, { voice, rate, runFn }); this.name = 'macos-say'; }
  async synthesize(text, outWav) {
    const args = ['-v', this.voice, '-o', outWav, '--data-format=LEI16@22050']; if (this.rate) args.push('-r', String(this.rate));
    args.push('--', text);
    await this.runFn('say', args);
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn) };
  }
}
class PiperTTS {
  constructor({ model, bin = 'piper', runFn = run } = {}) { if (!model) throw new Error('piper model path required'); Object.assign(this, { model, bin, runFn }); this.name = 'piper'; }
  async synthesize(text, outWav) {
    const { spawn } = require('child_process');
    await new Promise((res, rej) => { const p = spawn(this.bin, ['--model', this.model, '--output_file', outWav]); p.on('error', rej); p.on('close', c => c ? rej(new Error(`piper exit ${c}`)) : res()); p.stdin.end(text); });
    return { file: outWav, durationSec: await probeDuration(outWav, this.runFn) };
  }
}
module.exports = { StubTTS, MacSayTTS, PiperTTS };
