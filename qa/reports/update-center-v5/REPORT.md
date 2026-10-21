# Update Center re-audit (v1.3.0-test prep, third pass)

Read-only check of `origin/feat/update-center` at `8b0fbc60d8fdb59555feb95701396e7d715db13c`.
One commit on top of `51005681b646f18093aa9f88668dd691f283105d`, the commit in `qa/reports/update-center-v4/REPORT.md`.
Diff: 5 files, +104/−26 (`docs/ops/UPDATE_CENTER.md`, `docs/ops/UPDATE_CENTER_MAC_TEST.md`, `lib/ops/update-center.js`, `package.json`, `test/ops/release-keys.test.js`).
The product worktree was `/tmp/mk-uc5`. It stayed clean. Nothing was installed, merged, or published. No live GitHub release was fetched. No Mac was used.

`package.json` version is still `1.1.2`. `build.asarUnpack` now includes `desktop/build-info.json`. `build.mac.identity` is still null.

## Verdict

**PASS for inclusion in v1.3.0-test.**

Blocking bugs for that inclusion: none. With `OPS_UPDATE_KEYRING_DIR` unset, signature state is `BLOCKED` and the message is `BLOCKED: нет публичного ключа владельца`. The four auto-install flags stay off unless the value is exactly `1`. `SUPPORTED_SCHEMA` is 1.

**The owner may add a prod public key.** `QA-UC-008` and `QA-UC-009` hold on this commit. Put the key in a mode `0700` directory you own, on a parent that is `0700` or `0755`, or on a sticky directory such as `/tmp`. Leave the four `OPS_UPDATE_*` flags unset. A packaged build still needs a readable `desktop/build-info.json`; without it every release stays unverified even after the key is present.

`QA-UC-010` stays open at low severity. Files are opened by path after the directory fd is checked. A same-user rename during that gap loaded another key. A process running as the owner of a mode `0700` directory can already replace those files. That residual does not forbid adding the key.

Real publishing and social accounts stay forbidden.

## Owner actions

1. Add the prod public key when you are ready. Use a real directory at mode `0700` that you own. `keyring.json` and each `.pub.pem` must be regular files you own, with no group or other write. A parent symlink in the `/var` → `/private/var` shape stays `READY`.
2. Keep the parent free of other-write unless it has the sticky bit. A mode `0777` parent is `BLOCKED`. A sticky mode `1777` parent stays `READY`. A mode `0755` parent stays `READY`. A mode `0770` parent is also `READY`: the ancestor check looks at other-write. On this host `nobody` (group `nogroup`) renamed a keyring out of a mode `0770` parent. A directory owned by `nobody` then failed closed with `EACCES`, and that key was not loaded. Prefer a parent the group cannot write, so a group member cannot force the external ring closed.
3. Leave the four `OPS_UPDATE_*` flags unset. Leave `SUPPORTED_SCHEMA` at 1.
4. Ship `desktop/build-info.json` in the unpacked tree. `asarUnpack` lists that file. The reader lives at `app.asar.unpacked/lib/ops/update-center.js` and reads `app.asar.unpacked/desktop/build-info.json`. A file that exists only under `app.asar/` is invisible to that process, and the release is unverified. `electron-builder` was not run; the layout was copied to match `asarUnpack`.
5. A dev checkout with no `desktop/build-info.json` reports `проверка возраста сборки недоступна` and can still verify a newer signed release. The same environment variables on a path inside `app.asar.unpacked` stay packaged and fail closed.
6. Rehearse Gatekeeper, `ditto`, quarantine, `launchd`, Keychain, and notarization on the Mac before any live replace. Those were not run here.

## How this was checked

- Product suite, from `/tmp/mk-uc5`, with `NODE_PATH` pointing at the workspace modules and `@electron/asar`: `node --test test/ops/*.js test/contract/*.js`. **177 tests, 176 pass, 0 fail, 1 skip**, 12853 ms (`logs/their-tests.log`). The skip is the Studio jobs contract (`feat/v1.2.0 jobs API not present`). The claimed 176/0/1 matches pass, fail, and skip.
- Attack harness `qa/reports/update-center-v5/attack.cjs`. **35 observations, 0 failures.** Two residuals are recorded on purpose: the same-user path-open window. Log: `logs/attack.json`.
- The host is Linux. macOS `stat -f`, `chmod +a`, `codesign`, `spctl`, and a real `/var` → `/private/var` path were not executed.

## Claimed changes

| Claim | Result on 8b0fbc6 |
| --- | --- |
| `QA-UC-008`: `desktop/build-info.json` is in `asarUnpack`. Packaged mode comes from the code path. A packaged build with build-info missing fails closed | Holds. `asarUnpack` includes `desktop/build-info.json`. `isPackagedPath` matches `app.asar` and `app.asar.unpacked`. `lib/ops/index.js` calls `createUpdateCenter` with `env` for the flags and does not pass `packaged`. With the module loaded from `app.asar.unpacked` and the file missing, `buildAge.failClosed` is true, the message is `BLOCKED: собранное приложение без читаемого desktop/build-info.json…`, the release is unverified, and `prepareDownload` throws `UNVERIFIED`. Signature state stays `READY` when a prod key is loaded. The refusal is the age check. |
| Environment variables cannot force dev mode | Holds. `STUDIO_FLAVOR=dev`, `NODE_ENV=development`, `ELECTRON_IS_PACKAGED=0`, `ELECTRON_RUN_AS_NODE=1`, `OPS_UPDATE_PACKAGED=0`, `STUDIO_PACKAGED=false`, and `STUDIO_DEV=1` were set in `process.env` and in the `env` argument. The unpacked path stayed packaged and the release stayed unverified. The same variables on `/tmp/mk-uc5/lib/ops` stayed a dev warning, and the release stayed verified. `createUpdateCenter({ packaged: false })` does override the path. `index.js` does not pass that option. |
| A corrupted or partial build-info is `BLOCKED` | Holds for empty, whitespace, `{`, a truncated object, `{"builtAt":null}`, `{"builtAt":""}`, `{"builtAt":"not-a-date"}`, `{"commit":"abc"}`, a numeric `builtAt`, and `{"builtAt":true}`. Each left `buildAge.failClosed` true, the release unverified, and download `UNVERIFIED`. A date-only `2026-06-01` parses, so that file is a readable date and the release can verify. A readable `2026-06-01T00:00:00.000Z` rejects a signed `builtAt` of `2026-01-01` and accepts `2026-10-21`. |
| `QA-UC-009`: realpath once; directory opened with `O_NOFOLLOW\|O_DIRECTORY`; files with `O_NOFOLLOW\|O_RDONLY`; `fstat` and the read use that fd; directory dev/ino checked again; a world-writable parent without sticky is `BLOCKED` | Holds for the checks that were claimed. `O_NOFOLLOW` is 131072 on this host. A mode `0777` parent is `BLOCKED` (`без sticky`) and the key is not loaded. Sticky `1777` and mode `0755` stay `READY`. A parent symlink in the `/var` shape stays `READY`. A resolved parent that is `0777` is `BLOCKED` when the logical parent is private. The directory as a symlink, and a `.pub.pem` as a symlink, stay `BLOCKED`. Leaving the swapped directory in place returns `папка была подменена во время проверки` and does not merge the attacker key. |
| Higher-volume race of the parent-symlink harness | 341623 loads in 20 seconds, 0 attacker keys, 340899 blocked, 724 still on the owner key. The v4 hole (stat one path, read another) did not reproduce. |
| Remaining risk: no `openat` | Present, same-user. After the directory fd is `fstat`ed, `keyring.json` and the pem are opened with `path.join(realpath, name)`. A hook renamed a second mode `0700` directory into that path for the file opens and restored the original inode before the trailing `lstat`. Signature state was `READY` and the attacker key was the one loaded. A live same-user rename over 12 seconds won 488 of 185057 loads (183814 blocked, 730 owner, 0 thrown). See `QA-UC-010`. |
| Errors and revocations from the external keyring are merged | Holds. An external ring that lists a base prod key in `revoked` removes that key. `verifySig` returns `ключ … отозван`. An external ring that revokes its own key does not load it; the base key remains and signature stays `READY`. A mode `0777` external directory is rejected and its `revoked` list is not applied. A private PEM in the external JSON is merged as `OPS_UPDATE_KEYRING_DIR: … ПРИВАТНЫЙ …`, that entry is dropped, the revocation still applies, and the other public key loads. |

## Findings

### Low

**`QA-UC-010`. Keyring files are opened by path, so a same-user rename can change the bytes after the directory fd is checked.**

`readExternalKeyring` resolves the directory once, opens it with `O_RDONLY|O_NOFOLLOW|O_DIRECTORY`, and takes mode, owner, and inode from `fstat` of that fd. The file open is `fs.openSync(path.join(rp, name), O_RDONLY|O_NOFOLLOW)`. That walk starts from the filesystem root. It does not use `openat` on the directory fd. The trailing `lstat` of `rp` and of the logical path rejects a directory that is still swapped.

Two measurements loaded an attacker public key while the directory inode matched at the end:

- A hook swapped the real directory after the directory open and restored it inside `lstat`, before the inode compare. State `READY`, attacker key present, owner key absent.
- A second process running as the same uid renamed the real directory out and an attacker directory in, then restored them, for 12 seconds. 488 of 185057 loads returned the attacker key.

`nobody` retargeting a parent symlink in a mode `0777` directory for 20 seconds produced 0 attacker keys in 341623 loads. A nobody-owned directory substituted for the keyring is `BLOCKED` (`EACCES` on open) and the key is not loaded. The window that returns `READY` is a process that can rename a directory the loader uid owns, and that can place files owned by that uid. That is the same uid that can write the mode `0700` directory directly.

A same-user hardlink is still a regular file and is loaded. That was already measured in v4.

### Measured, not filed

A mode `0770` parent is `READY`. The ancestor walk rejects other-write (`0002`) without the sticky bit (`01000`). Group-write is outside that test. `nobody` in group `nogroup` moved the keyring directory aside. The follow-up directory, owned by `nobody` at mode `0700`, failed closed and did not load its key.

`createUpdateCenter({ packaged: false })` treats a missing build-info as the dev warning on a path that contains `app.asar.unpacked`. The production call in `lib/ops/index.js` does not pass `packaged`.

A date-only `builtAt` of `2026-06-01` is a readable date. `Date.parse` accepts it. The packaged fail-closed path is for a missing or unparseable value.

## Registry

| Id | Was | Now |
| --- | --- | --- |
| QA-UC-001 … QA-UC-007 | qa_verified | unchanged |
| QA-UC-008 | open, medium | qa_verified. A packaged path with a missing, asar-only, or unreadable build-info leaves the release unverified. Env does not select dev mode. |
| QA-UC-009 | open, medium | qa_verified. The parent-symlink double read is closed. A world-writable parent without sticky is `BLOCKED`. The 20-second race loaded 0 attacker keys in 341623 loads. |
| QA-UC-010 | — | open, low. Same-user rename between the directory fd and the path-based file open loaded an attacker key. |
| QA-NODE-004 | open, low | unchanged. This commit does not touch the Computers UI. |

Owner approval is not set on any of these. Registry after this report: 37 bugs (14 open, 22 qa_verified, 1 blocked).

## Linux only

This host verified `O_NOFOLLOW`, sticky and non-sticky parents, a group-writable parent, `protected_hardlinks` behavior from the previous pass (a same-user hardlink still loads), and a constructed `app.asar` plus `app.asar.unpacked` tree. It did not run Darwin `stat -f`, macOS ACLs, `codesign`, `spctl`, `ditto`, quarantine, `launchd`, Keychain, or notarization. `electron-builder` was not run.

## Mac mini

Allowed for v1.3.0-test: install the test build. With `OPS_UPDATE_KEYRING_DIR` unset the signature state is `BLOCKED`. The dev warning about build age is expected on a checkout that has no `desktop/build-info.json`.

You may add the prod public key. Use a mode `0700` directory you own, under a parent you own that is not group-writable and is not world-writable without the sticky bit. Run `bash scripts/mac-keyring-check.sh` on the Mac. The Linux run of that script is not that rehearsal. A packaged app needs `desktop/build-info.json` beside the unpacked server; a missing file keeps every release unverified.

`QA-UC-010` is a same-user residual. It does not change that instruction. `QA-NODE-004` stays open and is not part of this inclusion.

Real publishing and social accounts stay forbidden.

## Result

**PASS** for inclusion in v1.3.0-test. The owner may add a prod public key on a mode `0700` directory they own, with the four flags unset and a parent that other users cannot rewrite. Blocking bugs: none. `QA-UC-008` and `QA-UC-009` are qa_verified on `8b0fbc6`. Open: `QA-UC-010` (low, no `openat`). Owner approval is not set.
