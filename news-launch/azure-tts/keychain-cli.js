'use strict';
const fs = require('fs');
const { SERVICE, TEST_SERVICE, storeKey } = require('./keychain');

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

if (require.main === module) {
  runCli(process.argv.slice(2), fs.readFileSync(0, 'utf8'))
    .then(msg => { process.stdout.write(`${msg}\n`); })
    .catch(e => {
      process.stderr.write(`${e && e.message ? e.message : 'Azure Speech key was not stored.'}\n`);
      process.exitCode = 1;
    });
}

module.exports = { runCli, USAGE };
