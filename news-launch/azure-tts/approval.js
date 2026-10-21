'use strict';
const crypto = require('crypto');

/**
 * Fields an episode agent must not set through MasterVoice.setCandidate.
 * The signing private key stays in the Keychain service below. The provider
 * never reads that service. It only verifies with a public key the caller passes
 * from outside the voice file.
 */
const OWNER_SERVICE = 'MOONKATTY AI STUDIO.azure-speech-owner';
const OWNER_ACCOUNT = 'azure-speech-owner';
const OWNER_ONLY_FIELDS = Object.freeze([
  'enabled', 'paidEnabled', 'paidApproval', 'tier', 'pricePerMillionChars', 'monthlyBudgetUsd',
  'priceFile', 'approvalPublicKey', 'approvalPublicKeyPem', 'skuProbe', 'stateFile', 'keyService',
]);
const APPROVAL_TTL_MS = 31 * 24 * 60 * 60 * 1000;
const BUDGET_CEILING_USD = 1;

function asTime(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' || typeof now === 'string') return new Date(now).getTime();
  return Date.now();
}

function freshAt(at, now) {
  const atMs = Date.parse(String(at || ''));
  const nowMs = asTime(now);
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return false;
  if (atMs > nowMs + 5 * 60 * 1000) return false;
  if (nowMs - atMs >= APPROVAL_TTL_MS) return false;
  return true;
}

function approvalMessage({ at, by, voice, region, serial }) {
  return JSON.stringify({
    v: 1,
    paid: true,
    at: String(at),
    by: String(by).trim(),
    voice: String(voice),
    region: String(region),
    serial,
  });
}

function signApproval(privateKey, { at, by, voice, region, serial } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(at || '')) || !String(by || '').trim()) {
    throw new Error('Azure Speech owner approval needs a timestamp and a name.');
  }
  if (!voice || !region) throw new Error('Azure Speech owner approval needs the voice and region.');
  if (!Number.isInteger(serial) || serial < 1) throw new Error('Azure Speech owner approval needs a serial.');
  const sig = crypto.sign(null, Buffer.from(approvalMessage({ at, by, voice, region, serial })), privateKey);
  return { at: String(at), by: String(by).trim(), serial, sig: sig.toString('base64') };
}

function verifyApproval(record, publicKey, { voice, region, now, minSerial = 0 } = {}) {
  if (!publicKey || !record || typeof record !== 'object') return false;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(record.at || '')) || !String(record.by || '').trim()) return false;
  if (!Number.isInteger(record.serial) || record.serial < 1) return false;
  const floor = Number.isInteger(minSerial) && minSerial >= 0 ? minSerial : 0;
  if (record.serial <= floor) return false;
  if (!freshAt(record.at, now)) return false;
  if (typeof record.sig !== 'string' || !record.sig) return false;
  let sig;
  try { sig = Buffer.from(record.sig, 'base64'); } catch { return false; }
  try {
    return crypto.verify(null, Buffer.from(approvalMessage({
      at: record.at, by: record.by, voice, region, serial: record.serial,
    })), publicKey, sig);
  } catch {
    return false;
  }
}

function budgetMicro(usd) {
  const micro = Math.round(Number(usd) * 1000000);
  if (!Number.isInteger(micro)) return null;
  return micro;
}

function budgetMessage({ at, by, micro }) {
  return JSON.stringify({
    v: 1,
    budget: true,
    at: String(at),
    by: String(by).trim(),
    micro,
  });
}

function signBudgetGrant(privateKey, { at, by, monthlyBudgetUsd } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(at || '')) || !String(by || '').trim()) {
    throw new Error('Azure Speech budget grant needs a timestamp and a name.');
  }
  const micro = budgetMicro(monthlyBudgetUsd);
  if (micro == null || micro <= Math.round(BUDGET_CEILING_USD * 1000000)) {
    throw new Error('Azure Speech budget grant must be above the ceiling of 1.00.');
  }
  const sig = crypto.sign(null, Buffer.from(budgetMessage({ at, by, micro })), privateKey);
  return { at: String(at), by: String(by).trim(), micro, sig: sig.toString('base64') };
}

function verifyBudgetGrant(grant, publicKey, { micro, now } = {}) {
  if (!publicKey || !grant || typeof grant !== 'object') return false;
  if (!Number.isInteger(grant.micro) || grant.micro !== micro) return false;
  if (!freshAt(grant.at, now)) return false;
  if (!String(grant.by || '').trim() || typeof grant.sig !== 'string' || !grant.sig) return false;
  let sig;
  try { sig = Buffer.from(grant.sig, 'base64'); } catch { return false; }
  try {
    return crypto.verify(null, Buffer.from(budgetMessage({ at: grant.at, by: grant.by, micro: grant.micro })), publicKey, sig);
  } catch {
    return false;
  }
}

module.exports = {
  OWNER_SERVICE, OWNER_ACCOUNT, OWNER_ONLY_FIELDS, APPROVAL_TTL_MS, BUDGET_CEILING_USD,
  approvalMessage, signApproval, verifyApproval, budgetMicro, budgetMessage, signBudgetGrant, verifyBudgetGrant, freshAt,
};
