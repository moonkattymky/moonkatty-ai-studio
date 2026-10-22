# Computers (Nodes) re-check — d38c682..fe8e4ab

Target: branch `feat/studio-operations`, range `d38c682..fe8e4ab` (Studio 3). The tree was read in a detached worktree at `/tmp/mk-nodes`, HEAD `fe8e4ab56fdc756a22e128724502ea45a73c3660`. `d38c682` is an ancestor of that commit. `git status --porcelain` there was empty before the tests and empty after them. Nothing on that branch was modified. Nothing was merged and nothing was published. Passwords and tokens in the tests are fake. No call was made to Meta, Facebook, Instagram, or Telegram.

The integrated v1.2.4-test tree was read at `/tmp/mk-v124f`, HEAD `b7101c437466599558bf14653ff782677a2ec95b`. The parent of the memory-only fix, `343d645`, was read at `/tmp/mk-nodes-pre`. Both stayed clean.

## Verdict

**PASS** for the claimed Computers fixes at `fe8e4ab`.

An unauthenticated request, including a bearer that names a real node and carries a foreign secret, left `nodes.json`, the node records, and the jobs unchanged. The same probe at `343d645` wrote `lastConnError` into `nodes.json`. That write is the bug this delta introduces and then removes. **`b7101c4` does not contain that write. It is not a blocker for the v1.2.4-test install.**

Blocking bugs for these claimed fixes: none.

`QA-NODE-001`, `QA-NODE-002`, and `QA-NODE-003` stay open. New low: `QA-NODE-004` (the committed Computers UI e2e reads the enrollment code already on screen).

Real publishing and social accounts stay forbidden. Funnel and a public bind stay off. Computers connect on the `b7101c4` zip stays forbidden for the reasons in `qa/reports/security-recheck-v1.2.4-final/REPORT.md`: that commit does not contain this delta. `origin/feat/v1.2.4-test-nodes` later moved to `322023f` (“nodes: port Studio 3 d38c682..fe8e4ab”). That port was not the audit target.

## How this was checked

- Their suite, from `/tmp/mk-nodes`, Node v22.23.3, `NODE_PATH=/workspace/node_modules`, `STUDIO_SQLITE=node`: `node --test test/ops/ui-routes.test.js test/ops/enroll.test.js test/ops/nodes.integration.test.js test/ops/security-center.test.js test/ops/node-e2e.test.js test/ops/ui-computers.e2e.test.js`. Log: `logs/their-tests.log`. **28 pass, 1 fail**, `duration_ms` 45404.722637, exit 1. The failure is `test/ops/ui-computers.e2e.test.js` (`E_CODE_USED`). NEWS + MONITOR `test/ops/node-e2e.test.js` passed (`duration_ms` 15949.079677). The route registry and the status render passed.
- Independent harness: `node qa/reports/computers-nodes-fixes/attack.cjs`. Log: `logs/attack.log`. Rows: `logs/attack.json`. **55 controls, 0 failed.**
- Computers UI path again, same script, with two test-only changes (wait until the code text changes, poll every 3 seconds). Log: `logs/ui-rerun.log`. **1 pass, 0 fail**, `duration_ms` 83835.312706. That run includes the DOM, API, log, audit, and data-file secret scan.

```text
{"commit":"fe8e4ab56fdc756a22e128724502ea45a73c3660","pre":"343d645","v124":"b7101c437466599558bf14653ff782677a2ec95b","controls":55,"failed":[]}
```

Chrome and `playwright-core` were present. `defaultWhois('100.101.1.2')` returned null. Live `tailscale whois`, macOS Keychain, `launchd`, and Gatekeeper were **NOT VERIFIED**. The harness injected `whois`. Enrollment in their e2e used `test/fixtures/fake-security.js`.

## Foreign token across the node API

Two legacy nodes, `imac` (news) and `macbook` (monitor), and one leased `news.collect` job. Every node path was called with no Authorization, `Bearer foreign-token`, `Bearer nk_imac.<wrong secret>`, `Bearer nk_notanode.<secret>`, an empty bearer, and Basic. Paths: `POST /hello`, `POST /pull`, `POST /rotate`, `POST /jobs/<id>/heartbeat|complete|fail`, `GET /ping`, `GET /files/<sha>`, `PUT /files/<sha>`, `POST /nope`, plus `POST /enroll` and `POST /enroll/status`.

| Tree | Unauthenticated node records | `nodes.json` | `lastConnError` on disk | In-memory status |
| --- | --- | --- | --- | --- |
| `fe8e4ab` | unchanged, every call 401 | unchanged | absent | `E_UNAUTHORIZED` for `nk_imac.<wrong>` |
| `343d645` | `lastConnError` written onto the node | rewritten | present | `E_UNAUTHORIZED` |
| `b7101c4` | unchanged, every call 401 | unchanged | absent | no connection error |

At `fe8e4ab`, `noteConnError` stores the code in a `Map` and does not call `save()` (`lib/ops/nodes.js` lines 83–86 and 199–200). A second `createNodeManager` on the same directory does not see the error. At `343d645` the same function assigned `n.lastConnError` and called `save()` when 5 seconds had elapsed since the previous note. The first request saved. `b7101c4` returns 401, 426, or 429 on auth failure and has no `noteConnError`.

The macbook token, used against the imac job, got 409 on heartbeat, complete, and fail. The imac record and the leased job stayed as they were. `GET /files/<sha>` was 403. `PUT` of bytes that do not match the URL hash was 422 and applies to the authenticated caller. `POST /rotate` was 409 `E_NOT_ENROLLED`.

Bad enrollment codes returned 403 or 429 and left the node records and jobs unchanged. The enroll path can still write its rate-limit counters. That is the existing per-peer counter, and it did not store `lastConnError`.

Owner routes without a session returned 401 (`POST /api/ops/nodes/enroll`, revoke, command, jobs, and `GET /api/ops/nodes`). A node bearer without the studio cookie returned 401 on revoke, rotate, and reject. Confirm without `X-Studio-Request` was 403.

## Claimed fixes

| Claim | Result |
| --- | --- |
| `VIEWS[ROUTE]` crash | **Fixed.** `public/app.js` returns a card when `VIEWS[ROUTE]` is not a function. Their route test and the UI rerun walked every sidebar route with no `VIEWS[ROUTE]` error. |
| Password confirm under Security Center | **Fixed.** `POST /api/ops/confirm` accepts `node-confirm`, `node-revoke`, `node-rotate`, and `node-legacy-token`. Confirm without the password token was 428. A wrong password was 403. The right password (`fake-password-123`) issued a token, and confirm then returned 400 `E_BAD_REQUEST` because the request was still `awaiting_code`, which means the action was recognized. Revoke and rotate without the token were 428. After the password, legacy create stayed 403 `E_LEGACY_DISABLED`. |
| Approval screen and unknown peer | **Fixed** on the injected `whois`. Loopback with no tailnet header is unverified and the label is `адрес Tailscale не определён (запрос через локальный прокси)`. The string `127.0.0.1` is absent. Confirm throws 409 `E_PEER_UNVERIFIED` until `acknowledgeUnverifiedPeer: true`, and the audit row `peer_unverified_acknowledged` is written once. A stub `whois` for `100.101.1.2` shows `macbook · 100.101.1.2 · igor@x`. |
| Foreign token changes node state | **Fixed** at `fe8e4ab`. See the table above. |
| Statuses Online, Offline, 426, revoked, TLS | **Fixed** in `public/ops-ui.js` `nodeStatus`. Their render test covers Online, Offline, 426, revoked, and an auth error. The UI rerun showed Online, then Offline and Отозван, then 426 on the iMac card. Their node e2e recorded agent `E_PIN` for a bad fingerprint and coordinator `E_AGENT_VERSION` for signed hello `0.3.1`. |
| Secret leak | **Holds** in the harness, in their node e2e, and in the UI rerun. Status, audit, `nodes.json`, the one-time code, the request secret, the bearer secret, the fake password, and `PRIVATE KEY` stayed out of the scanned DOM, API, logs, audit, and data files after the code had been shown once. |
| NEWS and MONITOR 0.2.2 e2e | **Passed** in `test/ops/node-e2e.test.js`: enroll, `E_PEER_UNVERIFIED`, ack, pull, heartbeat, complete, rotate, revoke (`E_REVOKED`), re-enroll, offline to online, agent `E_PIN`, and 426. The committed UI e2e failed before that path (`QA-NODE-004`). The corrected rerun passed it. |

## b7101c4

The disk write exists only between `343d645` and `fe8e4ab`. `b7101c4` has no `noteConnError`, no `E_PEER_UNVERIFIED`, and no `acknowledgeUnverifiedPeer`. The foreign-token probe on that tree matched `fe8e4ab` for disk and node records, and it did not set a connection error. **Do not treat `b7101c4` as blocked by this bug.** The v1.2.4-final install verdict stays as written. Computers connect on that zip stays forbidden until a build that actually contains `fe8e4ab` is audited. `322023f` was not run.

## Known limits, confirmed

- `whois` was a stub. `defaultWhois` on this host returned null. A live tailnet device name was **NOT VERIFIED**.
- A fingerprint mismatch is reported by the agent (`E_PIN` in their node e2e). The coordinator records `tlsClientError` only. The pin check in `node-agent/enroll.js` compares the certificate after the handshake and then closes. The Computers view says that pin mismatch is also shown on the node screen.
- Connection errors at `fe8e4ab` are memory-only. That is the fix for the disk write. A new process does not show the error.

## Findings that stay open

### Low — `QA-NODE-001` — nonce cache is still memory-only

`lib/ops/nodes.js` line 89 is still `const nonces = new Map()`. This re-audit did not repeat the restart capture. The delta does not close it.

### Low — `QA-NODE-002` — loopback can still name a peer and skip the second ack

Loopback plus `X-Forwarded-For: 100.101.1.2` and a stub `whois` that returns an id is `verified: true`, key `tsnode:nMB`. Confirm of that enrollment succeeded with no `acknowledgeUnverifiedPeer`. A direct socket on `100.101.1.2` ignored a spoofed `X-Forwarded-For`. A login header without a tailnet address is now unverified (`tsuser:igor@x`). The shared `loopback` bucket remains.

Their UI e2e sets `pollMs: 200`. Both agents share that loopback bucket, and `/enroll/status` counts toward the 30 calls per minute. The first corrected rerun, still on a 200 ms poll, ended with `E_RATE_LIMIT`. The product client default is 3 seconds. With that interval the UI path finished, because confirm stopped the poll before the window filled.

### Low — `QA-NODE-003` — reject still skips the password

`classify` returns null for `POST /api/ops/nodes/enroll/:id/reject` and for command. A session with `X-Studio-Request` reached reject and got 400 `E_BAD_REQUEST` (the request was `awaiting_code`), which is the handler, so the password step did not run. Confirm on the same server was 428.

### Low — `QA-NODE-004` — the committed Computers UI e2e reads the previous code

`test/ops/ui-computers.e2e.test.js` clicks «Подключить компьютер» and waits for `#enOut .enroll-code`. After the first computer that element is already visible, so the second read returns the first code. Both agents post it. The second `POST /enroll` returns `E_CODE_USED` (`logs/their-tests.log`). The panel itself returns a new code. Waiting until the text changes, and polling every 3 seconds, let the same flow pass (`logs/ui-rerun.log`), including Online, Offline, 426, revoked, the unverified-peer dialog, the password prompt, and the secret scan.

## Mac mini

Allowed: keep the isolated v1.2.4-test install and 3D result from the final audit. Leave Computers disconnected on that zip.

For a later build that contains `fe8e4ab`: the private-tailnet conditions from `qa/reports/node-0.2.2/REPORT.md` still apply. Leave `STUDIO_NODES_LEGACY_TOKENS` unset. Leave Funnel off. An unknown peer needs the second confirmation. Live Tailscale `whois`, Keychain, `launchd`, and Gatekeeper are still **NOT VERIFIED**.

Forbidden: real publishing, and any Meta, Facebook, Instagram, or Telegram send.
