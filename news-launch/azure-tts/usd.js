'use strict';
const fs = require('fs');
const path = require('path');
const { isHdVoice, utcMonth, warnThreshold, withFileLock, writeState } = require('./budget');
const { inspectLedger, ledgerPath } = require('./ledger');
const { BUDGET_CEILING_USD, budgetMicro, verifyBudgetGrant } = require('./approval');

/**
 * Retail Prices API, queried 21 October 2026.
 * Neural: meter "S1 Neural Text To Speech Characters", unitPrice 15 USD per 1M.
 * HD: meter "Neural HD Text to Speech Characters", unitPrice 22 USD per 1M.
 * https://prices.azure.com/api/retail/prices
 * The quotas page calls the paid tier S0. The retail neural sku is labeled S1.
 */
const PRICE_SOURCE = Object.freeze({
  url: 'https://prices.azure.com/api/retail/prices',
  accessed: '2026-10-21',
  neuralUsdPerMillion: 15,
  hdUsdPerMillion: 22,
});
const NEURAL_USD_PER_MILLION = PRICE_SOURCE.neuralUsdPerMillion;
const HD_USD_PER_MILLION = PRICE_SOURCE.hdUsdPerMillion;
const DEFAULT_MONTHLY_BUDGET_USD = 1;

function assertUsd(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Azure Speech ${label} must be a positive number. Refusing to run.`);
  }
}

function retailFloor(voice) {
  return isHdVoice(voice) ? HD_USD_PER_MILLION : NEURAL_USD_PER_MILLION;
}

function resolvePrice({ voice, pricePerMillionChars = null, monthlyBudgetUsd = null, budgetGrant = null, approvalPublicKeyPem = null, now } = {}) {
  const floor = retailFloor(voice);
  const pricePerMillion = pricePerMillionChars == null ? floor : pricePerMillionChars;
  const budgetUsd = monthlyBudgetUsd == null ? DEFAULT_MONTHLY_BUDGET_USD : monthlyBudgetUsd;
  assertUsd(pricePerMillion, 'pricePerMillionChars');
  assertUsd(budgetUsd, 'monthlyBudgetUsd');
  if (pricePerMillion + 1e-9 < floor) {
    throw new Error(`Azure Speech pricePerMillionChars ${pricePerMillion} is below the retail floor of ${floor.toFixed(2)}. Refusing to run.`);
  }
  const micro = budgetMicro(budgetUsd);
  const ceiling = budgetMicro(BUDGET_CEILING_USD);
  if (micro == null || micro < 1) throw new Error('Azure Speech monthlyBudgetUsd must be a positive number. Refusing to run.');
  let grant = null;
  if (micro > ceiling) {
    if (!verifyBudgetGrant(budgetGrant, approvalPublicKeyPem, { micro, now })) {
      throw new Error(`Azure Speech monthlyBudgetUsd ${budgetUsd} is above the ceiling of ${BUDGET_CEILING_USD.toFixed(2)}. An owner-signed budget record is required. Refusing to run.`);
    }
    grant = budgetGrant;
  }
  return { pricePerMillionChars: pricePerMillion, monthlyBudgetUsd: micro / 1000000, floor, budgetGrant: grant };
}

function toMicro(usd) {
  return Math.round(usd * 1000000);
}

/** Conservative: round the estimated charge up to the next micro-dollar. */
function costMicro(chars, pricePerMillion) {
  if (!Number.isInteger(chars) || chars < 1) throw new Error('Azure Speech character count must be a positive integer. Refusing to run.');
  const priceMicro = Math.round(pricePerMillion * 1000000);
  return Math.ceil((chars * priceMicro) / 1000000);
}

function formatUsd(micro) {
  return (micro / 1000000).toFixed(6);
}

function readUsd(file) {
  if (!fs.existsSync(file)) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('Azure Speech usage state is unreadable. Refusing to run.'); }
  if (!data || typeof data !== 'object' || !/^\d{4}-\d{2}$/.test(data.month)) throw new Error('Azure Speech usage state is unreadable. Refusing to run.');
  if (!Number.isInteger(data.spentMicro) || data.spentMicro < 0) throw new Error('Azure Speech usage state is unreadable. Refusing to run.');
  const history = {};
  if (data.history != null) {
    if (typeof data.history !== 'object' || Array.isArray(data.history)) throw new Error('Azure Speech usage state is unreadable. Refusing to run.');
    for (const [month, entry] of Object.entries(data.history)) {
      if (!/^\d{4}-\d{2}$/.test(month) || !entry || !Number.isInteger(entry.spentMicro) || entry.spentMicro < 0) {
        throw new Error('Azure Speech usage state is unreadable. Refusing to run.');
      }
      history[month] = { spentMicro: entry.spentMicro };
    }
  }
  return {
    month: data.month,
    spentMicro: data.spentMicro,
    reconciliation: data.reconciliation || null,
    inflight: data.inflight && typeof data.inflight === 'object' ? data.inflight : {},
    history,
  };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/**
 * USD guard for Standard (S0). Spent is integer micro-dollars for the UTC month.
 * reserve() runs before HTTP. A blocked request is not added. Failures are not refunded.
 */
class UsdBudget {
  constructor({ stateFile, ledgerDir = null, monthlyBudgetUsd = DEFAULT_MONTHLY_BUDGET_USD, pricePerMillionChars = NEURAL_USD_PER_MILLION, voice = null, budgetGrant = null, approvalPublicKeyPem = null, now = () => new Date() } = {}) {
    if (!stateFile) throw new Error('Azure Speech usage state file is required.');
    const price = resolvePrice({
      voice, pricePerMillionChars, monthlyBudgetUsd, budgetGrant, approvalPublicKeyPem, now: now(),
    });
    this.stateFile = stateFile;
    this.ledgerDir = ledgerDir || path.dirname(stateFile);
    this.monthlyBudgetUsd = price.monthlyBudgetUsd;
    this.pricePerMillionChars = price.pricePerMillionChars;
    this.budgetMicro = toMicro(price.monthlyBudgetUsd);
    this.now = now;
    this.lockFile = `${stateFile}.lock`;
  }
  _ledger() {
    return inspectLedger(ledgerPath(this.ledgerDir, utcMonth(this.now())));
  }
  _load() {
    const month = utcMonth(this.now());
    const ledger = this._ledger();
    const loaded = readUsd(this.stateFile);
    if (!loaded) {
      if (ledger.lines > 0) throw new Error('Azure Speech usage state is missing but the ledger exists. Refusing to run.');
      return { month, spentMicro: 0, reconciliation: null, inflight: {}, history: {}, rolled: true };
    }
    const history = { ...loaded.history };
    let spent = loaded.spentMicro;
    let reconciliation = loaded.reconciliation;
    let inflight = loaded.inflight;
    let rolled = false;
    if (loaded.month !== month) {
      history[loaded.month] = { spentMicro: loaded.spentMicro };
      if (history[month]) spent = history[month].spentMicro;
      else if (ledger.lines > 0) throw new Error('Azure Speech usage state does not match this month and the ledger exists. Refusing to run.');
      else spent = 0;
      reconciliation = null;
      inflight = {};
      rolled = true;
    }
    if (ledger.lines > 0 && spent < ledger.spentMicro) throw new Error('Azure Speech usage state is below the ledger. Refusing to run.');
    return { month, spentMicro: spent, reconciliation, inflight, history, rolled };
  }
  _save(state) {
    const history = { ...state.history };
    delete history[state.month];
    writeState(this.stateFile, {
      month: state.month,
      spentMicro: state.spentMicro,
      budgetMicro: this.budgetMicro,
      monthlyBudgetUsd: this.monthlyBudgetUsd,
      pricePerMillionChars: this.pricePerMillionChars,
      tier: 'S0',
      reconciliation: state.reconciliation,
      inflight: state.inflight,
      history,
    });
  }
  /**
   * Claim this hash for the current process and reserve the cost.
   * cacheHit and busy do not add spend.
   */
  begin({ chars, hash, cacheHit = false }) {
    return withFileLock(this.lockFile, () => {
      const state = this._load();
      if (cacheHit) {
        if (state.rolled) this._save(state);
        return { cache: true, month: state.month, spentMicro: state.spentMicro, budgetMicro: this.budgetMicro, warnings: [], characters: 0, costMicro: 0, estCostUsd: formatUsd(0) };
      }
      const flight = state.inflight[hash];
      if (flight && flight.pid !== process.pid && pidAlive(flight.pid) && Date.now() - Date.parse(flight.at) < 120000) {
        return { busy: true, month: state.month, spentMicro: state.spentMicro, budgetMicro: this.budgetMicro };
      }
      const cost = costMicro(chars, this.pricePerMillionChars);
      if (state.spentMicro + cost > this.budgetMicro) {
        if (state.rolled) this._save(state);
        const err = new Error(`Azure Speech monthly budget reached ($${(state.spentMicro / 1000000).toFixed(2)} + $${(cost / 1000000).toFixed(6)} > $${(this.budgetMicro / 1000000).toFixed(2)} for ${state.month}). No request was sent.`);
        err.code = 'BUDGET';
        err.projected = { chars, costMicro: cost, estCostUsd: formatUsd(cost), month: state.month, spentMicro: state.spentMicro };
        throw err;
      }
      const before = state.spentMicro;
      state.spentMicro += cost;
      state.inflight[hash] = { pid: process.pid, at: this.now().toISOString() };
      const warnings = [];
      const t70 = warnThreshold(this.budgetMicro, 70);
      const t90 = warnThreshold(this.budgetMicro, 90);
      if (before < t70 && state.spentMicro >= t70) warnings.push(`Azure Speech spend reached 70% of the monthly budget ($${formatUsd(state.spentMicro)} / $${formatUsd(this.budgetMicro)} in ${state.month}).`);
      if (before < t90 && state.spentMicro >= t90) warnings.push(`Azure Speech spend reached 90% of the monthly budget ($${formatUsd(state.spentMicro)} / $${formatUsd(this.budgetMicro)} in ${state.month}).`);
      this._save(state);
      return { cache: false, busy: false, month: state.month, spentMicro: state.spentMicro, budgetMicro: this.budgetMicro, warnings, characters: chars, costMicro: cost, estCostUsd: formatUsd(cost) };
    });
  }
  clearInflight(hash) {
    return withFileLock(this.lockFile, () => {
      const state = this._load();
      if (state.inflight[hash] && state.inflight[hash].pid === process.pid) delete state.inflight[hash];
      this._save(state);
    });
  }
  /**
   * Owner-entered invoice usage. Spend rises to the actual figure when that is higher.
   * A lower actual does not reduce the guard.
   */
  reconcile({ actualUsd, by, at = null, note = '' } = {}) {
    assertUsd(actualUsd, 'actualUsd');
    if (!by || !String(by).trim()) throw new Error('Azure Speech reconciliation needs the owner name. Nothing was changed.');
    if (/[A-Za-z0-9+/_=-]{12,}/.test(String(note || ''))) {
      throw new Error('Azure Speech reconciliation note was refused. Nothing was changed.');
    }
    return withFileLock(this.lockFile, () => {
      const state = this._load();
      const actualMicro = toMicro(actualUsd);
      if (actualMicro > state.spentMicro) state.spentMicro = actualMicro;
      state.reconciliation = { at: at || this.now().toISOString(), by: String(by).trim(), actualUsd: formatUsd(actualMicro), note: String(note || '').slice(0, 200) };
      this._save(state);
      return { month: state.month, spentMicro: state.spentMicro, estCostUsd: formatUsd(state.spentMicro), reconciliation: state.reconciliation };
    });
  }
}

module.exports = {
  PRICE_SOURCE, NEURAL_USD_PER_MILLION, HD_USD_PER_MILLION, DEFAULT_MONTHLY_BUDGET_USD,
  resolvePrice, retailFloor, toMicro, costMicro, formatUsd, UsdBudget, pidAlive,
};
