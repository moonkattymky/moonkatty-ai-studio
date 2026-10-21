'use strict';
const crypto = require('crypto');
const fs = require('fs');
const { SERVICE, TEST_SERVICE, OWNER_SERVICE, OWNER_ACCOUNT, storeKey } = require('./keychain');
const { signApproval } = require('./approval');
const { writeOwnerConfig } = require('./owner-config');

const USAGE = 'usage: node keychain-cli.js store|store-test  (key on stdin, no extra arguments)';

/**
 * Store the key from stdin. Extra arguments are refused so the key cannot be passed on argv.
 * The success line does not include the key.
 */
async function runCli(argv, stdinText, deps = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || (argv[0] !== 'store' && argv[0] !== 'store-test')) throw new Error(USAGE);
  const service = argv[0] === 'store-test' ? TEST_SERVICE : SERVICE;
  const key = String(stdinText == null ? '' : stdinText).replace(/\r?\n$/, '');
  await storeKey(key, { service, ...deps });
  return 'Stored Azure Speech key in the Keychain. The key was not printed.';
}

const OWNER_USAGE = 'usage: node keychain-cli.js store-owner | approve <at> <by> <voice> <region> <serial> | revoke <at> <by> <serial> <file>  (key material on stdin, no key in arguments)';

/**
 * store-owner writes the signing key. approve signs a paid-use record.
 * The private key is stdin only and is not copied into the approval JSON.
 */
function ownerPrivateKey(material) {
  try { return crypto.createPrivateKey({ key: Buffer.from(material, 'base64'), format: 'der', type: 'pkcs8' }); }
  catch { throw new Error('Azure Speech owner key was not accepted.'); }
}

function serialArg(text) {
  if (!/^[1-9][0-9]*$/.test(String(text || '')) && text !== '0') return null;
  const serial = Number(text);
  if (!Number.isInteger(serial) || serial < 0) return null;
  return serial;
}

async function runOwner(argv, stdinText, deps = {}) {
  if (!Array.isArray(argv) || argv.length < 1 || (argv[0] !== 'store-owner' && argv[0] !== 'approve' && argv[0] !== 'revoke')) throw new Error(OWNER_USAGE);
  const material = String(stdinText == null ? '' : stdinText).replace(/\s+/g, '');
  if (!material) throw new Error('Azure Speech owner key is empty.');
  if (argv[0] === 'store-owner') {
    if (argv.length !== 1) throw new Error(OWNER_USAGE);
    await storeKey(material, { service: OWNER_SERVICE, account: OWNER_ACCOUNT, ...deps, lockdown: true });
    return 'Stored Azure Speech owner key in the Keychain. The key was not printed.';
  }
  let privateKey;
  if (argv[0] === 'revoke') {
    if (argv.length !== 5) throw new Error(OWNER_USAGE);
    const serial = serialArg(argv[3]);
    if (serial == null) throw new Error(OWNER_USAGE);
    privateKey = ownerPrivateKey(material);
    const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
    writeOwnerConfig(argv[4], { privateKey, publicKeyPem, at: argv[1], by: argv[2], serial });
    const out = `Revoked Azure Speech approval serials through ${serial}. The key was not printed.`;
    if (out.includes(material)) throw new Error('Azure Speech owner key was not accepted.');
    return out;
  }
  if (argv.length !== 6) throw new Error(OWNER_USAGE);
  const [, at, by, voice, region, serialText] = argv;
  const serial = serialArg(serialText);
  if (serial == null || serial < 1) throw new Error(OWNER_USAGE);
  if ([at, by, voice, region].some(part => part && material.includes(part) && part.length > 20)) throw new Error(OWNER_USAGE);
  privateKey = ownerPrivateKey(material);
  const record = signApproval(privateKey, { at, by, voice, region, serial });
  const out = JSON.stringify(record);
  if (out.includes(material)) throw new Error('Azure Speech owner key was not accepted.');
  return out;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const stdin = fs.readFileSync(0, 'utf8');
  const job = argv[0] === 'store-owner' || argv[0] === 'approve' || argv[0] === 'revoke' ? runOwner(argv, stdin) : runCli(argv, stdin);
  job.then(msg => { process.stdout.write(`${msg}\n`); })
    .catch(e => {
      process.stderr.write(`${e && e.message ? e.message : 'Azure Speech key was not stored.'}\n`);
      process.exitCode = 1;
    });
}

module.exports = { runCli, runOwner, USAGE, OWNER_USAGE };
