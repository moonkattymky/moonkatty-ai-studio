'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { withFileLock } = require('./budget');

const FIELDS = ['at', 'chars', 'estCostUsd', 'status', 'requestId', 'attempt', 'month', 'mac'];
const CHAIN_BROKEN = 'Azure Speech ledger chain does not match. Refusing to run.';

function ledgerPath(dir, month) {
  return path.join(dir, `ledger-${month}.jsonl`);
}

function lineHash(line) {
  return crypto.createHash('sha256').update(line).digest('hex');
}

function parseMicro(text) {
  const match = /^(\d+)\.(\d{6})$/.exec(String(text == null ? '' : text));
  if (!match) throw new Error(CHAIN_BROKEN);
  return Number(match[1]) * 1000000 + Number(match[2]);
}

/** Walk the hash chain. Reserved lines are the spend. A broken link refuses. */
function inspectLedger(file) {
  if (!fs.existsSync(file)) return { lines: 0, spentMicro: 0, head: 'genesis' };
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(line => line.length > 0);
  let prev = 'genesis';
  let spentMicro = 0;
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch { throw new Error(CHAIN_BROKEN); }
    if (row.prev !== prev) throw new Error(CHAIN_BROKEN);
    if (row.status === 'reserved') spentMicro += parseMicro(row.estCostUsd);
    prev = lineHash(line);
  }
  return { lines: lines.length, spentMicro, head: prev };
}

function ledgerOkMac(cacheKey, requestId) {
  return crypto.createHmac('sha256', String(cacheKey)).update('ok\0').update(String(requestId)).digest('hex');
}

function macMatches(expected, actual) {
  if (typeof actual !== 'string' || !actual) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function ledgerHasOk(dir, requestId, cacheKey) {
  if (!cacheKey || !dir || !fs.existsSync(dir)) return false;
  const expected = ledgerOkMac(cacheKey, requestId);
  for (const name of fs.readdirSync(dir)) {
    if (!/^ledger-\d{4}-\d{2}\.jsonl$/.test(name)) continue;
    const lines = fs.readFileSync(path.join(dir, name), 'utf8').split('\n').filter(line => line.length > 0);
    for (const line of lines) {
      let row;
      try { row = JSON.parse(line); } catch { return false; }
      if (row.status === 'ok' && row.requestId === requestId && macMatches(expected, row.mac)) return true;
    }
  }
  return false;
}

/**
 * One JSON line per attempt. Script text and the subscription key are not fields.
 * A line that already contains the key is dropped.
 */
function appendLedger(file, entry, secret) {
  if (entry.text != null || entry.ssml != null || entry.key != null || entry.body != null) {
    throw new Error('Azure Speech ledger refused script content.');
  }
  return withFileLock(`${file}.lock`, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const prior = inspectLedger(file);
    const row = {};
    for (const field of FIELDS) if (entry[field] != null) row[field] = entry[field];
    row.prev = prior.head;
    const line = JSON.stringify(row);
    if (secret && line.includes(secret)) throw new Error('Azure Speech ledger refused a secret. The line was not written.');
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
    return row;
  });
}

module.exports = { appendLedger, ledgerPath, inspectLedger, ledgerHasOk, ledgerOkMac, FIELDS, CHAIN_BROKEN };
