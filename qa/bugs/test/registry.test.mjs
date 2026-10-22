import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate } from '../registry.mjs';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../registry.mjs');

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-bugs-'));
  const file = path.join(dir, 'registry.json');
  const doc = {
    contract: 'moonkatty.qa.bugs/1',
    updatedAt: '2026-10-21T00:00:00.000Z',
    bugs: [{
      id: 'QA-TST-001',
      title: 'Scratch defect for the registry test',
      severity: 'low',
      status: 'open',
      ownerApproval: false,
      summary: 'Used only by the registry test.',
      repro: ['Run the registry test'],
      foundAt: '2026-10-21T00:00:00.000Z',
      history: [{ at: '2026-10-21T00:00:00.000Z', status: 'open', note: 'opened' }]
    }]
  };
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return { dir, file, env: { ...process.env, REGISTRY_PATH: file } };
}

function run(env, args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
}

test('validate accepts the scratch registry and rejects owner approval without the flag', () => {
  const { file } = fresh();
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(validate(doc), []);
  doc.bugs[0].status = 'owner_approved';
  doc.bugs[0].ownerApproval = false;
  assert.ok(validate(doc).some(item => item.includes('ownerApproval')));
});

test('add refuses a duplicate and update records qa_verified without owner approval', () => {
  const { file, env } = fresh();
  const entry = path.join(path.dirname(file), 'entry.json');
  fs.writeFileSync(entry, JSON.stringify({
    id: 'QA-TST-002',
    title: 'Second scratch defect',
    severity: 'info',
    status: 'open',
    summary: 'Added through the CLI.',
    repro: ['node qa/bugs/registry.mjs add'],
    foundAt: '2026-10-21T00:00:00.000Z'
  }));
  const added = run(env, ['add', '--file', entry]);
  assert.equal(added.status, 0, added.stderr);
  const again = run(env, ['add', '--file', entry]);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already present/);

  const updated = run(env, ['update', 'QA-TST-002', '--status', 'qa_verified', '--note', 'scratch check passed']);
  assert.equal(updated.status, 0, updated.stderr);
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bug = doc.bugs.find(item => item.id === 'QA-TST-002');
  assert.equal(bug.status, 'qa_verified');
  assert.equal(bug.ownerApproval, false);
  assert.equal(bug.history.at(-1).note, 'scratch check passed');

  const approved = run(env, ['update', 'QA-TST-002', '--status', 'owner_approved', '--note', 'owner said yes in this test only']);
  assert.equal(approved.status, 0, approved.stderr);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  const row = after.bugs.find(item => item.id === 'QA-TST-002');
  assert.equal(row.status, 'owner_approved');
  assert.equal(row.ownerApproval, true);
});
