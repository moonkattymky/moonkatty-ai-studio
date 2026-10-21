# Independent security re-audit — MOONKATTY NODE 0.2.2

Target: branch `feat/studio-operations`, range `01ef2b0..db4720b`. The tree was read in a detached worktree at `/tmp/mk-node022`, HEAD `db4720bee599f42a815c6876eb1446317f7d5258`. `01ef2b0` is an ancestor of that commit. `git status --porcelain` there was empty before the tests and empty after them. Nothing on that branch was modified. Nothing was merged and nothing was published. Passwords and codes in the tests are fake. No call was made to Meta, Facebook, Instagram, or Telegram.

This re-runs the NODE 0.2.1 attack against the twelve fixes Studio claimed for protocol 2. The 0.2.1 review is `qa/reports/node-0.2.1/REPORT.md` (commit `596cb57`).

## Verdict

**Private tailnet test: GO, with the conditions at the end of this report.**

**Funnel, a public bind, and a production launch: NO-GO.**

All twelve claimed fixes hold. No critical, high, or medium finding. Three new low findings: the nonce cache is memory-only (`QA-NODE-001`), unidentified loopback clients share one lock bucket and a loopback process can name another peer (`QA-NODE-002`), and reject does not ask for the password (`QA-NODE-003`).

macOS Keychain, `launchd`, Gatekeeper, and a real `tailscale whois` were **NOT VERIFIED**. The harness injected `whois` and used `test/fixtures/fake-security.js`.

## Unknown peer and the shared fallback bucket

An unidentified loopback client uses the key `loopback`. Ten failures from `127.0.0.1` with no Tailscale headers locked that bucket. The next enrollment from `::1`, also with no headers, returned `E_IP_LOCKED`. An identified peer on the same loopback socket, sent with `X-Forwarded-For` of a tailnet address that `whois` named, still returned `pending`.

A non-loopback socket cannot force other peers into that bucket. From `100.101.1.2`, a spoofed `X-Forwarded-For` of another peer was ignored and the bucket was `whois` of the socket (`tsnode:nEVIL`). From `10.9.9.9` with a spoofed `X-Forwarded-For`, the bucket was `ip:10.9.9.9`.

A process on `127.0.0.1` or `::1` can set `X-Forwarded-For` to a victim tailnet address. When `whois` returns an id, that peer's bucket locks. Ten failures locked `tsnode:nIMAC`. `tsnode:nEVIL` still enrolled. That trust is local to the Mac mini: `tailscale serve` and any other process on loopback.

```text
unknown-bucket-dos-is-shared: unknown loopback, other loopback, locked E_IP_LOCKED, identified pending
loopback-xff-can-lock-named-peer: victim E_IP_LOCKED, other pending
xff-ignored-off-loopback: nonLoop tsnode:nEVIL, lan ip:10.9.9.9, login tsuser:igor@x
```

## How this was checked

- Their suite, from the worktree, Node v22.23.3: `node --test test/ops/enroll.test.js test/ops/security-center.test.js test/ops/nodes.test.js test/ops/nodes.integration.test.js`. Log: `logs/their-tests.log`. **33 pass, 0 fail**, `duration_ms` 1402.119967, exit 0.
- Independent harness: `node qa/reports/node-0.2.2/attack.cjs` with `NODE_022_SRC=/tmp/mk-node022`. Log: `logs/attack.log`. Machine-readable rows: `logs/attack.json`. **24 controls, 0 failed.**

```text
{"commit":"db4720bee599f42a815c6876eb1446317f7d5258","controls":24,"failed":[]}
```

`test/ops/nodes.multiprocess.test.js` was not run. The lock was checked with a second process in the harness.

Their tests already cover entropy, expiry, reuse, binding, brute force, a real TLS enroll with the fake Keychain, plaintext and a wrong pin, 0.2.0 in-process compatibility, CGNAT, anti-replay, a timing ratio under 3, peer buckets, confirmation screens, legacy tokens off plus the password step-up, and the Funnel JSON cases.

## Claimed fixes

| 0.2.1 finding | Claim | Result |
| --- | --- | --- |
| Medium — signed pull replayed for 120 seconds | `x-node-nonce` is in the signature, 30 s window, 401 `E_REPLAY` | **Fixed.** Residual: the nonce map dies with the process (`QA-NODE-001`). |
| Medium — every serve peer shares `127.0.0.1` | Buckets from `whois` and `X-Forwarded-For`, headers trusted only from loopback | **Fixed** for a non-loopback spoof. Residual: the shared `loopback` bucket and a loopback `X-Forwarded-For` (`QA-NODE-002`). |
| Medium — approval screen omits the device-key fingerprint | Panel and node screen show the fingerprint; hostname, model, and OS are marked unverified | **Fixed.** |
| Medium — Funnel check always passes | `serve`/`funnel status --json`; on is a failure; unreadable is a warning | **Fixed** on injected JSON. The real binary was **NOT VERIFIED**. |
| Low — IP lock resets on a new process | Locks persist in `nodes.json` | **Fixed.** A second manager returned `E_IP_LOCKED`. |
| Low — `--code` puts the code in argv | Code comes from stdin; `--code` exits | **Fixed.** Exit 2. The code was absent from stdout and stderr. |
| Low — forced `tlsMode: tailscale` skips the pin on any host | `tlsMode` tailscale requires `*.ts.net` | **Fixed.** `enroll` and `client` both threw `E_TLS_MODE`. |
| Low — confirm does not ask for the password | Confirm, revoke, and rotate require the password again | **Fixed** for those three. Reject is outside the set (`QA-NODE-003`). |
| Low — a node rotates without the owner flag | Rotate returns 409 until the owner sets the flag | **Fixed.** 409 `E_ROTATE_NOT_REQUESTED`, then 200 with a new `nk_` token. |
| Low — the panel mints a bearer-only node | Legacy tokens stay off unless `STUDIO_NODES_LEGACY_TOKENS=1` | **Fixed.** First POST 428, after the password 403 `E_LEGACY_DISABLED`. |
| Low — two processes can each issue a token | `nodes.lock` refuses a second live pid | **Fixed.** The second process threw. After `SIGKILL`, the dead pid was reclaimed. |
| Low — a matching bearer is much slower | A dummy Ed25519 verify runs on every path | **Fixed.** Wrong token 33961 ns, right token 37796 ns, ratio 1.11. |

## New findings

### Low — `QA-NODE-001` — the used-nonce map is memory only

`lib/ops/nodes.js` line 82 keeps nonces in a `Map`. `useNonce` (lines 83–84) returns `E_REPLAY` when that map already holds the key. `authNode` (lines 91–96) verifies `METHOD\nPATH\nts\nnonce\nsha256(body)`, requires the timestamp inside `SIG_WINDOW_MS` (30 seconds, line 35), and requires `x-node-nonce` matching `/^[A-Za-z0-9_-]{22,64}$/`. A signature without a nonce on a device key returns 426 `E_AGENT_VERSION` (line 94). `node-agent/agent.js` line 59 puts the nonce in the signed string and in `x-node-nonce`.

The first pull leased `nj_abe28ca73c5c7883`. The same bytes in that process returned `E_REPLAY`. The same signature with a timestamp 31 seconds behind the server clock returned `E_UNAUTHORIZED`. A second `createNodeManager` on the same directory accepted the captured signature.

A restart inside the 30 second window can hand the next job to a captured pull. Capturing the bytes still requires breaking TLS or reading them on the node.

### Low — `QA-NODE-002` — unidentified loopback clients share one bucket, and loopback can name a peer

`peerOf` (`lib/ops/nodes.js` 75–80) reads `X-Forwarded-For` and `Tailscale-User-Login` only when the socket is `127.0.0.1` or `::1`. A tailnet address goes to `whois` and becomes `tsnode:<id>`. A login header with a non-tailnet forwarded address becomes `tsuser:<login>`. No header on loopback becomes `loopback` with `verified: false`. Off loopback the headers are ignored. `lib/ops/node-enroll.js` line 24 stores the counters in `S.enrollLimits`, which is written with `nodes.json`.

Measured buckets: loopback plus a tailnet `X-Forwarded-For` was `tsnode:nIMAC` and `tsnode:nEVIL`; loopback plus `Tailscale-User-Login` and a non-tailnet forwarded address was `tsuser:igor@x`. The shared-bucket and named-peer results are in the section above. The lock survived a new manager (`E_IP_LOCKED`).

`whois` was injected. `defaultWhois` (`nodes.js` 217–219) shells out to `tailscale whois --json`. That binary was absent.

### Low — `QA-NODE-003` — reject does not ask for the password

`classify` (`lib/ops/security-center.js` 72–75) returns `node-confirm`, `node-revoke`, `node-rotate`, and `node-legacy-token`. It does not match reject. `lib/ops/protected.js` lines 82–89 return 428 for any `node-*` action even when the Security Center flag is off. Reject falls through.

The harness: confirm 428, wrong password 403, confirm after a valid confirm token 400 (the request was no longer pending), revoke 428, rotate 428. `test/ops/nodes.integration.test.js` line 46 asserts that reject is not 428. Their suite passed, including that assertion.

### Info — recorded here, not as registry bugs

- `lib/ops/node-enroll.js` line 67 returns `protocol: 1` on the enrolled status. `hello` (`nodes.js` 124) returns `PROTOCOL`, which is 2. The harness read `protocolField` 1. The agent does not branch on that field.
- `node-agent/agent.js` line 247 exits 2 when argv contains `--code`. Line 266 still prints a help line that includes `--code`.
- `lockDir` (`nodes.js` 221–223) returns immediately when the lock file holds the same pid. That re-entry is what the tests use.
- `agentOk` (`nodes.js` 38) accepts a missing `agentVersion` and any `0.2.z`. The advertised `AGENT_RANGE` is `>=0.2.0 <0.3.0`. A string that does not match `x.y.z` is refused.

## Controls that held

Replay inside one process. First pull `nj_abe28ca73c5c7883`, replay `E_REPLAY`, timestamp 31 seconds old `E_UNAUTHORIZED`, missing nonce `E_AGENT_VERSION`.

Rotation. `POST /api/nodes/rotate` without `rotatePending` was HTTP 409 `E_ROTATE_NOT_REQUESTED`. After `requestRotate`, HTTP 200 and a token starting with `nk_`.

Peer headers. Loopback trusted `X-Forwarded-For` and produced `tsnode:nIMAC` / `tsnode:nEVIL`. A non-loopback tailnet socket ignored the spoofed header and used `whois` of the socket. A LAN socket with a spoofed header stayed `ip:10.9.9.9`.

Persistence and the process lock. The IP lock survived a second `createNodeManager`. A second process on a held directory threw `уже используется процессом`. After `SIGKILL` the exit handler did not unlink the lock, and the next manager reclaimed the dead pid and opened.

Screens. `public/ops-ui.js` lines 37–39 and 63 render `pubKeyShort`, the full `pubKeyFingerprint`, and the sentence `Сообщено устройством (не проверено)`. `node-agent/enroll.html` line 15 writes `pubKeyShort` and `pubKeyFp` through `textContent`. The file has no `innerHTML`.

Code entry. `--code` exited 2 with `не передавайте код в командной строке`. Stdin of a code against `http://` exited 2 with `только https`. The code was absent from stdout and stderr.

TLS mode. `enroll({ tlsMode: 'tailscale' })` on a non-`.ts.net` host threw `E_TLS_MODE`. `client()` threw the same message the agent already used in 0.2.1.

Funnel, on injected status objects. Empty serve and funnel objects: ok, `Funnel выключен`. `AllowFunnel` true: ok false, `ВКЛЮЧЁН`, host `mac-mini.tailnet.ts.net:443`. Both streams null: ok false, warning, including through `securityAudit`.

Timing. Dummy verify at `nodes.js` 91 runs before the `tokOk` return at line 92. Ratio 1.11 (33961 ns wrong, 37796 ns right).

Legacy and step-up. `POST /api/ops/nodes` was 428, then 403 `E_LEGACY_DISABLED` with `STUDIO_NODES_LEGACY_TOKENS` unset. Confirm, revoke, and rotate were 428 before the password.

## Conditions for a private tailnet test

1. Funnel stays off. The audit now reads `tailscale serve status --json` and `tailscale funnel status --json`. AllowFunnel true fails the check. Unreadable output is a warning and the audit is not ok. Confirm that on the Mac mini; this run injected the JSON.
2. Compare `pubKeyShort` and the full SHA-256 on the node screen (`127.0.0.1:8791`) with the same two values in the confirm dialog. Hostname, model, and OS are labeled unverified and come from the enrolling machine.
3. Enter the code at the prompt or on stdin. `--code` exits 2. The listen log line still mentions the flag.
4. Leave `STUDIO_NODES_LEGACY_TOKENS` unset. The panel then refuses a bearer-only token after the password.
5. Run one coordinator process. `nodes.lock` refuses a second live pid and reclaims a dead one.
6. Treat loopback as trusted. Ten failures with no Tailscale headers lock every other unidentified loopback client for 15 minutes. A local process can set `X-Forwarded-For` to a victim tailnet address and lock that peer when `whois` names it. Identified peers stay on their own buckets.
7. A coordinator restart clears the nonce map. A captured signed request can be accepted once more while its timestamp is still inside 30 seconds. The request lock and the IP lock stay on disk.

This GO is for a private tailnet test. It is not a production launch and it is not a Funnel launch. macOS Keychain, `launchd`, Gatekeeper, and a live tailnet `whois` were **NOT VERIFIED**.
