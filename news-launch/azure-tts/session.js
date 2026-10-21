'use strict';
const { episodeRecord, writeEpisodeRecord } = require('./disclosure');

const DEFAULT_FALLBACK = Object.freeze({ engine: 'kokoro', voice: 'am_michael' });

function classifyAzure(err) {
  const message = String(err && err.message || '');
  if (/disabled/.test(message)) return 'disabled';
  if (/key is not in the Keychain|macOS-only/.test(message)) return 'no-key';
  if (/budget reached|cap reached|BUDGET/.test(message)) return 'budget-blocked';
  if (/S0 calls are refused|paidEnabled|owner approval/.test(message)) return 'not-approved';
  return 'error';
}

/**
 * Episode voice. Azure is attempted only when the caller passes an enabled provider.
 * Disabled, missing key, budget block, missing paid permission, and request errors
 * use the local engine. A final render that did not use Azure is marked voice:fallback
 * for owner review. The raw Azure error is not copied into the episode file.
 */
class VoiceSession {
  constructor({ azure, local, episodeFile, summary = '', showCaption = false, fallback = DEFAULT_FALLBACK } = {}) {
    if (!azure) throw new Error('Azure Speech session needs a provider.');
    this.azure = azure;
    this.local = local || null;
    this.episodeFile = episodeFile || null;
    this.summary = summary;
    this.showCaption = showCaption === true;
    this.fallback = fallback || DEFAULT_FALLBACK;
  }
  _store(record) {
    if (this.episodeFile) writeEpisodeRecord(this.episodeFile, record);
    return record;
  }
  async render(text, outWav, { episodeId = null, final = false } = {}) {
    try {
      const spoken = await this.azure.synthesize(text, outWav);
      const record = this._store(episodeRecord({
        episodeId,
        engine: this.azure.name,
        voice: this.azure.voice,
        final,
        summary: this.summary,
        showCaption: this.showCaption,
      }));
      return { ...spoken, ...record };
    } catch (err) {
      const azureStatus = classifyAzure(err);
      if (!this.local || typeof this.local.synthesize !== 'function') {
        this._store(episodeRecord({
          episodeId,
          engine: `${this.fallback.engine}:${this.fallback.voice}`,
          voice: 'fallback',
          final: true,
          summary: this.summary,
          azureStatus,
        }));
        throw err;
      }
      let spoken;
      try { spoken = await this.local.synthesize(text, outWav); }
      catch (localErr) {
        this._store(episodeRecord({
          episodeId,
          engine: this.local.name || `${this.fallback.engine}:${this.fallback.voice}`,
          voice: 'fallback',
          final: true,
          summary: this.summary,
          azureStatus,
        }));
        throw localErr;
      }
      const record = this._store(episodeRecord({
        episodeId,
        engine: this.local.name || `${this.fallback.engine}:${this.fallback.voice}`,
        voice: 'fallback',
        final,
        summary: this.summary,
        azureStatus,
      }));
      if (final && record.voice !== 'fallback') throw new Error('Azure Speech fallback was not marked. Refusing to finish the render.');
      return { ...spoken, ...record, fallback: true };
    }
  }
}

module.exports = { VoiceSession, classifyAzure, DEFAULT_FALLBACK };
