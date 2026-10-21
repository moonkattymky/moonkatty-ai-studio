# Re-audit of v1.3.0-test at c24f756

Read-only on `integ/v1.3.0-test` at `c24f7569301dbc5fe3cfe2a58143890c9ef74133` (2026-10-21 21:42:21 +0300). Parent is `b813ac4c5fe571f87ad2465d6ad29bb3b54ce5be`. This audit supersedes the install target in `qa/reports/final-v1.3.0-test/REPORT.md`. The product worktrees were detached checkouts. Fake password `fake-admin-pw-1` only. No publish. No Meta, Facebook, Instagram, Telegram, X, or YouTube calls. No Azure. No owner approval was set.

The hash below is the zip this Linux host built from that commit with `FLAVOR=test scripts/package-mac-on-linux.sh`. It matches the claimed SHA-256.

## Result

**PASS** for installing the isolated TEST zip built from `c24f756`.

Blocking bugs: none.

This zip replaces `c460cfcc886d5e0982f4f0b8c04df0263e968540208cbd5487def3f7673b3a06` (`b813ac4`) as the v1.3.0-test install. A later commit needs its own final audit. A zip of this commit whose SHA-256 is the value below is the artifact this report covers.

Real publishing and real social accounts stay forbidden. A production launch stays blocked. The zip is ad-hoc signed and is not notarized. macOS Keychain, `launchd`, Gatekeeper, and a live `tailscale whois` were not run.

`QA-NODE-005` stays open. `test:ops:studio` is still 0 pass, 1 fail, 1 cancelled, and the first failure is the same `TypeError` as on `b813ac4`. Studio 5 `check-compat` fails its unit test because `origin/integ/v1.3.0-test` exists; the script itself exits 0 with no conflict paths. `npm run smoke` with no URL fails in `page.goto` because the URL argument is missing. Those three are the same known failures. None of them blocks the install.

## Allowed on the Mac mini

- Install `MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip` only when its SHA-256 is `d512263ef450bf9ca82297108d4b61c84c779f777665707559f32b52af603b5e`. That is the rebuild of `c24f756` recorded in `logs/BUILD-INFO.txt`. Leave the `b813ac4` zip off the machine. Its command center has no Studio 2 read API on disk.
- Run the TEST app only. `CFBundleIdentifier` is `com.moonkatty.aistudio.test`. The product name is `MOONKATTY AI STUDIO TEST`. The version is `1.3.0-test`. The baked config uses Keychain service `MOONKATTY AI STUDIO.test`, port `8687`, and `appId` `com.moonkatty.aistudio.test`. Use the TEST app’s data directory.
- Confirm `Contents/Resources/app.asar.unpacked/desktop/build-info.json` reads commit `c24f7569301dbc5fe3cfe2a58143890c9ef74133`, `flavor` `test`, and `appId` `com.moonkatty.aistudio.test`.
- Leave publishing off. `POST /api/queue` with `status: published` is stored as `pending_approval`. `POST /api/queue/:id/publish` returns 403 `publishing_disabled`. Leave real social accounts disconnected.
- Leave auto-update off. This tree and this zip contain no Update Center module. `desktop/main.js` is byte-identical to `b813ac4`, so `checkUpdates` still returns immediately when the flavor is test. Leave `STUDIO_OPS_UPDATE` and `OPS_UPDATE_*` unset.
- Leave `MA_EXPERIMENTAL` unset. Leave `MA_JOBS_BACKEND` unset. Leave `STUDIO_MEDIA_ROOT` and `STUDIO_PLATFORM_SNAPSHOT` unset. With those unset, the packaged command center reads the shipped sample snapshot.
- Treat every figure on the Revenue Command Center platform strip as fixture money. YouTube News confirmed money is `DEMO USD 12.50`, `excludedFromActual` true, payout `MOCK-PAYOUT-0001`. The estimate line is `DEMO не подтверждено`. `publish` is false. `viewsAreRevenue` is false. That figure is a sample. It is outside the real total.
- The bundled agent is `node-agent/agent.js` `VERSION = '0.2.2'`, SHA-256 `3fcaea09b821575edded1948892203e2bab22cd4dd9e909b454a774fec3e0ff0`, the same bytes as the source file and as the `b813ac4` package. Leave `STUDIO_NODES_LEGACY_TOKENS` unset. Leave Tailscale Funnel off.
- `meta.js` is absent from the TEST app. The packager refuses a TEST Resources tree that still contains it. Publish adapters, `platforms/ledger.js`, and `platforms/promotion.js` are absent from the asar and from the unpacked tree.

## Diff

`git diff --stat b813ac4 c24f756` is one file:

```
 package.json | 8 ++++++++
 1 file changed, 8 insertions(+)
```

`git diff --exit-code b813ac4 c24f756 -- . ':(exclude)package.json'` exits 0. `logs/path-diff.txt` is the hunk. Both `build.files` and `asarUnpack` gain these four paths:

- `media-automation/src/platforms/read-api.js`
- `media-automation/src/platforms/registry.js`
- `media-automation/src/platforms/capabilities.js`
- `media-automation/fixtures/platforms-snapshot.sample.json`

`package-lock.json` is unchanged. The node tree, `server.js`, `desktop/main.js`, `lib/studio-config.js`, `lib/world/platform-read.js`, and `lib/db-backup.js` match `b813ac4`.

## Zip

`FLAVOR=test scripts/package-mac-on-linux.sh` in a detached tree at `c24f756`. `rcodesign` 0.29.0 ad-hoc. `SOURCE_DATE_EPOCH` `1792608141` (`2026-10-21T18:42:21Z`), taken from the commit. Electron 44.9.1. electron-builder 26.15.3. Bundled Node v24.22.0. Host Node v22.23.3.

Independent `sha256sum` of `dist/MOONKATTY-AI-STUDIO-TEST-1.3.0-test-arm64-mac.zip`:

`d512263ef450bf9ca82297108d4b61c84c779f777665707559f32b52af603b5e`

That equals the claimed hash and `logs/BUILD-INFO.txt`. The packager left the product tree clean. Unpacked `desktop/build-info.json`:

```json
{"commit":"c24f7569301dbc5fe3cfe2a58143890c9ef74133","builtAt":"2026-10-21T18:42:21.000Z","electron":"44.9.1","node":"v24.22.0","builder":"linux","flavor":"test","appId":"com.moonkatty.aistudio.test"}
```

Requiring the unpacked `lib/studio-config.js` reports `FLAVOR_SOURCE` `baked`, `IS_TEST` true, flavor `test`, bundle `com.moonkatty.aistudio.test`, port `8687`, and Keychain service `MOONKATTY AI STUDIO.test`. A packaged server started with `STUDIO_FLAVOR=prod` still reports health flavor `test` and version `1.3.0-test`.

The asar lists 905 entries. The four new paths are in the asar and under `app.asar.unpacked`. A name scan of the asar and of the Resources tree found no `meta.js`, no `publish/adapters/`, no `analytics/adapters.js`, no `platforms/ledger.js`, no `platforms/promotion.js`, and no `platforms/index.js`. The three paths whose names contain `ledger` are the Studio 5 files already present at `b813ac4` (`ledger-adapter.js`, `ledger-stub.js`, `studio3-ledger-entry.schema.json`). `git diff` of those three files against `b813ac4` is empty. They are the Studio 5 contract. They are outside the read-api require chain.

## Command center and fixture money

`logs/probe.json` (source tree, 18 checks, 0 failed) and `logs/zip-probe.json` (packaged tree, 13 checks, 0 failed).

`GET /api/world/command-center` on the source server and on the unpacked packaged server returns:

```json
{"source":"studio2-read-api","version":"1.0.0","demo":true,"publish":false,"viewsAreRevenue":false}
```

`openPlatformRead()` finds `media-automation/src/platforms/read-api.js` and calls `createReadApi()` with no arguments. That reads `fixtures/platforms-snapshot.sample.json`. Every `dataMode` in that file is `mock`. The file note says every platform is mock and that no accounts are connected. YouTube News confirmed money is `DEMO USD 12.50` with `excludedFromActual` true. The packaged HTTP response matches. Every object label on the platform strip starts with `DEMO` or is «НЕТ ДАННЫХ». `usd` is absent on those labels. `dataMode` on those rows is `mock`.

`lib/world/platform-read.js` sets `publish: false` on the opened reader and again in `summarize`. The command-center payload copies that `publish: false`. Directors report `publishes: false`. `publishing.touched` is false and `publishing.testDisabled` is true.

## Write and publish paths

The require closure of the three new modules is four files: `read-api.js`, `registry.js`, `capabilities.js`, and `experimental.js`.

`capabilities.js` has no `fs`, `http`, `https`, `net`, or `child_process` import. `capabilitiesFor` returns a static catalog. The catalog text includes a `promotion_boost` entry whose note says draft only and never auto-spend. The module does not import `promotion.js` and does not call a network endpoint.

`registry.js` imports `./capabilities` and `../experimental`. `platformState` and `liveMode` read the experimental flag, an owner flag, and `approvals.get`. `requestLiveMode` would call `approvals.submit` if some caller passed an approvals object. The only reference to `requestLiveMode` in the tree, outside its definition, is `media-automation/test/platforms.test.js`. That test is outside `build.files`. No shipped file calls it. The HTTP server does not mount it.

`createReadApi()` with no arguments reads the snapshot and does not call a publisher or a ledger. The server’s only call is that no-argument form in `platform-read.js`. A direct call that passes a ledger object returns `dataMode: 'real'` for that caller’s rows. The command center does not make that call. The platforms test that passes a ledger is not packaged.

`POST /api/queue` with `published` returns 201 and is stored as `pending_approval` with no `externalId`. `POST /api/queue/:id/publish` returns 403 `publishing_disabled` on both the source server and the packaged server.

## Regression versus b813ac4

Same commands as the `b813ac4` table. `STUDIO_FLAVOR` was unset except where a script sets it. `test:publish-guard` ran in the build tree after the zip existed, so the 14 bundle checks ran.

| Script | b813ac4 | c24f756 |
| --- | --- | --- |
| test:security | 52 / 0 | 52 / 0 |
| test:runner | 5 / 0 | 5 / 0 |
| test:opencode | 51 / 0 | 51 / 0 |
| test:policy | 46 / 0 | 46 / 0 |
| test:video | 45 / 0 plus wiring 8 / 0 | 45 / 0 plus wiring 8 / 0 |
| test:publish-guard | 73 / 0 | 73 / 0 |
| test:isolation | 65 / 0 | 65 / 0 |
| test:nodes | 52 / 0 | 52 / 0 |
| test:ops | 40 / 0 | 40 / 0 |
| **Executed here** | **437 / 0** | **437 / 0** |

`node scripts/world-class-test.mjs` is 62 pass, 0 fail, plus one `BLOCKED` macOS launch check and one `MOCK` Ollama check. The product copy of `qa/reports/world-class-v1.3.0/results.json` was restored after the run. The world harness also records fixture revenue as `DEMO` and `readApi.publish` false.

### Known failures

| Check | Result | Why it is the same failure |
| --- | --- | --- |
| Studio 5 `node --test studio-intelligence/test/check-compat.test.js` | 0 pass, 1 fail | `Missing expected exception`. The test expects `integ/v1.3.0-test` to be absent. This clone has `origin/integ/v1.3.0-test`. |
| `scripts/check-compat.sh` | exit 0 | `merge-tree HEAD origin/integ/v1.3.0-test`, tree `8b4aa8432dab23a05d7f6ad4fc4deef234b23c2d`, and no conflict paths. The script file matches `b813ac4`. |
| `npm run test:ops:studio` | 0 pass, 1 fail, 1 cancelled | `TypeError: Cannot read properties of undefined (reading 'info')` at `nodes.multiprocess.test.js:24`. The second test is cancelled at 90000 ms. `QA-NODE-005`. The test file matches `b813ac4`. |
| `npm run smoke` with no URL | exit 1 | `page.goto: url: expected string, got undefined` at `scripts/smoke.mjs:10`. The script matches `b813ac4` and requires `<url> <prefix> <user> <pass>`. |

## What was not runnable on Linux

- The arm64 `.app` was not launched. The world harness records `BLOCKED` for the macOS Apple Silicon launch check.
- macOS Keychain, `launchd`, Gatekeeper, quarantine, `sandbox-exec`, and notarization.
- A real Ollama model. The world harness records `MOCK`.
- A live `tailscale whois`.
- `test:3d`, `test:3c`, `test:e2e-test-build`, and `test:opencode-json`. Those need Blender or OpenCode and were outside the 437 on `b813ac4`.

## Registry

38 bugs: 15 open, 22 qa_verified, 1 blocked. None are owner-approved.

`QA-NODE-005` stays `open`. The history note records the `c24f756` rerun. No new bug was opened. Update Center remains outside this commit.
