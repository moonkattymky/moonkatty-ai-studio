'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-compat.sh');

test('check-compat по умолчанию ждёт integ/v1.3.0-test и помечает отсутствие как BLOCKED', () => {
  assert.throws(
    () => execFileSync('sh', [SCRIPT], { cwd: ROOT, encoding: 'utf8' }),
    err => err.status === 2 && String(err.stdout).includes('BLOCKED') && String(err.stdout).includes('integ/v1.3.0-test')
  );
  const out = execFileSync('sh', [SCRIPT, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /merge-tree HEAD HEAD/);
});
