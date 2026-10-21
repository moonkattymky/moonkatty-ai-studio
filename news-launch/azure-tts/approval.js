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
  'priceFile', 'approvalPublicKey', 'approvalPublicKeyPem', 'skuProbe',
]);

function approvalMessage({ at, by, voice, region }) {
  return JSON.stringify({
    v: 1,
    paid: true,
    at: String(at),
    by: String(by).trim(),
    voice: String(voice),
    region: String(region),
  });
}

function signApproval(privateKey, { at, by, voice, region } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(at || '')) || !String(by || '').trim()) {
    throw new Error('Azure Speech owner approval needs a timestamp and a name.');
  }
  if (!voice || !region) throw new Error('Azure Speech owner approval needs the voice and region.');
  const sig = crypto.sign(null, Buffer.from(approvalMessage({ at, by, voice, region })), privateKey);
  return { at: String(at), by: String(by).trim(), sig: sig.toString('base64') };
}

function verifyApproval(record, publicKey, { voice, region } = {}) {
  if (!publicKey || !record || typeof record !== 'object') return false;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(record.at || '')) || !String(record.by || '').trim()) return false;
  if (typeof record.sig !== 'string' || !record.sig) return false;
  let sig;
  try { sig = Buffer.from(record.sig, 'base64'); } catch { return false; }
  try {
    return crypto.verify(null, Buffer.from(approvalMessage({ at: record.at, by: record.by, voice, region })), publicKey, sig);
  } catch {
    return false;
  }
}

module.exports = {
  OWNER_SERVICE, OWNER_ACCOUNT, OWNER_ONLY_FIELDS, approvalMessage, signApproval, verifyApproval,
};
