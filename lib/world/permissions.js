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
  function gate(action, { actor, confirm, detail } = {}) {
    const tier = tierOf(action); let decision;
    if (tier === 'forbidden' || !tier) decision = 'deny';
    else if (tier === 'owner' && confirm !== true) decision = 'needs_owner';
    else decision = 'allow';
    write({ actor, action, tier: tier || 'unknown', decision, detail });
    return { action, tier: tier || 'unknown', decision };
  }
  return { gate, write, list: n => recent.all(Math.min(n || 50, 200)), AUTO: [...AUTO], OWNER: [...OWNER], FORBIDDEN: [...FORBIDDEN] };
}
module.exports = { createPermissions, tierOf, AUTO, OWNER, FORBIDDEN };
