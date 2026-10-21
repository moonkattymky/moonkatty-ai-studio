'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Fixed owner pin. Not the voice JSON. Gitignored with the rest of state/. */
const OWNER_CONFIG = path.join(__dirname, 'state', 'owner.json');

function serialMessage({ at, by, serial, publicKeyPem }) {
  return JSON.stringify({
    v: 1,
    serialState: true,
    at: String(at),
    by: String(by).trim(),
    serial,
    publicKeyPem: String(publicKeyPem),
  });
}

function verifySerialState(data) {
  if (!data || data.v !== 1 || !Number.isInteger(data.serial) || data.serial < 0) return false;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(data.at || '')) || !String(data.by || '').trim()) return false;
  if (typeof data.publicKeyPem !== 'string' || !data.publicKeyPem.includes('PUBLIC KEY')) return false;
  if (typeof data.sig !== 'string' || !data.sig) return false;
  let sig;
  try { sig = Buffer.from(data.sig, 'base64'); } catch { return false; }
  try {
    return crypto.verify(null, Buffer.from(serialMessage({
      at: data.at, by: data.by, serial: data.serial, publicKeyPem: data.publicKeyPem,
    })), data.publicKeyPem, sig);
  } catch {
    return false;
  }
}

function assertOwnerConfig(file) {
  let st;
  try { st = fs.statSync(file); } catch {
    throw new Error('Azure Speech owner config is missing. Refusing to run.');
  }
  if (!st.isFile() || (st.mode & 0o077) !== 0) {
    throw new Error('Azure Speech owner config must be owner-only (mode 0600). Refusing to run.');
  }
}

/**
 * Missing file: no public key, serial 0. S0 then fails closed.
 * A present file that is loose or unsigned refuses every caller, including Kokoro.
 */
function loadOwnerConfig(file = OWNER_CONFIG) {
  if (!fs.existsSync(file)) return { publicKeyPem: null, serial: 0 };
  assertOwnerConfig(file);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    throw new Error('Azure Speech owner config is unreadable. Refusing to run.');
  }
  if (!verifySerialState(data)) throw new Error('Azure Speech owner config signature does not verify. Refusing to run.');
  return { publicKeyPem: data.publicKeyPem, serial: data.serial };
}

function writeOwnerConfig(file, { privateKey, publicKeyPem, at, by, serial } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(String(at || '')) || !String(by || '').trim()) {
    throw new Error('Azure Speech owner config needs a timestamp and a name.');
  }
  if (!Number.isInteger(serial) || serial < 0) throw new Error('Azure Speech owner serial must be a non-negative integer.');
  if (typeof publicKeyPem !== 'string' || !publicKeyPem.includes('PUBLIC KEY')) {
    throw new Error('Azure Speech owner config needs the public key.');
  }
  if (fs.existsSync(file)) {
    const current = loadOwnerConfig(file);
    if (serial < current.serial) throw new Error('Azure Speech owner serial cannot move backwards. Refusing to write.');
  }
  const body = {
    v: 1,
    publicKeyPem,
    serial,
    at: String(at),
    by: String(by).trim(),
    sig: crypto.sign(null, Buffer.from(serialMessage({ at, by, serial, publicKeyPem })), privateKey).toString('base64'),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(body) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
  return { publicKeyPem, serial };
}

module.exports = { OWNER_CONFIG, loadOwnerConfig, writeOwnerConfig, verifySerialState, serialMessage };
