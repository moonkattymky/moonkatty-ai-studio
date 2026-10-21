# Final audit of v1.3.0-test at d1adf4d

Read-only on `feat/update-center-v130b` at `d1adf4d86d09384d2cc322920d360eb87797c1de` (2026-10-21 22:23:57 +0300). Parent is `94237a3cc3100b50b98b3117a7684df41c67001f`, the cherry-pick of the Update Center port. That commit’s parent is `c24f7569301dbc5fe3cfe2a58143890c9ef74133`, the approved v1.3.0-test. This audit supersedes the install target in `qa/reports/final-v1.3.0-test-r2/REPORT.md`. The product worktrees were detached checkouts. Fake passwords `fake-password-123` and `fake-admin-pw-1` only. No publish. No Meta, Facebook, Instagram, Telegram, X, or YouTube calls. No Azure. No owner approval was set.

The hash below is the zip this Linux host built from `d1adf4d` with `FLAVOR=test scripts/package-mac-on-linux.sh`. No claimed zip hash was supplied.

## Result

**PASS** for installing the isolated TEST zip built from `d1adf4d` as the new v1.3.0-test install target.

Blocking bugs: none.

This zip replaces `d512263ef450bf9ca82297108d4b61c84c779f777665707559f32b52af603b5e` (`c24f756`) as the v1.3.0-test install. `035571f` stays off the machine. That commit was the failed port audit and was never an approved zip. A later commit needs its own final audit. A zip of this commit whose SHA-256 is the value below is the artifact this report covers.

Real publishing and real social accounts stay forbidden. A production launch stays blocked. The zip is ad-hoc signed and is not notarized. macOS Keychain, `launchd`, Gatekeeper, `codesign`, `spctl`, and a live `tailscale whois` were not run.

`QA-UC-011` is `qa_verified`. Owner approval stays false. `QA-UC-010` stays `open`: the macOS `/dev/fd` path mode was not run here, and `HARD_GATE.closed` stays true. `QA-NODE-005` stays open. Studio 5 `check-compat` fails its unit test because `origin/integ/v1.3.0-test` exists; the script itself exits 0 with no conflict paths. `npm run smoke` with no URL fails in `page.goto` because the URL argument is missing. Those three known failures match `c24f756`. None of them blocks the install.

## Allowed on the Mac mini

- Install `MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip` only when its SHA-256 is `d5ff49345b70ccfb61cf4fb0be0256558947a751eda11bbf4f0ffbf71a104655`. That is the rebuild of `d1adf4d` recorded in `logs/BUILD-INFO.txt`. Leave the `c24f756` zip `d512263ef450bf9ca82297108d4b61c84c779f777665707559f32b52af603b5e` and any `035571f` zip off the machine.
- Confirm `Contents/Resources/app.asar.unpacked/desktop/build-info.json` reads commit `d1adf4d86d09384d2cc322920d360eb87797c1de`, `version` `1.3.0-test`, `flavor` `test`, and `appId` `com.moonkatty.aistudio.test`.
- Run the TEST app only. `CFBundleIdentifier` is `com.moonkatty.aistudio.test`. The product name is `MOONKATTY AI STUDIO TEST`. The version is `1.3.0-test`. The baked config uses Keychain service `MOONKATTY AI STUDIO.test`, port `8687`, and `appId` `com.moonkatty.aistudio.test`. Use the TEST app’s data directory.
- Leave `STUDIO_OPS_UPDATE` unset. With it unset, `GET /api/ops/update-center` is 404 `unknown collection`. Leave `OPS_UPDATE_DOWNLOAD_ENABLED` and the four auto-install flags unset. Leave `HARD_GATE.closed` true. A READY key alone leaves download off.
- Leave publishing off. `POST /api/queue` with `status: published` is stored as `pending_approval`. `POST /api/queue/:id/publish` returns 403 `publishing_disabled`. Leave real social accounts disconnected.
- Leave the TEST auto-update return in place. `checkUpdates` still returns immediately when the flavor is test. The Update Center module is in the app and stays gated by the flag and the hard gate.
- Leave `MA_EXPERIMENTAL` unset. Leave `MA_JOBS_BACKEND` unset. Leave `STUDIO_MEDIA_ROOT` and `STUDIO_PLATFORM_SNAPSHOT` unset. With those unset, the packaged command center reads the shipped sample snapshot.
- Treat every figure on the Revenue Command Center platform strip as fixture money. YouTube News confirmed money is `DEMO USD 12.50`, `excludedFromActual` true, payout `MOCK-PAYOUT-0001`. `publish` is false. `viewsAreRevenue` is false. That figure is a sample. It is outside the real total.
- The bundled agent is `node-agent/agent.js` `VERSION = '0.2.2'`, SHA-256 `3fcaea09b821575edded1948892203e2bab22cd4dd9e909b454a774fec3e0ff0`, the same bytes as `c24f756`. Leave `STUDIO_NODES_LEGACY_TOKENS` unset. Leave Tailscale Funnel off.
- `meta.js` stays out of the TEST app. The packager still refuses a TEST Resources tree that contains it. Publish adapters, `platforms/ledger.js`, and `platforms/promotion.js` stay out because the files glob did not add them.

## Diff

`git diff --stat c24f756 d1adf4d` is 27 files, +2048/−4. `git merge-base --is-ancestor c24f756 d1adf4d` is true. The cherry-pick `94237a3` has no conflict markers. The `=======` lines in `public/app.js`, `public/social-ui.js`, and `test/ops/update-center.test.js` are comment banners.

`git diff c24f756 d1adf4d` contains zero `12.5.1`. `git grep 12.5.1 d1adf4d` finds two lines, both already on `c24f756`:

- `lib/ops/nodes.js:28` says the earlier docs’ macOS `12.5.1` was wrong. The news-node scanner strips lines that contain `wrong`.
- `test/ops/news-node.test.js:10` is the test title. The scanner drops that file from the file list.

`git diff --exit-code c24f756 d1adf4d -- test/ops/news-node.test.js lib/ops/nodes.js` exits 0. `logs/path-diff.txt` also exits 0 for `node-agent`, `desktop/main.js`, `lib/ops/nodes.js`, `lib/ops/nodes-server.js`, `lib/ops/node-enroll.js`, `lib/studio-config.js`, `lib/db-backup.js`, `runner.js`, and `scripts/world-class-test.mjs`. `server.js` adds the three `mountUpdateCenter` lines after the unchanged nodes mount. The TEST publish throw and the publish middleware are unchanged context.

`package.json` versus `c24f756` adds the `test:update-center` script and the private-key asar excludes (`!**/*.key`, `*.p8`, `*.p12`, `*.pfx`, `*.priv`, `*.priv.pem`, `*private*.pem`, `*secret*.pem`). The `c24f756` read-api, registry, capabilities, and sample-snapshot entries stay in `build.files` and `asarUnpack`. `package-lock.json` is unchanged.

`git diff --stat 035571f d1adf4d` is four files, +13/−5: the three `12.5.1` replacements (`13.7.1` in `docs/ops/UPDATE_CENTER.md`, `docs/ops/UPDATE_CENTER_MAC_TEST.md`, and `test/ops/update-center.test.js`) plus the eight `package.json` lines that keep the `c24f756` read-api packaging. `lib/ops/update-center.js`, `update-center-mount.js`, `update-backup.js`, `update.js`, `server.js`, `desktop/main.js`, and `public/update-ui.js` are byte-identical to `035571f`.

## The 119/119 claim on 035571f

Host Node for this audit is v22.23.3. On `d1adf4d`, `npm run test:ops` is 119 pass, 0 fail. `news-node` test 22 is `ok` (`logs/ops.log`).

On `035571f` the same command, recorded in `qa/reports/update-center-v130/logs/test-ops.log`, is 119 tests, 118 pass, 1 fail. The only failure is test 22. Its actual list is exactly `docs/ops/UPDATE_CENTER.md`, `docs/ops/UPDATE_CENTER_MAC_TEST.md`, and `test/ops/update-center.test.js`. Those three lines do not contain the strip words `ошибочн`, `WRONG`, `wrong`, or `неверн`.

The scanner is `git ls-files` plus that regex. It does not read `process.version`. It does not read a `STUDIO_*` variable. Node version and the studio env do not change the result.

`npm run test:update-center` runs the four Update Center files and omits `news-node.test.js`. On `035571f` that command is 79 pass, 0 fail. The ops suite on `c24f756`, before those files existed, is 40 pass, 0 fail. 79 + 40 = 119. That sum uses the old news-node result from a tree that did not contain the new docs. `npm run test:ops` is the command that scans the new docs together with news-node. On `035571f` it fails. On `d1adf4d` the three hits say macOS `13.7.1`, and the same command passes.

## Attack results from 035571f, re-run here

The committed harness `qa/reports/update-center-v130/attack.cjs` was run with `UC_ROOT` pointed at this commit. `logs/attack.out` is 59 checks, 0 failures. `STUDIO_SQLITE=node`. Ports 18961–18963. The security modules match `035571f` byte for byte, so the earlier results still hold on this tree.

| Check | Result |
| --- | --- |
| `STUDIO_OPS_UPDATE` unset | 404 `unknown collection` |
| No session, node-agent bearer, wrong app token | 401 |
| Missing CSRF header, foreign Origin, Origin null, `Sec-Fetch-Site: cross-site` | 403 |
| Approve or auto-install with a missing or wrong owner password | 403 «Неверный пароль владельца» |
| Right password plus every download flag and `hardGateOverrideForTests` in the JSON body | 400 `UPDATE_DISABLED` |
| `HARD_GATE.closed` | true. Mount, server, and UI do not pass `hardGateOverrideForTests`. An env var of that name leaves download off. A READY key plus `OPS_UPDATE_DOWNLOAD_ENABLED=1` leaves `downloadEnabled` false |
| Authenticated status | flavor `test`, bundle `com.moonkatty.aistudio.test`, known true, signature READY, `downloadEnabled` false, `hardGate` true |
| TEST publish | queue POST `published` stored 201; publish POST 403 `publishing_disabled` |
| Linux keyring read | fd-relative via `/proc/self/fd/20` |
| Prod bundle id on the TEST server | known false, download off |
| Backup | SHA-256 `14b385b7b68e9a8e54c0ee4fe01a7531b8a1782439c56614d3508464254b22fc`, trial restore ok. Schema 1–6 accepted. Schema 0 and 7 rejected |

The path diff against `c24f756` for the node tree, `desktop/main.js`, the nodes ops files, `lib/studio-config.js`, and `lib/db-backup.js` is empty. `server.js` is the three mount lines.

## Zip

`FLAVOR=test scripts/package-mac-on-linux.sh` in a detached tree at `d1adf4d`. `rcodesign` 0.29.0 ad-hoc. `SOURCE_DATE_EPOCH` `1792610637` (`2026-10-21T19:23:57Z`), taken from the commit. Electron 44.9.1. electron-builder 26.15.3. Bundled Node v24.22.0. Host Node v22.23.3.

Independent `sha256sum` of `dist/MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip`:

`d5ff49345b70ccfb61cf4fb0be0256558947a751eda11bbf4f0ffbf71a104655`

That equals `logs/BUILD-INFO.txt`. The packager left the product tree clean. Unpacked `desktop/build-info.json`:

```json
{"commit":"d1adf4d86d09384d2cc322920d360eb87797c1de","builtAt":"2026-10-21T19:23:57.000Z","version":"1.3.0-test","electron":"44.9.1","node":"v24.22.0","builder":"linux","flavor":"test","appId":"com.moonkatty.aistudio.test"}
```

Fuses include `WasmTrapHandlers` Enabled. The zip is ad-hoc and is not notarized.

## Packaged app

`logs/zip-probe.json` is 10 checks, 0 failed. The unpacked server was started with `STUDIO_FLAVOR=prod` and `STUDIO_OPS_UPDATE` empty, on port 8941, with fake password `fake-admin-pw-1`.

- Health flavor stays `test`, product `MOONKATTY AI STUDIO TEST`, version `1.3.0-test`.
- `GET /api/ops/update-center` is 404 `unknown collection`.
- Requiring the unpacked Update Center module reports `HARD_GATE.closed` true.
- `openPlatformRead()` path is `studio2-read-api` and `publish` is false.
- `GET /api/world/command-center` returns `source` `studio2-read-api`, `demo` true, `publish` false. YouTube News confirmed money is `DEMO USD 12.50`, `excludedFromActual` true, `dataMode` mock, payout `MOCK-PAYOUT-0001`.
- `POST /api/queue` with `published` is stored as `pending_approval`. `POST /api/queue/:id/publish` is 403 `publishing_disabled`.
- Baked `lib/studio-config.js` reports `FLAVOR_SOURCE` baked, `IS_TEST` true, `appId` `com.moonkatty.aistudio.test`.

`test:publish-guard` ran in the build tree after the zip existed: 73 pass, 0 fail, including the 14 bundle checks. `meta.js` is absent from the TEST app.

## Regression versus c24f756

Same commands as the `c24f756` table. `STUDIO_FLAVOR` was unset except where a script sets it. `STUDIO_SQLITE=node`. Update flags were unset. Host Node v22.23.3. `test:publish-guard` ran in the build tree after the zip existed.

| Script | c24f756 | d1adf4d |
| --- | --- | --- |
| test:security | 52 / 0 | 52 / 0 |
| test:runner | 5 / 0 | 5 / 0 |
| test:opencode | 51 / 0 | 51 / 0 |
| test:policy | 46 / 0 | 46 / 0 |
| test:video | 45 / 0 plus wiring 8 / 0 | 45 / 0 plus wiring 8 / 0 |
| test:publish-guard | 73 / 0 | 73 / 0 |
| test:isolation | 65 / 0 | 65 / 0 |
| test:nodes | 52 / 0 | 52 / 0 |
| test:ops | 40 / 0 | 119 / 0 |
| **Executed here** | **437 / 0** | **516 / 0** |

The ops growth is the four Update Center files. 437 − 40 + 119 = 516. `news-node` test 22 passes inside that 119.

`node scripts/world-class-test.mjs` is 62 pass, 0 fail, plus one `BLOCKED` macOS launch check and one `MOCK` Ollama check. The product copy of `qa/reports/world-class-v1.3.0/results.json` was restored after the run. Both product trees were clean afterward.

### Known failures

| Check | Result | Why it is the same failure |
| --- | --- | --- |
| Studio 5 `node --test studio-intelligence/test/check-compat.test.js` | 0 pass, 1 fail | `Missing expected exception`. The test expects `integ/v1.3.0-test` to be absent. This clone has `origin/integ/v1.3.0-test`. The test file is unchanged. |
| `scripts/check-compat.sh` | exit 0 | `merge-tree HEAD origin/integ/v1.3.0-test`, tree `c8a45bc9b44ffdfab2f36280f80c3b386103f3ec`, and no conflict paths. |
| `npm run test:ops:studio` | 0 pass, 1 fail, 1 cancelled | `TypeError: Cannot read properties of undefined (reading 'info')` at `nodes.multiprocess.test.js:24`. The second test is cancelled at 90000 ms. `QA-NODE-005`. The test file is outside this diff. |
| `npm run smoke` with no URL | exit 1 | `page.goto: url: expected string, got undefined` at `scripts/smoke.mjs:10`. The script is unchanged and requires a URL, a prefix, a user, and a password. |

## What was not runnable on Linux

- The arm64 `.app` was not launched. The world harness records `BLOCKED` for the macOS Apple Silicon launch check.
- macOS `/dev/fd` keyring reads, Keychain, `launchd`, Gatekeeper, quarantine, `codesign`, `spctl`, and notarization. `QA-UC-010` stays open for that reason.
- A real Ollama model. The world harness records `MOCK`.
- A live `tailscale whois`.
- A real GitHub release download. The attack harness `fetchImpl` throws.
- `test:3d`, `test:3c`, `test:e2e-test-build`, and `test:opencode-json`. Those need Blender or OpenCode and were outside the 437 on `c24f756`.

## Registry

38 bugs: 14 open, 23 qa_verified, 1 blocked. None are owner-approved.

`QA-UC-011` is `qa_verified`. The history note records that `d1adf4d` replaces the three `12.5.1` hits with `13.7.1`, and that `test:ops` on Node v22.23.3 is 119 pass, 0 fail. Owner approval is false.

`QA-UC-010` stays `open`. `QA-NODE-005` stays `open`.
