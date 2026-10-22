# Update Center re-audit (Studio 3)

Read-only check of `origin/feat/update-center` at `aef14c465322e3c969b41d4866c3557b7b555367`.
Range `8b5b942..aef14c4` against the `9ffad98` review in `qa/reports/update-center/REPORT.md` (closed in `ae10471`).
The product worktree was `/tmp/mk-uc2`. It stayed clean. Nothing was installed, merged, or published.

Package version on that commit is 1.1.2. `build.appId` is `com.moonkatty.aistudio`.

## Verdict

**PASS** for the claimed security fixes. `QA-UC-001` through `QA-UC-005` are closed on this commit.

Inclusion in a working version is allowed when the conditions below are true. Until they are true, leave Update Center off. This is not approval of a production launch, of auto-install, or of publishing.

Real publishing and social accounts stay forbidden.

## Conditions for inclusion

1. The owner's production Ed25519 public key is in the `prod` set of `lib/ops/update-keys/keyring.json`. The committed ring has an empty prod set. The only key is the test stub `24f2c5557922cb89`, and a stub is refused if its set is `prod`. A `stable` or `preview` manifest does not verify until that owner key is added.
2. The four flags `OPS_UPDATE_AUTO_INSTALL`, `OPS_UPDATE_SIGNATURE_READY`, `OPS_UPDATE_BACKUP_VERIFIED_READY`, and `OPS_UPDATE_ROLLBACK_TESTED_ON_MAC` stay unset. Auto-install also requires `signing: developer-id`, `notarized: true`, and `spctl` on a staged copy. `package.json` `build.mac.identity` is still `null`, with `hardenedRuntime: false` and `gatekeeperAssess: false`.
3. `SUPPORTED_SCHEMA` in `lib/ops/update.js` is 1. A database at schema 2, 3, or 4 makes `schemaCheck.ok` false, and the gate blocks the replace. That is fail-closed. Raise the cap only together with the migrations this build actually runs. Until then, Update Center cannot update a current studio database, and that is the safe state.
4. A test build's bundle id comes from `Contents/Info.plist` or `STUDIO_APP_BUNDLE_ID`. A dev checkout with this `package.json` resolves as the prod profile. `STUDIO_FLAVOR` must match that profile, or every install stays blocked.
5. Gatekeeper, `ditto`, quarantine, `launchd`, Keychain, and notarization were not executed on this Linux host. Rehearse those on the Mac before any live replace.

`QA-UC-006` (low, open) is a residual of the 365-day check. It does not reopen the production-app replace. A lower version stays blocked. A revoked key stays rejected.

## How this was checked

- Product suite, from `/tmp/mk-uc2` with `NODE_PATH=/workspace/node_modules`: `node --test test/ops/update-center.test.js test/ops/update.test.js test/ops/update-center.integration.test.js`. **46 pass, 0 fail.**
- Attack harness `qa/reports/update-center-v2/attack.mjs`. **79 controls, 0 failed.** Log: `qa/reports/update-center-v2/logs/attack.log`.
- Fake password `fake-password-123` on throwaway servers at `127.0.0.1:18961` and `127.0.0.1:18962`. Servers were stopped. The worktree was clean after.

## Claimed fixes

| Claim | Result on aef14c4 |
| --- | --- |
| Runtime identity, separate test and prod profiles | `resolveIdentity` reads Info.plist, then `STUDIO_APP_BUNDLE_ID`, then `package.json`. Prod is `com.moonkatty.aistudio` at `/Applications/MOONKATTY AI STUDIO.app` (preview, stable, port 8787). Test is `com.moonkatty.aistudio.test` at `/Applications/MOONKATTY AI STUDIO TEST.app` (channel test, port 8687). A flavor that contradicts the bundle id sets `known: false` and blocks every install. |
| Channel, bundle id, and `.app` path checked; channel switch blocked | A test-channel manifest carrying the prod bundle id, app name, data dir, launchd label, and Keychain prefix is signed by the test key and then blocked. `installPlan` mode is `blocked`. `autoInstall` returns `BLOCKED`. The plan text has no `mv` of the prod `.app`. A fully isolated test manifest beside a prod install is `side-by-side` onto the TEST `.app`. A prod manifest against a test install is blocked. A test profile replaces only the TEST `.app`. |
| Separate key sets; prod placeholder rejected; prod empty | `verifySig` requires JSON `{v:1, alg:ed25519, keyId, sig}`. A raw base64 signature is refused. The test key does not verify `stable`. The prod key does not verify `test`. A revoked key id is refused. A `retired` key is not loaded. A `next` test key verifies the test channel. A stub with `set: prod` is dropped at load. The committed ring loads 0 prod keys and 1 stub test key. No private key is in the tree. |
| Symlinks checked | A symlink to `/etc/passwd` and a symlink whose target leaves the `.app` fail `inspectZip`. Download returns `BAD_ARCHIVE` and deletes the file. An in-app relative symlink (`../Info.plist` inside the app) stays allowed. |
| Hash and archive parsing repeated | After `status: verified`, replacing the zip makes `installPlan` refuse with the changed-SHA-256 reason and sets the download to `tampered`. `autoInstall` returns `BLOCKED`. |
| Consent bound to the manifest SHA-256 | `approve` stores `manifestSha256`. The next `check` of different bytes for the same tag deletes that approval and records that the manifest changed. `gate` with the old approval object and the new digest stays blocked. |
| Strict tag; builds older than 365 days refused | Tag `v1.3.0-test` on a stable `1.3.0` manifest is unverified. The preview suffix is accepted only on channel `preview`. Version `1.1.9` and version `1.2.0` against current `1.2.0` are blocked as not newer. A signed `1.2.5` with `published_at` `2020-06-01` is blocked at 2334 days. See `QA-UC-006` for the unsigned date. |
| Electron auto-check off | `desktop/main.js` sets `checkUpdates: false`. `checkUpdates` returns immediately unless the menu call passes `manual`. The five-second timer is gone. The menu item remains. There is no `electron-updater`. Update Center has no `setInterval`. The panel check is the `ucCheck` button. |
| Unknown DB schema blocks install | Schema 3, schema 4, and schema 99 on the live database make `schemaCheck.ok` false and the gate blocks. Manifest `dbSchemaVersion: 99` is blocked as an unknown schema. Schema 1 still passes `schemaCheck`. |
| No `rm -rf` | `lib/ops` has no `rm -rf`. Rollback commands are `launchctl` and `mv` to a `-failed-<timestamp>.app`. HTTP `POST /rollback` stays `dryRun: true` even when the body asks for a live rollback. |
| Health only via loopback | `safeHealthUrl` accepts `http://127.0.0.1:<port>/api/health`. The metadata IP, `https`, and a query string throw `BAD_HEALTH_URL`. `lib/ops/index.js` builds that loopback URL from `PORT`. The test server logged `http://127.0.0.1:18962`. |
| codesign / Gatekeeper failure is `ok: false` | Linux `verifySignature` is `ok: false` (`codesign: false`). A darwin mock whose `spctl` throws is `ok: false` (`gatekeeper: false`). |
| Auto-install requires Developer ID, notarization, and `spctl` in temp | With the four flags unset, the code is `AUTO_INSTALL_DISABLED` and the HTTP route is HTTP 400 with that code. `signing: adhoc` / `notarized: false` throws `NOT_NOTARIZED`. Linux throws `NOT_MAC`. The dry-run command list extracts with `ditto -x -k` into the staging directory, then `codesign --verify` and `spctl --assess` on that staged `.app`, then `mv`. The list has no `xattr` and no `rm`. |

## Attack harness

- **Test manifest with prod ids.** Signed with the test key, downloaded to `verified`, approved, backup recorded. Plan blocked. Auto-install `BLOCKED`. Prod `.app` is not the replace target.
- **Downgrade and replay.** `1.1.9` and the same version `1.2.0` are blocked. A 2020 `published_at` on a newer version is blocked. The same signed bytes checked twice stay verified. Republishing those bytes with `published_at` `2026-10-01` is not age-blocked (`QA-UC-006`). A missing `published_at` skips the age check.
- **Key revocation.** A key id in `revoked` fails `verifySig` before the signature bytes are used. `retired` is not in the set. The prod stub is dropped.
- **Consent replay.** Approval of tag `v1.3.0` is removed when the next check sees different manifest bytes. The old approval object does not satisfy `gate` for the new digest.
- **TOCTOU.** Bytes overwritten after `verified` fail the plan-time SHA-256. Status becomes `tampered`.
- **Zip-slip and symlinks.** `../outside.txt`, `/tmp/abs.txt`, and a backslash path are rejected. The slip download is deleted. Absolute and escaping symlinks are rejected at download. An internal relative symlink is allowed.
- **Update without the button.** `STUDIO_OPS_UPDATE` unset → HTTP 404. No session → HTTP 401. `POST /check` without `X-Studio-Request` → HTTP 403. `Origin: https://evil.example` → HTTP 403. `Sec-Fetch-Site: cross-site` → HTTP 403. Wrong approve password → HTTP 403. An authenticated check returned HTTP 200 and did not create `/Applications/MOONKATTY AI STUDIO.app`. The Electron shell does not call the check at launch.

## Registry

| Id | Was | Now |
| --- | --- | --- |
| QA-UC-001 | open, high | qa_verified. Test-channel prod ids cannot replace the prod app. |
| QA-UC-002 | open, medium | qa_verified. Escaping symlinks are refused. |
| QA-UC-003 | open, medium | qa_verified. Plan re-hashes. Consent is the manifest digest. |
| QA-UC-004 | open, medium | qa_verified. Electron check is manual. |
| QA-UC-005 | open, medium | qa_verified. An unsupported or unknown schema blocks the gate. |
| QA-UC-006 | — | open, low. Age uses unsigned GitHub `published_at`. |

Owner approval is not set on any of these.

## Not verified on this host

macOS `codesign`, `spctl`, `ditto`, quarantine, `launchd` bootout/bootstrap, Keychain, notarization, and a real Developer ID signature. The auto-install dry-run listed those commands. It did not run them. No live replace of `/Applications` was attempted.

## Mac mini

Allowed while the conditions are still open: leave `STUDIO_OPS_UPDATE` unset and leave the four `OPS_UPDATE_*` flags unset. Do not point auto-install at the production `.app`. The v1.2.4-test isolated-install verdict is a different commit and does not include this Update Center.

After the conditions are met, a manual plan (button, owner password, verified backup) is the path this code allows. Auto-install stays off until the Mac rehearsal of Developer ID, notarization, and `spctl` in the staging directory has passed.

Real publishing and social accounts stay forbidden.

## Result

**PASS**, with the five conditions above. Blocking bugs for the claimed fixes: none. Open residual: `QA-UC-006` (low). Owner approval is not set.
