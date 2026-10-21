'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { run, probeDuration } = require('../../media-automation/src/video/exec');
const { DEFAULT_VOICE, resolveCap } = require('./budget');
const { resolvePrice, UsdBudget } = require('./usd');
const { SERVICE, readKey, redact } = require('./keychain');
const { buildSsml, DEFAULT_PRONUNCIATIONS } = require('./ssml');
const { appendLedger, ledgerPath, ledgerHasOk, ledgerOkMac } = require('./ledger');
const { readOwnerPrice } = require('./price');
const { OWNER_UNREADABLE } = require('./keychain');

const CACHE_KEY_FILE = path.join(__dirname, 'state', 'cache-mac.key');

function readCacheKeyFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  if (!st.isFile() || (st.mode & 0o077) !== 0) {
    throw new Error('Azure Speech cache key must be owner-only (mode 0600). Refusing to run.');
  }
  const key = fs.readFileSync(file, 'utf8').trim();
  if (!key) throw new Error('Azure Speech cache key is unreadable. Refusing to run.');
  return key;
}

function writeCacheKeyFile(file, key) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

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

function cacheMac(key, hash, audio) {
  return crypto.createHmac('sha256', key).update(String(hash)).update(audio).digest('hex');
}

function sealCache(key, hash, audio) {
  const body = Buffer.from(audio);
  return Buffer.from(JSON.stringify({ v: 1, hash, mac: cacheMac(key, hash, body), audio: body.toString('base64') }));
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
 * Every call is budgeted in USD. The Speech key cannot reveal F0 versus S0.
 * S0 also needs paidEnabled and an approval signature that has not expired.
 * Cache hits need an HMAC under a cache key, not the speech key, and a matching ledger mac.
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
    approvalPublicKeyPem = null,
    approvalMinSerial = 0,
    budgetGrant = null,
    monthlyBudgetUsd = null,
    pricePerMillionChars = null,
    priceFile = null,
    skuProbe = null,
    paidCapChars,
    limitChars,
    stateFile,
    ledgerDir,
    cacheDir,
    cacheKey = null,
    cacheKeyFile = null,
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
    this.approvalPublicKeyPem = approvalPublicKeyPem || null;
    this.approvalMinSerial = Number.isInteger(approvalMinSerial) ? approvalMinSerial : 0;
    this.budgetGrant = budgetGrant || null;
    this.monthlyBudgetUsd = monthlyBudgetUsd;
    this.pricePerMillionChars = pricePerMillionChars;
    this.priceFile = priceFile || null;
    this.skuProbe = skuProbe;
    this.paidCapChars = paidCapChars;
    this.limitChars = limitChars;
    this.stateFile = stateFile || path.join(__dirname, 'state', 'usage.json');
    this.ledgerDir = ledgerDir || path.dirname(this.stateFile);
    this.cacheDir = cacheDir || path.join(path.dirname(this.stateFile), 'cache');
    this.cacheKey = cacheKey || null;
    this.cacheKeyFile = cacheKeyFile || CACHE_KEY_FILE;
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
      region: this.region,
      paidEnabled: this.paidEnabled,
      paidApproval: this.paidApproval,
      approvalPublicKeyPem: this.approvalPublicKeyPem,
      approvalMinSerial: this.approvalMinSerial,
      now: this.now,
      monthlyBudgetUsd: this.monthlyBudgetUsd,
      pricePerMillionChars: this.pricePerMillionChars,
    });
    const clock = this.now();
    const fromFile = this.priceFile ? readOwnerPrice(this.priceFile, policy.voice, { approvalPublicKeyPem: this.approvalPublicKeyPem, now: clock }) : null;
    const price = resolvePrice({
      voice: policy.voice,
      pricePerMillionChars: fromFile ? fromFile.pricePerMillionChars : this.pricePerMillionChars,
      monthlyBudgetUsd: fromFile ? fromFile.monthlyBudgetUsd : this.monthlyBudgetUsd,
      budgetGrant: fromFile ? fromFile.budgetGrant : this.budgetGrant,
      approvalPublicKeyPem: this.approvalPublicKeyPem,
      now: clock,
    });
    return { ...policy, ...price };
  }
  async _observedSku(policy) {
    if (typeof this.skuProbe !== 'function') return null;
    let sku;
    try { sku = await this.skuProbe(); } catch {
      throw new Error('Azure Speech resource sku check failed. Refusing to run.');
    }
    const shown = sku == null || sku === '' ? 'missing' : String(sku);
    if (sku !== 'F0' && sku !== 'S0') throw new Error(`Azure Speech resource sku is unknown (${shown}). Refusing to run.`);
    if (sku !== policy.tier) throw new Error(`Azure Speech resource sku is ${sku} and the config says ${policy.tier}. Refusing to run. No request was sent.`);
    return sku;
  }
  async listVoices() {
    return [{ id: this.voice, lang: 'en-US' }];
  }
  _cacheFile(hash) {
    return path.join(this.cacheDir, hash);
  }
  _cacheKey() {
    if (this.cacheKey) return this.cacheKey;
    const key = readCacheKeyFile(this.cacheKeyFile);
    if (key) this.cacheKey = key;
    return key;
  }
  _ensureCacheKey() {
    const existing = this._cacheKey();
    if (existing) return existing;
    const created = crypto.randomBytes(32).toString('hex');
    writeCacheKeyFile(this.cacheKeyFile, created);
    this.cacheKey = created;
    return created;
  }
  _openCache(hash, key) {
    const file = this._cacheFile(hash);
    if (!fs.existsSync(file)) return null;
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    if (!data || data.v !== 1 || data.hash !== hash || typeof data.mac !== 'string' || typeof data.audio !== 'string') return null;
    const audio = Buffer.from(data.audio, 'base64');
    const mac = cacheMac(key, hash, audio);
    const left = Buffer.from(mac);
    const right = Buffer.from(data.mac);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    if (!ledgerHasOk(this.ledgerDir, hash.slice(0, 16), key)) return null;
    return audio;
  }
  _writeCache(hash, bytes, key) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const file = this._cacheFile(hash);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, sealCache(key, hash, bytes), { mode: 0o600 });
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
    await this._observedSku(policy);
    const cacheKey = this._cacheKey();
    const cached = cacheKey ? this._openCache(hash, cacheKey) : null;
    if (cached) {
      const durationSec = await this._toWav(cached, outWav, '');
      const month = (this.now().toISOString()).slice(0, 7);
      this._note({ month, chars: 0, estCostUsd: '0.000000', status: 'cache', requestId, attempt: 0 });
      return {
        file: outWav, durationSec, warnings: [], characters: 0, month, requestId,
        ledgerRequestId: requestId, cached: true, attempts: 0,
      };
    }
    let key;
    try { key = await this.getKey(); }
    catch (e) {
      const msg = e && e.message;
      if (msg === 'Azure Speech key is not in the Keychain.' || msg === 'Azure Speech Keychain is macOS-only.' || msg === OWNER_UNREADABLE) throw new Error(msg);
      throw new Error('Azure Speech key is not in the Keychain.');
    }
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) throw new Error('Azure Speech key is not in the Keychain.');
    const warnings = [];
    let lastError = null;
    const usd = new UsdBudget({
      stateFile: this.stateFile,
      ledgerDir: this.ledgerDir,
      monthlyBudgetUsd: policy.monthlyBudgetUsd,
      pricePerMillionChars: policy.pricePerMillionChars,
      budgetGrant: policy.budgetGrant,
      approvalPublicKeyPem: this.approvalPublicKeyPem,
      voice: policy.voice,
      now: this.now,
    });
    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        let reserved;
        try {
          reserved = usd.begin({ chars: characters, hash });
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
        const sealKey = this._ensureCacheKey();
        this._writeCache(hash, bytes, sealKey);
        this._note({
          month, chars: characters, estCostUsd: reserved.estCostUsd || '0.000000', status: 'ok', requestId, attempt,
          mac: ledgerOkMac(sealKey, requestId),
        }, key);
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

module.exports = { AzureSpeechProvider, endpoint, OUTPUT_FORMAT, requestHash, cacheMac, sealCache, CACHE_KEY_FILE };
