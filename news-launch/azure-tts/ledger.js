'use strict';
const fs = require('fs');
const path = require('path');
const { withFileLock } = require('./budget');

const FIELDS = ['at', 'chars', 'estCostUsd', 'status', 'requestId', 'attempt', 'month'];

function ledgerPath(dir, month) {
  return path.join(dir, `ledger-${month}.jsonl`);
}

/**
 * One JSON line per attempt. Script text and the subscription key are not fields.
 * A line that already contains the key is dropped.
 */
function appendLedger(file, entry, secret) {
  if (entry.text != null || entry.ssml != null || entry.key != null || entry.body != null) {
    throw new Error('Azure Speech ledger refused script content.');
  }
  const row = {};
  for (const field of FIELDS) if (entry[field] != null) row[field] = entry[field];
  const line = JSON.stringify(row);
  if (secret && line.includes(secret)) throw new Error('Azure Speech ledger refused a secret. The line was not written.');
  return withFileLock(`${file}.lock`, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${line}\n`, { mode: 0o600 });
    return row;
  });
}

module.exports = { appendLedger, ledgerPath, FIELDS };
