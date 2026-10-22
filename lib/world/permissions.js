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
  // approved, unexpired, not-yet-consumed world_approvals row for the same action AND the same params
  // (sha256 of canonical JSON); call consume(id) after execution.
  const apprGet = db.prepare('SELECT id, action, status, consumed_at, params_hash, expires_at, requested_by FROM world_approvals WHERE id = ?');
  const apprConsume = db.prepare("UPDATE world_approvals SET consumed_at = ? WHERE id = ? AND status = 'approved' AND consumed_at IS NULL");
  const apprNew = db.prepare('INSERT INTO world_approvals (id, at, action, tier, status, detail, requested_by, decided_by, decided_at, params_hash, expires_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)');
  const TTL_MS = 24 * 3600 * 1000;
  function canon(v) { if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'; return JSON.stringify(v === undefined ? null : v); }
  function paramsHash(params) { return require('crypto').createHash('sha256').update(canon(params == null ? {} : params)).digest('hex'); }
  const nowMs = () => Date.parse(core.now()) || Date.now();
  function expired(row) { return !row.expires_at || Date.parse(row.expires_at) <= nowMs(); }
  function check(id, action, params, actor) {
    if (typeof id !== 'string' || !id) return 'missing';
    const row = apprGet.get(id); if (!row) return 'unknown';
    if (row.action !== action) return 'action_mismatch';
    if (row.status !== 'approved') return 'not_approved';
    if (row.consumed_at) return 'consumed';
    if (expired(row)) return 'expired';
    if (!row.params_hash || row.params_hash !== paramsHash(params)) return 'params_mismatch'; // also rejects legacy rows (pre-migration, no binding)
    if (!row.requested_by || row.requested_by !== actor) return 'user_mismatch';
    return 'ok';
  }
  function request({ action, tier = 'owner', detail = '', params, actor, ttlMs = TTL_MS }) {
    const id = core.uid(); const exp = new Date(nowMs() + ttlMs).toISOString();
    apprNew.run(id, core.now(), action, tier, 'pending', sec.redact(String(detail)).slice(0, 500), actor || null, paramsHash(params), exp, JSON.stringify(params == null ? {} : params));
    return id;
  }
  function gate(action, { actor, approvalId, params, detail } = {}) {
    const tier = tierOf(action); let decision, reason;
    if (tier === 'forbidden' || !tier) decision = 'deny';
    else if (tier === 'owner' && (reason = check(approvalId, action, params, actor)) !== 'ok') decision = 'needs_owner';
    else { decision = 'allow'; reason = undefined; }
    write({ actor, action, tier: tier || 'unknown', decision, detail: String(detail || '') + (reason && approvalId ? ' [' + reason + ']' : '') });
    return { action, tier: tier || 'unknown', decision, reason: decision === 'needs_owner' && approvalId ? reason : undefined, approvalId: tier === 'owner' && decision === 'allow' ? approvalId : undefined };
  }
  function consume(id) { return apprConsume.run(core.now(), id).changes === 1; }
  return { gate, consume, request, check, paramsHash, expired, write, list: n => recent.all(Math.min(n || 50, 200)), AUTO: [...AUTO], OWNER: [...OWNER], FORBIDDEN: [...FORBIDDEN] };
}
module.exports = { createPermissions, tierOf, AUTO, OWNER, FORBIDDEN };
