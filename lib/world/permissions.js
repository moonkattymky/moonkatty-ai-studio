// Permission tiers for world-class actions. Existing policy.js still governs files, shell and OpenCode.
// Every decision is appended to world_journal. Unknown actions are denied.
'use strict';
const AUTO = new Set(['analysis', 'scripts', 'drafts', 'local_tests', 'qc', 'internal_reports', 'opportunity_search']);
const OWNER = new Set(['spending', 'paid_ads', 'outreach_new_clients', 'contracts', 'payment_settings', 'mass_mailing', 'editorial_publication', 'critical_settings']);
const FORBIDDEN = new Set(['spam', 'botting', 'bought_followers', 'fake_followers', 'fake_views', 'platform_evasion', 'key_disclosure', 'unauthorized_access', 'fake_financials', 'dangerous_production']);
function tierOf(action) { if (AUTO.has(action)) return 'auto'; if (OWNER.has(action)) return 'owner'; if (FORBIDDEN.has(action)) return 'forbidden'; return null; }
function createPermissions({ db, core, sec }) {
  const ins = db.prepare('INSERT INTO world_journal (id, at, actor, action, tier, decision, detail) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const recent = db.prepare('SELECT id, at, actor, action, tier, decision, detail FROM world_journal ORDER BY at DESC, rowid DESC LIMIT ?');
  function write(row) {
    const detail = sec.redact(String(row.detail || '')).slice(0, 2000);
    ins.run(core.uid(), core.now(), row.actor || null, String(row.action || 'unknown').slice(0, 80), row.tier || 'unknown', row.decision, detail);
  }
  // QA-E2E-001: a client-sent `confirm` flag is ignored. Owner-tier actions pass only with the id of an
  // approved, not-yet-consumed world_approvals row for the same action; call consume(id) after execution.
  const apprGet = db.prepare('SELECT id, action, status, consumed_at FROM world_approvals WHERE id = ?');
  const apprConsume = db.prepare("UPDATE world_approvals SET consumed_at = ? WHERE id = ? AND status = 'approved' AND consumed_at IS NULL");
  function approvalOk(id, action) {
    if (typeof id !== 'string' || !id) return false;
    const row = apprGet.get(id);
    return !!row && row.status === 'approved' && row.action === action && !row.consumed_at;
  }
  function gate(action, { actor, approvalId, detail } = {}) {
    const tier = tierOf(action); let decision;
    if (tier === 'forbidden' || !tier) decision = 'deny';
    else if (tier === 'owner' && !approvalOk(approvalId, action)) decision = 'needs_owner';
    else decision = 'allow';
    write({ actor, action, tier: tier || 'unknown', decision, detail });
    return { action, tier: tier || 'unknown', decision, approvalId: tier === 'owner' && decision === 'allow' ? approvalId : undefined };
  }
  function consume(id) { return apprConsume.run(core.now(), id).changes === 1; }
  return { gate, consume, write, list: n => recent.all(Math.min(n || 50, 200)), AUTO: [...AUTO], OWNER: [...OWNER], FORBIDDEN: [...FORBIDDEN] };
}
module.exports = { createPermissions, tierOf, AUTO, OWNER, FORBIDDEN };
