# QA report — NODE 0.2.2 r3 (feat/nodes-022-final @ 5bd0d84d026aca3baf908c2cf42e06e820f62d06)
Date: 2026-10-22. Auditor: independent QA (Grok Bot). Baseline: 907610a (prior PASS). Fresh clone, git 2.47.3, Linux.

## Overall: PASS (real-Mac checks: BLOCKED)

## Tests (observed)
| suite | result | verdict |
|---|---|---|
| test:ops | 143 tests, 141 pass / 0 fail / 2 skip | PASS |
| test:ops:studio | 4/0/0 | PASS |
| test:update-center (UC) | 79/0 | PASS |
| test:nodes | 52/0 | PASS |
| test:security | 52/0 | PASS |
| test:isolation | 65/0 (Node 22; fails to start on Node 20: node:sqlite missing) | PASS |
| test:publish-guard | 59/0 (Node 22; bundle checks SKIP, no dist build) | PASS |
| test:policy | 46/46 | PASS |
| node-pkg-repro (test/ops/node-pkg-repro.test.js) | 1/0 | PASS |
| real Mac (Ventura iMac / Monterey MBP) | — | BLOCKED |

## Hashes — all match claims; independent full rebuild byte-identical
darwin-x64 cd576260…7026, monterey 834a5792…050c, js-only 5ffaf1e2…80db, source zip eb15243d…a684 (git 2.47.3 = same version). verify-source-zip.sh: OK, 627 files match the commit.

## Security review of 907610a..5bd0d84
- Signature verification, bearer token compare (timingSafeEqual), ±30 s window (`Math.abs(now()-ts) <= SIG_WINDOW_MS`), nonce regex: unchanged. Floor/nonce check runs only after sig+window pass. Not weakened.
- useNonce strictly tightened: `ts > bootFloor` (persisted nowHwm, else startedAt-1) and `ts > bootScopes[scope]`; nonce single-use kept; floor persist failure → E_RATE_LIMIT (429) before nonce is recorded/accepted.
- Agent E_REPLAY retry: loops and re-calls req() → new ts/nonce/signature; no signature reuse. Other 401s keep the 60 s pause.
- replay-floor.json: open 0600 + chmod 0600, write+fsync, rename, dir fsync; contains only timestamps (test asserts mode 0600, no secrets).
- Secrets: no real tokens in code, archives, send/ folder; only fake fixtures in node-pkg-repro test and redaction regexes. BUILDINFO source = public token-free URL. Clone remote token-free.

## Issues
- LOW: directory fsync errors are silently swallowed (`catch {}`) — rename durability not guaranteed on FS where dir fsync fails; acceptable.
- LOW: on persist failure the `.tmp` file is not removed (harmless, 0600, no secrets).
- INFO: isolation/publish-guard require Node >= 22 (node:sqlite); document test runtime.
- INFO: synchronous fsync on request path at most once per 3 s step (+ per future-skew ts) — fine at node scale.
