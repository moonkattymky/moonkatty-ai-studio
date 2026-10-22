// QA-E2E-001 regression: owner-gated world actions need an approved, unexpired, unconsumed world_approvals id
// bound to the same action params. Usage: node scripts/world-approval-test.mjs (Node >= 22.5, in-memory node:sqlite)
import { createRequire } from 'module'; import { DatabaseSync } from 'node:sqlite';
const require = createRequire(import.meta.url);
const { migrate } = require('../lib/world/schema.js'); const { createPermissions } = require('../lib/world/permissions.js');
const db = new DatabaseSync(':memory:'); migrate(db); migrate(db); // idempotent
let n = 0, T = Date.parse('2026-10-22T12:00:00Z'); const core = { uid: () => 'id' + (++n), now: () => new Date(T).toISOString() }; const sec = { redact: s => s };
const P = createPermissions({ db, core, sec });
const setS = db.prepare('UPDATE world_approvals SET status = ? WHERE id = ?');
const mk = (action, params, status = 'approved', ttlMs) => { const id = P.request({ action, params, detail: 't', ttlMs }); if (status !== 'pending') setS.run(status, id); return id; };
const S = { kind: 'savings', target_usd: 100 };
const A1 = mk('critical_settings', S), P1 = mk('critical_settings', S, 'pending'), R1 = mk('critical_settings', S, 'rejected'), X1 = mk('spending', S);
const E1 = mk('critical_settings', S, 'approved', 1000);
db.prepare("INSERT INTO world_approvals (id, at, action, tier, status, detail) VALUES ('L1', 'x', 'critical_settings', 'owner', 'approved', 'legacy')").run();
let fail = 0; const ok = (name, c) => { console.log((c ? 'PASS ' : 'FAIL ') + name); if (!c) fail++; };
const g = (o) => P.gate('critical_settings', { params: S, ...o });
ok('confirm:true alone -> needs_owner', g({ confirm: true }).decision === 'needs_owner');
ok('no approval -> needs_owner', g({}).decision === 'needs_owner');
ok('pending id -> needs_owner', g({ approvalId: P1 }).reason === 'not_approved');
ok('rejected id -> needs_owner', g({ approvalId: R1 }).reason === 'not_approved');
ok('mismatched action id -> needs_owner', g({ approvalId: X1 }).reason === 'action_mismatch');
ok('unknown id -> needs_owner', g({ approvalId: 'nope', confirm: true }).reason === 'unknown');
ok('legacy row without hash/expiry -> rejected', g({ approvalId: 'L1' }).decision === 'needs_owner');
ok('params mismatch (target_usd 999) -> needs_owner', g({ approvalId: A1, params: { kind: 'savings', target_usd: 999 } }).reason === 'params_mismatch');
ok('key order does not matter', P.paramsHash({ a: 1, b: 2 }) === P.paramsHash({ b: 2, a: 1 }));
ok('valid approved id -> allow', g({ approvalId: A1 }).decision === 'allow');
ok('consume once -> true', P.consume(A1) === true);
ok('reused id -> needs_owner', g({ approvalId: A1, confirm: true }).reason === 'consumed');
ok('second consume -> false', P.consume(A1) === false);
T += 2000; ok('expired id -> needs_owner', g({ approvalId: E1 }).reason === 'expired');
ok('auto tier unaffected', P.gate('analysis', {}).decision === 'allow');
ok('forbidden still denied with approval', P.gate('spam', { approvalId: X1 }).decision === 'deny');
ok('journal records rejection reason', P.list(50).some(r => /\[params_mismatch\]/.test(r.detail)));
console.log(fail ? `FAILED ${fail}` : 'ALL PASS'); process.exit(fail ? 1 : 0);
