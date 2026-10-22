# World Approvals API (QA-E2E-001)

Owner-tier actions are never executed by `confirm:true`. They need a `world_approvals` id that is
approved, unexpired, unconsumed, bound to the same params (sha256 of canonical JSON) and to the requester.

## Endpoints that accept `approvalId`

| Endpoint | Action (tier owner) | Bound params | Effect on approve |
|---|---|---|---|
| `POST /api/world/savings` `{target_usd, approvalId?}` | `critical_settings` | `{kind:'savings', target_usd}` | executor `critical_settings` → `world.applySavings` (real) |
| `POST /api/world/action` `{action, detail, approvalId?}` | `spending`, `paid_ads`, `outreach_new_clients`, `contracts`, `payment_settings`, `mass_mailing`, `editorial_publication`, `critical_settings` | `{detail}` | external actions: `executed:false`, `execStatus:'external_disabled'` (no payments/publishing) |

Without a valid id both return `403 {code:'needs_owner', approvalId:<new pending id>, reason}`.
Reused id → `409 consumed`; expired id (24 h TTL) → `409 expired`. Other reasons (`unknown`, `action_mismatch`,
`not_approved`, `params_mismatch`, `user_mismatch`, legacy rows without binding) → `403 needs_owner`.

## `POST /api/world/approvals/:id` `{decision:'approve'|'reject', password}`

Check order: `404 not_found` → `409 consumed` → `409 expired` → `409 already_decided` → `403 self_approval`
→ `403 owner_session_required` → `429 locked|throttled` (with `Retry-After`) → `403 owner_reauth` → approve+execute.
Not wired (no `lib/world/wiring.js`) → `503 not_wired`, nothing executed.

* Channel is decided only from server state: `x-studio-app-token`, `Authorization` or `x-api-key` present (even empty/whitespace) → `app`
  (mixed token + cookie is never a session); otherwise `session` only if the real session store user equals `req.user`.
* Agents / app token can never approve (their own or any request) and cannot change their own rights.
* Owner self-approval: only for a request the owner created in a verified session, approved from a verified session
  with a fresh password, within 15 min, hash-bound, single-use; journal decision `owner_self_approval`.
  Kill switch: `allowOwnerSelfApproval: false` in mission config or `MK_WORLD_OWNER_SELF_APPROVAL=0`.
* Password limiter: SQLite `world_auth_fails`, key `user|peer-IP` (socket address, no X-Forwarded-For), survives restart and new sessions. Safe reset: a successful main login (session issued after the lockout) or lockout expiry. Progressive delay 1 s·2^(n-1)
  (max 30 s), 5 failures → 15 min lockout; after expiry the row is cleared, a correct password resets. Missing password is not counted.
* Atomic consume (`UPDATE … WHERE consumed_at IS NULL`): parallel approvals → one executes, the other `409`.
* Executor re-checks `paramsHash(payload_json) === params_hash` before executing (tampered payload → not executed).
* `GET /api/world/approvals/:id` → status, consumed, execStatus (`executed|external_disabled|not_wired|failed`).
