'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, probeDuration } = require('../../media-automation/src/video/exec');
const { DEFAULT_VOICE, resolveCap, CharacterBudget } = require('./budget');
const { resolvePrice, UsdBudget } = require('./usd');
const { SERVICE, readKey, redact } = require('./keychain');
const { buildSsml, DEFAULT_PRONUNCIATIONS } = require('./ssml');
const { appendLedger, ledgerPath } = require('./ledger');

const OUTPUT_FORMAT = 'riff-24khz-16bit-mono-pcm';

function assertRegion(region) {
  if (!/^[a-z0-9]+$/.test(String(region || ''))) {
    throw new Error('Azure Speech region is required and must be a lowercase Azure region name. Refusing to run.');
  }
}

function endpoint(region) {
  return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
}

function requestHash({ text, voice, rate, ssml }) {
  return crypto.createHash('sha256').update(String(voice)).update('\0').update(String(rate ?? '')).update('\0').update(ssml).update('\0').update(String(text)).digest('hex');
}

function retryable(err, status) {
  if (status === 408 || status === 429 || status >= 500) return true;
  const name = err && err.name;
  const code = err && err.code;
  if (name === 'AbortError' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return true;
  return /timeout/i.test(String(err && err.message || ''));
}

/**
 * Candidate Azure Speech provider. Disabled unless `enabled` is true.
 * S0 does not call the network unless paidEnabled is true and paidApproval has at and by.
 * Billable length is the full SSML payload. Identical text+voice+SSML is served from cache at $0.
 */
class AzureSpeechProvider {
  constructor({
    enabled = false,
    voice = DEFAULT_VOICE,
    region,
    tier,
    rate = null,
    allowPaid = false,
    paidEnabled = false,
    paidApproval = null,
    monthlyBudgetUsd = null,
    pricePerMillionChars = null,
    paidCapChars,
    limitChars,
    stateFile,
    ledgerDir,
    cacheDir,
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
    maxAttempts = 2,
    timeoutMs = 15000,
  } = {}) {
    this.enabled = enabled === true;
    this.voice = voice || DEFAULT_VOICE;
    this.region = region;
    this.tier = tier;
    this.rate = rate;
    this.allowPaid = allowPaid === true;
    this.paidEnabled = paidEnabled === true;
    this.paidApproval = paidApproval || null;
    this.monthlyBudgetUsd = monthlyBudgetUsd;
    this.pricePerMillionChars = pricePerMillionChars;
    this.paidCapChars = paidCapChars;
    this.limitChars = limitChars;
    this.stateFile = stateFile || path.join(__dirname, 'state', 'usage.json');
    this.ledgerDir = ledgerDir || path.dirname(this.stateFile);
    this.cacheDir = cacheDir || path.join(path.dirname(this.stateFile), 'cache');
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
    this.maxAttempts = Number.isInteger(maxAttempts) && maxAttempts >= 1 ? maxAttempts : 2;
    this.timeoutMs = timeoutMs;
    this.name = `azure:${this.voice}`;
  }
  assertConfig() {
    assertRegion(this.region);
    const policy = resolveCap({
      tier: this.tier,
      allowPaid: this.allowPaid,
      limitChars: this.limitChars,
      paidCapChars: this.paidCapChars,
      voice: this.voice,
      paidEnabled: this.paidEnabled,
      paidApproval: this.paidApproval,
      monthlyBudgetUsd: this.monthlyBudgetUsd,
      pricePerMillionChars: this.pricePerMillionChars,
    });
    if (policy.tier === 'S0') {
      const price = resolvePrice({ voice: policy.voice, pricePerMillionChars: this.pricePerMillionChars, monthlyBudgetUsd: this.monthlyBudgetUsd });
      return { ...policy, ...price };
    }
    return policy;
  }
  async listVoices() {
    return [{ id: this.voice, lang: 'en-US' }];
  }
  _cacheFile(hash) {
    return path.join(this.cacheDir, hash);
  }
  _readCache(hash) {
    const file = this._cacheFile(hash);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }
  _writeCache(hash, bytes) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const file = this._cacheFile(hash);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  _note(entry, secret) {
    const at = this.now().toISOString();
    appendLedger(ledgerPath(this.ledgerDir, entry.month), { at, ...entry }, secret);
  }
  async _toWav(bytes, outWav, secret) {
    const raw = `${outWav}.azure.wav`;
    fs.writeFileSync(raw, bytes);
    try {
      await this.runFn('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
    } catch (e) {
      throw new Error(`Azure Speech audio conversion failed. ${redact(e && e.message, secret)}`);
    } finally {
      fs.rmSync(raw, { force: true });
    }
    try { return await this.probeDurationFn(outWav, this.runFn); }
    catch (e) { throw new Error(`Azure Speech audio conversion failed. ${redact(e && e.message, secret)}`); }
  }
  async synthesize(text, outWav) {
    if (this.enabled !== true) throw new Error('Azure Speech provider is disabled.');
    if (!text || !String(text).trim()) throw new Error('TTS: empty text');
    const policy = this.assertConfig();
    const script = String(text);
    const ssml = buildSsml(script, { voice: policy.voice, rate: this.rate, pronunciations: this.pronunciations });
    const characters = ssml.length;
    const hash = requestHash({ text: script, voice: policy.voice, rate: this.rate, ssml });
    const requestId = hash.slice(0, 16);
    if (typeof this.fetchFn !== 'function') throw new Error('Azure Speech HTTP client is unavailable. Refusing to run.');
    const cached = this._readCache(hash);
    if (cached) {
      const durationSec = await this._toWav(cached, outWav);
      const month = (this.now().toISOString()).slice(0, 7);
      this._note({ month, chars: 0, estCostUsd: '0.000000', status: 'cache', requestId, attempt: 0 });
      return { file: outWav, durationSec, warnings: [], characters: 0, month, requestId, cached: true, attempts: 0 };
    }
    let key;
    try { key = await this.getKey(); }
    catch (e) {
      const msg = e && e.message;
      if (msg === 'Azure Speech key is not in the Keychain.' || msg === 'Azure Speech Keychain is macOS-only.') throw new Error(msg);
      throw new Error('Azure Speech key is not in the Keychain.');
    }
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw new Error('Azure Speech key is not in the Keychain.');
    const warnings = [];
    let lastError = null;
    let usd = null;
    if (policy.tier === 'S0') {
      usd = new UsdBudget({
        stateFile: this.stateFile,
        monthlyBudgetUsd: policy.monthlyBudgetUsd,
        pricePerMillionChars: policy.pricePerMillionChars,
        now: this.now,
      });
    }
    const charsBudget = policy.tier === 'F0'
      ? new CharacterBudget({ stateFile: this.stateFile, limitChars: policy.limitChars, tier: 'F0', now: this.now })
      : null;
    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        let reserved;
        try {
          if (usd) reserved = usd.begin({ chars: characters, hash });
          else reserved = charsBudget.reserve(characters);
        } catch (e) {
          if (e.code === 'BUDGET' && e.projected) {
            this._note({ month: e.projected.month, chars: e.projected.chars, estCostUsd: e.projected.estCostUsd, status: 'blocked', requestId, attempt });
          }
          throw e;
        }
        if (reserved && reserved.busy) throw new Error('Azure Speech identical request is already in flight. No second request was sent.');
        if (reserved.warnings) warnings.push(...reserved.warnings);
        const month = reserved.month;
        this._note({ month, chars: characters, estCostUsd: reserved.estCostUsd || '0.000000', status: 'reserved', requestId, attempt }, key);
        let res;
        let timer;
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        if (controller && this.timeoutMs) timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          res = await this.fetchFn(endpoint(this.region), {
            method: 'POST',
            headers: {
              'Ocp-Apim-Subscription-Key': key,
              'Content-Type': 'application/ssml+xml',
              'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
              'User-Agent': 'moonkatty-news',
              'X-Client-Request-Id': requestId,
            },
            body: ssml,
            signal: controller ? controller.signal : undefined,
          });
        } catch (e) {
          lastError = e;
          const statusName = retryable(e) ? 'timeout' : 'failed';
          this._note({ month, chars: characters, estCostUsd: reserved.estCostUsd || '0.000000', status: statusName, requestId, attempt }, key);
          if (retryable(e) && attempt < this.maxAttempts) continue;
          throw new Error(`Azure Speech request failed. ${redact(e && e.message, key)}`);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (!res || !res.ok) {
          let body = '';
          try { body = res && res.text ? await res.text() : ''; } catch (e) { body = redact(e && e.message, key); }
          const status = res && res.status ? res.status : 0;
          this._note({ month, chars: characters, estCostUsd: reserved.estCostUsd || '0.000000', status: 'failed', requestId, attempt }, key);
          lastError = new Error(`Azure Speech HTTP ${status}. ${redact(body, key).slice(0, 300)}`);
          if (retryable(null, status) && attempt < this.maxAttempts) continue;
          throw lastError;
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!bytes.length) {
          this._note({ month, chars: characters, estCostUsd: reserved.estCostUsd || '0.000000', status: 'failed', requestId, attempt }, key);
          throw new Error('Azure Speech returned empty audio.');
        }
        this._writeCache(hash, bytes);
        this._note({ month, chars: characters, estCostUsd: reserved.estCostUsd || '0.000000', status: 'ok', requestId, attempt }, key);
        const durationSec = await this._toWav(bytes, outWav, key);
        return {
          file: outWav,
          durationSec,
          warnings,
          characters,
          month,
          usedChars: reserved.usedChars,
          limitChars: reserved.limitChars,
          spentMicro: reserved.spentMicro,
          estCostUsd: reserved.estCostUsd || '0.000000',
          requestId,
          attempts: attempt,
          cached: false,
        };
      }
    } finally {
      if (usd) usd.clearInflight(hash);
    }
    throw lastError || new Error('Azure Speech request failed.');
  }
}

module.exports = { AzureSpeechProvider, endpoint, OUTPUT_FORMAT, requestHash };
