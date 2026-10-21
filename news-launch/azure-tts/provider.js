'use strict';
const fs = require('fs');
const { run, probeDuration } = require('../../media-automation/src/video/exec');
const { DEFAULT_VOICE, resolveCap, CharacterBudget } = require('./budget');
const { SERVICE, readKey, redact } = require('./keychain');
const { buildSsml, countChars, DEFAULT_PRONUNCIATIONS } = require('./ssml');

const OUTPUT_FORMAT = 'riff-24khz-16bit-mono-pcm';

function assertRegion(region) {
  if (!/^[a-z0-9]+$/.test(String(region || ''))) {
    throw new Error('Azure Speech region is required and must be a lowercase Azure region name. Refusing to run.');
  }
}

function endpoint(region) {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

/**
 * Candidate Azure Speech provider. Disabled unless `enabled` is true.
 * Implements TTSProvider.synthesize(text, outWav) -> { file, durationSec }.
 * Not selected by detectTTS. Does not read the environment for the key.
 */
class AzureSpeechProvider {
  constructor({
    enabled = false,
    voice = DEFAULT_VOICE,
    region,
    tier,
    rate = null,
    allowPaid = false,
    paidCapChars,
    limitChars,
    stateFile,
    keyService = SERVICE,
    account,
    pronunciations,
    getKey,
    fetchFn,
    runFn = run,
    probeDurationFn = probeDuration,
    now,
    platform,
    spawnFn,
  } = {}) {
    this.enabled = enabled === true;
    this.voice = voice || DEFAULT_VOICE;
    this.region = region;
    this.tier = tier;
    this.rate = rate;
    this.allowPaid = allowPaid === true;
    this.paidCapChars = paidCapChars;
    this.limitChars = limitChars;
    this.stateFile = stateFile || require('path').join(__dirname, 'state', 'usage.json');
    this.keyService = keyService;
    this.account = account;
    this.pronunciations = pronunciations || DEFAULT_PRONUNCIATIONS;
    this.platform = platform || process.platform;
    this.spawnFn = spawnFn;
    this.getKey = getKey || (() => readKey({ service: this.keyService, account: this.account, spawnFn: this.spawnFn, platform: this.platform }));
    this.fetchFn = fetchFn || globalThis.fetch;
    this.runFn = runFn;
    this.probeDurationFn = probeDurationFn;
    this.now = now || (() => new Date());
    this.name = `azure:${this.voice}`;
  }
  assertConfig() {
    assertRegion(this.region);
    return resolveCap({
      tier: this.tier,
      allowPaid: this.allowPaid,
      limitChars: this.limitChars,
      paidCapChars: this.paidCapChars,
      voice: this.voice,
    });
  }
  async listVoices() {
    return [{ id: this.voice, lang: 'en-US' }];
  }
  async synthesize(text, outWav) {
    if (this.enabled !== true) throw new Error('Azure Speech provider is disabled.');
    if (!text || !String(text).trim()) throw new Error('TTS: empty text');
    const policy = this.assertConfig();
    const script = String(text);
    const ssml = buildSsml(script, { voice: policy.voice, rate: this.rate, pronunciations: this.pronunciations });
    if (typeof this.fetchFn !== 'function') throw new Error('Azure Speech HTTP client is unavailable. Refusing to run.');
    let key;
    try { key = await this.getKey(); }
    catch (e) {
      const msg = e && e.message;
      if (msg === 'Azure Speech key is not in the Keychain.' || msg === 'Azure Speech Keychain is macOS-only.') throw new Error(msg);
      throw new Error('Azure Speech key is not in the Keychain.');
    }
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw new Error('Azure Speech key is not in the Keychain.');
    const budget = new CharacterBudget({ stateFile: this.stateFile, limitChars: policy.limitChars, tier: policy.tier, now: this.now });
    const reserved = budget.reserve(countChars(script));
    const url = endpoint(this.region);
    let res;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'User-Agent': 'moonkatty-news',
        },
        body: ssml,
      });
    } catch (e) {
      throw new Error(`Azure Speech request failed. ${redact(e && e.message, key)}`);
    }
    if (!res || !res.ok) {
      let body = '';
      try { body = res && res.text ? await res.text() : ''; } catch (e) { body = redact(e && e.message, key); }
      const status = res && res.status ? res.status : 0;
      throw new Error(`Azure Speech HTTP ${status}. ${redact(body, key).slice(0, 300)}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) throw new Error('Azure Speech returned empty audio.');
    const raw = `${outWav}.azure.wav`;
    fs.writeFileSync(raw, bytes);
    try {
      await this.runFn('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
    } catch (e) {
      throw new Error(`Azure Speech audio conversion failed. ${redact(e && e.message, key)}`);
    } finally {
      fs.rmSync(raw, { force: true });
    }
    let durationSec;
    try { durationSec = await this.probeDurationFn(outWav, this.runFn); }
    catch (e) { throw new Error(`Azure Speech audio conversion failed. ${redact(e && e.message, key)}`); }
    return {
      file: outWav,
      durationSec,
      warnings: reserved.warnings,
      characters: reserved.characters,
      month: reserved.month,
      usedChars: reserved.usedChars,
      limitChars: reserved.limitChars,
    };
  }
}

module.exports = { AzureSpeechProvider, endpoint, OUTPUT_FORMAT };
