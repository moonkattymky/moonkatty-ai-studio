'use strict';
const fs = require('fs');
const path = require('path');
const { resolvePrice } = require('./usd');

/** Owner override. Not the voice JSON. Gitignored with the rest of state/. */
const PRICE_FILE = path.join(__dirname, 'state', 'price.json');

function assertOwnerOnly(file) {
  let st;
  try { st = fs.statSync(file); } catch {
    throw new Error('Azure Speech price file is missing. Refusing to run.');
  }
  if (!st.isFile() || (st.mode & 0o077) !== 0) {
    throw new Error('Azure Speech price file must be owner-only (mode 0600). Refusing to run.');
  }
}

function readOwnerPrice(file, voice, { approvalPublicKeyPem = null, now } = {}) {
  assertOwnerOnly(file);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    throw new Error('Azure Speech price file is unreadable. Refusing to run.');
  }
  if (!data || typeof data !== 'object') throw new Error('Azure Speech price file is unreadable. Refusing to run.');
  return resolvePrice({
    voice,
    pricePerMillionChars: data.pricePerMillionChars,
    monthlyBudgetUsd: data.monthlyBudgetUsd == null ? null : data.monthlyBudgetUsd,
    budgetGrant: data.budgetGrant || null,
    approvalPublicKeyPem,
    now,
  });
}

function writeOwnerPrice(file, { pricePerMillionChars, monthlyBudgetUsd = null, voice, budgetGrant = null, approvalPublicKeyPem = null, now } = {}) {
  const resolved = resolvePrice({ voice, pricePerMillionChars, monthlyBudgetUsd, budgetGrant, approvalPublicKeyPem, now });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const stored = {
    pricePerMillionChars: resolved.pricePerMillionChars,
    monthlyBudgetUsd: resolved.monthlyBudgetUsd,
  };
  if (resolved.budgetGrant) stored.budgetGrant = resolved.budgetGrant;
  const body = JSON.stringify(stored) + '\n';
  fs.writeFileSync(tmp, body, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return resolved;
}

module.exports = { PRICE_FILE, readOwnerPrice, writeOwnerPrice, assertOwnerOnly };
