import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide } from '../gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cli = path.join(root, 'qa/release/gate.mjs');

test('GO requires security, green tests, fact-check, and owner approval together', () => {
  const go = decide({ security: 'PASS', testsGreen: true, factCheckDone: true, ownerApproval: true });
  assert.equal(go.decision, 'GO');
  assert.equal(go.reasons.length, 0);
  const held = decide({ security: 'PASS', testsGreen: true, factCheckDone: false, ownerApproval: false });
  assert.equal(held.decision, 'NO-GO');
  assert.ok(held.reasons.includes('fact-check is not done'));
  assert.ok(held.reasons.includes('owner approval flag is not set'));
  const insecure = decide({ security: 'FAIL', testsGreen: false, factCheckDone: true, ownerApproval: true });
  assert.equal(insecure.decision, 'NO-GO');
  assert.ok(insecure.reasons.includes('security result is not PASS'));
  assert.ok(insecure.reasons.includes('tests are not green'));
});

test('the CLI on the committed flags is NO-GO', () => {
  const run = spawnSync(process.execPath, [cli], { encoding: 'utf8', cwd: root });
  assert.equal(run.status, 2, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.decision, 'NO-GO');
  assert.equal(report.criteria.find(item => item.id === 'security').pass, true);
  assert.equal(report.criteria.find(item => item.id === 'factCheck').actual, false);
  assert.equal(report.criteria.find(item => item.id === 'ownerApproval').actual, false);
});
