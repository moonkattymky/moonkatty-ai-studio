# Final security recheck — v1.2.2-test @ 7327a1e

Target: branch `feat/v1.2.2-test-isolated`, commit `7327a1ebec7f5d62e1d3ea176f1886e8630e24af`. Tag `v1.2.2-test` points at that same SHA. The branch was read in a detached worktree. Nothing on it was modified. Nothing was merged and nothing was published. Passwords in the tests are fake. No call was made to Meta, Facebook, Instagram, or Telegram.

Prerelease: https://github.com/moonkattymky/moonkatty-ai-studio/releases/tag/v1.2.2-test (prerelease, not a draft). Assets include `MOONKATTY-AI-STUDIO-TEST-1.2.2-test-arm64-mac.zip`, `MAC_TEST_ISOLATED.md`, and `SECURITY_RECHECK_v1.2.2-test.md`. The same two docs are in the commit under `docs/`.

## Conclusions

**Mac mini, OpenCode + Blender testing:** allowed for this isolated test app only, after Igor's checklist below. The zip is the TEST build (port 8687, its own data directory, publisher not loaded). This Linux host has neither the suite's OpenCode binary nor Blender, so that end-to-end path was not run here.

**Real social accounts:** not allowed. The running test build returns 403 for `/publish` and `/reply`, and `graph.facebook.com`, `graph.instagram.com`, and `api.telegram.org` are rejected by the integration allowlist before any connection.

**What still blocks a full launch:**

1. This artifact is the test build. `lib/flavor.baked.js` in the zip is `'test'`. It is not a production publisher.
2. A queue row that is already stored as `published` with an `externalId` and no `publication` object is treated as a legacy row (`server.js` 57–62). A migrated v1 database kept such a row, and a later HTTP title edit left it `published`. A direct write to `studio.db` does the same. HTTP POST/PUT cannot create that shape.
3. The HMAC key is `meta.publishSealKey` inside the same `studio.db`. A local reader of that file can build a seal that `put()` accepts. No HTTP route accepts the seal.
4. Mac Keychain, launchd, Gatekeeper, and `sandbox-exec` were not executed. `test:3d`, `test:3c`, and `test:e2e-test-build` exited 2 because `opencode` and `blender` are absent on this host.

## Release zip

| Check | Result |
| --- | --- |
| SHA-256 of the zip | **PASS.** `sha256sum` equals `ba759a217c919ba729f30c39c0783a533324c467d7aef13f6b52e133adb58832`. The `.sha256` asset and the GitHub asset digest are the same value. Size 169686627. |
| Built from `7327a1e` | **PASS.** Tag and `BUILD-INFO.txt` both say `7327a1ebec7f5d62e1d3ea176f1886e8630e24af`, branch `feat/v1.2.2-test-isolated`. `git hash-object` of packaged `server.js`, `meta.js`, `lib/egress.js`, `lib/studio-config.js`, `lib/keystore.js`, and `runner.js` matches that commit. `MANIFEST.sha256`: 857 files, 0 mismatches against the unpacked app. Packaged `package.json` differs on purpose: the packager sets `studioFlavor` and `productName`. |
| `studioFlavor` | **PASS.** Unpacked `package.json` has `"studioFlavor": "test"` and `"productName": "MOONKATTY AI STUDIO TEST"`. |
| Bundle id | **PASS.** `Info.plist` `CFBundleIdentifier` is `com.moonkatty.aistudio.test`. `CFBundleName` is `MOONKATTY AI STUDIO TEST`. |
| Baked flavor | **PASS.** `app.asar.unpacked/lib/flavor.baked.js` is `module.exports = 'test'`. |
| Publisher | **PASS for the running test process.** A `require` hook on the packaged tree loaded zero `meta.js` modules while flavor was test (`logs/attack.log`). **The file is still in the bundle** (`app.asar.unpacked/meta.js`, same blob as the commit). The test process does not load it. Editing `flavor.baked.js` to `'prod'` on a copy of that tree did load `./meta.js`. |
| Egress allowlist | **PASS on the test process.** `POST /api/integrations/meta/test` with URL `https://graph.facebook.com/v19.0/me` returned HTTP 400 `blocked_url` (`Хост graph.facebook.com не входит в список известных интеграций`). Instagram and Telegram hosts did the same. `lib/egress.js` lines 14–15 add `SOCIAL_HOSTS` only when `IS_TEST` is false. Those three names remain in the source so the prod flavor can list them. |
| ASAR integrity | **PASS for the header hash.** `Info.plist` `ElectronAsarIntegrity` SHA256 is `2f682ec7cb6b39b6c083916c271be287d5262bfa839880d82b0db766387dc210`. `app-builder-lib` `readAsarHeader` + SHA-256 of that header equals it. |
| Fuses | **PASS for the bytes in `Electron Framework`.** Sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`, version 1, length 9, wire `010011011`. That is RunAsNode off, cookie encryption on, NODE_OPTIONS off, inspect off, asar integrity on, onlyLoadAppFromAsar on, browser V8 snapshot off, GrantFileProtocolExtraPrivileges on, WasmTrapHandlers on. `BUILD-INFO.txt` prints the same nine lines, including `WasmTrapHandlers is Enabled`. The arm64 app was not launched. |

`BUILD-INFO.txt`: flavor test, bundle `com.moonkatty.aistudio.test`, Electron 44.9.1, electron-builder 26.15.3, bundled Node v24.22.0, ad-hoc, not notarized, built on Linux. `file` on the main binary and `Resources/node/node` reports Mach-O arm64.

## 1. Can any HTTP route set `published` / `externalId`? Is the seal unforgeable?

**HTTP on every flavor that was started: PASS (cannot set them).** **The seal is not unforgeable for someone who can write `studio.db`: FAIL.**

Harness `attack.mjs`, log `logs/attack.log`, 79 controls, 0 failed. Servers: source tree with `NODE_ENV=test` and `STUDIO_FLAVOR=test` (port 8911), the same tree with `STUDIO_FLAVOR=prod` (8912), and the packaged unpacked `server.js` with `NODE_ENV=production`, `STUDIO_FLAVOR=prod`, and argv `--flavor=prod --prod` (8913).

On all three:

- Unauthenticated `POST /api/queue` is HTTP 401.
- `POST` with `status:"published"`, `externalId`, or `publication` is stored as `pending_approval` with those fields absent (`server.js` 439–443 and `PROTECTED` at 431).
- `PUT` of `status:"published"`, of `externalId`, or of a `publication` object (including one whose HMAC matches the database key) is HTTP 403 `published_internal_only`.
- `PATCH` is HTTP 404.
- Packaged `POST /api/queue/:id/publish` is HTTP 403 `publishing_disabled`. The prod-flavor source route is mounted and returned HTTP 400 `Нужно утверждение` on a row that was not `approved`. The row did not become `published`. No Graph call was made: `meta.js` `publish()` reaches `graph()` only after `blockReason` (`meta.js` 154–168) and a workspace token.

`sealPublication` (`server.js` 48–53) accepts caller `'meta-publisher'` only, and only a Facebook id `^\d{5,32}(_\d{5,32})?$` or an Instagram id `^\d{5,32}$`. The seal is HMAC-SHA256 over `id|platform|responseId|at|callerModule`. The key is created on first use and stored as hex in `meta.publishSealKey` (`server.js` 45). It is 64 hex characters. `GET /api/backup` (13414 bytes in this run) did not contain it.

What a local database writer can do:

- Insert `{status:"published", externalId:"123456789012"}` with no `publication`. `GET` returns it. `PUT {title}` returns HTTP 200 and leaves `status:"published"`. That is `legacyPublished` (`server.js` 57–62): the row was already published, the `externalId` is unchanged, and there is no seal. The same thing happened to a v1-shaped database seeded with queue id `old-pub` before migration: after upgrade, `GET` was `published` and a title edit stayed `published` with `externalId` `5555566666` and no `publication`.
- Insert a `publication` whose seal was computed from `publishSealKey` in that same file. `PUT {title:"renamed-by-http"}` returned HTTP 200 and kept `status:"published"`. A wrong seal on that shape returned HTTP 403 `published_internal_only`.

So an HTTP client cannot forge the seal. A process that can read and write `studio.db` can, because the key lives in that file, and because a row with no `publication` object skips the HMAC entirely.

`PUT {status:"Published"}` is stored as the string `Published`. It is not the status `published`, it has no `externalId`, and `/publish` on the prod flavor still answered `Нужно утверждение`.

## 2. Restore

**PASS** for demotion, inert `historical_*`, traversal, and the pre-restore hash. On both source flavors (`logs/attack.log`):

- One-step restore with a `data` body: HTTP 400 `confirm_required`. Wrong `confirm`: HTTP 400. Reused token: HTTP 403.
- A forged queue row (`status:"published"`, `externalId`, `publication` with a fake seal, id `../outside`) was stored as `pending_approval` with `externalId`, `publishedAt`, and `publication` removed, and `historical_status:"published"` (`server.js` 182–186).
- A row that arrived with `historical_status:"draft"` and `historical_externalId:"should-stay"` kept those values. `PUT` of new `historical_*` values left them unchanged (`PROTECTED`, `server.js` 431). Status stayed `pending_approval`.
- A `rejected` row with no `externalId` stayed `rejected`.
- No file named `outside` appeared outside the data directory. The id is a SQLite key.
- `pre-restore-*.db` matched its `.sha256` sidecar.

The incoming JSON has no separate signature. The server holds it in memory behind a one-time token, then snapshots SQLite before replacing collections.

## 3. Flavor override and exit 78

**PASS** for the shipped files. **A local edit of the unpacked bake file changes the flavor.**

From the packaged tree (`logs/attack.log`):

| Attempt | Result |
| --- | --- |
| `STUDIO_FLAVOR=prod` with `NODE_ENV=production` or `NODE_ENV=test` | `test\|baked\|com.moonkatty.aistudio.test\|8687\|MOONKATTY AI STUDIO.test\|com.moonkatty.aistudio.test.server` |
| `MK_FLAVOR=prod`, `FLAVOR=prod` | same |
| `--flavor=prod --prod` on `server.js`, and the same strings pushed into `process.argv` | flavor stayed `test`. Health: `{"flavor":"test","product":"MOONKATTY AI STUDIO TEST","version":"1.2.2-test"}` |
| `desktop.json` `{"flavor":"prod","studioFlavor":"prod"}` | source stayed `baked` |
| Delete `flavor.baked.js`, leave `studioFlavor:"test"` | source `package.json`, flavor `test` |
| Delete both, `NODE_ENV=production`, `STUDIO_FLAVOR=prod` | exit 78, source `none` |
| Invalid `module.exports = 'staging'` | exit 78, source `baked-invalid`, env does not rescue |
| Source checkout (no bake file), `NODE_ENV=production`, `STUDIO_FLAVOR=test` | exit 78 |
| `STUDIO_DATA_DIR` inside a fake `Library/Application Support/MOONKATTY AI STUDIO/` | exit 78 `PROD_PATH_REFUSED` |

`lib/studio-config.js` lines 14–18: a valid `flavor.baked.js` is final. Env is consulted only when no bake file and no `studioFlavor` key exist, and only when `NODE_ENV=test` on plain Node. Deleting both markers and setting `NODE_ENV=test` `STUDIO_FLAVOR=prod` reported `prod|env(dev)`. `desktop/service.js` lines 14–15 launches the server with `NODE_ENV=production`.

Writing `module.exports = 'prod'` into the unpacked `lib/flavor.baked.js` made that process load `./meta.js`. The file was restored to `'test'` after the probe. That file lives under `app.asar.unpacked/`. The asar header hash covers `app.asar`. It does not cover the unpacked copy the server actually runs.

## 4. No network path to social APIs in the test build

**PASS** for the process that was run.

- Test flavor does not `require('./meta.js')` (`server.js` 109–111). The hook log was empty.
- `/api/queue/:id/publish` and `/api/comments/:id/reply` return 403 `publishing_disabled` before `meta.mountProtected` (`server.js` 161).
- `server.js` 504 skips `meta.tick()` when `CFG.IS_TEST`.
- Integration test of the three social hosts returned `blocked_url` without a connect (`lib/egress.js` `policyFor` returns before `vet`'s DNS lookup when the host is not in `PUBLIC_HOSTS`).

`meta.js` is on disk in the test zip, so the Graph client source is present. The test process does not load it.

## 5. Isolation from v1.1.2

**PASS for the constants in the build. NOT VERIFIED on a Mac beside a live v1.1.2 install.**

Packaged `studio-config` probe and `release-manifest.json`:

| | v1.1.2 / prod constants | this zip |
| --- | --- | --- |
| Bundle id | `com.moonkatty.aistudio` | `com.moonkatty.aistudio.test` (`Info.plist`) |
| Keychain service | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO.test` |
| Data dir name | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO TEST` |
| launchd label | `com.moonkatty.aistudio.server` | `com.moonkatty.aistudio.test.server` |
| Server port | 8787 | 8687 |
| OpenCode URL | `127.0.0.1:4096` | `127.0.0.1:4097` |

No Keychain item was created and no LaunchAgent was loaded. The prod-path guard exit 78 is in section 3. `scripts/isolation-test.mjs` also reported the production data dir byte-for-byte unchanged (64/64, `logs/suite.log`).

## Secrets in argv

**PASS** for the spawn sites that were executed with the fake `security` binary.

`lib/keystore.js` 21–23 and `lib/opencode-auth.js` 34–36 send `add-generic-password` on stdin of `security -i`. The argv log from `loadKey` was `["-i"]` and `find-generic-password ... -w`. `-w` is a flag. The secret was not an argv element. `lib/blender.js` uses `shell: false` and an env of `PATH`, `HOME`, `LANG`, `TMPDIR`. `desktop/service.js` 27 puts `ProgramArguments` as the node binary and `server.js` only. A live `ps` of macOS `security` was not captured.

## OpenCode seatbelt

**Source PASS. Runtime NOT VERIFIED.**

`runner.js` 39–40 allow writes to the task directory, `tmpDir(dir)` (`<sandbox>/.tmp`), `/dev/null`, and `/dev/tty`. The code half of that allow line does not list `/private/tmp` or `/private/var/folders`. `sandbox-exec` was not run.

## Backup before migration

**PASS.** A v1-shaped database (tables `items` and `meta` only, task `QA-MIG-KEEP`) opened by this server wrote `pre-migration-v1-to-v4-2026-10-21T10-00-49-798Z.db` whose bytes match the `.sha256` sidecar. `GET /api/tasks/keep-me` returned `QA-MIG-KEEP`. `lib/db-backup.js` `backupBeforeMigration`, called from `server.js` 26 before `openDb` of the main file.

## Their test suite

The committed doc `docs/SECURITY_RECHECK_v1.2.2-test.md` says **426/426**, with `test:publish-guard` at 38/38 because no `dist/` bundle was present. The user message says 429/429. With the release asar linked at `dist/mac-arm64/`, `test:publish-guard` is **41/41** (the three bundle checks). 38+3=41, and 426−38+41=429. That 429 count also includes `test:3d` 53, `test:3c` 61, and `test:e2e-test-build` 11.

| Suite | This host |
| --- | --- |
| test:policy | **46/46** exit 0 |
| test:video | **45/45** exit 0 |
| test:runner | **5/5** exit 0 |
| test:security | **52/52** exit 0 |
| test:opencode | **51/51** exit 0 |
| test:publish-guard | **41/41** exit 0 |
| test:isolation | **64/64** exit 0 |
| test:3d, test:3c, test:e2e-test-build | **NOT VERIFIED.** Each exited 2: `opencode` missing at `/workspace/tools/oc/node_modules/.bin/opencode`. Those scripts also require Blender at `/workspace/tools/blender-5.2.2-linux-x64/blender`. |

Executed assertions: 304, failed 0 (`logs/suite.log`). The 125 assertions in the three skipped suites were not run, so 429/429 was not reproduced here.

## Remaining issues

1. **Medium — legacy published rows skip the seal.** `server.js` 57–62. A v1 row and a direct SQLite insert of `status:"published"` plus an `externalId` and no `publication` stay published, and HTTP can edit other fields. Restore does demote that shape. HTTP POST/PUT cannot create it.
2. **Low — HMAC key is in the database it protects.** `server.js` 45. `publishSealKey` is random, absent from `/api/backup`, and useless to an HTTP client (PUT of a valid seal is still 403). Anyone who can read `studio.db` can compute a seal that a later `put()` will accept.
3. **Low — `POST /api/comments` stores `status:"approved"`.** Seen on the test flavor and the prod flavor. On the test flavor `/reply` is 403 `publishing_disabled`, so the row was not sent.
4. **Low — unpacked `lib/flavor.baked.js` can be rewritten.** The shipped file is `'test'`. Replacing it with `'prod'` made the process load `meta.js`. Asar integrity matches the asar header and does not hash that unpacked file. `NODE_ENV=production` with both bake markers removed exits 78.
5. **Info — `meta.js` is shipped inside the test zip** and is not loaded while the bake file says `test`.

## Mac checklist for Igor

Linux already checked the zip hash, the bake file, the fuse wire, the asar header hash, HTTP publish refusal, restore demotion, and the prod-path exit 78 against a fake home. These still need a Mac:

1. `shasum -a 256 -c` on the zip. Expect `ba759a217c919ba729f30c39c0783a533324c467d7aef13f6b52e133adb58832`.
2. Install only with `ditto` into `~/Applications/MOONKATTY AI STUDIO TEST.app`. Leave `/Applications/MOONKATTY AI STUDIO.app` in place. Open via System Settings → Privacy & Security → Open Anyway. Do not use `xattr` and do not turn Gatekeeper off.
3. `curl -s http://127.0.0.1:8687/api/health` shows `"flavor":"test"`, product `MOONKATTY AI STUDIO TEST`. Port 8787 still belongs to v1.1.2. v1.1.2's `studio.db` size and checksum stay as they were before the test app was opened.
4. Keychain: new items only under service `MOONKATTY AI STUDIO.test` (accounts `studio-master-key`, `opencode-server-password`). `security find-generic-password -s "MOONKATTY AI STUDIO" -a studio-master-key` still describes the old item. Do not print secrets (`-w` dumps the secret to the terminal).
5. `launchctl print gui/$(id -u)/com.moonkatty.aistudio.test.server` is the test job. The prod label `com.moonkatty.aistudio.server` is unchanged. Data dir is `~/Library/Application Support/MOONKATTY AI STUDIO TEST/`.
6. Pointing the test server at the v1.1.2 data directory, including a different-case path on APFS, exits 78.
7. OpenCode: `MK_FLAVOR=test` serve on `127.0.0.1:4097` with the test Keychain password. `ps` during `security -i` shows argv `-i` only. A task write outside the sandbox directory is denied by `sandbox-exec`.
8. Blender: one headless template run from 3D Studio. Expect `scene.blend` and `preview.png` with SHA-256, and the task waiting for approval. This host did not run that.
9. Do not add a real Facebook, Instagram, or Telegram token. `POST /api/queue/:id/publish` should stay HTTP 403 `publishing_disabled`.
