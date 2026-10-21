# Final audit of integrated v1.2.4-test

Read-only on `feat/v1.2.4-test-nodes` @ `b7101c437466599558bf14653ff782677a2ec95b`. Compared with v1.2.3-test `a2a35c8` (previous PASS) and with the NODE 0.2.2 audit of `feat/studio-operations` @ `db4720b`. Nothing on the product branch was modified. Fake passwords only. No publish. No Meta, Facebook, Instagram, or Telegram calls.

Studio will put Computers fixes `d38c682..fe8e4ab` (currently `origin/feat/studio-operations` @ `fe8e4ab`) on top of this commit. Findings that delta is expected to replace are marked **pending delta**. Those paths were measured on `b7101c4` and were not re-tested against `fe8e4ab`.

## Result

**PASS** for installing the isolated test zip and running 3D on the Mac mini.

**Computers / node connect stays forbidden on this commit.** The gaps below are pending delta. The later check covers only that delta.

Blocking bugs for the allowed install: none.

Real publishing and real social accounts stay forbidden. A production launch stays blocked. The zip is ad-hoc signed and is not notarized.

## Allowed on the Mac mini

- Install `MOONKATTY-AI-STUDIO-TEST-1.2.4-test-arm64-mac.zip` only after the SHA-256 is `879aef8e9a7386a5bd8332eb1473d37f3cc5ef44bad730a360b3591a4d7f76ba`.
- Run the TEST app (`com.moonkatty.aistudio.test`, port 8687, Keychain `MOONKATTY AI STUDIO.test`, data directory of `MOONKATTY AI STUDIO TEST`).
- Run a 3D job with OpenCode and Blender 4.2 or newer.
- Leave `STUDIO_OPS_UPDATE` and the four Update Center auto-install flags unset.
- Leave Node API off. Do not enroll a computer, do not set `STUDIO_NODES=1`, and do not set `STUDIO_NODES_LEGACY_TOKENS=1`.

## Zip

`FLAVOR=test scripts/package-mac-on-linux.sh` in a clean detached tree at `b7101c4`. `rcodesign` 0.29.0. `SOURCE_DATE_EPOCH` from that commit (`1792586484`).

Rebuilt SHA-256 matches the claim: `879aef8e9a7386a5bd8332eb1473d37f3cc5ef44bad730a360b3591a4d7f76ba`. `BUILD-INFO.txt` records commit `b7101c4`, bundle id `com.moonkatty.aistudio.test`, Electron 44.9.1. The packager left tracked files clean.

## Invariants (v1.2.3 harness)

`attack.mjs`: **68 controls, 0 failed**.

Publish guard holds. `POST /api/queue` with `published` is stored as `pending_approval`. `PUT` of `published` or `externalId` is 403 `published_internal_only`. `POST /publish` is 403 `publishing_disabled`. A pre-migration backup exists and matches its SHA-256 sidecar. Flavor markers agree on `test`. A missing flavor, a rewritten baked file, deleted markers, or the production data path exits 78. `NODE_ENV=production` does not select the production flavor. Facebook, Instagram, and Telegram are blocked before DNS. `meta.js` refuses to load when the flavor is test. The built TEST app has no `meta.js`. `checkUpdates` is false on the test flavor and the automatic check returns immediately. The seal key moved through fake `security` with argv `["-i"]` only and is absent from `studio.db`, the WAL, stdout, and `GET /api/backup`.

`POST /api/comments` with status `approved` is stored as `new`. The reply route is 403 `publishing_disabled`. That closes `QA-CMT-001` for this commit.

Residual lows, same as v1.2.3, still reproduced and still not blocking: a published row inserted into the live database stays visible until the next start; rewriting every marker and planting `meta.js`, then starting `node server.js`, loads the publisher. `desktop/flavor-guard.js` still refuses that tree because the asar lock says test.

## 1. QA-3D-001

**Fixed on this commit. Status `qa_verified`. Owner approval is not set.**

`36fc193`, merged by `5b7e000`. The agent step passes `NO_TOOLS` (write, edit, bash, webfetch, and the rest false). `extractJson` takes one object from the reply (fence or the first balanced `{...}`) and rejects text longer than 20000 characters. `validate` is a strict schema. `writeParamsSafe` checks `realpath` containment, refuses a symlink version directory, opens a temp file with `O_EXCL` and `O_NOFOLLOW` mode `0600`, then renames it to `scene_params.json`. The agent loop tries twice, then fails in Russian. The idle timeout is `STUDIO_3D_AGENT_TIMEOUT_MS` (the e2e used 6000 ms).

`scripts/opencode-json-test.mjs` with `STUDIO_FLAVOR=test`, OpenCode 1.19.3, and official Blender 4.2.9 LTS: **21/21**. The chat-only case (no tool call, JSON text) reached `waiting_approval`. Studio wrote `scene_params.json` (`title` `Fake agent cat`). Blender wrote `scene.blend` 913192 bytes, magic `BLENDER`, SHA-256 `526f5bc8aa582ac638323aa8ccfec46f4239298d800be9d8514a809edfdfaa50`, and `renders/preview.png` 320×240, SHA-256 `999047f27aef57bc2e1ba53f94ccc5865ae54e7005014fc24a990cbda77c22b3` (`logs/preview-chat-only.png`). The prompt sent `tools.write/edit/bash = false`.

Also passed in that script and in `scope.mjs`: fenced JSON; extra fields `path` and `cmd` rejected; `subject` `import os` rejected; malformed JSON then a good retry; malformed JSON twice stops after exactly two prompts; model error; silence times out at 6 s; a file the agent drops (`evil.py`) fails the job before Blender; an in-folder edit ask and an outside write ask are rejected; a symlink version directory is refused; `policy.inside` rejects `../`.

A symlink `scene_params.json` is refused before the write. The refusal string on this tree is the realpath check (`Путь scene_params.json вне рабочей папки проекта`). The official test recorded the symlink target still equal to `ORIG`. The scoped assertion asked for the later symlink sentence and is the one scope failure (33/34). The write did not happen.

A real Ollama model was not used. The model was the test double inside `opencode-json-test.mjs`.

## 2. NODE 0.2.2 port (`70073ac`) — deviations

Protocol 2 is enforced for an enrolled device key. A signature without `x-node-nonce` is HTTP **426** `E_AGENT_VERSION` with `protocol: 2`. A signed hello that includes a nonce returns `protocol: 2`. These measurements are on `b7101c4`.

| Measured on b7101c4 | Computers delta (`d38c682..fe8e4ab`) | Mark |
| --- | --- | --- |
| Owner password is `body.password` plus a confirm word. Missing or wrong password is 403 `password_required`. There is no 428 and no `/api/ops/confirm` on this route. Eight wrong passwords stayed 403. CSRF holds: missing `X-Studio-Request`, `Origin: https://evil.example`, and `Sec-Fetch-Site: cross-site` are 403. The fake password was absent from logs, stdout, `studio.db`, and `nodes.json`. | `lib/ops/protected.js` accepts `node-confirm`, `node-revoke`, `node-rotate`, and `node-legacy-token` on `/api/ops/confirm`. | **pending delta** |
| `enrollKey` is `crypto.randomBytes(32)` in RAM and `delete S.enrollKey` removes it from `nodes.json`. A second manager in the same process cannot verify the outstanding code (`E_CODE_INVALID`). The `awaiting_code` row and `codeHash` remain on disk. The plaintext code does not. | `S.enrollKey` is created once and kept in `nodes.json` (`S.enrollKey \|\|= …`). | **pending delta** |
| `node-agent/agent.js` is `VERSION = '0.2.0'` and sends `Authorization: Bearer` only. No `x-node-nonce`, `x-node-ts`, or `x-node-sig`. That bearer call against an enrolled device key is 401. Legacy direct tokens stay off unless `STUDIO_NODES_LEGACY_TOKENS=1`. | `node-agent/agent.js` `VERSION = '0.2.2'`. | **pending delta** |

Reject still does not ask for the password (`QA-NODE-003`, still open, low). A reject of an `awaiting_code` request returned the pending-state error and did not return `password_required`. The delta's step-up list does not add reject. This item is not pending delta. It does not block the isolated test install.

`QA-NODE-001` (nonce cache memory-only) and `QA-NODE-002` (shared loopback bucket) were not re-opened. The nonce map in this tree is still process memory.

## 3. «Подключить компьютер» panel

On `b7101c4` the panel is `public/app.js` `VIEWS.nodes`. The certificate fingerprint, the one-time code, `pubKeyFingerprint`, and device hostname/model/os go through `esc()` (`& < > " '` → entities). A hostname `<img src=x onerror=alert(1)>&"'` is stored as that text and the template escapes it. Enroll, confirm, revoke, and settings posts send `X-Studio-Request` via `api()` and sit behind `csrfCheck`. The hostile-name enroll response was JSON, which does not execute markup.

`e86382b` replaces the Computers view in `public/ops-ui.js` (route crash, Online/Offline, `E_PEER_UNVERIFIED`). That view is **pending delta** and was not reviewed here.

## Update Center and Studio 2/5

Absent from `a2a35c8..b7101c4`. `lib/ops/update-center.js`, `lib/ops/update.js`, `lib/studio-intelligence.js`, and `lib/media-automation.js` are not in the tree. `package.json` has no `electron-updater`. `video_render` is still the stub that fails with «Не подключено». `desktop/main.js` still schedules `checkUpdates(false)` at 5 seconds. On the test flavor `checkUpdates` is false, so that call returns immediately. The test menu omits the update item.

## Their suite

Claimed total 663. This run did not produce that number. Linux-runnable results below. `test:3d`, `test:3c`, and `test:e2e-test-build` were not started. `test:opencode-json` is the Blender 4.2.9 e2e those scripts would repeat.

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
| **Executed and accepted** | **448 pass, 0 fail** |
| test:ops:studio | 0 pass, 2 fail under `STUDIO_FLAVOR=test` (`imac` does not satisfy the `-test` id suffix, then `n.info` throws). Not re-run. The script launches `node-agent` 0.2.0. **pending delta** |

## NOT VERIFIED

macOS Keychain, `launchd`, Gatekeeper, quarantine, `sandbox-exec`, notarization, a real Ollama model, and a live `tailscale whois`. The Computers delta `d38c682..fe8e4ab` was read for file names and the three replacements above. It was not executed.

## Registry

19 bugs: 12 open, 6 qa_verified, 1 blocked. None are owner-approved.

`QA-3D-001` is `qa_verified` on `b7101c4`. `QA-CMT-001` is `qa_verified` on `b7101c4`. `QA-NODE-003` stays open.
