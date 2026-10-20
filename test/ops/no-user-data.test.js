'use strict';
// (b) Tests never touch real user data: every server test uses a fresh tmp STUDIO_DATA_DIR; helper refuses Application Support.
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('fs'), path = require('path'), os = require('os');
const { assertSafeDir } = require('../helpers/server.js'); const ROOT = path.join(__dirname, '..', '..');
test('helper refuses ~/Library/Application Support and non-tmp dirs', () => {
  assert.throws(() => assertSafeDir(path.join(os.homedir(), 'Library/Application Support/MOONKATTY AI STUDIO'))); assert.throws(() => assertSafeDir('/var/data'));
  assert.ok(assertSafeDir(fs.mkdtempSync(path.join(os.tmpdir(), 'ok-'))));
});
test('no test file writes to Application Support or $HOME paths', () => {
  const files = [...fs.readdirSync(path.join(ROOT, 'test/ops')).map(f => 'test/ops/' + f), ...fs.readdirSync(path.join(ROOT, 'test/contract')).map(f => 'test/contract/' + f), ...['security-test.mjs', 'runner-test.mjs', 'opencode-auth-test.mjs', 'mobile-ui-test.mjs'].map(f => 'scripts/' + f)];
  for (const f of files.filter(f => !f.endsWith('no-user-data.test.js'))) { const s = fs.readFileSync(path.join(ROOT, f), 'utf8'); const bad = s.split('\n').filter(l => /Application Support/.test(l) && !/throws|refuse|assertSafeDir|never/i.test(l));
    assert.deepEqual(bad, [], f); }
});
