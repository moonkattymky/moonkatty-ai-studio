# Update Center re-audit (v1.3.0-test prep)

Read-only check of `origin/feat/update-center` at `3fc95736bbe7752fa376539c8e275fcc91978a51`.
One commit on top of `aef14c465322e3c969b41d4866c3557b7b555367`, the commit in `qa/reports/update-center-v2/REPORT.md`.
Diff: 8 files, +308/−8. The product worktree was `/tmp/mk-uc3`. It stayed clean. Nothing was installed, merged, or published. No live GitHub release was fetched.

Package version on this commit is still `1.1.2`. `build.appId` is `com.moonkatty.aistudio`. `build.mac.identity` is `null`, `hardenedRuntime` is false, and `gatekeeperAssess` is false.

## Verdict

**PASS for inclusion in v1.3.0-test, in the fail-closed state.**

The prod key set is empty. Signature state is `BLOCKED` with the message `BLOCKED: нет публичного ключа владельца`. A signed stable release is stored unverified. `prepareDownload` throws `UNVERIFIED`. With all four auto-install flags set to `1`, `autoInstall` throws `SIGNATURE_BLOCKED`. Health, tasks, and runtime still answer HTTP 200. Download and auto-install do not run.

Blocking bugs for that inclusion: none.

This is not approval to turn signature checks to `READY`, to turn auto-install on, or to publish. Real publishing and social accounts stay forbidden.

## Owner actions

1. Leave the prod public key out of the build until you have decided to trust Update Center with a real key. Until then the signature state stays `BLOCKED` and that is the safe state for v1.3.0-test.
2. When you add the key, do it from `docs/ops/RELEASE_KEY_SETUP_MAC_MINI.md`. Generate the Ed25519 pair outside the repo. Keep the private key offline. Put only the `.pub.pem` and a `keyring.json` entry in `OPS_UPDATE_KEYRING_DIR`, or commit only those two files. The directory in the doc is mode `0700`. The loader does not enforce that mode (`QA-UC-007`).
3. Leave `OPS_UPDATE_AUTO_INSTALL`, `OPS_UPDATE_SIGNATURE_READY`, `OPS_UPDATE_BACKUP_VERIFIED_READY`, and `OPS_UPDATE_ROLLBACK_TESTED_ON_MAC` unset. Only the exact string `1` turns one on. With the prod ring empty, `1` on all four still cannot auto-install.
4. Leave `SUPPORTED_SCHEMA` at 1 until this build actually migrates a current studio database. Schema 1 passes. Schemas 2, 3, and 4 fail closed and the install gate blocks.
5. A test build's bundle id is `com.moonkatty.aistudio.test`. A flavor that contradicts the bundle id is not a known identity, and every install stays blocked. A dev checkout of this `package.json` still resolves as the prod profile.
6. Rehearse Gatekeeper, `ditto`, quarantine, `launchd`, Keychain, and notarization on the Mac before any live replace. Those were not run here.

## How this was checked

- Product suite, from `/tmp/mk-uc3` with `NODE_PATH=/workspace/node_modules`: `node --test test/ops/*.js test/contract/*.js`. **156 tests, 155 pass, 0 fail, 1 skip**, 25327 ms (`logs/their-tests.log`). The skip is the Studio jobs contract, which skips because this tree has no `createJob` API. `test/ops/release-keys.test.js` is 9 tests, and all 9 passed.
- Attack harness `qa/reports/update-center-v3/attack.cjs`. **43 observations, 0 failures.** Eight of those are the residuals named below. Log: `logs/attack.json`.
- One throwaway server at `127.0.0.1:18971` with `STUDIO_OPS_UPDATE=1` and the fake password `fake-password-123`. It was stopped. The worktree was clean after.

## Claimed changes

| Claim | Result on 3fc9573 |
| --- | --- |
| External keyring accepts public keys and revocations, and rejects a private key file | A PKCS#8 private PEM, an encrypted PKCS#8 PEM, a public PEM with a private PEM after it, a private JWK, a tab inside the private header, a public header over a private body, and a zero-width space in the header were all refused. Prod size stayed 0. A symlink to a private-key PEM was refused with `ПРИВАТНЫЙ`. A mode `0700` directory with a real public key is `READY` and the key object type is `public`. |
| Symlinks | A symlink whose target is a public key outside the directory is loaded. `keyring.json` as a symlink is followed. See `QA-UC-007`. |
| Path traversal | An absolute `file` path and a `file` path containing `..` are reduced with `path.basename`. The outside file is not read. A `file` value of `..` loads nothing. |
| Revocation injection | A revocation is taken from the `revoked` array. An external ring can revoke a built-in key and add a different public key. It cannot clear a revocation already in the base ring. A key listed in both `keys` and `revoked` in one file is not loaded. A `revoked` object is ignored. Revoking the test stub leaves both flavors `BLOCKED`. |
| World-writable directory | A mode `0777` directory and a mode `0666` `keyring.json` are loaded, and the signature state becomes `READY`. There is no mode check. See `QA-UC-007`. |
| Secret names in `.gitignore` and `build.files` | `*.key`, `*.p8`, `*.p12`, `*.pfx`, `*.priv`, `*.priv.pem`, `*private*.pem`, `*secret*.pem`, and `release-*-*.key` are ignored. The committed `*.pub.pem` is not ignored. The same private globs are in `build.files`. `owner.pem` and `id_ed25519` are not name-excluded. The content scan in `release-keys.test.js` passed: no PEM private header is tracked or sitting in `ops`, `lib`, `public`, or `desktop`. |
| `QA-UC-006` partial fix | A signed `builtAt` of `2020-01-01` blocks a release whose GitHub `published_at` is `2026-10-21`. A recent `builtAt` with `published_at` of `2020-06-01` is also blocked, because the older date wins. A manifest with no `builtAt` and a fresh `published_at` is not age-blocked. A missing `builtAt` and a missing `published_at` skip the age check. The bug stays open. |
| Empty prod ring is `BLOCKED`, and the rest of the app works | In process: verified false, download `UNVERIFIED`, unknown tag `NOT_FOUND`, auto-install `SIGNATURE_BLOCKED`. On the server: `GET /api/health` 200, `GET /api/tasks` 200, `GET /api/runtime` 200, update-center `signature.state` `BLOCKED`, auto-install HTTP 400. A download of a tag that had not been checked returned HTTP 404. |
| Test flavor isolation | A test-key signature verifies. The same manifest carrying the prod bundle id, app name, data dir, launchd label, and Keychain prefix does not install over the test profile or the prod profile. `allowed` is false and `mode` is `blocked`. A `STUDIO_FLAVOR=prod` on the test bundle id is not a known identity. |
| Auto-install flags default off | All four are false when unset. `true`, `yes`, `on`, `0`, and an empty string leave auto-install disabled. |
| `SUPPORTED_SCHEMA` fail-closed | The constant is 1. Schema 1 passes. Schemas 2, 3, and 4 make `schemaCheck.ok` false. The gate then blocks. |
| `QA-NODE-004` | Still open in the registry. This commit has no `test/ops/ui-computers.e2e.test.js`. It does not change that bug. |

## Findings

### Medium

**`QA-UC-007`. The external keyring does not check the directory mode or where a symlink points.**

`loadKeyrings` resolves `OPS_UPDATE_KEYRING_DIR` and reads `keyring.json` and each `file` with `fs.readFileSync`. `path.basename` stops a `..` path in the `file` field. Nothing calls `lstat`, nothing requires mode `0700`, and nothing checks that `realpath` stays inside the directory.

- A directory at mode `0777`, with `keyring.json` and the public key at mode `0666`, loaded the key. `signatureStatus` was `READY`.
- A symlink named `link.pub.pem` whose target was a public key outside the directory loaded that key. The key object type was `public`.
- `keyring.json` as a symlink was followed.
- The same symlink aimed at a PKCS#8 private PEM was rejected.
- An external ring that revoked the base prod key id and added a second public key left the signature state `READY` on the second key. A revocation already stored in the base ring could not be removed by the external ring.

With the variable unset, none of this runs. The v1.3.0-test inclusion above does not set the variable. The hole is the step that turns the signature state to `READY`.

### Low, still open

**`QA-UC-006`. Age is signed only when `builtAt` is present.**

The gate takes `Math.min` of the signed `builtAt` and the unsigned GitHub `published_at`. An old `builtAt` cannot be reset by republishing. A manifest that omits `builtAt` still follows `published_at`, and both dates absent skips the check. A lower version stays blocked. A revoked key stays rejected.

Name filters do not list `owner.pem` or `id_ed25519`. The content scan is what passed. A file under `lib/` with that name and no `PRIVATE KEY` header would not match the globs.

## Registry

| Id | Was | Now |
| --- | --- | --- |
| QA-UC-001 … QA-UC-005 | qa_verified at aef14c4 | unchanged |
| QA-UC-006 | open, low | open, low. `builtAt` is in the signed age check. A missing `builtAt` still uses the unsigned date. |
| QA-UC-007 | — | open, medium. External keyring mode and symlink targets are not checked. |
| QA-NODE-004 | open, low | open, low. This commit does not contain the Computers UI e2e. |

Owner approval is not set on any of these.

## Not verified on this host

macOS `codesign`, `spctl`, `ditto`, quarantine, `launchd`, Keychain, notarization, and a real Developer ID signature. No live replace of `/Applications` was attempted. The owner keyring directory was a temp directory, not `~/Library/Application Support`.

## Mac mini

Allowed for v1.3.0-test: install the test build with `OPS_UPDATE_KEYRING_DIR` unset and the four `OPS_UPDATE_*` flags unset. Update Center shows `BLOCKED`. The rest of the app is the part this check exercised (health, tasks, runtime). Do not point auto-install at either `.app`.

Before any release can verify: add the prod public key by the Mac doc, on a directory at mode `0700`, and confirm the panel says `READY` only after that file is the key you generated. Leave auto-install off until the Mac rehearsal has passed.

`QA-NODE-004` stays open on the Computers UI e2e. It is not part of this Update Center inclusion.

Real publishing and social accounts stay forbidden.

## Result

**PASS** for inclusion in v1.3.0-test while the prod keyring is empty and signature checks stay `BLOCKED`. Blocking bugs for that inclusion: none. Open: `QA-UC-006` (low), `QA-UC-007` (medium, applies when the external keyring is set), `QA-NODE-004` (low, not this commit). Owner approval is not set.
