'use strict';
const fs = require('fs');
const path = require('path');

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
 * Decide the hard cap before any key lookup or HTTP call.
 * F0 cannot be raised. S0 does not run unless the owner set allowPaid and a cap.
 */
function resolveCap({ tier, allowPaid = false, limitChars, paidCapChars, voice = DEFAULT_VOICE } = {}) {
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
    if (allowPaid !== true) {
      throw new Error('Azure Speech tier S0 is the paid Standard tier. No request was sent. Set allowPaid=true and a paidCapChars per-month cap only after the owner accepts paid use.');
    }
    if (!Number.isInteger(paidCapChars) || paidCapChars < 1) {
      throw new Error('Azure Speech allowPaid requires a positive integer paidCapChars per-month cap. Refusing to run.');
    }
    return { tier, limitChars: paidCapChars, voice };
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

module.exports = { F0_FREE_CHARS, DEFAULT_VOICE, isHdVoice, utcMonth, warnThreshold, resolveCap, CharacterBudget };
