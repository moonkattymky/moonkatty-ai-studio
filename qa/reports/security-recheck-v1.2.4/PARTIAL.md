# SUPERSEDED — partial check of v1.2.4-test at 6cf7c08

**SUPERSEDED.** Studio marked `feat/v1.2.4-test-nodes` at `6cf7c08a3e0447c0871ba01597d5ad150e99e47f` obsolete because NODE 0.2.2 is being ported and a new commit and zip hash will follow. This note is not a release verdict. It does not approve a prerelease publish, a Mac mini install, or enabling the node listener. `REPORT.md` was not written. `qa/bugs/registry.json` was not updated for this commit.

Read-only worktree: `/tmp/mk-v124`, detached at `6cf7c08`, ancestor `a2a35c8`. No commits were made on that branch.

## What was executed

| Check | Result |
|---|---|
| `FLAVOR=test scripts/package-mac-on-linux.sh` | Exit 0. Zip SHA-256 `d32f33667b51aa2a290c5ce5f5260843efa96d80036b2400eb45331ae7a6e554`, equal to the claimed hash. `logs/BUILD-INFO.txt`. |
| Regression harness `attack.mjs` | 79 controls, 0 failed. `logs/attack.log`. |
| Node harness `nodes-attack.mjs` | 29 controls, 0 failed. Residuals below. `logs/nodes-attack.log`. |
| Product scripts on Linux | 443 assertions passed, 0 failed, in the scripts that do not need OpenCode or Blender. |
| `scripts/desktop-test.mjs` | Clean source tree: Electron exits 78 (`сборка не определена`) because flavor markers exist only during packaging. With temporary test markers that were removed afterward: 23/23. |
| `test:3d`, `test:3c`, `test:e2e-test-build` | Exit 2. `SKIP: opencode not found`. Blender at the documented path is also absent. Not counted. |

The claimed suite total 554/554 was not reproduced as one number on this host. Counted passes: security 52, runner 5, opencode 51 (script default flavor `prod`; an earlier run that inherited `STUDIO_FLAVOR=test` failed the prod Keychain service assertion, 50 pass / 1 fail), policy 46, video 45, publish-guard 73, isolation 65, nodes 51, nodes-021 21, `test/ops` 34. Sum 443. Desktop 23 is separate and required temporary markers.

## Observations at this commit (not a verdict)

Zip and bundle: hash match. Bundle id `com.moonkatty.aistudio.test`. `meta.js` absent from the asar. Coordinator modules present: `nodes.js`, `node-enroll.js`, `nodes-server.js`, `state.js`, `jobs-adapter.js`. `node-agent/enroll.js` is not in the tree and not in the asar. Asar integrity matched header `22c24ab235472bb316d6249c0761e8d65fe89e32836e115694ac7b55a5e320f8`. Squirrel.framework is in the `.app`. `Electron Framework` contains the string `@rpath/Squirrel.framework/Squirrel` at byte offset 6016. The test menu source omits `Проверить обновления…` when `CFG.IS_TEST`, and `checkUpdates` returns before any GitHub fetch.

Listener: off unless `STUDIO_NODES=1` or saved `enabled`. A default server did not listen. `listen()` refused `0.0.0.0`, `8.8.8.8`, `10.1.2.3`, `192.168.1.9`, and `::` before bind. Settings POST returned 400 for `0.0.0.0`, public, and LAN addresses, and 200 for `100.64.1.2`. `HOST=0.0.0.0` for the panel exited 78. A public source on the node handler returned 403 `E_FORBIDDEN_SOURCE`.

`POST /api/comments` with `status: approved` and `status: replied` stored `new`. `drafted` stayed `drafted`. Reply returned 403 `publishing_disabled`. PUT then stored `approved`.

v1.2.3 regression items that passed again: publish guard, restore and seal migration, flavor markers, refusal of the v1.1.2 data directory, social egress blocked before DNS, no auto-update symbols, seal key absent from argv. The known local marker-rewrite residual reproduced: direct `node server.js` with consistent prod markers and a planted `meta.js` loads the publisher; `desktop/flavor-guard.js` still refuses because the asar lock stays test.

NODE 0.2.1 items, as observed here:

| Item | At 6cf7c08 |
|---|---|
| Signed pull replay / no nonce | Still present. Replay inside 120 s leased a second job (`nj_4afb517c704ff406` then `nj_cbc22819a768bb5a`). ±121 s returned 401. |
| Single IP bucket behind tailscale serve | Direct binds use `remoteAddress`. `X-Forwarded-For` did not select the bucket. A front that presents every peer as `127.0.0.1` would still share one in-memory bucket. Docs say not to use serve. |
| Fingerprint on the approval screen | API view includes `pubKeyFingerprint` and `pubKeyShort`. `public/app.js` has no enroll/confirm screen. The Connect computer screen and `node-agent/enroll.js` are not ported. |
| Hardcoded Funnel `ok: true` | `lib/ops/security-center.js` is not in this tree. |
| `tlsMode` pin skip | `enroll.js` is absent. `client({ tlsMode: 'tailscale', url: 'https://127.0.0.1:1' })` threw before connect and required `*.ts.net`. |
| Node self-rotation without the owner flag | Still present. `POST /api/nodes/rotate` returned a new token while `rotatePending` was false. Owner rotate of a bearer-only node still returns a token and requires the password and `СМЕНИТЬ`. |
| Bearer-only 0.2.0 minting | Still present, now behind the owner password and `ВЫДАТЬ`, id suffix `-test`. |
| State-file race | Still present. Two processes each returned a different enrollment token. `nodes.json` kept one hash. No lock in `state.js`. |
| Code in argv | Not present. No `--code` / `--enroll`. Agent argv did not contain `NODE_TOKEN`. |
| Confirm without a password | The enroll confirm route required `ПОДТВЕРДИТЬ` and the owner password (400 without them, 200 with them). |
| Timing | A correct enrolled bearer was about 39× slower than a wrong one over 200 calls (132605 ns vs 3416 ns). |

`docs/SECURITY_RECHECK_v1.2.4-test.md` section 2 says one-time codes are not implemented. The coordinator routes in `lib/ops/node-enroll.js` and `lib/ops/nodes-server.js` do implement them. The node enroll UI is what is absent.

Not run on this host: a real Tailscale address, macOS Keychain, launchd, Gatekeeper, notarization. The zip is ad-hoc signed and not notarized.

## Files

- `attack.mjs`, `logs/attack.log` — regression harness
- `nodes-attack.mjs`, `attack-race-child.cjs`, `logs/nodes-attack.json`, `logs/nodes-attack.log`
- `logs/BUILD-INFO.txt`
