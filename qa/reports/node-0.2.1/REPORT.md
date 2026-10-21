# Independent security review — MOONKATTY NODE 0.2.1 enrollment

Target: branch `feat/studio-operations`, range `38bce84..596cb57`. The tree was read in a detached worktree at `/tmp/mk-node-021`, HEAD `596cb576c9203a2b26fde62980a52426e25275be`. `git status --porcelain` there was empty before the tests and empty after them. Nothing on that branch was modified. Nothing was merged and nothing was published. Passwords and codes in the tests are fake. No call was made to Meta, Facebook, Instagram, or Telegram.

Reviewed at that commit: `lib/ops/nodes.js`, `lib/ops/node-enroll.js` (the enrollment coordinator; the request named the files around it), `node-agent/enroll.js`, `node-agent/agent.js`, `node-agent/enroll.html`, `public/ops-ui.js`, `public/app.js`, `lib/ops/protected.js`, `lib/security.js`, `lib/ops/security-center.js`, `server.js`, `docs/ops/NODE_API_CONTRACT.md`, `docs/ops/NODE_ENROLL_0.2.1.md`, `test/ops/enroll.test.js`.

## Verdict

**Private tailnet test: GO, with the conditions at the end of this report.**

**Funnel, a public bind, and a production launch: NO-GO.**

No critical finding and no high finding. Four medium findings and eight low findings. The cryptographic controls that the design claims (HMAC-only storage, five-attempt request lock that survives a new process, single use, TLS required, pin before any enrollment POST, Ed25519 on enrolled calls, owner session plus CSRF on the admin routes) held under the attack harness.

Keychain and launchd were not executed on macOS. The harness used `test/fixtures/fake-security.js`.

## How this was checked

- Their suite, from the worktree: `node --test test/ops/enroll.test.js`. Log: `logs/their-enroll.log`. **9 pass, 0 fail**, `duration_ms` 649.964557, exit 0. Node v22.23.3.
- Independent harness: `node qa/reports/node-0.2.1/attack.cjs` with `NODE_021_SRC=/tmp/mk-node-021`. Log: `logs/attack.log`. Machine-readable rows: `attack-results.json`. **19 controls, 0 failed. 11 probes.** Summary line:

```text
{"commit":"596cb576c9203a2b26fde62980a52426e25275be","src":"/tmp/mk-node-021","controls":19,"controlsFailed":[],"probes":11,"node":"v22.23.3"}
```

The harness loads the worktree modules. It does not write into that tree. Certificates used for the pin-skip probe were minted locally with `openssl` and trusted only inside a child process via `NODE_EXTRA_CA_CERTS`.

## Their suite

`test/ops/enroll.test.js` already covers alphabet and entropy, expiry, reuse, wrong code, cross-request binding, the 5-attempt lock, the 10-failure IP lock, the 30/minute cap, bad device signatures, a real TLS enroll with the fake Keychain (token absent from files, logs, and the fake `security` argv), plaintext 426, a wrong pin before any enrollment, 0.2.0 bearer compatibility, and the CGNAT address check. All nine passed. The probes below are the cases that suite does not attack.

## Findings

### Medium — a captured signed request is accepted again for 120 seconds

`lib/ops/nodes.js` 65–69 compares `x-node-ts` to server time with `Math.abs(now() - ts) < 120e3` and verifies the Ed25519 signature. There is no nonce and no record of a signature already seen. `node-agent/agent.js` 59 signs `METHOD\nPATH\nts\nsha256(body)` and sends that timestamp once.

The harness enrolled a node, queued two `news.collect` jobs, and sent the same signed `POST /api/nodes/pull` twice. Both returned 200 and leased different jobs. The same signature at `now+121000` and `now-121000` returned 401 `E_UNAUTHORIZED`.

```text
signed-pull-replay-window: first nj_86e7479cd5abc386, replay nj_c7375233db179723,
sameJob false, replayStatus 200, future 401, past 401
```

`complete` is idempotent on the lease id (`lib/ops/nodes.js` 108–113). `pull` is not. A passive capture of one signed pull inside the window takes the next queued job. Capturing the bytes requires breaking TLS or reading them on the node. On a private tailnet that is defense in depth, and it is a real replay.

Fix: remember `(nodeId, ts, sig)` until the timestamp leaves the window, or require a single-use nonce. Reject a repeat with 401.

### Medium — the documented Tailscale proxy puts every peer in one IP bucket

`lib/ops/nodes.js` 158 sets the enrollment address from `socket.remoteAddress` and strips a leading `::ffff:`. It does not read `X-Forwarded-For`, `X-Real-IP`, or `Forwarded`. `lib/ops/node-enroll.js` 24 keeps the counters in `const ip = {}`. Ten failures lock that address for 15 minutes (`node-enroll.js` 26–29).

Ten format-invalid enrollments were sent over TLS from 127.0.0.1 with `X-Forwarded-For: 8.8.8.8`, `X-Real-IP: 9.9.9.9`, and `Forwarded: for=1.2.3.4`. An eleventh request with `X-Forwarded-For: 1.1.1.1` was locked. A direct call with address `8.8.8.8` was not locked. The only bucket before that direct call was `127.0.0.1`.

```text
xff-does-not-select-bucket: tenth E_CODE_INVALID, eleventh E_IP_LOCKED,
directSpoofedIp E_CODE_INVALID, bucketsBeforeDirect ["127.0.0.1"]
```

Spoofing the header does not move the limit. `docs/ops/NODE_ENROLL_0.2.1.md` line 28 tells the operator to run `tailscale serve --bg --https=8443 https+insecure://127.0.0.1:8790`. Every tailnet peer then appears as 127.0.0.1, so ten bad codes from anyone lock enrollment for the iMac as well, for 15 minutes.

Fix: bind `8790` on the Tailscale `100.x` address so `remoteAddress` is the peer. If serve-to-loopback stays, honor a peer identity header only when the socket is loopback and Tailscale is the one setting it. Say so in the doc.

### Medium — the iMac screen does not show the device-key fingerprint the owner is told to compare

`docs/ops/NODE_ENROLL_0.2.1.md` line 41: compare deviceId, hostname, model, OS, and the key fingerprint with what the iMac shows, then confirm. `node-agent/enroll.html` 14–15 writes `deviceId`, `requestId`, `nodeId`, and the error through `textContent`. The harness check `enrollHtmlShowsDeviceKey` is false. The page does include an input labeled `Отпечаток сертификата` (the coordinator certificate). That is a different value.

`lib/ops/node-enroll.js` 39–40 puts `pubKeyFingerprint` (full SHA-256 of the SPKI) and `pubKeyShort` (first 16 hex digits) on the API view. `public/ops-ui.js` 37 renders `pubKeyShort` only. `templateShowsShortOnly` is true. Line 60 confirms with the request id and the fixed sentence “Сверьте имя, deviceId и ключ.” `confirmInterpolatesFingerprint` is false. Line 59’s `XXXX-XXXX-XXXX-XXXX` next to the one-time code is `fingerprintShort` of the TLS certificate, not the device key.

Hostname, model, OS, and arch are copied from the enroll body (`node-enroll.js` 57, sliced). The API view recorded hostname `<img src=x onerror=alert(1)>` after a parallel enroll. The panel template escapes it (`escaped: true` against the real `esc` in `public/app.js` 8). The strings are still attacker-chosen labels.

A tailnet peer who has the one-time code can submit their own key and the iMac’s hostname, model, and OS. The owner then sees a plausible row. The value the doc says to read off the iMac is not on that screen. `deviceId` is on both sides, and the panel row does show the 16-hex short key.

Fix: render the same `pubKeyShort` and the full fingerprint on the iMac status line and in the confirm dialog. Keep treating hostname, model, and OS as labels from the enrolling machine.

### Medium — the Funnel check always passes

`lib/ops/security-center.js` 118 is `add('funnel-not-used', true, 'Проверьте вручную: tailscale funnel status → off', 'info')`. The harness called `securityAudit` with no Tailscale binary. The check came back `ok: true` with that detail and an empty `fix`.

`listen` (`lib/ops/nodes.js` 193) throws unless `isPrivateIPv4` accepts the bind address. The harness got that throw for `0.0.0.0`, `8.8.8.8`, `::ffff:8.8.8.8`, `::ffff:100.64.0.1`, `0177.0.0.1`, `2130706433`, `localhost`, `imac.tailnet.ts.net`, and `127.0.0.1.attacker.test`. A public bind is refused. Funnel in front of `127.0.0.1:8790` is a different process, and this check does not look at it.

Fix: run `tailscale funnel status` and fail the audit when it is on, or remove the check so the operator gate is the only one. Leave Funnel off for the tailnet test.

### Low — the IP lock is gone after a new process; the request lock stays

`node-enroll.js` 24. Ten failures from `10.8.8.8` produced `E_IP_LOCKED`. A new `createNodeManager` on the same directory accepted another guess from that address (`E_CODE_INVALID`, `lockedUntil` 0, one new failure). Five wrong codes locked a request; a new manager on the same directory still returned `E_REQUEST_LOCKED` for the right code, and the code was absent from `nodes.json`.

```text
request-lock-survives-restart: wrongs [E_CODE_INVALID x4, E_REQUEST_LOCKED], after E_REQUEST_LOCKED, codeInState false
ip-lock-resets-on-new-process: locked E_IP_LOCKED, afterRestart E_CODE_INVALID, lockedUntil 0, fails 1
```

This matches the limitation the owner already stated. The request lock is the control that stops an online brute force across a restart. The code is 10 symbols from a 31-character alphabet, about 49.5 bits (`10 * log2(31)`), and the request id prefix is public.

Fix: persist IP locks next to the request lock if a restart should keep them. Otherwise leave the doc as it is and rely on the request lock.

### Low — `agent.js --enroll --code` puts the code in argv

`node-agent/agent.js` 245–246 reads `--code` from `process.argv`. The harness started that command with code `23456-789GH-JKMNP`. `/proc/<pid>/cmdline` contained the code. stdout/stderr did not (`outputHasCode: false`; the process stopped with `Keychain недоступен`). The local enroll page does not put the code in argv.

Fix: take the code from the page on `127.0.0.1`, or from stdin. Keep it out of the command line on a machine where other users can run `ps`.

### Low — `enroll()` will skip the pin when the caller forces tailscale mode

`node-agent/enroll.js` 38 keeps a caller-supplied `tlsMode` and only appends `.ts.net` detection when `tlsMode` is empty. `enroll.js` 32 attaches `checkServerIdentity` only when `tlsMode !== 'tailscale'`. `node-agent/agent.js` 65 refuses tailscale mode unless the URL is `https` and the host ends in `.ts.net`. The shipped UI and CLI do not pass `tlsMode` into `enroll()`.

Observed:

- `enroll({ tlsMode: 'tailscale', url: https://127.0.0.1 })` against the coordinator’s self-signed cert threw `DEPTH_ZERO_SELF_SIGNED_CERT`. Enrollment audit entries added: 0.
- The same call against a locally trusted cert (SAN `IP:127.0.0.1`, `NODE_EXTRA_CA_CERTS` in a child) sent `POST /api/nodes/enroll` with the code. The test server returned 403. `hitsAfterForced` is 1.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` plus `tlsMode: 'tailscale'` and no extra CA also sent the code (`hitsAfterInsecure` 2).
- Pinned mode with the wrong fingerprint returned `E_PIN` and did not send the POST, including under `NODE_TLS_REJECT_UNAUTHORIZED=0` (`insecurePinned.code` is `E_PIN`).
- `client({ tlsMode: 'tailscale', url: 'https://127.0.0.1:1' })` threw before connect: `NODE_TLS_MODE=tailscale: COORDINATOR_URL должен быть https://<mac-mini>.<tailnet>.ts.net`.
- `enroll({ url: 'http://127.0.0.1:…' })` threw `E_TLS_REQUIRED` with 0 connections to a local HTTP server.
- A wrong pin on the real coordinator: `E_PIN`, `code_accepted` absent, `device.json` not created.

Fix: use the same `.ts.net` check in `enroll()` that `client()` already uses. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` on a node.

### Low — approving a device does not ask for the password again

`lib/ops/security-center.js` 60–72 returns null for enroll confirm, reject, revoke, and rotate. The harness classified confirm and revoke as null and then confirmed a pending request with the owner cookie and `X-Studio-Request: 1` and no `X-Studio-Confirm`. Status 200.

The session and CSRF checks still ran. See the controls below. `server.js` 74 sets `mk_session` as `HttpOnly; SameSite=Strict`.

Fix: add device confirm, revoke, and owner rotate to `classify` if approval should require the password a second time.

### Low — an enrolled node can rotate its token without the owner flag

`lib/ops/nodes.js` 171 calls `rotateToken` for any enrolled node. It does not read `rotatePending`. The owner route (`lib/ops/protected.js` 92) only sets that flag. The contract (`docs/ops/NODE_API_CONTRACT.md` section F) says `POST /api/nodes/rotate` returns a new token and kills the old one.

The harness called rotate with no prior `requestRotate`. Status 200. The old token’s ping was 401, the new token’s ping was 200, revoke made the new token 401, and the token string was absent from `nodes.json`.

Someone who already has the bearer token and the device key can rotate. That is the same principal the enrollment trusted. It is not a step up.

Fix: require `rotatePending` on `/api/nodes/rotate` if rotation must wait for the owner button.

### Low — the owner can still mint a bearer-only node

`lib/ops/protected.js` 83 `POST /api/ops/nodes` calls `registerNode` (`lib/ops/nodes.js` 52–59), which stores a token hash and no `devicePubKey`. `authNode` skips the signature when `devicePubKey` is empty (line 67). The harness, with an owner session, received such a token and `authNode` accepted it with no signature (`legacyBearerAcceptedWithoutSignature: true`).

The enroll path always sets the device key. This route is the 0.2.0 compatibility path their test 8 keeps. It is owner-only. A stolen studio session can skip the one-time code.

Fix: stop issuing signature-less tokens from the panel API, or require a device key on `registerNode`.

### Low — two processes on one state file can each hand out a token

`status` (`node-enroll.js` 59–65) checks `secretHash`, then on `confirmed` issues the token and clears the hash, synchronously. In one process the second call was `E_NOT_FOUND`. Two parallel HTTPS status calls returned one `enrolled` and one `E_NOT_FOUND` (`tokenCount` 1).

Two managers loaded the same file after confirm and before either status call. Both returned `enrolled` with different tokens. The file kept the second hash (`storedIsT2: true`, `storedIsT1: false`). One token was dead as soon as the second save landed. The coordinator is one process.

Fix: take a file lock around confirm-to-issue if a second process is ever started on the same `nodes.json`.

### Low — a correct bearer token is slower than a wrong one

`authNode` runs `timingSafeEqual` on the token hash and, only after a match, verifies Ed25519 (`nodes.js` 66–68). Median of 800 samples:

| Compare | Median |
| --- | ---: |
| `timingSafeEqual` on 8 KB, mismatch at byte 0 | 5722 ns |
| `timingSafeEqual` on 8 KB, mismatch at the last byte | 5341 ns |
| Byte-by-byte loop, mismatch at byte 0 | 130 ns |
| Byte-by-byte loop, mismatch at the last byte | 7553 ns |
| `authNode`, wrong token | 3321 ns |
| `authNode`, right token, bad signature | 115083 ns |
| SHA-256 HMAC digest compare, differ | 539 ns |
| SHA-256 HMAC digest compare, equal | 549 ns |

The 8 KB `timingSafeEqual` pair stays flat. The early-exit loop does not, so the clock can see a prefix leak when one exists. The HMAC helper in `node-enroll.js` 15 uses `timingSafeEqual` on equal-length hex. The enroll code is not recovered through that compare.

The token path is about 35 times slower once the bearer matches, because the signature verify runs only then. The secret is 24 bytes of base64url (`nodes.js` 43). This does not make the token guessable.

Fix: when the bearer hash does not match, verify a dummy signature so the two failures take similar time.

## Controls that held

Request binding. A code whose secret half came from another live request returned `E_CODE_INVALID`. A Unicode dash was `E_CODE_INVALID`. The real client uppercases before signing; the lowercased code then enrolled. A proof from another key returned `E_BAD_SIGNATURE` and left the code usable (`retryAfterBadProof: pending`).

TTL. `node-enroll.js` 30 uses `t > expiresAt`. At `expiresAt` the code enrolled. One millisecond later a fresh code returned `E_CODE_EXPIRED`.

Single use. The second in-process status was `E_NOT_FOUND`. A second submit of the same code was `E_CODE_USED`. Two parallel TLS enrollments produced one `pending` and one rejection.

Rate limits. Thirty-one failing status calls from one address ended `E_IP_LOCKED` (the failure counter trips at 10, before the 30/minute cap). With 30 calls prefilled and zero failures, the next enroll was `E_RATE_LIMIT`. Their test 4 covers the same numbers and passed.

Signature canonicalisation, all against a live enrolled node:

| Request | Status |
| --- | ---: |
| `GET /api/nodes/ping` signed as `GET` | 200 |
| Signed method `get` | 401 |
| Signed path with a trailing space | 401 |
| Signature joined with `\r\n` | 401 |
| No `x-node-sig` | 401 |
| Another device key | 401 |
| `GET /api/nodes/ping?injected=1`, signature over the path only | 200 |

`new URL('/api/nodes/ping/../ping')` normalizes to `/api/nodes/ping`, and a signature over that path is a normal ping (200). `new URL('/api/nodes/%2e%2e/ping')` normalizes to `/api/ping`, which does not start with `/api/nodes/` and never reaches `authNode`. The query string is outside the signature. The ping handler does not read it (`nodes.js` 169). No route in the node handler uses the query.

Address checks (`isPrivateIPv4`, then `listen` for the rejects). Accepted: `127.0.0.1`, `10/8`, `192.168/16`, `172.16.0.0/12`, `100.64.0.0/10` through `100.127.255.255`, `fd7a:115c:a1e0::/48` in either case. Rejected by `net.isIP`, so also by the allowlist: `127.1`, `127.0.0.01`, `0177.0.0.1`, `0x7f.0.0.1`, `2130706433`, `127.0.0.1.`, `192.168.1.256`, `100.64.999.1`, `localhost`, `imac.tailnet.ts.net`, `127.0.0.1.attacker.test`, `[fd7a:115c:a1e0::1]`. `::ffff:127.0.0.1`, `::ffff:100.64.0.1`, and `::ffff:8.8.8.8` are IPv6 and fail the Tailscale prefix, so `listen` throws. `::1`, `fd00::1`, and `fe80::1` are rejected. DNS rebinding names are rejected because `listen` does not resolve them. The studio `hostCheck` returned 421 for `Host: evil.example`. The enroll UI on `127.0.0.1` returned 421 for `Host: evil.example` and for `Host: 127.0.0.1.attacker.test`, 200 for `Host: localhost:<port>`, 403 for `POST /enroll` without `x-node-local`, and 202 with the per-start token (`node-agent/agent.js` 254–257).

Secrets. After a real enroll, `nodes.json` mode was `600`, the token and the request secret were absent, and `sha256(token)` was present. The audit JSON contained neither. The create log did not contain the code. Fake Keychain argv was `["-i"]` and did not contain the token (`node-agent/enroll.js` 14). A value with a space threw before spawn. `device.json` holds the public key. The private key went to the fake Keychain.

Admin authorization, using the real `csrfCheck` (`lib/security.js` 19–29), the real `hostCheck`, and the real `mountProtected`, with a session map shaped like `server.js` 107–110. CSRF is mounted first, as in `server.js` 50.

| Call | Status |
| --- | ---: |
| `POST /api/ops/nodes/enroll` with no cookie | 403 |
| Cookie, no `X-Studio-Request` | 403 |
| Cookie, header, `Origin: https://evil.test` | 403 |
| `Origin: null` | 403 |
| `Sec-Fetch-Site: cross-site` | 403 |
| Node bearer, no studio cookie | 401 |
| `GET /api/ops/nodes/enroll` with no cookie | 401 |
| `Host: evil.example` | 421 |
| Owner cookie, `X-Studio-Request: 1`, `Origin: http://127.0.0.1:8799` | 200, code returned |

XSS. The panel row built with `esc` from `public/app.js` 8 turned `<script>alert(1)</script>` into `&lt;script&gt;…` and the hostname payload into `&quot;&gt;&lt;img…`. `enroll.html` assigns status with `textContent` and has no `innerHTML`.

Plaintext enroll on the node listener returned 426 `E_TLS_REQUIRED`.

## Conditions for a private tailnet test

1. Funnel stays off. Check `tailscale funnel status` by hand. The in-app audit will report `funnel-not-used` ok without running that command.
2. Bind port 8790 on the Tailscale address if each peer should have its own failure counter. The serve command in the doc sends every peer to 127.0.0.1, and ten bad codes then lock enrollment for 15 minutes for everyone.
3. Before confirm, compare `deviceId` (the iMac screen shows it) and the short key on the panel row. The iMac screen does not show the device-key fingerprint. Hostname, model, and OS are whatever the enrolling machine sent.
4. Enter the code on `http://127.0.0.1:8791`. The `--code` flag is visible to `ps`.
5. A coordinator restart clears the IP lock and keeps a locked request locked. The right code still fails after five wrong ones.
6. Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`. Do not pass `tlsMode: 'tailscale'` for a host outside `*.ts.net`.
7. This GO is for a private tailnet test. It is not a production launch. macOS Keychain, `launchd`, Gatekeeper, and `sandbox-exec` were not run. The Keychain path was the test double, whose argv for a set was `["-i"]`.
