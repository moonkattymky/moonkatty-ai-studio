// QA-E2E-001 regression: owner-gated world actions need an approved, unconsumed world_approvals id.
// Usage: node scripts/world-approval-test.mjs  (in-memory node:sqlite, no server)
import { createRequire } from 'module'; import { DatabaseSync } from 'node:sqlite';
const require = createRequire(import.meta.url);
const { migrate } = require('../lib/world/schema.js'); const { createPermissions } = require('../lib/world/permissions.js');
const db = new DatabaseSync(':memory:'); migrate(db);
let n = 0; const core = { uid: () => 'id' + (++n), now: () => new Date().toISOString() }; const sec = { redact: s => s };
const P = createPermissions({ db, core, sec });
const ins = db.prepare('INSERT INTO world_approvals (id, at, action, tier, status, detail) VALUES (?, ?, ?, ?, ?, ?)');
ins.run('A1', core.now(), 'critical_settings', 'owner', 'approved', 't'); ins.run('P1', core.now(), 'critical_settings', 'owner', 'pending', 't');
ins.run('R1', core.now(), 'critical_settings', 'owner', 'rejected', 't'); ins.run('S1', core.now(), 'spending', 'owner', 'approved', 't');
let fail = 0; const ok = (name, c) => { console.log((c ? 'PASS ' : 'FAIL ') + name); if (!c) fail++; };
const g = (o) => P.gate('critical_settings', o).decision;
ok('confirm:true alone -> needs_owner', g({ confirm: true }) === 'needs_owner');
ok('no approval -> needs_owner', g({}) === 'needs_owner');
ok('pending id -> needs_owner', g({ approvalId: 'P1' }) === 'needs_owner');
ok('rejected id -> needs_owner', g({ approvalId: 'R1' }) === 'needs_owner');
ok('mismatched action id -> needs_owner', g({ approvalId: 'S1' }) === 'needs_owner');
ok('unknown id -> needs_owner', g({ approvalId: 'nope', confirm: true }) === 'needs_owner');
ok('valid approved id -> allow', g({ approvalId: 'A1' }) === 'allow');
ok('consume once -> true', P.consume('A1') === true);
ok('reused id -> needs_owner', g({ approvalId: 'A1', confirm: true }) === 'needs_owner');
ok('second consume -> false', P.consume('A1') === false);
ok('auto tier unaffected', P.gate('analysis', {}).decision === 'allow');
ok('forbidden still denied with approval', P.gate('spam', { approvalId: 'S1' }).decision === 'deny');
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
