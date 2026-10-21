# Final audit of integrated v1.2.4-test

Read-only on `feat/v1.2.4-test-nodes`. Base `b7101c437466599558bf14653ff782677a2ec95b` plus one commit `322023fd6f8e98dbddd38341e07227ded149c1fb` (the Computers/Nodes port of `d38c682..fe8e4ab`). The product trees were not modified. Fake passwords only. No publish. No Meta, Facebook, Instagram, or Telegram calls.

The 3D and install measurements below are the `b7101c4` run. This commit touches eight files (`+93/−30`) and does not touch the 3D writer, Blender job, flavor guard, or publish guard. Those results still apply to `322023f`. The zip and the node delta were rebuilt and executed on `322023f`.

## Result

**PASS** for installing the isolated test zip, running 3D, and for the Computers/Nodes fixes claimed in `322023f`.

Blocking bugs: none.

Real publishing and real social accounts stay forbidden. A production launch stays blocked. The zip is ad-hoc signed and is not notarized. macOS Keychain, `launchd`, Gatekeeper, and a live `tailscale whois` were not run.

## Allowed on the Mac mini

- Install `MOONKATTY-AI-STUDIO-TEST-1.2.4-test-arm64-mac.zip` only after the SHA-256 is `fdefbabd3a5e9369c1569f452b960e8b43b6ff15fa470c0968561fc45a0819ad`. That is the `322023f` build. The earlier `b7101c4` zip `879aef8e9a7386a5bd8332eb1473d37f3cc5ef44bad730a360b3591a4d7f76ba` is the previous commit.
- Run the TEST app (`com.moonkatty.aistudio.test`, port 8687, Keychain `MOONKATTY AI STUDIO.test`, data directory of `MOONKATTY AI STUDIO TEST`).
- Run a 3D job with OpenCode and Blender 4.2 or newer.
- Leave `STUDIO_OPS_UPDATE` and the four Update Center auto-install flags unset.
- Node API may be turned on for a separate agent that signs protocol 2 (`x-node-ts`, `x-node-nonce`, `x-node-sig`) on a private tailnet address. Leave `STUDIO_NODES_LEGACY_TOKENS` unset. Leave Tailscale Funnel off. The agent shipped in this zip is `node-agent/agent.js` `VERSION = '0.2.0'` and sends `Authorization: Bearer` only, so that agent stops at 401 on an enrolled device key.
- An unverified peer (loopback, or a tailnet address whose whois returns nothing) stays at 409 `E_PEER_UNVERIFIED` until the owner sends `acknowledgeUnverifiedPeer: true` with the password and the confirm word. That second confirmation is one `peer_unverified_acknowledged` audit row.

## Zip

`FLAVOR=test scripts/package-mac-on-linux.sh` in a clean detached tree at `322023f`. `rcodesign` ad-hoc. `SOURCE_DATE_EPOCH` `1792587340`. Electron 44.9.1. Bundled Node v24.22.0.

Independent `sha256sum` matches the claim and `dist/BUILD-INFO.txt`: `fdefbabd3a5e9369c1569f452b960e8b43b6ff15fa470c0968561fc45a0819ad`. The packager removed `lib/flavor.baked.js` and left tracked files clean. Copy: `logs/BUILD-INFO.txt`.

## Delta `322023f` (only this commit)

Port of Studio 3 `d38c682..fe8e4ab`. Own exploit: `delta-attack.cjs`, **40 controls, 0 failed** (`logs/delta-attack.json`). Their `test/ops/enroll-022.test.js`: **14 pass, 0 fail**.

### Whois peer

Loopback with no forwarding header is unverified, `ip` null, and the label is «адрес Tailscale не определён (запрос через локальный прокси)». A stub whois for `100.101.1.2` returns `macbook · 100.101.1.2 · igor@x` and `verified: true`. A whois miss stays unverified. `defaultWhois` on this Linux host returns null.

Confirm of the loopback peer throws `E_PEER_UNVERIFIED` until `acknowledgeUnverifiedPeer === true`. The string `"true"` stays 409. The boolean writes one audit row. The same sequence through the owner HTTP API (password `fake-password-123`, word `ПОДТВЕРДИТЬ`, TLS enroll) is 409, 409, then 200, and `GET /api/ops/nodes/audit` contains `peer_unverified_acknowledged`.

`QA-NODE-002` remains open. A loopback request with `X-Forwarded-For` set to an address the stub whois names still confirms without the second acknowledgement.

### Statuses and `OPS_NODES_DOWN_MS`

`OPS_NODES_DOWN_MS=500` is reported as `nodeDownMs: 2000` (`Math.max(2000, …)`). A wrong bearer is stored only in the in-memory map (`E_UNAUTHORIZED`). A new manager on the same directory does not see it. `nodes.json` from the six unauthenticated shapes has no `lastConnError`. Their enroll-022 status test also passed (memory error, five wrong-secret hellos leave the file bytes alone, 426, clear on success, sweep to down, revoke then `E_REVOKED`).

In a source checkout, `STUDIO_NODES_DOWN_MS` is applied after that floor because `FLAVOR_SOURCE` starts with `env`. A packaged app has `FLAVOR_SOURCE` `baked`, so that override is absent and the floored `OPS_NODES_DOWN_MS` is the timer.

### Unauthenticated and foreign-token writes

On every authenticated node route (`hello`, `pull`, `rotate`, job heartbeat, complete, fail, `ping`, `GET` and `PUT` files, unknown path), six shapes (no header, `Bearer foreign-token`, `Bearer nk_imac.` plus a wrong secret, an unknown id, an empty bearer, `Basic`) returned 401. Node records, jobs, and `nodes.json` bytes stayed the same. The `PUT` did not create the target file.

A second enrolled node’s bearer on the victim’s job, rotate, and file routes left the victim node and the job unchanged and did not create the file. Rotate of that legacy node is 409 `E_NOT_ENROLLED`. Heartbeat, complete, and fail are 409. `GET` files is 403. `PUT` with a body that is not the URL hash is 422.

`POST /api/nodes/enroll` with a garbage code is 403 `E_CODE_INVALID`. `POST /api/nodes/enroll/status` for an unknown request is 404 `E_NOT_FOUND`. Node records and jobs stay the same and `lastConnError` stays off disk. The file bytes do change: the enroll rate limiter persists the loopback bucket. That is the lockout counter, and it does not alter a node token or a job.

Status, audit, and `nodes.json` omit the bearer secrets. The one-time code and the owner password are absent from stdout, `GET /api/logs`, and the data directory.

### Deviations

**`VIEWS[ROUTE]`.** `public/app.js` still assigns `v.innerHTML = VIEWS[ROUTE]()`. The hash handler sets `ROUTE` to a `NAV` entry, and an unknown hash becomes the dashboard, before that call. `NAV` includes `nodes` and `VIEWS.nodes` is assigned. The Studio 3 crash (a Computers nav entry with no view function) is absent on this tree. This is safe here.

**Password field, no Security Center.** Enroll requires the word `ПОДКЛЮЧИТЬ` and the owner password. A missing word is 400 `confirm_required`. A wrong password is 403 `password_required`. CSRF on `POST /api/ops/nodes/enroll`: no session 401, missing `X-Studio-Request` 403, `Origin: https://evil.example` 403, `Sec-Fetch-Site: cross-site` 403. `log()` stores `sec.redact(message)`. The node log line records the request id and the state. The fake password was absent from stdout, the log API, and every file under the data directory. `QA-NODE-003` stays open: reject of a pending device with an empty body returned 200 `state: rejected` and did not return `password_required`.

**`ENROLLED_MIN`.** The symbol is absent here and on `fe8e4ab`. `agentOk` accepts any `0.2.x` and a missing version. Measured: signed `0.2.0` and `0.2.1` with a nonce are 200, a missing `agentVersion` is 200, `0.3.0` is 426 `E_AGENT_VERSION`, a signature without a nonce is 426, a bearer with no signature is 401. The version is whatever the client sends. The device key is the gate. `QA-NODE-006` is open, low, and does not block the install. The bundled 0.2.0 bearer agent still cannot speak protocol 2.

### `test:ops:studio` and `nodes.lock`

`npm run test:ops:studio` with `STUDIO_FLAVOR`, `STUDIO_NODES_LEGACY_TOKENS`, and `DB_PATH` unset: **0 pass, 2 fail** (`logs/ops-studio.log`). The studio helper `POST /api/ops/nodes` returns «Прямые токены 0.2.0 отключены» (`E_LEGACY_DISABLED`). The test does not check that status. `nodes.every(...)` on an empty list is true, then `n.info` throws. The second test times out waiting for `needs_approval`. The log contains no second-coordinator error.

`nodes.lock` itself: a second process on a live pid throws «второй координатор запрещён». `kill(pid, 0)` still sees an unreaped `SIGKILL` child, so takeover waits until the parent reaps it. After the `exit` event, the new process writes its own pid. Their enroll-022 test takes over a stale pid `999999` in the same process. This 0/2 result does not hide a lock race. `QA-NODE-005` records the test gap. It does not block the install.

## Invariants (v1.2.3 harness, on `b7101c4`)

`attack.mjs`: **68 controls, 0 failed**. This commit does not touch those files. The harness was not repeated.

Publish guard holds. `POST /api/queue` with `published` is stored as `pending_approval`. `PUT` of `published` or `externalId` is 403 `published_internal_only`. `POST /publish` is 403 `publishing_disabled`. A pre-migration backup exists and matches its SHA-256 sidecar. Flavor markers agree on `test`. A missing flavor, a rewritten baked file, deleted markers, or the production data path exits 78. `NODE_ENV=production` does not select the production flavor. Facebook, Instagram, and Telegram are blocked before DNS. `meta.js` refuses to load when the flavor is test. The built TEST app has no `meta.js`. `checkUpdates` is false on the test flavor and the automatic check returns immediately. The seal key moved through fake `security` with argv `["-i"]` only and is absent from `studio.db`, the WAL, stdout, and `GET /api/backup`.

`POST /api/comments` with status `approved` is stored as `new`. The reply route is 403 `publishing_disabled`. That closes `QA-CMT-001` for this commit.

Residual lows, same as v1.2.3, still reproduced on `b7101c4` and still not blocking: a published row inserted into the live database stays visible until the next start; rewriting every marker and planting `meta.js`, then starting `node server.js`, loads the publisher. `desktop/flavor-guard.js` still refuses that tree because the asar lock says test.

## 1. QA-3D-001

**Fixed on `b7101c4`. Status `qa_verified`. Owner approval is not set.** `322023f` does not touch these files.

`36fc193`, merged by `5b7e000`. The agent step passes `NO_TOOLS` (write, edit, bash, webfetch, and the rest false). `extractJson` takes one object from the reply (fence or the first balanced `{...}`) and rejects text longer than 20000 characters. `validate` is a strict schema. `writeParamsSafe` checks `realpath` containment, refuses a symlink version directory, opens a temp file with `O_EXCL` and `O_NOFOLLOW` mode `0600`, then renames it to `scene_params.json`. The agent loop tries twice, then fails in Russian. The idle timeout is `STUDIO_3D_AGENT_TIMEOUT_MS` (the e2e used 6000 ms).

`scripts/opencode-json-test.mjs` with `STUDIO_FLAVOR=test`, OpenCode 1.19.3, and official Blender 4.2.9 LTS: **21/21**. The chat-only case (no tool call, JSON text) reached `waiting_approval`. Studio wrote `scene_params.json` (`title` `Fake agent cat`). Blender wrote `scene.blend` 913192 bytes, magic `BLENDER`, SHA-256 `526f5bc8aa582ac638323aa8ccfec46f4239298d800be9d8514a809edfdfaa50`, and `renders/preview.png` 320×240, SHA-256 `999047f27aef57bc2e1ba53f94ccc5865ae54e7005014fc24a990cbda77c22b3` (`logs/preview-chat-only.png`). The prompt sent `tools.write/edit/bash = false`.

Also passed in that script and in `scope.mjs`: fenced JSON; extra fields `path` and `cmd` rejected; `subject` `import os` rejected; malformed JSON then a good retry; malformed JSON twice stops after exactly two prompts; model error; silence times out at 6 s; a file the agent drops (`evil.py`) fails the job before Blender; an in-folder edit ask and an outside write ask are rejected; a symlink version directory is refused; `policy.inside` rejects `../`.

A symlink `scene_params.json` is refused before the write. The refusal string on this tree is the realpath check (`Путь scene_params.json вне рабочей папки проекта`). The official test recorded the symlink target still equal to `ORIG`. The scoped assertion asked for the later symlink sentence and is the one scope failure (33/34). The write did not happen.

A real Ollama model was not used. The model was the test double inside `opencode-json-test.mjs`.

## 2. NODE 0.2.2 on this tree

Protocol 2 is enforced for an enrolled device key. A signature without `x-node-nonce` is HTTP **426** `E_AGENT_VERSION`. A signed hello that includes a nonce returns protocol 2. Re-measured on `322023f` in the delta exploit.

`enrollKey` stays `crypto.randomBytes(32)` in RAM. `delete S.enrollKey` keeps it out of `nodes.json`. That v1.2.4 choice is unchanged by this port. `fe8e4ab` persists `S.enrollKey`.

`node-agent/agent.js` is unchanged by `322023f`. `VERSION` is `0.2.0`. The coordinator call sets `authorization: Bearer` and does not set `x-node-nonce`.

## 3. «Подключить компьютер» panel

The panel is `public/app.js` `VIEWS.nodes`. Confirm posts the password, the word `ПОДТВЕРДИТЬ`, and `acknowledgeUnverifiedPeer` through `api()`, which sends `X-Studio-Request`. The peer line uses `nodePeer()` and `esc()`. The instructional copy still names `127.0.0.1:8791` as the node status screen. There is no `public/ops-ui.js` route named Computers.

## Their suite on `b7101c4`

Claimed total 663. That run did not produce that number. Linux-runnable results below were executed on `b7101c4` and were not repeated, because this commit does not touch those suites. `test:3d`, `test:3c`, and `test:e2e-test-build` were not started. `test:opencode-json` is the Blender 4.2.9 e2e those scripts would repeat.

| Script | Result |
| --- | --- |
| test:security | 52 pass, 0 fail |
| test:runner | 5 pass, 0 fail |
| test:opencode | 51 pass, 0 fail (clean re-run; a first run with `STUDIO_FLAVOR=test` failed one prod Keychain service string) |
| test:policy | 46 pass, 0 fail |
| test:video | 45 pass, 0 fail |
| test:publish-guard | 73 pass, 0 fail |
| test:isolation | 65 pass, 0 fail |
| test:nodes | 52 pass, 0 fail |
| test:ops | 38 pass, 0 fail |
| test:opencode-json | 21 pass, 0 fail |
| **Executed and accepted on b7101c4** | **448 pass, 0 fail** |
| enroll-022 on 322023f | 14 pass, 0 fail |
| test:ops:studio on 322023f | 0 pass, 2 fail (`QA-NODE-005`). The lock probe passed. |

## NOT VERIFIED

macOS Keychain, `launchd`, Gatekeeper, quarantine, `sandbox-exec`, notarization, a real Ollama model, and a live `tailscale whois`. `defaultWhois` on this host returns null.

## Registry

23 bugs: 11 open, 11 qa_verified, 1 blocked. None are owner-approved.

`QA-3D-001` and `QA-CMT-001` stay `qa_verified` on `b7101c4`. `QA-NODE-001`, `QA-NODE-002`, and `QA-NODE-003` stay open on `322023f`. `QA-NODE-005` and `QA-NODE-006` are open and low. `QA-NODE-004` is the Computers UI e2e on `fe8e4ab` and was not part of this tree.
