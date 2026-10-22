# Update Center port onto v1.3.0-test

Read-only on `feat/update-center-v130` at `035571ffb4984187d70ca2c440536e5cdac2a5af` (2026-10-21 21:44:59 +0300). Parent is `b813ac4c5fe571f87ad2465d6ad29bb3b54ce5be`. Diff against that parent: 27 files, +2048/−4. The product worktree was a detached checkout at `/tmp/mk-uc130`. It was left clean. Fake password `fake-password-123` only. No publish. No GitHub release fetch. No Meta, Facebook, Instagram, Telegram, X, or YouTube calls. No Azure. No owner approval was set.

## Result

**FAIL** for adding `035571f` to v1.3.0-test.

Blocking bug: `QA-UC-011` (open, low). The port puts the retracted iMac version `12.5.1` back into `docs/ops` and `test/ops`. `news-node.test.js` passed on `b813ac4` and fails on this commit. `test:ops` is 118 pass, 1 fail. The claimed 119/0 does not hold.

The Update Center mount, the password step-up, the backup adapter, schema 1–6, the Linux fd-relative keyring read, and the hard gate all held under attack. Those results stay in the tables below. They do not clear the failing regression.

A rebuilt zip of this commit needs a fresh final audit, and this commit should be packaged only after `QA-UC-011` is gone. The zip audited at `c460cfcc886d5e0982f4f0b8c04df0263e968540208cbd5487def3f7673b3a06` is `b813ac4`. It has no Update Center module.

Real publishing and real social accounts stay forbidden.

## Allowed on the Mac mini

- Leave this commit off the machine. Do not install a zip built from `035571f`.
- The TEST zip already audited for `b813ac4` stays the one whose SHA-256 is `c460cfcc886d5e0982f4f0b8c04df0263e968540208cbd5487def3f7673b3a06`. That zip has no `lib/ops/update-center.js`.
- After the three `12.5.1` hits are removed, rebuild the TEST zip from that later commit and run a new final audit before any install. `scripts/write-build-info.mjs` adds a `version` field, `server.js` gains the mount, `package.json` gains private-key asar excludes, and `public/update-ui.js` is new. That zip is a different artifact from `c460cfcc…`.
- Leave `STUDIO_OPS_UPDATE` unset. With it unset the update routes are absent (HTTP 404).
- Leave `OPS_UPDATE_DOWNLOAD_ENABLED` and the four `OPS_UPDATE_AUTO_INSTALL` / `OPS_UPDATE_SIGNATURE_READY` / `OPS_UPDATE_BACKUP_VERIFIED_READY` / `OPS_UPDATE_ROLLBACK_TESTED_ON_MAC` flags unset.
- Leave `HARD_GATE.closed` as the source constant `true`. A public key alone leaves `downloadEnabled` false.
- Leave publishing off. `POST /api/queue/:id/publish` on the TEST flavor is 403 `publishing_disabled`.

## Path diff

`git diff --exit-code --stat b813ac4 HEAD` on these paths printed nothing and exited 0 (`logs/path-diff.txt`):

- `node-agent`
- `desktop/main.js`
- `lib/ops/nodes.js`
- `lib/ops/nodes-server.js`
- `lib/ops/node-enroll.js`
- `lib/studio-config.js`
- `lib/db-backup.js`
- `runner.js`
- `scripts/world-class-test.mjs`

`server.js` is the only shared runtime file in the diff, and the hunk is three added lines. They call `mountUpdateCenter` immediately after the existing nodes mount. The nodes `require('./lib/ops/nodes-server.js').mountNodes(...)` block is unchanged context. The TEST publish middleware is unchanged context:

- `if (CFG.IS_TEST) throw new Error('publication: disabled in TEST build')`
- `if (CFG.IS_TEST) app.use(['/api/queue/:id/publish', '/api/comments/:id/reply'], … publishing_disabled)`

`desktop/main.js` `checkUpdates` is the same function as on `b813ac4`. Its first statement is `if (CFG.IS_TEST) return`. The menu item «Проверить обновления…» is still omitted when `CFG.IS_TEST` is true. The function fetches the GitHub releases API and shows a dialog. It never downloads or installs. Electron was not launched. The TEST skip is the same source line, and the file hash is unchanged.

## Mount, password, and the attack

`lib/ops/update-center-mount.js` returns `null` unless `env.STUDIO_OPS_UPDATE === '1'`. The call in `server.js` sits after `app.use('/api', auth)` and after `sec.csrfCheck`. Approve and auto-install call `checkPassword(req.user, password)` and return 403 `Неверный пароль владельца` when that fails. The password check uses the owner scrypt hash.

Harness `attack.cjs`, 59 checks, 0 failures (`logs/attack.json`). TEST flavor, loopback, temp data dir.

| Attack | Result |
| --- | --- |
| `STUDIO_OPS_UPDATE` unset, session present | 404 `unknown collection` |
| No session, GET and POST | 401 `auth required` |
| Session, POST without `X-Studio-Request` | 403 `CSRF check failed` |
| Session, `Origin: https://evil.example` | 403 `Cross-origin request rejected` |
| Session, `Origin: null` | 403 |
| Session, `Sec-Fetch-Site: cross-site` | 403 |
| `Authorization: Bearer nk_…` and a wrong `x-studio-app-token` | 401 |
| Approve with no password, and with the wrong password | 403 |
| Auto-install with the wrong password | 403 |
| Auto-install with `fake-password-123`, `dryRun: false`, all four auto-install flags, `OPS_UPDATE_DOWNLOAD_ENABLED=1`, a READY test key, and `hardGateOverrideForTests` in the JSON body | 400 `UPDATE_DISABLED` |
| POST `…/v1.9.9-test/download` with the same flags | 400 `UPDATE_DISABLED` |
| Authenticated status | `flavor` `test`, `bundleId` `com.moonkatty.aistudio.test`, `known` true, `signature.state` `READY`, `downloadEnabled` false, `hardGate` true |
| `STUDIO_APP_BUNDLE_ID=com.moonkatty.aistudio` on the TEST server | `known` false (`STUDIO_FLAVOR=test` contradicts the bundle id), `downloadEnabled` false |
| `POST /api/queue` with `status: published`, then `POST /api/queue/q-uc/publish` | queue stored 201, publish 403 `publishing_disabled` |

Health on that server: `flavor` `test`, `schemaVersion` 6, `version` `1.3.0-test`.

## Backup and schema

`lib/ops/update-backup.js` calls `lib/db-backup.js` `snapshot` (`VACUUM INTO` plus a `.sha256` sidecar). `verify` compares the sidecar to `sha256File`. `testRestore` copies into a temp directory, opens it, and requires `PRAGMA integrity_check === 'ok'` plus tables `items` and `meta`.

Measured on a temp `node:sqlite` database: create SHA-256 `14b385b7b68e9a8e54c0ee4fe01a7531b8a1782439c56614d3508464254b22fc`, verify ok, trial restore `integrity` `ok`, the live row still present. A rewritten sidecar fails with `SHA-256 бэкапа не совпадает`. Extra bytes on the database file fail the same check. Restoring the original bytes verifies again.

`KNOWN_SCHEMAS` is `[1, 2, 3, 4, 5, 6]`. `createUpdateManager({ supportedSchema: 6 })` accepts meta `schemaVersion` 1 through 6 and rejects 0 and 7. `compatCheck` against a current schema of 6 treats 1–5 as older (restore the backup; the schema is known) and rejects 0 and 7 as unknown. The mount passes `DB_SCHEMA_VERSION`, which is 6.

## QA-UC-010 and the hard gate

On this Linux host `readExternalKeyring` reported `mode: "fd-relative"`. The traced `openSync` paths were `/proc/self/fd/22/keyring.json` and `/proc/self/fd/22/owner.pub.pem`.

Their stress test (`logs/test-ops.log`, `logs/test-update-center.log`) on the same host:

- path mode (`forcePathMode: true`): 97400 loads, mixed 23
- fd-relative: 97600 loads, mixed 0

`fdRelativeBase` tries `/proc/self/fd/<dfd>` and then `/dev/fd/<dfd>`. If neither can `stat` `keyring.json`, the base is null and the mode is `path`. That is the macOS branch in the source. This host did not boot macOS, so that branch was not executed.

`HARD_GATE` is `{ closed: true, reason: 'загрузка/установка через Update Center отключены до закрытия QA-UC-010 …' }`. `mechanismStatus` adds that reason while `closed` is true and the constructor argument `hardGateOverrideForTests` is false. It adds the missing-flag reason while `OPS_UPDATE_DOWNLOAD_ENABLED` is anything other than the exact string `1` and the same constructor argument is false. `downloadEnabled` and `installEnabled` are true only when that reason list is empty.

What opens download and install:

1. Set `HARD_GATE.closed` to false in the source (or assign that property on the exported object inside the process) and set `OPS_UPDATE_DOWNLOAD_ENABLED` to the exact string `1`. Both are required. Measured: the assignment alone, with the flag unset, leaves `downloadEnabled` false. The assignment plus the flag leaves it true.
2. Pass `hardGateOverrideForTests: true` to `createUpdateCenter`. That argument skips both checks, including the download flag. Measured: `downloadEnabled` true. `server.js`, `lib/ops/update-center-mount.js`, `public/update-ui.js`, and `lib/studio-config.js` do not contain that name. The mount does not pass it.

These leave `downloadEnabled` false, with `signature.state` `READY` where a test public key was loaded: the key alone; `OPS_UPDATE_DOWNLOAD_ENABLED=1`; `OPS_UPDATE_DOWNLOAD_ENABLED=true`; all four auto-install flags plus `OPS_UPDATE_NODES=1` and `STUDIO_OPS_UPDATE=1`; environment names `HARD_GATE`, `HARD_GATE_CLOSED`, `OPS_UPDATE_HARD_GATE`, `OPS_UPDATE_HARD_GATE_CLOSED`, `hardGateOverrideForTests`, and `STUDIO_HARD_GATE`. The HTTP body field of the same name does not reach the constructor.

`QA-UC-010` stays open. Linux reads now come from the checked directory fd. The macOS path-mode window is still in the source, and this host did not measure it. The hard gate keeps that window from enabling download. Owner approval is not set.

`QA-UC-011` is the new open bug. `lib/ops/nodes.js` still records the iMac as macOS Ventura 13.7.1. The new hits are:

- `docs/ops/UPDATE_CENTER.md` (iMac Intel 12.5.1 as the example for `node.minMacOS`)
- `docs/ops/UPDATE_CENTER_MAC_TEST.md` (check for iMac Intel, macOS 12.5.1)
- `test/ops/update-center.test.js` (`nodeCompat` samples and a fake iMac `info.os` of `macOS 12.5.1`)

The scanner ignores a line that contains `ошибочн`, `WRONG`, `wrong`, or `неверн`. These three lines do not.

## Suites

Regression scripts, same list as the 437 on `b813ac4`. `STUDIO_FLAVOR` was unset for the OpenCode run.

| Suite | b813ac4 | 035571f |
| --- | --- | --- |
| test:security | 52 pass, 0 fail | 52 pass, 0 fail |
| test:runner | 5 pass, 0 fail | 5 pass, 0 fail |
| test:opencode | 51 pass, 0 fail | 51 pass, 0 fail |
| test:policy | 46 pass, 0 fail | 46 pass, 0 fail |
| test:video | 45 pass and 8 pass, 0 fail | 45 pass and 8 pass, 0 fail |
| test:publish-guard | 73 pass, 0 fail | 59 pass, 0 fail |
| test:isolation | 65 pass, 0 fail | 65 pass, 0 fail |
| test:nodes | 52 pass, 0 fail | 52 pass, 0 fail |
| test:ops, the five files that existed on b813ac4 | 40 pass, 0 fail | 39 pass, 1 fail |
| Sum | 437 pass, 0 fail | 422 pass, 1 fail, 14 not run |

The 14 missing publish-guard checks are the `dist/mac-arm64` bundle tamper block. This worktree has no `dist/`, and the script prints `SKIP: bundle checks (no dist build)`. Those 14 passed on `b813ac4` because that worktree still had the TEST app from the zip rebuild. `scripts/publish-guard-test.mjs` is unchanged. The source-tree half is 59 pass, 0 fail.

`npm run test:ops` is `node --test test/ops/*.test.js`. That glob now includes the four Update Center files, so the runner total is 119 tests: 118 pass, 1 fail. The failure is the only `not ok` in `logs/test-ops.log`. The two in-process multiprocess tests (ok 29 and ok 30) passed inside that run.

`npm run test:update-center` is the four Update Center files: 79 pass, 0 fail.

The end-to-end file is `test/ops/update-center.integration.test.js`. `node --test` on that file alone is 1 pass, 0 fail. There is no runner summary of 11. That one test is already inside the 79 and the 119. It checks the flag-off 404, auth, CSRF, BLOCKED status without an owner key, the password step-up, and a verified backup.

`npm run test:world` with Ollama down: 62 pass, 0 fail. The macOS launch note is BLOCKED. The Ollama note is MOCK. `runner.js` and `scripts/world-class-test.mjs` match `b813ac4`.

The `qwen3:8b` failure is pre-existing. A mock `http://127.0.0.1:11434/api/tags` that returns `{ "models": [] }` makes the same check fail on both commits: `FAIL 3 runtime reports ollama without inventing a model — Модель qwen3:8b не установлена (ollama pull qwen3:8b)`. With that port closed, this host's `test:world` passes. The product `results.json` written by those runs was restored.

`npm run test:ops:studio` is pre-existing `QA-NODE-005`. 0 pass, 1 fail, 1 cancelled. The first test throws `Cannot read properties of undefined (reading 'info')` at `nodes.multiprocess.test.js:24`. The second test is cancelled at 90000 ms. `node-agent` and `lib/ops/nodes-server.js` are byte-identical to `b813ac4`, where the same pair failed the same way. The in-process run of those two tests passed inside `test:ops`.

## What this host did not run

macOS `/dev/fd` path mode, Keychain, `launchd`, Gatekeeper, `codesign`, `spctl`, notarization, a real GitHub release download, and the Electron process that would call `checkUpdates`. The 14 packaged publish-guard tamper checks need a `dist/` tree this commit does not have. `test:3d`, `test:3c`, `test:opencode-json`, and `test:e2e-test-build` were not started. They need Blender or an OpenCode binary, and they are outside the 437.
