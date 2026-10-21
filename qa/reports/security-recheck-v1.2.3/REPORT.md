# Independent security verification — v1.2.3-test @ a2a35c8

Target: branch `feat/v1.2.2-test-isolated`, HEAD `a2a35c864755739a581d5a3c981a9feae3bb9b3d` (docs only). Code is `79b7d585eba103d3cb76b51422c129261ec934f3`. `git diff --stat 79b7d58 a2a35c8` is `docs/SECURITY_RECHECK_v1.2.3-test.md` (+55). The branch was read in a detached worktree at `/tmp/mk-src-v123`. Nothing on it was modified. Nothing was merged and nothing was published. Passwords in the tests are fake. No call was made to Meta, Facebook, Instagram, or Telegram.

The claimed zip is not on a GitHub release. It was rebuilt here.

## Verdict

**Publishing the v1.2.3-test prerelease: PASS.**

**Installing that zip on the Mac mini for OpenCode + Blender testing: PASS**, after the checklist at the end of this report.

**Real social accounts: not allowed.**

**A full production launch stays blocked.** This artifact is the isolated test build. It is ad-hoc signed and not notarized. macOS Keychain, launchd, Gatekeeper, and `sandbox-exec` were not executed. OpenCode and Blender are absent on this host, so `test:3d`, `test:3c`, and `test:e2e-test-build` exited 2. A local rewrite of every flavor marker plus a planted `meta.js`, started as `node server.js`, loads the publisher. The Electron shell refuses that rewrite. See remaining issues.

## How this was checked

- Worktree `/tmp/mk-src-v123` at `a2a35c8`, `git status --porcelain --untracked-files=no` empty before the build and empty after the packager trap removed the generated markers.
- Rebuild: `FLAVOR=test scripts/package-mac-on-linux.sh` from that worktree. Host Node v22.23.3. `rcodesign` 0.29.0 (`apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz`, published SHA-256 `dbe85cedd8ee4217b64e9a0e4c2aef92ab8bcaaa41f20bde99781ff02e600002`, verified before install).
- Independent harness: `qa/reports/security-recheck-v1.2.3/attack.mjs` against a clean copy of the tree (`/tmp/mk-v123-clean`) and against the built `.app`. Log: `logs/attack.log`. 68 controls, 0 failed.
- Their suites, one after another, in the worktree that contains this `dist/`: `logs/suite.log`.

## Rebuild

**PASS.** `sha256sum` of `dist/MOONKATTY-AI-STUDIO-TEST-1.2.3-test-arm64-mac.zip` is `468d80404484fb23c5544153b166bb6653cc13a772439b195f31b00c6ed6c72d`. That is the claimed hash. The harness hashes the same file and records the same value (`logs/attack.log`). Size 169682325. `logs/BUILD-INFO.txt` records commit `a2a35c864755739a581d5a3c981a9feae3bb9b3d`, flavor test, bundle id `com.moonkatty.aistudio.test`, Electron 44.9.1, electron-builder 26.15.3, bundled Node v24.22.0, `SOURCE_DATE_EPOCH` 1792577754 (2026-10-21T10:15:54Z), ad-hoc, not notarized. The branch line says `HEAD` because the worktree was detached. That line is in `BUILD-INFO.txt`, which is outside the zip, and the zip hash still matches.

`git hash-object` of unpacked `server.js`, `lib/egress.js`, `lib/studio-config.js`, `lib/keystore.js`, and `runner.js` matches `a2a35c8` (and `79b7d58`, since those blobs did not change in the docs commit). `desktop/main.js` lives inside `app.asar`; extracting it and hashing it matches `a2a35c8:desktop/main.js` (`872b8e49e2b96bc2fc6b9ad1b9e99f2a7679f023`).

`Info.plist` `CFBundleIdentifier` is `com.moonkatty.aistudio.test`. `CFBundleName` is `MOONKATTY AI STUDIO TEST`. `CFBundleShortVersionString` is `1.2.3-test`. `ElectronAsarIntegrity` for `Resources/app.asar` is SHA256 `c9d4699788a2dab11170a2a014af1518b1ddf2568e5afe4132e7da02554f210b`, equal to SHA-256 of the asar header string from `app-builder-lib` `readAsarHeader`.

Fuses printed by `@electron/fuses` during the build (`logs/BUILD-INFO.txt`): RunAsNode disabled, cookie encryption enabled, NODE_OPTIONS disabled, inspect arguments disabled, embedded asar integrity enabled, onlyLoadAppFromAsar enabled, browser V8 snapshot disabled, GrantFileProtocolExtraPrivileges enabled, WasmTrapHandlers enabled. The arm64 app was not launched.

`find` of the built `.app` returned no `meta.js`. `@electron/asar` `listPackage` has 735 entries and no `/meta.js`.

## 1. Seal key in Keychain

**PASS.**

`lib/keystore.js` 43–48: account `publish-seal-key`, `secretSet` spawns `security` with argv `["-i"]` and sends `add-generic-password … -X <hex>` on stdin. There is no file or database fallback (`secretGet` returns null when `securityBin()` is null). `server.js` 49–57 reads that account, and on startup copies a legacy `meta.publishSealKey` into the Keychain when the value matches `/^[a-f0-9]{64}$/` and the account is empty, then `DELETE FROM meta`, `secure_delete`, `wal_checkpoint(TRUNCATE)`, `VACUUM`. `sealPublication` (`server.js` 60–67) throws `publication: disabled in TEST build` before it would create a key, and throws `Keychain недоступна` when `sealKey(true)` returns null.

Harness, fake `scripts/test-fixtures/fake-security.mjs`, `NODE_ENV=test` (the only way `STUDIO_TEST_SECURITY_BIN` is honored, `lib/keystore.js` 10):

- A v1-shaped database containing `meta.publishSealKey` and one row sealed with that key came up with `keySource:"keychain"`. The Keychain file’s `MOONKATTY AI STUDIO.test|publish-seal-key` entry matched the planted key. The key bytes were absent from `studio.db`, the WAL, the process stdout/stderr, and `GET /api/backup`. A second start did not write the row back.
- Argv log: 7 lines, none containing the key. The two writes are `["-i"]` and `["-i"]` (`logs/attack.log`). No `add-generic-password -w`.
- The sealed row stayed `published` after a title edit (HTTP 200). `PUT` of a new `externalId` returned HTTP 403 `published_internal_only`.
- The same shape with no `STUDIO_TEST_SECURITY_BIN`: the database copy of the key was deleted, the previously valid seal was rewritten to `pending_approval` with `historical_externalId` kept, and `POST /api/queue/:id/publish` returned HTTP 403 `publishing_disabled`.

Real macOS Keychain was not used. The account name, service name (`MOONKATTY AI STUDIO.test`), and stdin protocol were exercised through the fixture.

## 2. Legacy published rows

**PASS.** The earlier migrated v1-row attack does not keep the row published.

`looksPublished` is status `published`, or any `externalId`, `publication`, or `publishedAt` (`server.js` 74). `put()` throws `published_internal_only` when that shape fails `validSeal` (`server.js` 75–77). There is no `legacyPublished` exception. `demoteUnsealed()` runs at every start (`server.js` 91) and stores the old status, `externalId`, and `publishedAt` under `historical_*` (`server.js` 79–85). The HTTP error handler maps that code to HTTP 403 (`server.js` 511).

Harness, database with only `items` and `meta`, queue id `old-pub`, status `published`, `externalId` `5555566666`, `publishedAt` `2025-12-01T00:00:00Z`, task `QA-MIG-KEEP`, started with `STUDIO_FLAVOR=test` and `NODE_ENV=production`:

- `GET /api/queue/old-pub` is `pending_approval`, `historical_externalId` `5555566666`, `historical_status` `published`, `historical_publishedAt` `2025-12-01T00:00:00Z`, `externalId` absent.
- `PUT {title:"v1 title edit"}` is HTTP 200 and stays `pending_approval`.
- `GET /api/tasks/keep-me` is `QA-MIG-KEEP`.
- `pre-migration-v1-to-v4-2026-10-21T10-53-18-816Z.db` matches its `.sha256` sidecar (`logs/attack.log`).
- A row inserted with SQL into the live `studio.db` (`sql-pub`, status `published`, `externalId` `5555566666`) is still `published` on `GET` until the process restarts. `PUT {title}` on it is HTTP 403 `published_internal_only`. After restart, `GET` is `pending_approval` with `historical_externalId` `5555566666`, and a title edit stays `pending_approval`.

`POST /api/queue` with `status:"published"`, `externalId`, and a `publication` object is stored as `pending_approval` without those fields. `PUT` of `status:"published"` plus `externalId` is HTTP 403.

Their `test:publish-guard` records the same v1 migration (`logs/suite.log`).

## 3. Fail-closed flavor

**PASS** for the three-marker rule, for deleted markers, and for a flavor rewrite that does not also supply `meta.js`. The residual they described was reproduced and is rated **Low**.

`lib/studio-config.js` 19–36: if any of `lib/flavor.baked.js`, `lib/flavor.lock.json`, or `package.json` `studioFlavor` / `studioFlavorSha256` exists, all three must exist, the baked file must match the strict module shape, and both hashes must equal SHA-256 of the baked bytes. Otherwise `FLAVOR` is null and `server.js` 13 exits 78. With no markers, `STUDIO_FLAVOR` is read only when the path is a source checkout (`scripts/package-mac-on-linux.sh` present, not inside `.app/Contents`, not Electron). `NODE_ENV` is not read. There is no default flavor.

`desktop/flavor-guard.js` 6–16 compares the unpacked baked file, unpacked lock, and unpacked `package.json` to `desktop/flavor.lock.json` (packaged inside `app.asar`). A test lock with `meta.js` present in the unpacked tree returns `publisher module present in TEST build`. `desktop/main.js` 22–24 calls that check when `app.isPackaged` and exits 78 on mismatch. `meta.js` 10 throws unless `FLAVOR === 'prod'`. The packager adds `!meta.js` and drops `meta.js` from `asarUnpack` when `FLAVOR=test` (`scripts/package-mac-on-linux.sh` 28), then fails the build if any `meta.js` remains under `Resources/app`.

Independent results (`logs/attack.log`), on a tree placed under `Fake.app/Contents/Resources/app.asar.unpacked` and again on a copy of the built unpacked tree:

| Attempt | Result |
| --- | --- |
| Markers say test; `STUDIO_FLAVOR=prod`, `NODE_ENV=production`, `MK_FLAVOR=prod`, `FLAVOR=prod` | Flavor stays `test`, source `baked`, app id `com.moonkatty.aistudio.test` |
| Only `lib/flavor.baked.js` rewritten to `prod` | Exit 78, source `markers-disagree`. Flavor-guard: `unpacked markers do not match asar lock` |
| All three markers deleted, `STUDIO_FLAVOR=prod`, `NODE_ENV=production` and `NODE_ENV=test`, argv `--flavor=prod` | Exit 78 both times. Probe source `none` |
| All three markers rewritten to `prod`, `meta.js` removed | Exit 78, `модуль публикации недоступен` / `Cannot find module './meta.js'` |
| `STUDIO_FLAVOR` unset on the source checkout | `FLAVOR` null. `node server.js` exits 78 |
| Built app, flavor-guard on the untouched unpacked tree | `{ok:true, flavor:"test"}` |
| Baked file SHA-256 in the built app | `b0bf653f637435963c67bbb7bd323ed3877ff7389589c11bb9e66defced9472f`, same value in the unpacked lock, `package.json` `studioFlavorSha256`, and the asar `desktop/flavor.lock.json` |

Their `test:publish-guard` section E (bundle present) passed the same deleted-marker and rewritten-baked cases, including `NODE_ENV=test` (`logs/suite.log` lines 304–321).

**Residual, reproduced, Low.** Copy the built unpacked tree, write all three markers as a consistent `prod` set, copy in `meta.js`, run `node server.js` with `STUDIO_FLAVOR=test` and `NODE_ENV=production`. Health returned `"flavor":"prod"`, `"product":"MOONKATTY AI STUDIO"`. The same tree makes `flavor-guard` return `unpacked markers do not match asar lock`, so the Electron shell’s packaged check exits 78 before it starts the server (`desktop/main.js` 22–24). Doing this also means replacing files inside the ad-hoc `.app`. Asar integrity then fails for a forged `app.asar`, and this build is not notarized, so replacing the asar is enough to keep Electron from starting. The bypass is `node` on `server.js`, not the app icon and not an HTTP request. Rating: **Low** for the Mac mini test, provided the `.app` files are not replaced. It blocks any claim that this ad-hoc zip is tamper-proof without Developer ID and notarization. It does not by itself fail the test prerelease.

## 4. Their suite

**PASS** for the Linux runnable count. **462 was not run.**

`logs/suite.log`, Node v22.23.3, `STUDIO_SQLITE=node`, `dist/` from this rebuild present (so publish-guard section E ran):

| Suite | PASS | FAIL | Exit |
| --- | --- | --- | --- |
| test:security | 52 | 0 | 0 |
| test:runner | 5 | 0 | 0 |
| test:opencode | 51 | 0 | 0 |
| test:policy | 46 | 0 | 0 |
| test:video | 45 | 0 | 0 |
| test:publish-guard | 73 | 0 | 0 |
| test:isolation | 65 | 0 | 0 |
| test:3d | 0 | 0 | 2 |
| test:3c | 0 | 0 | 2 |
| test:e2e-test-build | 0 | 0 | 2 |
| **Runnable total** | **337** | **0** | |

PASS lines are `^PASS `. The three exits of 2 are `SKIP: opencode not found at /workspace/tools/oc/node_modules/.bin/opencode`. `/workspace/tools/oc` and `/workspace/tools/blender-5.2.2-linux-x64/blender` are absent. Their doc’s 53 + 61 + 11 = 125 were not executed. 337 + 125 = 462. The expected Linux number without those tools, 337, matches.

## 5. `POST /api/comments` with `status: approved`

**PASS for “does not bypass Approval Center sending” in the test build.** The stored status is a remaining **Low** issue.

Harness, test flavor: `POST /api/comments` with `status:"approved"` and a draft returned HTTP 201 and stored `approved`. `POST /api/comments/:id/reply` returned HTTP 403 `publishing_disabled`. A following `GET` was still `approved` with no `replyId`. The test middleware is `server.js` 185, registered before `meta.mountProtected()`, and the test process does not load `meta.js` (`server.js` 132–135). The reply route in `meta.js` 139–146, which would call Graph, is not mounted.

Their doc leaves this for v1.2.4. That matches what ran.

`PUT {status:"Published"}` on a queue row is stored as the string `Published`. It is a different status, it has no `externalId`, and the test publisher is not loaded. Info only.

## Isolation from v1.1.2

**PASS for the constants and for the prod-path refusal on Linux. NOT VERIFIED beside a live v1.1.2 install.**

`lib/studio-config.js` 49–59, confirmed by a probe with `STUDIO_FLAVOR=test` and `NODE_ENV=production` (`logs/attack.log`):

| Setting | Value |
| --- | --- |
| Product / data dir name | `MOONKATTY AI STUDIO TEST` |
| Bundle id | `com.moonkatty.aistudio.test` |
| Keychain service | `MOONKATTY AI STUDIO.test` |
| Port | 8687 |
| OpenCode | `http://127.0.0.1:4097` |
| launchd label | `com.moonkatty.aistudio.test.server` |
| `autoStartServer` | false |
| `checkUpdates` | false |

`Info.plist` on the rebuilt app carries the test bundle id and product name. Pointing `STUDIO_DATA_DIR` at `~/Library/Application Support/MOONKATTY AI STUDIO` under a fake `HOME` exits 78 with `PROD_PATH_REFUSED` (`logs/attack.log`). Case-insensitive APFS comparison is coded (`studio-config.js` 69) and was not executed on macOS. `test:isolation` is 65/65, including the new “NODE_ENV does not matter” check.

## Auto-publish

**PASS.** Test startup uses a stub whose `tick` returns `{disabled:true}` and does not load `meta.js` (`server.js` 132–135). The scheduler calls `meta.tick()` only when `CFG.IS_TEST` is false (`server.js` 526). `POST /api/queue` forces `pending_approval` (`server.js` 460–462). After login, queue creation, and the startup tick, no log row has source `publishing` (`logs/attack.log`). `POST /publish` is HTTP 403 `publishing_disabled`.

## Social egress

**PASS.** With `STUDIO_FLAVOR=test`, `policyFor` / `vet` on `https://graph.facebook.com/v19.0/me`, `https://graph.instagram.com/me`, and `https://api.telegram.org/botx/getMe` returned `blocked_url` and the injected resolver was called 0 times (`lib/egress.js` 14–15, 41–42). `PUBLIC_HOSTS` in that process was `api.github.com`, `ollama.com`, `registry.ollama.ai`. HTTP `POST /api/integrations/{meta-qa,ig-qa,tg-qa}/test` after storing those URLs returned HTTP 400 `blocked_url` for each. The log lines are source `integration:*` and describe the SSRF block. No socket to those hosts was opened by these checks.

## Automatic updates

**PASS. Automatic installation is absent. The automatic check is off in the test build.**

- `package.json` dependencies are `express`, `electron`, `electron-builder`, `playwright-core`, and optional `better-sqlite3`. `package-lock.json` has no `electron-updater` string.
- `desktop/main.js` has no `autoUpdater`, `setFeedURL`, or `electron-updater`. The copy inside `app.asar` is the same: those strings are absent, and `if (!manual && !c.checkUpdates) return;` is present (`desktop/main.js` 117–118). The extracted asar file matches the git blob.
- `Info.plist` has no `SUFeedURL` and no `SUEnableAutomaticChecks`.
- Test `checkUpdates` defaults to false (`lib/studio-config.js` 59, `desktop/main.js` 32). `setTimeout(() => checkUpdates(false), 5000)` (`desktop/main.js` 163) therefore returns immediately.
- The macOS menu item `Проверить обновления…` calls `checkUpdates(true)` (`desktop/main.js` 141). That path fetches `https://api.github.com/repos/moonkattymky/moonkatty-ai-studio/releases` and tells the user to download in a browser. The dialog text says automatic installation is not performed (`desktop/main.js` 113–134). `desktop.json` can set `checkUpdates` to true (`desktop/main.js` 35), which would enable the 5-second check. That check still does not download or replace the app.
- `Squirrel.framework` is present under `Contents/Frameworks/` because the macOS Electron build includes it. Nothing in `desktop/main.js` calls it, and the plist has no feed URL.

## Secrets in argv

**PASS** for the fake `security` binary. Writes of the master key and of `publish-seal-key` are argv `["-i"]` only. The seal hex was not in any argv line, in `studio.db`, in the WAL, in server stdout/stderr, or in `GET /api/backup`. `find-generic-password -w` is a read flag; the fixture prints the secret on that process’s stdout for the parent to read, and the argv log does not contain it. Do not run `-w` on the Mac.

## Remaining issues

1. **Low — local publisher bypass.** Rewrite `lib/flavor.baked.js`, `lib/flavor.lock.json`, and `package.json` `studioFlavor` / `studioFlavorSha256` so they agree on `prod`, add `meta.js`, and run `node server.js` on the unpacked tree. Health flavor becomes `prod`. `desktop/flavor-guard.js` still returns not ok against the original asar lock, so the Electron app should exit 78. Requires a local write and skipping Electron. Reproduced on the built tree (`logs/attack.log`).
2. **Low — `POST /api/comments` stores `status:"approved"`.** `server.js` generic POST (`server.js` 480–484) does not gate comment status. Test `/reply` is HTTP 403 and does not send. Left for v1.2.4 by their doc.
3. **Low — a published row written into the live database stays `published` on `GET` until the next start.** `demoteUnsealed` runs at startup (`server.js` 91), not on a timer. HTTP `PUT` of that row is 403. The next start demotes it and keeps `historical_*`. Requires a local SQLite write. HTTP cannot create the row.
4. **Info — `PUT {status:"Published"}` is stored as that string.** It is not status `published` and it has no `externalId`.
5. **Info — `Squirrel.framework` is in the zip and the manual update menu can query GitHub.** No feed URL, no `electron-updater`, no installer.

The v1.2.2 findings that this commit claimed to close — unsealed rows staying published across HTTP edits, the HMAC key living in `studio.db`, a one-file rewrite of `flavor.baked.js` changing flavor, and `meta.js` shipping inside the test zip — were re-tested and did not reproduce.

## Mac checklist for Igor

Linux already rebuilt the zip, matched the hash, checked the three markers, the missing `meta.js`, the asar header hash, the fuse list, HTTP publish refusal, the v1-row demotion, the Keychain stdin protocol against the fake `security`, and the prod-path exit 78 against a fake home. These still need a Mac:

1. `shasum -a 256` the zip. Expect `468d80404484fb23c5544153b166bb6653cc13a772439b195f31b00c6ed6c72d`.
2. Install only with `ditto` into `~/Applications/MOONKATTY AI STUDIO TEST.app`. Leave `/Applications/MOONKATTY AI STUDIO.app` in place. Open via System Settings → Privacy & Security → Open Anyway. Do not use `xattr` and do not turn Gatekeeper off. Do not replace files inside the `.app` (that is the residual above).
3. `curl -s http://127.0.0.1:8687/api/health` shows `"flavor":"test"` and product `MOONKATTY AI STUDIO TEST`. Port 8787 still belongs to v1.1.2. v1.1.2’s `studio.db` size and checksum stay as they were before the test app was opened.
4. Keychain items only under service `MOONKATTY AI STUDIO.test`. Expected accounts from normal use: `studio-master-key`, `opencode-server-password`. `publish-seal-key` should stay absent, because the test build refuses publication and creates that secret only inside `sealPublication`. `security find-generic-password -s "MOONKATTY AI STUDIO" -a studio-master-key` still describes the v1.1.2 item. Do not print secrets (`-w` writes the secret to the terminal).
5. During a Keychain write, `ps` shows argv `-i` only.
6. `launchctl print gui/$(id -u)/com.moonkatty.aistudio.test.server` is the test job. The prod label `com.moonkatty.aistudio.server` is unchanged. Data dir is `~/Library/Application Support/MOONKATTY AI STUDIO TEST/`. Logs are `~/Library/Logs/MOONKATTY AI STUDIO TEST/`.
7. Pointing the test server at the v1.1.2 data directory, including a different-case path on APFS, exits 78.
8. At launch the app should not request `api.github.com`. The 5-second check is off when `desktop.json` leaves `checkUpdates` unset or false. The menu item `Проверить обновления…` is the manual path. It does not install.
9. OpenCode on `127.0.0.1:4097` with the test Keychain password. A task write outside the sandbox directory is denied by `sandbox-exec`.
10. One Blender headless run from 3D Studio. Expect `scene.blend` and `preview.png`. This host did not run that.
11. Do not add a real Facebook, Instagram, or Telegram token. `POST /api/queue/:id/publish` and `POST /api/comments/:id/reply` should stay HTTP 403 `publishing_disabled`.

## Not verified here

- macOS Keychain, launchd, Gatekeeper, `sandbox-exec`, and a real Electron process running `flavor-guard` (the module was executed from the extracted asar on Linux).
- `test:3d` (53), `test:3c` (61), `test:e2e-test-build` (11).
- A real publication seal. The test build refuses it, and no platform token was used.
