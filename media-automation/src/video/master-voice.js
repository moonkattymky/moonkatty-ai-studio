'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { KokoroTTS, KokoroBlendTTS, PiperTTS, MacSayTTS } = require('./tts');
const DEFAULT = path.join(__dirname, '..', '..', 'config', 'master-voice.json');
const expand = (s, env) => String(s || '').replace(/\$\{(\w+)\}/g, (_, k) => env[k] || '');
const hashCache = new Map();
function sha256File(f) { const st = fs.statSync(f); const k = `${f}|${st.size}|${st.mtimeMs}`; if (hashCache.has(k)) return hashCache.get(k);
  const h = crypto.createHash('sha256'); const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(8 << 20); let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); fs.closeSync(fd);
  const d = h.digest('hex'); hashCache.set(k, d); return d; }
/**
 * MASTER VOICE: one pinned anchor voice (engine + voice id + model hash + rate) for all episodes and 3D lip-sync.
 * - Never auto-replaced: if engine/model missing or hash differs -> throw (no fallback to another voice).
 * - status 'candidate' until owner locks it; a locked config can only be changed via unlock(by, reason) (audit trail).
 */
class MasterVoice {
  constructor({ file = process.env.MA_MASTER_VOICE || DEFAULT, env = process.env } = {}) { this.file = file; this.env = env; this.cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  get locked() { return this.cfg.status === 'locked'; }
  _save() { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.cfg, null, 2) + '\n'); fs.renameSync(this.file + '.tmp', this.file); }
  /** Build the TTS provider exactly as pinned; throws loudly when unavailable. */
  createTTS() {
    const c = this.cfg; if (c.gender !== 'male') throw new Error('master voice must be male (owner requirement)');
    const model = expand(c.model?.file, this.env);
    if (c.engine !== 'say') {
      if (!model || !fs.existsSync(model)) throw new Error(`MASTER VOICE unavailable: model file not found (${c.model?.file}). Refusing to substitute another voice.`);
      const h = sha256File(model); if (h !== c.model.sha256) throw new Error(`MASTER VOICE model hash mismatch (${h.slice(0, 12)} != ${c.model.sha256.slice(0, 12)}). Refusing to substitute.`);
    }
    if (c.autoReplace !== false && c.status === 'locked') throw new Error('MASTER VOICE config invalid: locked voice must have autoReplace=false');
    if (c.engine === 'kokoro-blend') { const voices = expand(c.voicesFile, this.env); if (!voices || !fs.existsSync(voices)) throw new Error('MASTER VOICE unavailable: kokoro voices file missing. Refusing to substitute another voice.');
      if (c.voicesSha256 && sha256File(voices) !== c.voicesSha256) throw new Error('MASTER VOICE voices file hash mismatch. Refusing to substitute.');
      if (!c.blend || !Object.keys(c.blend).length) throw new Error('MASTER VOICE blend missing');
      return new KokoroBlendTTS({ python: this.env.MA_KOKORO_PYTHON || 'python3', model, voices, blend: c.blend, speed: c.speed || 1, pitchSemitones: c.pitchSemitones || 0, emotionPitch: c.emotionPitch !== false, lang: c.lang || 'en-us', name: `${c.id || 'master'}:${c.voice}` }); }
    if (c.engine === 'kokoro') { const voices = expand(c.voicesFile, this.env); if (!voices || !fs.existsSync(voices)) throw new Error('MASTER VOICE unavailable: kokoro voices file missing');
      return new KokoroTTS({ python: this.env.MA_KOKORO_PYTHON || 'python3', model, voices, voice: c.voice, speed: c.rate || 1 }); }
    if (c.engine === 'piper') return new PiperTTS({ model, bin: this.env.MA_PIPER_BIN || 'piper', lengthScale: c.rate ? 1 / c.rate : 1 });
    if (c.engine === 'say') { if (process.platform !== 'darwin') throw new Error('MASTER VOICE unavailable: macOS say requires macOS'); return new MacSayTTS({ voice: c.voice, rate: c.rate }); }
    throw new Error('unknown master voice engine ' + c.engine);
  }
  setCandidate(next, by) { if (this.locked) throw new Error('MASTER VOICE is locked; unlock(by, reason) first'); this.cfg = { ...this.cfg, ...next, status: 'candidate', changedBy: by, changedAt: new Date().toISOString() }; this._save(); return this.cfg; }
  lock(by) { if (!by) throw new Error('owner name required'); this.createTTS(); this.cfg.status = 'locked'; this.cfg.autoReplace = false; this.cfg.lockedBy = by; this.cfg.lockedAt = new Date().toISOString(); this.cfg.note = 'Approved master voice. Do not change without owner.'; this._save(); return this.cfg; }
  unlock(by, reason) { if (!by || !reason) throw new Error('owner and reason required'); (this.cfg.audit = this.cfg.audit || []).push({ at: new Date().toISOString(), by, action: 'unlock', reason }); this.cfg.status = 'candidate'; this._save(); return this.cfg; }
  /** Export for the Studio 3D lip-sync pipeline. */
  exportForLipSync() { const c = this.cfg; return { id: c.id || null, blend: c.blend || null, pitchSemitones: c.pitchSemitones || 0, voicesSha256: c.voicesSha256 || null, approvedBy: c.approvedBy || null, approvedAt: c.approvedAt || null, autoReplace: c.autoReplace, voiceProfileId: c.voiceProfileId || null, voiceId: `${c.engine}:${c.voice}`, engine: c.engine, voice: c.voice, rate: c.rate, modelSha256: c.model?.sha256 || null, status: c.status, lockedBy: c.lockedBy, lockedAt: c.lockedAt }; }
  /** Export record for the Studio 5 shared voice library (see docs/media-automation/MASTER_VOICE_EXPORT.md). */
  exportForStudio5() { const c = this.cfg; return { schema: 'moonkatty.studio5.voice-profile/v1 (proposal)', id: c.id, displayName: 'MOONKATTY NEWS anchor', status: c.status, owner: 'moonkatty-news (media-automation)',
    engine: { name: 'kokoro-82m', runtime: 'kokoro-onnx', runtimeVersion: '0.6.1', model: { sha256: c.model.sha256, license: c.model.license || 'Apache-2.0' }, voicesPack: { file: 'voices-v1.0.bin', sha256: c.voicesSha256 } },
    voice: { type: Object.keys(c.blend).length === 1 ? 'stock-voice' : 'style-blend', blend: c.blend, speed: c.speed, pitchSemitones: c.pitchSemitones, emotionPitch: c.emotionPitch !== false, emotionControls: c.emotionPitch === false ? ['speed', 'pauses', 'gain'] : ['speed', 'pauses', 'gain', 'pitch'], lang: c.lang || 'en-us', sampleRateHz: 24000, deliveryFormat: 'wav 48kHz mono s16, -16 LUFS' },
    character: { gender: c.gender, accent: c.accent, perceivedAge: '25-35', description: 'Kokoro stock US male voice ' + c.voice + '; synthetic, imitates no real person' },
    emotionModes: Object.keys(require('../anchor/emotion').MODES), policy: { autoReplace: c.autoReplace, failIfUnavailable: true, changeRequires: 'owner unlock(by, reason)' },
    approval: { approvedBy: c.approvedBy, approvedAt: c.approvedAt, supersedes: c.supersedes || null, audit: c.audit || [] }, voiceProfileId: c.voiceProfileId || null }; }
}
module.exports = { MasterVoice, sha256File };
