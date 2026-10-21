# Update Center re-audit (v1.3.0-test prep, second pass)

Read-only check of `origin/feat/update-center` at `51005681b646f18093aa9f88668dd691f283105d`.
Three commits on top of `3fc95736bbe7752fa376539c8e275fcc91978a51`, the commit in `qa/reports/update-center-v3/REPORT.md`: `e28a3d5`, `e4646b1`, `5100568`.
Diff: 12 files, +270/−19. The product worktree was `/tmp/mk-uc4`. It stayed clean. Nothing was installed, merged, or published. No live GitHub release was fetched. No Mac was used.

`package.json` is not in the diff. The package version is still `1.1.2`. `build.mac.identity` is still null.

## Verdict

**PASS for inclusion in v1.3.0-test while the prod keyring is empty and signature checks stay BLOCKED.**

Blocking bugs for that inclusion: none. With `OPS_UPDATE_KEYRING_DIR` unset, signature state is `BLOCKED` and the message is `BLOCKED: нет публичного ключа владельца`. Download of an unverified release is refused. The four auto-install flags stay off unless the value is exactly `1`. `SUPPORTED_SCHEMA` is 1. Schemas 2, 3, and 4 fail closed.

This is not a pass of the packaged anti-rollback claim. `QA-UC-008` is open: the server that a packaged app starts does not read `desktop/build-info.json` inside `app.asar`, and a missing file leaves an older signed release verified. `QA-UC-009` is open when the keyring path goes through a parent symlink another user can replace.

Real publishing and social accounts stay forbidden.

## Owner actions

1. Leave the prod public key out until you decide to add it. `BLOCKED` is the safe state for this inclusion.
2. When you add it, use a real directory at mode `0700` that you own. The directory, `keyring.json`, and each `.pub.pem` must be regular files. A parent symlink such as macOS `/var` → `/private/var` is allowed and was READY in a Linux simulation of that shape. Do not put that symlink in a directory another user can rewrite. A mode `0777` directory without the sticky bit let `nobody` retarget it (`QA-UC-009`). A sticky `/tmp` did not.
3. Leave the four `OPS_UPDATE_*` flags unset. Leave `SUPPORTED_SCHEMA` at 1.
4. Treat the “older than this build” check as inactive on a packaged app until `QA-UC-008` is fixed. `scripts/write-build-info.mjs` does write `builtAt` from `SOURCE_DATE_EPOCH`, and `build.files` includes `desktop/**`. The running server is `app.asar.unpacked/server.js` (`desktop/main.js`). `lib/**` is unpacked. `desktop/**` is not. The reader looks at `app.asar.unpacked/desktop/build-info.json`.
5. A dev checkout should show `проверка возраста сборки недоступна`. That message is expected there. The same message appears for a packaged layout whose file the server cannot read, and the release stays verified.
6. Rehearse Gatekeeper, `ditto`, quarantine, `launchd`, Keychain, and notarization on the Mac before any live replace. Those were not run here. `scripts/mac-keyring-check.sh` was run on Linux only.

## How this was checked

- Product suite, from `/tmp/mk-uc4`, with `NODE_PATH` pointing at the workspace modules and `@electron/asar`: `node --test test/ops/*.js test/contract/*.js`. **172 tests, 171 pass, 0 fail, 1 skip**, 12696 ms (`logs/their-tests.log`). The skip is the Studio jobs contract, which skips because this tree has no `createJob` API. The claimed 171/0/1 matches pass, fail, and skip.
- Attack harness `qa/reports/update-center-v4/attack.cjs`. **63 observations, 0 failures.** Log: `logs/attack.json`.
- The host is Linux. macOS `stat -f`, `chmod +a`, `codesign`, `spctl`, and a real `/var` → `/private/var` path were not executed.

## Claimed changes

| Claim | Result on 5100568 |
| --- | --- |
| `QA-UC-007`: external dir must be mode `0700`, owned by the current uid, not a symlink; `keyring.json` and `.pub.pem` must be regular files with no group/other write | Holds. Modes `0777`, `0755`, `0750`, `0701`, and `0707` are `BLOCKED` and the key is not loaded. A mode `0666` key file and a mode `0666` `keyring.json` are `BLOCKED`. A symlinked directory, a symlinked `keyring.json`, and a symlinked `.pub.pem` are `BLOCKED`. A foreign uid is `BLOCKED`. A mode `0700` directory owned by this user is `READY` and the key type is `public`. |
| Parent symlinks are allowed | A parent symlink in the `/var` → `/private/var` shape is `READY`. `scripts/mac-keyring-check.sh` with `TMPDIR` pointed through a symlink printed `ВСЕ PASS` and removed its temp dir. The directory itself as a symlink stays `BLOCKED`. |
| Parent symlink swapped to an attacker directory, `..`, realpath escape | A `..` path that lands on the same directory is that directory. A `..` path that lands on a mode `0777` directory is `BLOCKED`. An absolute `file` field and a `file` field containing `..` are rejected. A symlink file is rejected before its target is read. Swapping the parent symlink after the mode check and before `loadKeyring` reads the original path loaded the attacker key and the state was `READY`. See `QA-UC-009`. |
| `QA-UC-006`: `builtAt` is mandatory and signed; `release-sign.mjs` writes it | A manifest with no `builtAt` is unverified and `prepareDownload` throws `UNVERIFIED`. `scripts/write-build-info.mjs` is separate. `release-sign.mjs` still writes `builtAt` before the signature when the field is missing, and the new tests cover that writer. A signed `builtAt` of `2020-01-01` still fails the 365-day gate when `published_at` is `2026-10-21`. |
| Anti-rollback: downgrade, equal version, tag or zip mismatch, `builtAt` more than 5 minutes ahead, `builtAt` older than the installed build | `1.10.0` is newer than `1.9.0`. `1.9.0` against current `1.10.0` is unverified. An equal version is unverified. `1.10` (two components) is unverified. `1.3.0-rc.1` compares equal to `1.3.0` and is unverified. A manifest version `v1.3.0` does not match tag `v1.3.0`. A zip whose name does not contain the version is unverified. `builtAt` exactly 5 minutes ahead is accepted. One millisecond past that is unverified. A clock 10 minutes behind rejects a `builtAt` of “now”. When `currentBuiltAt` is a real date, an older `builtAt` is unverified. An equal `builtAt` is accepted. |
| An old signed release is unverified | True when `desktop/build-info.json` is readable beside the module. False when it is missing, and false in the packaged layout below. |
| Dev run without build-info says the age check is unavailable | Holds. `buildAge.available` is false and the message contains `проверка возраста сборки недоступна`. The release carries that warning. Version compare and the future check still run. |
| A packaged build with build-info missing fails closed | Does not hold. See `QA-UC-008`. |
| `scripts/mac-keyring-check.sh` uses BSD `stat` and stays in `$TMPDIR` | The script chooses `stat -f` on Darwin and `stat -c` otherwise. This host took the GNU branch. It created and deleted a directory under `$TMPDIR` only. The Darwin branch was not executed. |
| `scripts/write-build-info.mjs` | Refuses to run without `SOURCE_DATE_EPOCH` and does not write the file. With epoch `1700000000` it writes that instant as `builtAt`. The repo file `desktop/build-info.json` was not created. |

## Findings

### Medium

**`QA-UC-008`. A missing or unreadable `build-info.json` does not fail the age check.**

`readBuildInfoBuiltAt` returns null when the file is missing or the date does not parse. `signedVersionProblems` then appends `проверка возраста сборки недоступна` and leaves `verified` true when the version is newer and `builtAt` is not in the future. `prepareDownload` then allows the download. The status text calls this a dev run.

The packaged process does not see the file even when the asar contains it. `desktop/main.js` starts `Resources/app.asar.unpacked/server.js` with the bundled Node binary. `asarUnpack` lists `lib/**` and does not list `desktop/**`. From `app.asar.unpacked/lib/ops/update-center.js` the reader looks at `app.asar.unpacked/desktop/build-info.json`. A real asar was built with `@electron/asar` containing `/desktop/build-info.json` and `/lib/ops/update-center.js`. The copy required from `app.asar.unpacked/lib` returned null. An older signed `1.3.0` (current package `1.1.2`, `builtAt` `2026-01-01`, installed build `2026-06-01`) stayed verified and download was allowed.

The same layout with the file sitting next to the module rejected that older `builtAt`. Deleting the file made the next check verified again. Their packaged test extracts the whole asar into one directory, so `lib` and `desktop` are siblings. That is the case that passes. It is not the path the packaged server runs.

Version compare, the 5-minute future check, and the 365-day gate still run. A `builtAt` of `2020-01-01` still fails the gate. A release inside 365 days whose version is greater than `1.1.2` does not.

**`QA-UC-009`. The parent symlink is checked on one path and read on another.**

`externalKeyringProblem` takes the mode and owner from `lstat` of the path it was given, then `realpath`s that directory and checks the files there. `loadKeyring` reads the original path again, so a parent symlink is followed a second time. Replacing the symlink after the `keyring.json` check and before that second read loaded the attacker key. `signatureStatus` was `READY`. The attacker directory was mode `0755` and would have been `BLOCKED` if the load had started on it.

`nobody` cannot replace a symlink in a sticky mode `1777` directory. `nobody` can replace one in a mode `0777` directory without the sticky bit. A load that starts after the swap stats the attacker directory and blocks on its owner. Two live races on that directory: 1 hit in 21077 loads, then 0 hits in 32815 loads (`logs/attack.json` is the second sample). The winning load is the one that stats the good directory and reads the retargeted path.

macOS `/var` is not a directory a normal user can replace. The hole is a parent symlink in a shared directory without the sticky bit.

### Low, measured, not filed

The zip check is `name.includes(version)`. `MOONKATTY-AI-STUDIO-11.3.0-arm64-mac.zip` is accepted for signed version `1.3.0` when the tag is `v1.3.0-mac-preview`. The numeric compare still uses `1.3.0`. A zip name that does not contain the version is unverified.

A same-user hardlink is loaded. `protected_hardlinks` refused a hardlink to a file owned by `nobody`. Modes `1700`, `2700`, and `4700` are accepted because the check masks to `0777`, and `nobody` could not create a file in them. On Linux, `setfacl` without `-n` widened the directory to mode `0770` and the loader blocked it. `setfacl -n` left mode `0700` with an empty mask, the state stayed `READY`, and `nobody` could not write the key. macOS `chmod +a` was not run.

## Registry

| Id | Was | Now |
| --- | --- | --- |
| QA-UC-001 … QA-UC-005 | qa_verified at aef14c4 | unchanged |
| QA-UC-006 | open, low | qa_verified. `builtAt` is required and covered by the signature. A missing `builtAt` is unverified. |
| QA-UC-007 | open, medium | qa_verified. Mode, owner, and symlinks of the directory and its files are rejected. |
| QA-UC-008 | — | open, medium. Missing or asar-only build-info does not fail the age check. |
| QA-UC-009 | — | open, medium. A swapped parent symlink is read after the check. |
| QA-NODE-004 | open, low | unchanged. This range does not contain the Computers UI e2e. |

Owner approval is not set on any of these.

## Linux only

This host verified the GNU `stat` branch of `scripts/mac-keyring-check.sh`, POSIX ACLs via `setfacl`, `protected_hardlinks`, sticky versus non-sticky `/tmp`-style directories, and a constructed `app.asar` plus `app.asar.unpacked` tree. It did not run Darwin `stat -f`, a real macOS `$TMPDIR` under `/var/folders`, macOS ACLs, `codesign`, `spctl`, `ditto`, quarantine, `launchd`, Keychain, or notarization. `electron-builder` was not run. The unpack split is the one in `package.json` `asarUnpack`.

## Mac mini

Allowed for v1.3.0-test: install the test build with `OPS_UPDATE_KEYRING_DIR` unset and the four flags unset. Update Center shows `BLOCKED`. The dev warning about build age is expected on a checkout that has no `desktop/build-info.json`.

Before any release can verify: add the prod public key on a mode `0700` directory you own, and run `bash scripts/mac-keyring-check.sh` on the Mac. The Linux run of that script is not that rehearsal. Do not point the keyring through a symlink in a shared directory. Do not treat an older signed release as blocked on a packaged app until the unpacked server reads `builtAt`.

`QA-NODE-004` stays open. It is not part of this inclusion.

Real publishing and social accounts stay forbidden.

## Result

**PASS** for inclusion in v1.3.0-test while the prod keyring is empty and signature checks stay `BLOCKED`. Blocking bugs for that inclusion: none. Open: `QA-UC-008` (medium), `QA-UC-009` (medium). `QA-UC-006` and `QA-UC-007` are qa_verified on this commit. Owner approval is not set.
