# QA report r2 — MOONKATTY AI STUDIO TEST v1.3.1-test (QA-131-001 fix)
Head 3b72817d8c2a1af49d08c3f5d752f8e65dcaf0ef (c15de28 + 3b72817). Zip built from 3b72817. 2026-10-22. Independent QA (Grok Bot), token-free clones, Node v22.23.4.

## Overall: PASS — QA-131-001 CLOSED. codesign/Gatekeeper/real Mac: BLOCKED.

## Tests (clean clone, Node 22)
ops 119/0 (2 skip) · update-center 79/0 · ops:studio 2 pass/0 fail/2 skip · security 52/0 · isolation 65/0 · location 26/0 · policy 46/46 · publish-guard 59/0 · opencode 51/0 · opencode-serve 21/21 · opencode-json 22/22 · nodes 52/0 · memory, diagnose exit 0. All PASS.

## Hashes
Zip 9af58270…a1a8 = claim. Independent rebuild (FLAVOR=test package-mac-on-linux.sh, branch stab/v1.3.1-test @3b72817) byte-identical; MANIFEST identical. Info.plist (XML): com.moonkatty.aistudio.test, 1.3.1-test; unpacked build-info commit 3b72817. Shipped location-check.js = fixed version. Token scan of zip/asar/unpacked/out dir: clean.

## QA-131-001 code review — CLOSED
- checkLocation returns early unless flavor === 'test' (CFG.FLAVOR, baked) → prod never moves.
- No `conflictHandler: () => true` left (repo + shipped asar).
- Conflict: readBundleId(dest) reads Contents/Info.plist; unreadable/missing/binary/no key → null → refused with error dialog; id ≠ TEST appId (from studio-config) → refused. Only for test id: second dialog Отмена/Заменить, defaultId=cancelId=0 (Cancel); existsAndRunning disclosed. Dialog text corrected.
- Dest = /Applications/<own bundle basename>; a renamed bundle landing on the prod name is refused by bundle-id check.
- INFO: regex XML parse (first CFBundleIdentifier) — fine for electron-builder XML plists; binary plist is fail-safe (refused). If dest is a symlink to a test bundle, the symlink path is what gets replaced — acceptable.

## build-info.json investigation — LOW QA-131-004 (test hygiene, not a product defect)
desktop/build-info.json is gitignored and NOT committed. package-mac-on-linux.sh writes it into the working tree and leaves it after the build. update-center reads the real desktop/build-info.json (module constant); with the fresh builtAt (commit time) the fixture releases look older → anti-rollback blocks them. Reproduced: after a build in the same tree, test:ops 105/14 fail, test:update-center 65/14 fail; clean tree passes. Product behaviour is correct (anti-rollback working). Fix: build script removes/moves build-info.json in its EXIT trap (as for flavor files), or tests inject a build-info path/fixture.

## Docs
RELEASE_NOTES: QA-131-002 (upload unauthorized + no replay floor, "не подключайте узлы 0.2.2"), QA-131-003 codesign on Mac, qwen3:8b default (+ ollama pull), design3d fallback — present and accurate.
MAC_INSTALL: `codesign --verify --deep --strict --verbose=2` and `codesign -dv … | grep Identifier|Signature` correct, expected adhoc/test id; explicit "do not xattr -d / spctl --master-disable / SIP"; no sudo; Finder "Всё равно открыть" path; v1.1.2 untouched; backup of data dir recommended; states DB/Keychain/settings preserved (desktop.json with allowedHosts lives in the data dir and is preserved). INFO: STUDIO_ALLOWED_HOSTS/allowedHosts not named explicitly — suggest one line.
