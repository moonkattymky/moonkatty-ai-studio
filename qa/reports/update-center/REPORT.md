# Update Center review — feat/update-center @ 9ffad98

Target: `origin/feat/update-center`, HEAD `9ffad98cd8ceae7d94ad82a7aeb44bbfa8c70a7a`. The tree was read in a detached worktree at `/tmp/mk-update`. `git status --porcelain` there was empty before the tests and empty after them. Nothing on that branch was modified. Nothing was merged and nothing was published. The only password in the tests is `fake-password-123`. No call was made to Meta, Facebook, Instagram, or Telegram. One authenticated `POST /api/ops/update-center/check` did call the public GitHub releases API for `moonkattymky/moonkatty-ai-studio`.

Package version on this commit is `1.1.2`. Docs live at `docs/ops/UPDATE_CENTER.md` and `docs/ops/UPDATE_CENTER_MAC_TEST.md`.

## Verdict

**Do not include this Update Center in a working version yet.**

The pinned key is a placeholder, so a real GitHub release stays unverified and the download API refuses it. Auto-install stays off unless four environment flags are set, and on Linux it then refuses with `NOT_MAC`. That fail-closed behavior held. The design still has one production identity and one signing key, accepts symlink entries, does not hash the zip again at install time, lets the Electron shell check GitHub five seconds after launch, and does not apply `schemaCheck`'s support cap to the install gate.

Gatekeeper, quarantine, `ditto` on macOS, `launchd`, Keychain, and notarization were **not verified**. This machine is Linux.

## Conditions before inclusion

1. Give test and production different bundle ids, data directories, launchd labels, Keychain prefixes, and signing keys. The running app's identity has to come from the build, and the channel has to be checked against that identity.
2. Reject symlink entries, or extract them as links and refuse any target that leaves the archive. Path traversal is already rejected.
3. Recompute SHA-256 at install time and bind owner approval to the signed manifest bytes, not only to the tag string.
4. Make `schemaCheck`'s supported version the same check the gate uses. A database the running code calls unsupported must stay blocked. A manifest schema older than the live database already stays blocked.
5. Remove the five-second `checkUpdates(false)` call. Keep a check only on the menu item and on the Update Center button.
6. Put a key id in the signature, load an explicit set of keys, and ship a revocation list. Replacing the pem file in a later build is the only revocation that exists today.
7. Require a Developer ID signature and a successful `spctl` assessment before any auto-install. Leave quarantine in place. A zip written by Node does not receive `com.apple.quarantine`, so Gatekeeper may never see the extracted app. That path was not run on a Mac.
8. Rehearse backup, schema migration, `.app` swap, and rollback on the Mac mini. The Linux backup restore below succeeded. The `.app` swap did not run.
9. Drop `rm -rf` from `update.plan` rollback text. The steps the panel shows already avoid it. The API still returns it as `legacy`.

## How this was checked

- Their suite, from the worktree, Node v22.23.3, `STUDIO_SQLITE=node`: `node --test test/ops/update-center.test.js test/ops/update.test.js test/ops/update-center.integration.test.js`. Log: `logs/their-tests.log`. **35 pass, 0 fail**, `duration_ms` 760.214373, exit 0.
- Independent harness: `node qa/reports/update-center/attack.mjs` with `UC_SRC=/tmp/mk-update`. Log: `logs/attack.log`. Machine-readable rows: `logs/attack.json`. **69 controls, 0 failed.**

```text
{"commit":"9ffad98cd8ceae7d94ad82a7aeb44bbfa8c70a7a","controls":69,"failed":[]}
```

Their tests already cover the URL allowlist, a bad signature, a downgrade, hash mismatch, resume, path traversal, isolated versus partial identity, the auto-install flag, and a real backup. They assert `inspectZip` reports `symlinks === 1` and `ok` for a zip that contains a symlink. They stub `schemaCheck` to `{ ok: true }` in the compat test, so they do not see the support cap. The probes below are the cases that suite does not close.

## Findings

### High — one identity and one key, so a test channel can replace production

`lib/ops/update-center.js` line 17 sets `CURRENT_IDENTITY` to `com.moonkatty.aistudio`, data directory `MOONKATTY AI STUDIO`, launchd `com.moonkatty.aistudio.server`, and Keychain prefix `MOONKATTY AI STUDIO`. `createUpdateCenter` has no identity argument. `status().identity` returned that object. `lib/ops/index.js` lines 53–54 construct the center with `current: ctx.version` only.

`gate` (lines 122–126) compares `bundleId`, `dataDirName`, `launchdLabel`, and `keychainServicePrefix`. `channel` is not in that list. A manifest with `channel: "test"` and those four production ids, version `1.3.3`, verified signature, backup, and owner approval produced `mode: "replace"` and a step that moves `/Applications/MOONKATTY AI STUDIO.app`.

A partial overlap (test bundle id, test launchd, test Keychain prefix, production data directory) stayed blocked: `идентичность сборки частично совпадает`. A fully isolated manifest (`isolated: true`, all four ids different, `isolatedFrom` containing the installed bundle id) was `side-by-side` with `approved: false`. Calling `gate` with an installed test identity and a production manifest stayed blocked, and the product never passes that installed identity: the constant is production.

`loadKeys` (line 53) reads `lib/ops/update-keys/release-ed25519.pub.pem` unless the caller passes files. `verifySig` (lines 55–58) returns success when any loaded key verifies. A signature from a second key was rejected by the placeholder and accepted when that key was added beside another key. There is no per-channel key and no revocation list. `keyId` is the first 16 hex digits of the SPKI SHA-256, computed after verification. It is not inside the signature.

The committed key is a placeholder. `lib/ops/update-keys/README.md` says the private half was discarded. The directory contains no private key. A manifest signed by a test key failed `verifySig` against the placeholder (`подпись не прошла проверку закреплённым ключом`). Until that file is replaced, GitHub releases stay unverified. After it is replaced with one production key, the test-channel case above becomes a real replace.

### Medium — symlink entries are verified and would be extracted with ditto

`inspectZip` (lines 106–110) increments `symlinks` when the Unix mode is a symlink and sets `ok` from the problem list only. A stored zip with `MOONKATTY AI STUDIO.app/Contents/Info.plist` and `MOONKATTY AI STUDIO.app/Contents/MacOS/escape` pointing at `/etc/passwd` returned `ok: true`, `symlinks: 1`.

`../outside.txt`, `/tmp/abs.txt`, and `..\\outside.txt` were rejected (`опасный путь в архиве`). Download of the traversal zip threw `BAD_ARCHIVE` and left no `.partial` and no final file.

Download of the symlink zip returned `status: "verified"`, `zip.symlinks: 1`. With the four readiness flags, platform `darwin`, and `dryRun: true`, `autoInstall` returned:

```text
/usr/bin/ditto -x -k <verified.zip> /Applications
```

`ditto` was not executed. A symlink created in a temp directory with that target resolved to `/etc/passwd`, outside the extract root. `manifest.notarized: false` and `signing: "none"` still passed `validateManifest` and the gate. The gate does not read those fields.

### Medium — the verified zip is not hashed again, and approval sticks to the tag

`download` hashes the bytes once (lines 232–235) and stores `status: "verified"` and `file`. `installPlan` (lines 266–268) allows the plan when that status is `verified`. It does not open the file. `autoInstall` (line 288) passes `D.file` to `ditto`.

The harness downloaded a signed zip (`sha256` `56cffa44f85d…`), overwrote it (`4f14f5b7a2af…`), and called `installPlan`. `allowed` stayed true. The dry-run `ditto` command pointed at the replaced file.

`approve` (line 280) stores `S.approvals[tag]`. A second `check` of a newly signed manifest for the same tag `v1.3.0` kept `approved: true` while `assets[0].sha256` changed to the new zip. There is no manifest expiry. A signed release from `publishedAt` `2020-06-01` with version `1.2.5` against current `1.2.0` stayed eligible on version alone. The same check blocked `1.1.9` and `1.2.0` with `версия … не новее текущей`. A second check of the same signed bytes stayed `verified`. `cmpVer` (line 23) ignores the pre-release suffix, so tag `v1.3.0-test` verified against manifest version `1.3.0`.

A flipped signature byte and a flipped manifest byte both failed verification. Download of the tampered manifest threw `UNVERIFIED`.

### Medium — the Electron shell checks GitHub five seconds after launch

`desktop/main.js` line 23 defaults `checkUpdates` to true. Line 109 returns immediately only when the call is automatic and the saved config turned the check off. Line 154 is `setTimeout(() => checkUpdates(false), 5000)`. The function fetches `https://api.github.com/repos/moonkattymky/moonkatty-ai-studio/releases`, compares a `.sha256` asset with GitHub's digest, and may open the release page. The comment on line 104 says it never downloads or installs. The file contains no `autoUpdater` and no `Squirrel`. `package.json` has no `electron-updater` dependency.

`lib/ops/update-center.js` has no `setInterval`. `lib/ops/index.js` does not schedule `check`. `public/update-ui.js` shows the card after `GET /api/ops/status` and posts to `/api/ops/update-center/check` from the `#ucCheck` button.

On this branch the menu still contains `Проверить обновления…` (`desktop/main.js` line 132). That item calls `checkUpdates(true)`. The timer does not.

`electron-builder` is configured with `identity: null`, `hardenedRuntime: false`, and `gatekeeperAssess: false` (`package.json` `build.mac`). No `.app` was built for this commit, so Squirrel.framework inside an Electron Framework binary was not checked here. The v1.2.4 package, which this review does not approve, did contain that framework. Nothing in this tree sets a Squirrel feed URL.

### Medium — the schema support cap does not block the gate

`lib/ops/update.js` line 7 sets `SUPPORTED_SCHEMA = 1`. `schemaCheck` (lines 39–42) returns `ok: false` when the detected version is outside `1..1`. `detectSchemaVersion` (lines 59–65) reads `meta.schemaVersion` or infers 3 when `jobs.input` exists.

A jobs table with an `input` column and no meta version produced `schemaCheck.ok === false`, `schemaVersion === 3`, `supported === 1`. `compatCheck` (`update-center.js` lines 140–148) does not read `schema.ok`. With `dbSchemaVersion: 3` it returned `ok: true` (`схема без изменений (3, определена по таблицам)`). `gate` then returned `mode: "replace"`. A manifest `dbSchemaVersion: 99` against detected version 4 returned `migration: true`. A manifest schema of 1 against detected version 3 stayed blocked (`схема релиза (1) старше текущей (3)`).

Their compat test stubs `schemaCheck` to `{ ok: true }`, so this gap is outside that assertion.

The center does not run SQL migrations. The new app would. Rollback of the database is a backup restore into an empty directory. That path was executed on Linux and is described under question 3.

### Low — the legacy plan still tells the operator to rm -rf

`lib/ops/update.js` lines 52–53 put `rm -rf "/Applications/MOONKATTY AI STUDIO.app"` in `plan().rollback`. `installPlan` returns that array as `legacy` (line 278). The steps and the `rollback` array shown by `public/update-ui.js` do not contain `xattr`, `spctl --master-disable`, or `rm -rf`. The HTTP rollback route (`lib/ops/protected.js` line 71) calls `U.rollback({ dryRun: true })` even when the body says `dryRun: false`. The live response was `dryRun: true` and listed `launchctl` and `mv` only. A direct `rollback({ dryRun: false })` on Linux threw `NOT_MAC` and did not call `exec`.

### Low — the health check URL is not on the GitHub allowlist

`healthCheck` (lines 260–264) calls `fetchImpl(url)` with `healthUrl`. `lib/ops/index.js` line 54 sets that from `OPS_UPDATE_HEALTH_URL` or `http://127.0.0.1:${PORT}/api/health`. `assertUrl` is not used. A center built with `http://169.254.169.254/latest/meta-data/` fetched that URL. The same helper rejects that host for a GitHub download (`URL_NOT_ALLOWED` / `REDIRECT_NOT_ALLOWED` / `NOT_HTTPS`). Setting the variable requires control of the server environment.

`assertUrl` rejected `http://`, `https://169.254.169.254/`, `https://127.0.0.1/`, userinfo, a foreign repo, and a non-443 port. A redirect from a GitHub release URL to `http://169.254.169.254/` threw `NOT_HTTPS`.

### Low — codesign success is reported on Linux, and Gatekeeper failure is still ok

`verifySignature` (line 33) on a non-darwin platform records `codesign` as `ok: true` with `info: true`. The harness observed that. On darwin, the `spctl` catch (line 36) also records `gatekeeper` as `ok: true` and sets `r.gatekeeper = 'rejected'`. `fin` treats every `ok` check as success, so a Gatekeeper rejection does not fail the report. `autoInstall` runs `codesign --verify --deep --strict` and does not run `spctl`. An ad-hoc signature can satisfy `codesign --verify`. This was not executed on macOS.

## Attacks that were refused

| Attack | Result |
| --- | --- |
| Tampered manifest or flipped signature | `verified: false`, download `UNVERIFIED` |
| Signed `1.1.9` and signed `1.2.0` against current `1.2.0` | gate blocked, `не новее` |
| Zip slip `../outside.txt`, absolute path, backslash | `BAD_ARCHIVE`, file removed |
| Partial bundle identity | gate blocked, `частично совпадает` |
| Production manifest evaluated against a test install | gate blocked |
| `STUDIO_OPS_UPDATE` unset | live `GET /api/ops/update-center` **404** |
| No session | **401** |
| Cookie, no `X-Studio-Request` | **403** CSRF |
| `Origin: https://evil.example` | **403** |
| `Sec-Fetch-Site: cross-site` | **403** |
| Session cookie | `HttpOnly; SameSite=Strict` |
| `POST …/v9.9.9/auto-install` with `dryRun: false` and flags unset | **400** `AUTO_INSTALL_DISABLED` |
| `POST …/rollback` with `dryRun: false` | **200**, body `dryRun: true` |
| Approve with the wrong password | **403** |
| Auto-install on Linux with all four flags | `NOT_MAC`, `exec` not called |
| Authenticated check | **200**, `/Applications/MOONKATTY AI STUDIO.app` still absent |

`POST /api/ops/update-center/:tag/download` answers **202** before `download()` finishes (`lib/ops/protected.js` lines 64–65). A missing tag fails in the log after that response. It does not install.

`lib/ops/security-center.js` `classify` does not list update routes. Approve has its own password check (protected.js line 69). The other update routes rely on the owner session and the CSRF header. There is no second password on download or on check.

A loopback `X-Studio-App-Token` read `GET /api/ops/update-center` with **200** and `current: "1.1.2"`. That token is the desktop file `app-token`, mode `0600`. It is the same local trust the panel already uses.

## Studio questions

### 1. Where the signing key lives, and how it rotates without an Apple Developer ID

The public key that verifies `release-manifest.json.sig` is `lib/ops/update-keys/release-ed25519.pub.pem`. The README in that directory says the private half was discarded at generation, and a rotation is a reviewed commit that replaces the file. `docs/ops/UPDATE_CENTER.md` section 8 says to generate Ed25519 on an offline Mac, keep the private key on encrypted media and in a safe, and to sign in GitHub Actions only from an environment that requires a manual approval, or to sign offline and upload the `.sig`.

The code loads that one file. `verifySig` accepts any key in the array it was given, so an overlap of two files would accept both. Nothing in the signature names a key id, and there is no revocation list. An older build that still contains the old pem keeps trusting manifests that key signed. Apple Developer ID is a separate signature on the `.app`. It is not this Ed25519 key. This commit does not have a Developer ID (`identity: null`).

### 2. Replacing the .app without notarization

The manual plan tells the owner to move the current app aside, unpack the zip in Finder, and open the new app with Finder's secondary click. The displayed steps do not contain `xattr -d com.apple.quarantine` or `spctl --master-disable`. Auto-install, when the four flags and macOS are present, runs `launchctl bootout`, `mv` to `…-previous.app`, `ditto -x -k`, `codesign --verify --deep --strict`, and `launchctl bootstrap`. It does not strip quarantine and it does not assess Gatekeeper.

`codesign --verify` succeeds for an ad-hoc signature. A file Node writes with `fs.write` does not get the quarantine attribute a browser download gets, so Gatekeeper's first-launch prompt may not run for an app extracted from that zip. The safe path is a Developer ID Application signature, `notarytool submit --wait`, and `stapler staple`, then `spctl --assess` as a required check. The doc defers that. It was not run here. Stripping quarantine is not a substitute.

### 3. Database migration and rollback

The center does not apply schema SQL. `compatCheck` blocks a manifest schema older than the detected database and allows a newer one, including versions above `SUPPORTED_SCHEMA`. `preBackup` calls `backup.js` `create`, `verify`, and `testRestore` before a replace is allowed.

On Linux, with `node:sqlite`, a database at `meta.schemaVersion = 1` was backed up with passphrase `fake-pass-1234`. `verify` was ok. `testRestore` reported `integrity: ok` and `countsMatch: true`. The backup directory contained `secret.key.enc` and did not contain `secret.key` or `app-token`. After the live database was moved to schema 3 and gained a `migrated` table, `restoreInto` an empty directory brought back schema `1`, tables `items, meta`, and one item. Restore into a non-empty directory threw `Целевая папка не пуста`. The old data directory is renamed in the written plan and is not deleted by that restore.

Rolling the `.app` back is `mv` of `…-previous.app` on macOS. That command was returned as a dry-run and was not executed. If the new app has already migrated the live database, the plan says to restore the backup into an empty folder and swap the data directories. That swap was not run against a Mac data directory.

### 4. Turning off Squirrel and autoUpdater

This tree does not depend on `electron-updater` and does not call `autoUpdater`. No Squirrel feed is set. The automatic behavior that remains is `checkUpdates(false)` five seconds after launch, which talks to the GitHub API and can open a browser. Set the default of `checkUpdates` to false and delete that timer to stop it. The menu item can stay as the explicit check. Whether a built `.app` still contains `Squirrel.framework` because Electron links it was not measured on this commit.

## What the backup and the buttons already do

A verified backup is required before a same-identity replace, together with owner approval and a schema that is not older. Isolated side-by-side skips the password. Download still requires the button, and auto-install refuses a side-by-side plan (`mode !== 'replace'`). Ollama, OpenCode, Keychain, and the data directory are listed under `servicesPlan().untouched` and were not modified by the harness. The Linux backup left `secret.key` out of the archive unless a passphrase encrypted it.

Real social accounts stay out of this review. This commit is the Studio 3 / 1.1.2 line. It does not change that rule.

## Backup, rollback, and test/prod isolation

### Backup before an update, and rollback after it

A same-identity replace is allowed only when `preBackup` has a verified backup, the owner has approved the tag, and `compatCheck` does not see an older schema. `preBackup` calls `backup.js` `create`, `verify`, and `testRestore`.

On Linux, with `node:sqlite`, a database at `meta.schemaVersion = 1` was backed up with passphrase `fake-pass-1234`. `verify` was ok. `testRestore` reported `integrity: ok` and `countsMatch: true`. The archive contained `secret.key.enc`. It did not contain `secret.key` or `app-token`. After the live database moved to schema 3 and gained a `migrated` table, `restoreInto` an empty directory brought back schema `1`, tables `items, meta`, and one item. Restore into a non-empty directory threw `Целевая папка не пуста`.

The written plan renames the old data directory. That restore does not delete it. Rolling the `.app` back is `mv` of `…-previous.app`. The HTTP route `POST /api/ops/update-center/rollback` returned `dryRun: true` even when the body said `dryRun: false` (`lib/ops/protected.js` line 71). A direct `rollback({ dryRun: false })` on Linux threw `NOT_MAC` and did not call `exec`. The `.app` swap, `launchctl`, and a restore into a Mac data directory were **NOT VERIFIED**.

`compatCheck` blocks a manifest schema older than the detected database. It allows a newer schema, including `99` against a detected `4`, and it ignores `schemaCheck.ok`. `SUPPORTED_SCHEMA` is `1`. A jobs table that the detector calls schema `3` still produced `gate` mode `replace`. The center does not run the migration SQL. The new app would. If that app migrates the live database, the way back is the backup restored into an empty folder and a data-directory swap. That swap was not executed.

`servicesPlan().untouched` lists Ollama, OpenCode, Keychain, and the data directory. The harness did not modify them. Keychain items live outside the file backup. The Linux archive kept the encrypted `secret.key` and left the plaintext key out.

`lib/ops/update.js` lines 52–53 still put `rm -rf "/Applications/MOONKATTY AI STUDIO.app"` in `plan().rollback`. The panel steps do not show that command. The API returns it as `legacy`.

### Test and production do not update independently

`CURRENT_IDENTITY` in `lib/ops/update-center.js` line 17 is fixed: bundle id `com.moonkatty.aistudio`, data directory `MOONKATTY AI STUDIO`, launchd `com.moonkatty.aistudio.server`, Keychain prefix `MOONKATTY AI STUDIO`, app path `/Applications/MOONKATTY AI STUDIO.app`. `createUpdateCenter` has no identity argument. `lib/ops/index.js` passes `current: ctx.version` only. A test build of this commit still reports the production identity.

`gate` compares `bundleId`, `dataDirName`, `launchdLabel`, and `keychainServicePrefix`. `channel` is not one of those fields. A manifest with `channel: "test"` and the four production ids, version `1.3.3`, a verified signature, a backup, and owner approval returned `mode: "replace"` and a step that moves `/Applications/MOONKATTY AI STUDIO.app`.

A partial overlap (test bundle id, test launchd, test Keychain prefix, production data directory) stayed blocked: `идентичность сборки частично совпадает`. A fully isolated manifest (`isolated: true`, all four ids different, `isolatedFrom` containing the installed bundle id) was `side-by-side` with `approved: false`. Auto-install refuses a plan whose mode is not `replace`. Calling `gate` with an installed test identity and a production manifest stayed blocked, and this tree never supplies that installed identity.

One public key file is loaded: `lib/ops/update-keys/release-ed25519.pub.pem`. `verifySig` succeeds when any loaded key verifies. There is no test key and no production key. `keyId` is computed after verification and is not inside the signature. There is no revocation list. The committed pem is a placeholder whose private half the README says was discarded, so a real GitHub release stays unverified until that file is replaced. After it is replaced with one key, the test-channel replace above becomes a real replace of the production app and the production data directory.

## Result

**FAIL.** Do not include this Update Center in a working version.

Blocking bugs: `QA-UC-001` (one production identity and one key, so a test channel can replace production), `QA-UC-002` (symlink entries pass zip validation), `QA-UC-003` (no re-hash at install time, approval sticks to the tag), `QA-UC-004` (Electron checks GitHub five seconds after launch), `QA-UC-005` (the schema support cap does not block the gate). Owner approval is not set.

Open, and not the blockers above: the `rm -rf` string in `legacy`, the health URL taken from the environment, and codesign reported ok on Linux.

**Allowed on the Mac mini:** leave `STUDIO_OPS_UPDATE` unset. Leave the four `OPS_UPDATE_*` flags unset. Do not press Check or Update against this build. Do not auto-install. Real publishing and real social accounts stay forbidden. Gatekeeper, quarantine, `ditto`, `launchd`, Keychain, and notarization were **NOT VERIFIED** on this Linux host.
