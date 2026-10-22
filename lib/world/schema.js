// v1.3.0-test schema 6. Additive tables only. Reversed by DOWN_SQL (app code does not run it).
// backupBeforeMigration() in server.js copies the database before this runs on an older file.
'use strict';
const DOWN_SQL = `DROP TABLE IF EXISTS world_auth_fails;
DROP TABLE IF EXISTS world_approvals;
DROP TABLE IF EXISTS world_ledger;
DROP TABLE IF EXISTS world_journal;
DROP TABLE IF EXISTS world_mem;
DELETE FROM meta WHERE k IN ('worldMission','worldCeo','worldGrowth','worldSavings','worldSavingsPending','worldProposals','worldExperiments','worldAudienceReal','mig_130_world');`;
function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS world_journal (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL,
      tier TEXT NOT NULL, decision TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS world_ledger (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, booked_on TEXT NOT NULL, stream TEXT NOT NULL,
      platform TEXT, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD', payout_id TEXT, payout_confirmed INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'estimate', confirmation_source TEXT NOT NULL DEFAULT '',
      demo INTEGER NOT NULL, source TEXT NOT NULL, note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS world_approvals (
      id TEXT PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, tier TEXT NOT NULL,
      status TEXT NOT NULL, detail TEXT NOT NULL, requested_by TEXT, decided_by TEXT, decided_at TEXT);
    CREATE TABLE IF NOT EXISTS world_mem (
      id TEXT PRIMARY KEY, namespace TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
      body TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, source_path TEXT,
      source_record_id TEXT, idempotency_key TEXT NOT NULL, payload_json TEXT NOT NULL,
      request_hash TEXT NOT NULL, superseded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  const cols = db.prepare('PRAGMA table_info(world_ledger)').all().map(c => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec('ALTER TABLE world_ledger ADD COLUMN ' + ddl); };
  add('currency', "currency TEXT NOT NULL DEFAULT 'USD'");
  add('payout_id', 'payout_id TEXT');
  add('state', "state TEXT NOT NULL DEFAULT 'estimate'");
  add('confirmation_source', "confirmation_source TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE TABLE IF NOT EXISTS world_auth_fails (user TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL, next_at INTEGER NOT NULL, updated_at TEXT NOT NULL)'); // QA-E2E N2 persistent limiter
  const acols = db.prepare('PRAGMA table_info(world_approvals)').all().map(c => c.name);
  if (!acols.includes('consumed_at')) db.exec('ALTER TABLE world_approvals ADD COLUMN consumed_at TEXT'); // QA-E2E-001 replay guard
  for (const [c, d] of [['params_hash', 'TEXT'], ['expires_at', 'TEXT'], ['payload_json', 'TEXT'], ['exec_status', 'TEXT'], ['exec_result', 'TEXT'], ['exec_at', 'TEXT']]) if (!acols.includes(c)) db.exec(`ALTER TABLE world_approvals ADD COLUMN ${c} ${d}`); // QA-E2E-001 binding + expiry
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS world_ledger_payout ON world_ledger(platform, payout_id) WHERE payout_id IS NOT NULL AND payout_id != ''`);
}
module.exports = { migrate, DOWN_SQL };
