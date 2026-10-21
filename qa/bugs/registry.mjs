/**
 * Bug registry. Does not post to the studio and does not publish.
 *   node qa/bugs/registry.mjs validate
 *   node qa/bugs/registry.mjs list
 *   node qa/bugs/registry.mjs add --file entry.json
 *   node qa/bugs/registry.mjs update QA-APR-001 --status qa_verified --note "..." [--evidence path]
 * REGISTRY_PATH overrides the JSON file (tests).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.REGISTRY_PATH || path.join(here, 'registry.json');
const ID = /^QA-[A-Z0-9]+-\d{3}$/;
const SEVERITY = new Set(['blocker', 'high', 'medium', 'low', 'info']);
const STATUS = new Set(['open', 'proposed', 'isolated_test', 'qa_verified', 'owner_approved', 'wontfix', 'duplicate', 'blocked']);

export function load(file = FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function validate(doc) {
  const errors = [];
  if (!doc || doc.contract !== 'moonkatty.qa.bugs/1') errors.push('contract');
  if (typeof doc?.updatedAt !== 'string' || !doc.updatedAt) errors.push('updatedAt');
  if (!Array.isArray(doc?.bugs)) errors.push('bugs');
  const seen = new Set();
  for (const bug of doc?.bugs || []) {
    if (!ID.test(bug.id || '')) errors.push(`id ${bug.id}`);
    if (seen.has(bug.id)) errors.push(`duplicate ${bug.id}`);
    seen.add(bug.id);
    if (typeof bug.title !== 'string' || bug.title.length < 8) errors.push(`${bug.id} title`);
    if (!SEVERITY.has(bug.severity)) errors.push(`${bug.id} severity`);
    if (!STATUS.has(bug.status)) errors.push(`${bug.id} status`);
    if (typeof bug.summary !== 'string' || bug.summary.length < 8) errors.push(`${bug.id} summary`);
    if (!Array.isArray(bug.repro) || bug.repro.length < 1) errors.push(`${bug.id} repro`);
    if (!Array.isArray(bug.history) || bug.history.length < 1) errors.push(`${bug.id} history`);
    if (bug.status === 'owner_approved' && bug.ownerApproval !== true) errors.push(`${bug.id} ownerApproval`);
    for (const row of bug.history || []) {
      if (!row.at || !row.status || typeof row.note !== 'string') errors.push(`${bug.id} history row`);
    }
  }
  return errors;
}

function save(doc, file = FILE) {
  doc.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
}

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function cmdValidate() {
  const doc = load();
  const errors = validate(doc);
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  const counts = {};
  for (const bug of doc.bugs) counts[bug.status] = (counts[bug.status] || 0) + 1;
  console.log(JSON.stringify({ ok: true, bugs: doc.bugs.length, counts }));
}

function cmdList() {
  const doc = load();
  for (const bug of doc.bugs) console.log(`${bug.id}\t${bug.status}\t${bug.severity}\t${bug.title}`);
}

function cmdAdd() {
  const file = flag('--file');
  if (!file) throw new Error('add requires --file');
  const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
  const doc = load();
  if (doc.bugs.some(bug => bug.id === entry.id)) throw new Error(`already present: ${entry.id}`);
  if (!entry.history) {
    entry.history = [{ at: new Date().toISOString(), status: entry.status, note: 'added' }];
  }
  if (entry.ownerApproval == null) entry.ownerApproval = entry.status === 'owner_approved';
  doc.bugs.push(entry);
  const errors = validate(doc);
  if (errors.length) throw new Error(errors.join('; '));
  save(doc);
  console.log(JSON.stringify({ ok: true, id: entry.id }));
}

function cmdUpdate() {
  const id = process.argv[3];
  if (!ID.test(id || '')) throw new Error('update requires QA-XXX-000');
  const status = flag('--status');
  const note = flag('--note');
  const evidence = flag('--evidence');
  if (!status || !STATUS.has(status)) throw new Error('update requires --status');
  if (!note) throw new Error('update requires --note');
  const doc = load();
  const bug = doc.bugs.find(item => item.id === id);
  if (!bug) throw new Error(`missing ${id}`);
  bug.status = status;
  bug.ownerApproval = status === 'owner_approved';
  bug.history.push({ at: new Date().toISOString(), status, note });
  if (evidence) bug.evidence = [...(bug.evidence || []), evidence];
  const errors = validate(doc);
  if (errors.length) throw new Error(errors.join('; '));
  save(doc);
  console.log(JSON.stringify({ ok: true, id, status }));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'validate') cmdValidate();
    else if (cmd === 'list') cmdList();
    else if (cmd === 'add') cmdAdd();
    else if (cmd === 'update') cmdUpdate();
    else {
      console.error('usage: validate | list | add --file entry.json | update QA-ID --status S --note TEXT');
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
