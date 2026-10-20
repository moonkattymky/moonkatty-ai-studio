'use strict';
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const { KokoroTTS, PiperTTS, MacSayTTS } = require('./tts');
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
    if (c.engine === 'kokoro') { const voices = expand(c.voicesFile, this.env); if (!voices || !fs.existsSync(voices)) throw new Error('MASTER VOICE unavailable: kokoro voices file missing');
      return new KokoroTTS({ python: this.env.MA_KOKORO_PYTHON || 'python3', model, voices, voice: c.voice, speed: c.rate || 1 }); }
    if (c.engine === 'piper') return new PiperTTS({ model, bin: this.env.MA_PIPER_BIN || 'piper', lengthScale: c.rate ? 1 / c.rate : 1 });
    if (c.engine === 'say') { if (process.platform !== 'darwin') throw new Error('MASTER VOICE unavailable: macOS say requires macOS'); return new MacSayTTS({ voice: c.voice, rate: c.rate }); }
    throw new Error('unknown master voice engine ' + c.engine);
  }
  setCandidate(next, by) { if (this.locked) throw new Error('MASTER VOICE is locked; unlock(by, reason) first'); this.cfg = { ...this.cfg, ...next, status: 'candidate', changedBy: by, changedAt: new Date().toISOString() }; this._save(); return this.cfg; }
  lock(by) { if (!by) throw new Error('owner name required'); this.createTTS(); this.cfg.status = 'locked'; this.cfg.lockedBy = by; this.cfg.lockedAt = new Date().toISOString(); this.cfg.note = 'Approved master voice. Do not change without owner.'; this._save(); return this.cfg; }
  unlock(by, reason) { if (!by || !reason) throw new Error('owner and reason required'); (this.cfg.audit = this.cfg.audit || []).push({ at: new Date().toISOString(), by, action: 'unlock', reason }); this.cfg.status = 'candidate'; this._save(); return this.cfg; }
  /** Export for the Studio 3D lip-sync pipeline. */
  exportForLipSync() { const c = this.cfg; return { voiceId: `${c.engine}:${c.voice}`, engine: c.engine, voice: c.voice, rate: c.rate, modelSha256: c.model?.sha256 || null, status: c.status, lockedBy: c.lockedBy, lockedAt: c.lockedAt }; }
}
module.exports = { MasterVoice, sha256File };
