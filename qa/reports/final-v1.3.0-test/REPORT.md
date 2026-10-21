# Final integrated audit of v1.3.0-test

Read-only on `integ/v1.3.0-test` at `b813ac4c5fe571f87ad2465d6ad29bb3b54ce5be` (2026-10-21 21:12:51 +0300). `322023fd6f8e98dbddd38341e07227ded149c1fb` is an ancestor. The product worktree was a detached checkout. Fake password `fake-admin-pw-1` only. No publish. No Meta, Facebook, Instagram, Telegram, X, or YouTube calls. No Azure. No owner approval was set.

No prebuilt zip was attached to this run. The hash below is the zip this Linux host built from that commit with `FLAVOR=test scripts/package-mac-on-linux.sh`. It matches the claimed SHA-256.

## Result

**PASS** for installing the isolated TEST zip built from `b813ac4`.

Blocking bugs: none.

Real publishing and real social accounts stay forbidden. A production launch stays blocked. The zip is ad-hoc signed and is not notarized. macOS Keychain, `launchd`, Gatekeeper, and a live `tailscale whois` were not run.

`QA-NODE-005` stays open. `test:ops:studio` is still 0/2, and the first failure is the same `TypeError` as on `322023f`. Studio 5 `check-compat` fails its unit test because `origin/integ/v1.3.0-test` exists; the script itself is a clean merge-tree. Neither one blocks the install.

## Allowed on the Mac mini

- Install `MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip` only when its SHA-256 is `c460cfcc886d5e0982f4f0b8c04df0263e968540208cbd5487def3f7673b3a06`. That is the rebuild of `b813ac4` recorded in `logs/BUILD-INFO.txt`.
- Run the TEST app only. `CFBundleIdentifier` is `com.moonkatty.aistudio.test`. The product name is `MOONKATTY AI STUDIO TEST`. The version is `1.3.0-test`. The baked config uses Keychain service `MOONKATTY AI STUDIO.test`, port `8687`, nodes port `8690`, OpenCode `http://127.0.0.1:4097`, `launchd` label `com.moonkatty.aistudio.test.server`, `autoStartServer` false, and `checkUpdates` false. Use the TEST app’s data directory.
- Confirm `Contents/Resources/app.asar.unpacked/desktop/build-info.json` reads commit `b813ac4c5fe571f87ad2465d6ad29bb3b54ce5be`, `flavor` `test`, and `appId` `com.moonkatty.aistudio.test`.
- Leave publishing off. `POST /api/queue/:id/publish` and `POST /api/comments/:id/reply` return 403 `publishing_disabled`. Leave real social accounts disconnected.
- Leave auto-update off. This tree and this zip contain no Update Center module. `desktop/main.js` `checkUpdates` returns immediately when the flavor is test, and the menu item «Проверить обновления…» is omitted. Leave `STUDIO_OPS_UPDATE` and `OPS_UPDATE_*` unset.
- Leave `MA_EXPERIMENTAL` unset, and do not add `media-automation/config/experimental.json`. The default is off. The value `yes` stays off. The values `1` and `true` turn the flag on. X and Telegram adapters stay unregistered while the flag is off.
- Leave `MA_JOBS_BACKEND` unset. `video_render` is connected to the local Studio 2 executor. A job input may contain only `runId`, `preset`, and `episodeRef`. A `status` or `published` field is rejected (`неизвестное поле`). A finished render is a local artifact, and the Approval Center still has to accept anything that would leave the machine.
- Keep Approval Center in the path. Studio 5 `decide()` returns `executed: false` and stores `si_approvals.auto_execute = 0`. An agent principal is `PERMISSION_DENIED`. `autoExecute: true` is `VALIDATION`. `POST /api/queue` with `status: published` is stored as `pending_approval`. `PUT` of `published` or `externalId` is 403 `published_internal_only`.
- In this installed `.app`, `media-automation/src/platforms/read-api.js` is absent. The packaged command-center adapter reports path `absent`, so that panel shows «НЕТ ДАННЫХ». A source checkout of `b813ac4` uses `studio2-read-api` and labels mock money `DEMO`, excluded from the real total. Do not copy the fixture into the app and present it as cash.
- The bundled agent is `node-agent/agent.js` `VERSION = '0.2.2'`, SHA-256 `3fcaea09b821575edded1948892203e2bab22cd4dd9e909b454a774fec3e0ff0`, the same bytes as the source file. Leave `STUDIO_NODES_LEGACY_TOKENS` unset. Leave Tailscale Funnel off. Enroll with a one-time code. An unverified peer stays unverified until the owner sends the second acknowledgement. This host did not run a live whois.
- `meta.js` is absent from the TEST app. The packager refuses a TEST Resources tree that still contains it.

## Zip

`FLAVOR=test scripts/package-mac-on-linux.sh` in a detached tree at `b813ac4`. `rcodesign` 0.29.0 ad-hoc. `SOURCE_DATE_EPOCH` `1792606371` (`2026-10-21T18:12:51Z`). Electron 44.9.1. electron-builder 26.15.3. Bundled Node v24.22.0. Host Node v22.23.3.

Independent `sha256sum` of `dist/MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip`:

`c460cfcc886d5e0982f4f0b8c04df0263e968540208cbd5487def3f7673b3a06`

That equals the claimed hash and `logs/BUILD-INFO.txt`. The packager left tracked product files clean after it removed the baked flavor files. Unpacked `desktop/build-info.json`:

```json
{"commit":"b813ac4c5fe571f87ad2465d6ad29bb3b54ce5be","builtAt":"2026-10-21T18:12:51.000Z","electron":"44.9.1","node":"v24.22.0","builder":"linux","flavor":"test","appId":"com.moonkatty.aistudio.test"}
```

Requiring the unpacked `lib/studio-config.js` reports `FLAVOR_SOURCE` `baked`, `IS_TEST` true, and the TEST bundle, port, and Keychain service above.

Present under `Contents/Resources`: `app.asar.unpacked/desktop/build-info.json`, `node-agent/agent.js`, `studio-intelligence/src/index.js`, `lib/world/platform-read.js`, `lib/flavor.baked.js`, `server.js`.

Absent from the Resources tree: `meta.js`, `lib/ops/update-center.js`, `media-automation/src/platforms/read-api.js`, `media-automation/config/experimental.json`, `media-automation/fixtures/platforms-snapshot.sample.json`. `git ls-files` on this commit has no Update Center path.

## Claimed contents

| Claim | Measured |
| --- | --- |
| Studio 5 `4a101a7556732e6c53ab4793b49c568a9001770e` and `dbe63beb882d2959970cbacf6e5cc0e9e35fcaa9` | Both commits are ancestors. `studio-intelligence` vs `4a101a7` is exactly six files, and those six match `dbe63be`: `scripts/backup-db.js`, `scripts/rollback-db.js`, `src/db-backup.js`, `src/host-adapter.js`, `test/host-compat.test.js`, `test/upstream-rollback.test.js`. The tree is the union of the two commits. |
| Studio 2 `d0ded556bff0d640da8b003680aa7938d0b89893` | `git diff --quiet` for `media-automation` is empty. The whole directory matches. |
| `video_render` connected, `MA_EXPERIMENTAL` off | `server.js` calls `services.videoRender.setExecutor(createVideoRenderExecutor(...))` at boot. The comment states `MA_JOBS_BACKEND=jobsapi` stays unwired. `experimental.json` is absent. `experimentalEnabled({ env: {} })` is false, `yes` is false, `1` is true. |
| World-class `25e564a8538bca123dd0782edba8cad0db18c2e5` | `lib/world`, `config/WORLD_CLASS_MISSION.md`, `config/mission.yaml`, and `public/app.js` match. `scripts/world-class-test.mjs` differs by one line: the memory-path assertion accepts `fallback` or `studio-intelligence`. |
| node-agent 0.2.2 from `8b50ce6b0205626cf19d37d698e56e7f770fa181` | `git diff 8b50ce6:node-agent HEAD:node-agent` is empty. `8b50ce6` is not an ancestor; the directory was copied. `VERSION` is `0.2.2`. Packaged `agent.js` matches the source bytes. |
| Update Center absent, no auto-update path | No tracked Update Center file. The TEST `checkUpdates` function returns before a network call. The update menu item is omitted when `CFG.IS_TEST`. |
| `desktop/build-info.json` in `app.asar.unpacked` | Present, contents above. |

## Revenue, mission, DEMO, memory

`node scripts/world-class-test.mjs` on this tree (`STUDIO_FLAVOR=test`, port 8913, `logs/world.log`, `logs/world-results.json`): **62 pass, 0 fail**, plus one `BLOCKED` macOS launch check and one `MOCK` Ollama check. The product copy of `qa/reports/world-class-v1.3.0/results.json` was restored after the run.

The eight revenue rules passed:

1. Three states stay apart (`R1`).
2. Views and reach are not revenue (`R2`, and the views check).
3. The same payout is idempotent; a conflicting payout is rejected (`R3`).
4. The confirmed payout stores the required fields (`R4`).
5. Accrued import is accepted and is not the cash total (`R5`).
6. DEMO stays outside the real total (`R6`). Confirmed month revenue in that run was `$80.50`, with `DEMO $5.00` marked `excludedFromActual`.
7. Unconnected or empty sources are «НЕТ ДАННЫХ» (`R7`).
8. Restart and backup/restore keep the confirmed payout (`R8`). Backup SHA-256 `7222a106500cbb37fe53a068015809d250e2326d2fb48c4910a892efb2d517e1`.

Mission id `world-class` loads, and the harness reports file SHA-256 `1bfb455135837c1a24d30173d037e361cf065c7d7fdc952fdd1cb341db34d409`. The same mission is still on every agent after restart. `POST` of `published` is still rejected. Owner-gated world actions return `executed: false`. `botting`, `bought_followers`, `platform_evasion`, and `fake_followers` return `forbidden`.

A separate boot (`logs/probe.json`, 21 checks, 0 failed) measured the live adapters:

- Source `openPlatformRead()` path is `studio2-read-api`, `publish` false. YouTube News confirmed money is `DEMO USD 12.50`, `excludedFromActual` true.
- The booted command center reports `memory.path` `studio-intelligence` and `readApi` `{ source: studio2-read-api, version: 1.0.0, demo: true, publish: false, viewsAreRevenue: false }`.
- The same `platform-read.js` loaded from `app.asar.unpacked` reports path `absent`, because the package does not ship `read-api.js` or the sample snapshot.
- Studio 5: the director agent cannot approve (`PERMISSION_DENIED`). The owner decision is `executed: false`, `si_approvals.status` `approved`, `auto_execute` 0, and the studio `items` queue table is absent on that database. `autoExecute: true` throws `VALIDATION`.
- Health is flavor `test`, version `1.3.0-test`, schema 6.
- `POST /api/queue` with `published` returns 201 and is stored as `pending_approval` with no `externalId`. Comment `approved` is stored as `new`.

`video_render`’s module starts as a stub. The server replaces that stub at boot. `scripts/video-render-wiring-test.mjs` is 8/8, including a symlinked data directory, cancel, and `MA_JOBS_BACKEND` left off. The executor file has no publish path. An HTTP job that adds `status: published` returns 400 `неизвестное поле "status"`.

A scan of the tree, excluding `node_modules`, `dist`, `qa`, and markdown, found no `BEGIN PRIVATE KEY`, no `sk-` token, no `AKIA` key id, and no Slack `xox` token. The world harness also reports that `lib/world` and the mission files contain no secret material.

## Regression versus v1.2.4-test `322023f`

Same commands as the v1.2.4 table, with `STUDIO_FLAVOR` unset except where a script sets it itself. `test:opencode` was run with the flavor unset.

| Script | v1.2.4 record | This tree |
| --- | --- | --- |
| test:security | 52 / 0 | 52 / 0 |
| test:runner | 5 / 0 | 5 / 0 |
| test:opencode | 51 / 0 | 51 / 0 |
| test:policy | 46 / 0 | 46 / 0 |
| test:video | 45 / 0 | 45 / 0, plus new `video-render-wiring-test.mjs` 8 / 0 |
| test:publish-guard | 73 / 0 | 73 / 0 |
| test:isolation | 65 / 0 | 65 / 0 |
| test:nodes | 52 / 0 | 52 / 0 |
| test:ops | 38 / 0 on `b7101c4` | 40 / 0 |
| test:opencode-json | 21 / 0 on `b7101c4` | not started |
| **Executed here** | | **437 pass, 0 fail** |

`test/ops` at `b813ac4` matches `322023f`. The two tests past the old 38 landed in `enroll-022.test.js` on `322023f` and are inside this 40/0 run. The in-process multiprocess tests (the coordinator helper, not `COORD_HELPER=studio`) are ops tests 29 and 30 and they pass. `scripts/nodes-test.mjs` now expects agent version `0.2.2`; that suite is 52/0.

`lib/keystore.js` and `lib/opencode-auth.js` add the Node directory to `PATH` only when the `security` binary is not `/usr/bin/security`, so the Linux fixture’s `#!/usr/bin/env node` shebang can run. `/usr/bin/security` still gets `PATH=/usr/bin:/bin`.

### `test:ops:studio` (`QA-NODE-005`)

`COORD_HELPER=studio`, flavor and `STUDIO_NODES_LEGACY_TOKENS` unset.

| Commit | Result | First test | Second test |
| --- | --- | --- | --- |
| `322023f` | 0 pass, 2 fail | `TypeError: Cannot read properties of undefined (reading 'info')` at `nodes.multiprocess.test.js:24` | `until()` throws after about 15s waiting for `needs_approval` |
| `b813ac4` | 0 pass, 1 fail, 1 cancelled | the same `TypeError` at the same line | the test runner cancels the test at 90000ms |

`POST /api/ops/nodes` still returns 403 `E_LEGACY_DISABLED` («Прямые токены 0.2.0 отключены») when legacy tokens are unset. The test treats that body as a token. An empty node list makes `every()` true, then `n.info` throws. That first failure is pre-existing.

On `322023f` the bundled agent is 0.2.0 and `process.exit(1)` when configuration fails, so the second test reaches `until()`. On `b813ac4` the agent is 0.2.2. A missing token matches `нет токена` and enters `enrollUi()`, which waits instead of exiting, so `dropper.on('exit')` never fires and the 90s test timeout cancels the test. The fault scenario still never observes `needs_approval`. This is the same gap. It does not block the install. The in-process coordinator run of the same two tests passes inside `test:ops`.

### Studio 5 `check-compat`

`node --test studio-intelligence/test/check-compat.test.js`: 1 test, 0 pass, 1 fail, `Missing expected exception` (`logs/check-compat.log`). The test expects the default ref `integ/v1.3.0-test` to be absent and the script to exit 2 with `BLOCKED`. This clone has `origin/integ/v1.3.0-test`, so the exception is absent. That is the expected failure.

`scripts/check-compat.sh` itself exits 0 (`logs/check-compat-script.log`): `merge-tree HEAD origin/integ/v1.3.0-test`, tree `b98d15467fdab6803ad858cb655ca3e0b6b19185`, and no conflict paths.

## What was not runnable on Linux

- The arm64 `.app` was not launched. The world harness records `BLOCKED` for «macOS Apple Silicon launch».
- macOS Keychain, `launchd`, Gatekeeper, quarantine, `sandbox-exec`, and notarization.
- A real Ollama model. The world harness records `MOCK` («Ollama недоступна»). The runner suite used its mock.
- A live `tailscale whois`.
- `test:3d`, `test:3c`, `test:e2e-test-build`, and `test:opencode-json`. `blender` is not on `PATH`, and the OpenCode binary used by the earlier 21/21 run is absent. The v1.2.4 OpenCode-json result stays the `b7101c4` result; this integration did not repeat it.

## Registry

37 bugs: 14 open, 22 qa_verified, 1 blocked. None are owner-approved.

`QA-NODE-005` stays `open`. The history note records the `b813ac4` rerun. `QA-NODE-001`, `QA-NODE-002`, `QA-NODE-003`, and `QA-NODE-006` stay open. `QA-NODE-004` stays the Computers UI e2e and was not in this tree. Update Center bugs were not reopened: this commit has no Update Center.
