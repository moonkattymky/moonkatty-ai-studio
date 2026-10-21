'use strict';
const fs = require('fs');
const path = require('path');
const { verifyApproval } = require('./approval');

/** Published Free (F0) neural text-to-speech allowance. See RESEARCH.md. */
const F0_FREE_CHARS = 500000;
const DEFAULT_VOICE = 'en-US-AndrewMultilingualNeural';

function isHdVoice(voice) {
  const v = String(voice || '');
  return v.includes('DragonHD') || v.includes('MAI-Voice') || v.includes(':Dragon');
}

function utcMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Integer percent of the cap. 70% of 500000 is 350000. */
function warnThreshold(limit, percent) {
  return Math.ceil((limit * percent) / 100);
}

/**
 * Decide the guard before any key lookup or HTTP call.
 * F0 still refuses HD voices, allowPaid, and a limit above the published free quota.
 * synthesize charges the USD guard for every tier: the Speech key cannot show F0 versus S0.
 * S0 needs paidEnabled and a signed owner approval.
 */
function resolveCap({ tier, allowPaid = false, limitChars, paidCapChars, voice = DEFAULT_VOICE, region = null, paidEnabled = false, paidApproval = null, approvalPublicKeyPem = null, approvalMinSerial = 0, now = null, monthlyBudgetUsd = null, pricePerMillionChars = null } = {}) {
  if (tier !== 'F0' && tier !== 'S0') {
    const shown = tier == null || tier === '' ? 'missing' : String(tier);
    throw new Error(`Azure Speech pricing tier is unknown (${shown}). Refusing to run. Accepted values are F0 and S0.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(String(voice))) {
    throw new Error('Azure Speech voice name is invalid. Refusing to run.');
  }
  if (isHdVoice(voice) && tier === 'F0') {
    throw new Error(`Azure Speech voice ${voice} is an HD voice. The F0 allowance on the pricing page is labeled Neural, not Neural HD. Refusing to run.`);
  }
  if (tier === 'S0') {
    const clock = typeof now === 'function' ? now() : now;
    if (paidEnabled !== true || !verifyApproval(paidApproval, approvalPublicKeyPem, { voice, region, now: clock, minSerial: approvalMinSerial })) {
      throw new Error('Azure Speech S0 calls are refused. paidEnabled and an owner approval record (timestamp and who) are both required. No request was sent.');
    }
    return { tier, voice, monthlyBudgetUsd, pricePerMillionChars, paidApproval };
  }
  if (allowPaid === true) {
    throw new Error('Azure Speech allowPaid does not apply to tier F0. The free tier stays inside its published quota. Refusing to run.');
  }
  const cap = limitChars == null ? F0_FREE_CHARS : limitChars;
  if (!Number.isInteger(cap) || cap < 1 || cap > F0_FREE_CHARS) {
    throw new Error('Azure Speech F0 limitChars must be a positive integer no greater than the published free quota of 500000. Refusing to run.');
  }
  return { tier, limitChars: cap, voice };
}

function unreadable() {
  throw new Error('Azure Speech usage state is unreadable. Refusing to run.');
}

function readState(file) {
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { unreadable(); }
  if (!data || typeof data !== 'object' || !/^\d{4}-\d{2}$/.test(data.month) || !Number.isInteger(data.usedChars) || data.usedChars < 0) unreadable();
  return { month: data.month, usedChars: data.usedChars };
}

function writeState(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw e;
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Exclusive lock file so two processes cannot reserve the same month together. */
function withFileLock(lockFile, fn) {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const start = Date.now();
  for (;;) {
    let fd;
    try {
      fd = fs.openSync(lockFile, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try { stale = Date.now() - fs.statSync(lockFile).mtimeMs > 30000; } catch { stale = true; }
      if (stale) { try { fs.rmSync(lockFile, { force: true }); } catch { /* retry */ } continue; }
      if (Date.now() - start > 2000) throw new Error('Azure Speech budget lock is held. Refusing to run.');
      pause(15);
      continue;
    }
    try {
      fs.writeSync(fd, String(process.pid));
      return fn();
    } finally {
      try { fs.closeSync(fd); } catch { /* ignore */ }
      try { fs.rmSync(lockFile, { force: true }); } catch { /* ignore */ }
    }
  }
}

/**
 * Persistent monthly character counter. The month is the UTC calendar month.
 * reserve() counts BEFORE the HTTP call. A blocked request is not added.
 * A failed HTTP call is not refunded; the caller must not ask for a refund.
 */
class CharacterBudget {
  constructor({ stateFile, limitChars, tier = 'F0', now = () => new Date() } = {}) {
    if (!stateFile) throw new Error('Azure Speech usage state file is required.');
    if (!Number.isInteger(limitChars) || limitChars < 1) throw new Error('Azure Speech character cap must be a positive integer.');
    this.stateFile = stateFile;
    this.limitChars = limitChars;
    this.tier = tier;
    this.now = now;
  }
  reserve(chars) {
    return withFileLock(`${this.stateFile}.lock`, () => this._reserve(chars));
  }
  _reserve(chars) {
    if (!Number.isInteger(chars) || chars < 1) throw new Error('Azure Speech character count must be a positive integer. Refusing to run.');
    const month = utcMonth(this.now());
    const loaded = readState(this.stateFile);
    let used = loaded && loaded.month === month ? loaded.usedChars : 0;
    const rolled = !loaded || loaded.month !== month;
    if (used + chars > this.limitChars) {
      if (rolled) writeState(this.stateFile, { month, usedChars: 0, tier: this.tier, limitChars: this.limitChars });
      throw new Error(`Azure Speech monthly character cap reached (${used}+${chars} > ${this.limitChars} for ${month}). No request was sent.`);
    }
    const before = used;
    used += chars;
    const warnings = [];
    const t70 = warnThreshold(this.limitChars, 70);
    const t90 = warnThreshold(this.limitChars, 90);
    if (before < t70 && used >= t70) warnings.push(`Azure Speech character use reached 70% of the monthly cap (${used}/${this.limitChars} in ${month}).`);
    if (before < t90 && used >= t90) warnings.push(`Azure Speech character use reached 90% of the monthly cap (${used}/${this.limitChars} in ${month}).`);
    writeState(this.stateFile, { month, usedChars: used, tier: this.tier, limitChars: this.limitChars });
    return { month, usedChars: used, limitChars: this.limitChars, warnings, characters: chars };
  }
}

module.exports = { F0_FREE_CHARS, DEFAULT_VOICE, isHdVoice, utcMonth, warnThreshold, resolveCap, CharacterBudget, withFileLock, writeState };
