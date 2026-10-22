# QA report — MOONKATTY AI STUDIO TEST v1.3.1-test
Branch stab/v1.3.1-test head d9dd15a; zip from 792f6c2; base v1.3.0-test-stab (f19c273). Date 2026-10-22. Independent QA (Grok Bot), token-free clones, Node v22.23.4.

## Overall: PASS (test build) — with 2 MEDIUM + 3 LOW findings. codesign/Gatekeeper/real-Mac: BLOCKED.

## Tests (Node 22)
| suite | d9dd15a | 792f6c2 |
|---|---|---|
| ops | 119/0, 2 skip | 119/0, 2 skip |
| update-center | 79/0 | 79/0 |
| ops:studio | 2 pass / 2 skip | **2 pass / 2 FAIL** ('upload: unauthorized'; 'floor persisted') |
| security | 52/0 | 52/0 |
| isolation | 65/0 | 65/0 |
| location | 12/0 | 12/0 |
| policy 46/46 · publish-guard 59/0 · opencode 51/0 · opencode-serve 21/21 · opencode-json 22/22 · nodes 52/0 · memory, diagnose exit 0 | PASS | same (ran) |
| smoke (server test flavor :8687, headless Chrome) | ok, errors [] | — |

## Hashes
Zip sha256 0ff88a51…4e02 = claim. Independent rebuild (FLAVOR=test scripts/package-mac-on-linux.sh, clean clone, branch stab/v1.3.1-test @792f6c2) → byte-identical zip; MANIFEST.sha256 and BUILD-INFO identical. mac-diagnose.sh/.command hashes match sidecar and git. Info.plist: com.moonkatty.aistudio.test, CFBundleName "MOONKATTY AI STUDIO TEST", 1.3.1-test; flavor.baked.js = 'test'. Token/password scan of zip, app.asar (extracted), unpacked, out/ dir: clean.
Zip vs head: 792f6c2..d9dd15a changes only test/ops/nodes.multiprocess.test.js (not shipped) → zip not stale in content.
codesign-verify.txt in out/ shows rcodesign errors ("verify only works on Mach-O"; "CMS error") — verification on Mac BLOCKED.

## 1. Base fix (d1adf4d..f19c273: ab97d37 + f19c273)
- POST/GET /api/opencode/serve: 403 unless CFG.IS_TEST; behind global /api session auth, hostCheck, csrfCheck. Port fixed to TEST 4097, explicit refusal of PROD 4096 (never probed), --hostname 127.0.0.1, only loopback hostnames accepted. Password from Keychain (service 'MOONKATTY AI STUDIO.test', account opencode-server-password) only in child env (minimal env, not argv); output scrubbed; not returned/logged. PASS.
- serve.sh: prod path pinned to 4096/prod Keychain, refuses 4097; MK_FLAVOR=test execs serve-test.sh. PASS.
- Default model ollama/qwen3:8b (PROD+TEST, opencode-studio.json): used only when integration model is unset (it.model || default). Cannot change installed prod v1.1.2 (separate bundle/data dir; test build never touches them). Would change behaviour of a FUTURE prod build for users without an explicit model → LOW (release-note item).
- lib/host-memory.js: execFile('/usr/bin/vm_stat'|'/usr/bin/memory_pressure', []) fixed paths, no shell, regex parsing, timeout, cached. PASS.
- design3d fallback: when OpenCode is down/timeout/model error/bad JSON, studio writes rule-based validated params, warns in job log, paramsBy '+fallback'; security violations (written files, forbidden tools, 3 permission asks) still throw; writes only in projects3d version dir; no server/blender* writes. Not silent. LOW: job ends "done" — UI should flag fallback clearly.

## 2. f19c273..d9dd15a
- desktop/location-check.js: Electron isInApplicationsFolder/moveToApplicationsFolder; asks user (dialog, default move, cancel continues); no xattr/spctl/child_process. Moves to /Applications/<bundle name>.app = "MOONKATTY AI STUDIO TEST.app", so the production /Applications/MOONKATTY AI STUDIO.app is not touched by this build. DB/Keychain/data dir/desktop.json (allowedHosts) untouched by the move; no schema/migration changes (schema 6).
- **MEDIUM QA-131-001**: `conflictHandler: () => true` auto-approves replacement of an existing same-named bundle (incl. 'existsAndRunning' → Electron terminates the running copy) with no second prompt; dialog text claims "macOS спросит о её замене" (it will not). Also not flavor-gated: a PROD build from this source would replace /Applications/MOONKATTY AI STUDIO.app (production) after one click. Fix: gate to CFG.IS_TEST (or verify bundle id), conflictHandler that shows a confirm dialog / refuses existsAndRunning, correct text.
- mac-diagnose: separate asset, read-only (curl to loopback health, writes only its own report file to Desktop/HOME). PASS.
- Version 1.3.1-test, same bundle id/data dir/Keychain service as 1.3.0-test. PASS.
- **MEDIUM QA-131-002 (skips)**: the 2 skipped ops:studio tests FAIL at the zip commit 792f6c2 and were skipped in d9dd15a. Skip reasons are honest (features absent in 1.3.x) but they document real gaps in the 1.3.1-test coordinator: (a) enrolled 0.2.2 nodes get 'upload: unauthorized' (signed upload unsupported → node 0.2.2 file results fail against 1.3.1-test); (b) no replay floor at all in 1.3.x useNonce (no startedAt check) → signed requests captured within ±30 s are replayable after a coordinator restart (QA-NODE-001 residual open; mitigated by pinned TLS + tailnet). Skips are acceptable only if tracked and nodes 0.2.2 are not paired with 1.3.1-test.

## Other LOW
- QA-131-003 LOW: codesign-verify.txt contains failed rcodesign verification output (wrong invocation on bundle) — redo verification on Mac.
