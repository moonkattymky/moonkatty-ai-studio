# Final audit — v1.2.1-mac-preview

Independent QA before a Mac mini install. Read-only on `main` and every other branch. This file is the only write, on `feat/quality-automation`. Nothing was merged and nothing was published. No quality score is assigned.

## Recommendation

**NO-GO** as the studio the owner would publish from, and **NO-GO** as a build that contains Video Factory, the News Engine, or shared memory.

**Conditional GO** only as the prerelease 3D Studio stage C preview named in the GitHub release, and only if all of the following stay true:

1. Before the first launch, copy the v1.1.2 `studio.db` (and any `studio.db-wal` / `studio.db-shm`) out of `~/Library/Application Support/MOONKATTY AI STUDIO/`. The upgrade experiment kept the seeded user, task, queue row, and Ollama model. The app does not take that copy itself (QA-DB-001).
2. Leave Facebook and Instagram disconnected until QA-APR-001 is fixed. `POST /api/queue` can store `status: "approved"` or `status: "retry"` without the fact-check and daily-limit guardrails. With a connected workspace, `meta.tick` will call `publish()` for those rows.
3. Treat Keychain, launchd, Gatekeeper, and Metal Blender as unchecked. The arm64 `.app` cannot run on this Linux host. The Mac checklist below is the remaining work.
4. Do not point Studio 2 at this server for `video_render`. The tagged jobs API returns HTTP 400 `Неизвестный тип задания: video_render`.

Reasons for the NO-GO beyond that preview scope: commit `a991e93` (video_render), `a33a315` (media-automation / Studio 2), and `fa0efc4` (news-launch) are not ancestors of the tagged commit. Shared-memory tables from `feat/studio-intelligence` and `feat/studio-operations` are not created by this server.

## Release identity

| Check | Result |
| --- | --- |
| Asset | `MOONKATTY-AI-STUDIO-1.2.1-arm64-mac.zip` from `https://github.com/moonkattymky/moonkatty-ai-studio/releases/tag/v1.2.1-mac-preview` |
| SHA-256 actual | `ae87d263c9aac16f929112a35401046833df96a578210b396d2e9c0aed7c8b42` |
| SHA-256 expected | `ae87d263c9aac16f929112a35401046833df96a578210b396d2e9c0aed7c8b42` |
| Match | yes (`sha256sum` and the `.sha256` sidecar) |
| Tag commit | `42d3fd5866cb7a84d6a3e12647e3c4c24dec4597` |
| Subject | `v1.2.1: 3D Studio stage C — references, review (approve/rework/reject), versions, re-render controls, exports, local GLB viewer, i18n, test:3c` |
| BUILD-INFO commit | same SHA |
| Release | prerelease, published 2026-10-20T22:48:36Z, title "MOONKATTY AI STUDIO 1.2.1 mac preview (3D Studio stage C)" |
| Build host | Linux, ad-hoc signed, not notarized, Electron 44.9.1, electron-builder 26.15.3, minimum macOS 12.0, arm64 only |
| Bundled server node | `Contents/Resources/node/node`, 122490848 bytes, BUILD-INFO says v24.22.0. SHA-256 `b125bfe123da81a7f3b60181bf638d9ac548e508599a959e34a37710a1eba11b`. Not executed (Mach-O arm64). |

Shipped unpacked sources match the tag blob byte for byte:

| File | SHA-256 (zip and `git show 42d3fd5`) |
| --- | --- |
| `app.asar.unpacked/lib/jobs.js` | `bfd4b6f353506313578632035535e0113ae607c00e06754c8c2bed0bbc0c60b8` |
| `app.asar.unpacked/lib/services.js` | `a4233b5dfe6517bdbff82f80a27c3ee0ea41b27bb48856bff2a2cf1b11e11620` |
| `app.asar.unpacked/server.js` | `9e84ac700c9f4360682456ec67e85e58d46511a0319ba46d18fec3bcc92424aa` |

`git merge-base --is-ancestor` against `42d3fd5` exits 1 for all three:

- `a991e933029815b194b2234f0751a092c5318b48` — only commit on `origin/feat/v1.2.0` after the tag (`git log v1.2.1-mac-preview..origin/feat/v1.2.0`)
- `a33a315ff0a7c4a5adc765f0f572b5f49e0bba39` — `origin/feat/media-automation`
- `fa0efc4dd293586a2351ebaa146ab6acdfd3723e` — `origin/feat/news-launch-integration`

`v1.1.2-mac-preview` is `3f9bd9038a3245a362b355565c4ba2a860c6ba3c`.

Electron fuse wire in `Electron Framework` (sentinel `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`, version 1, length 9): bytes `[48, 49, 48, 48, 49, 49, 48, 49, 49]` which is DISABLE, ENABLE, DISABLE, DISABLE, ENABLE, ENABLE, DISABLE, ENABLE, ENABLE. That is RunAsNode off, cookie encryption on, NODE_OPTIONS off, inspect off, asar integrity on, only-load-from-asar on, browser V8 snapshot off, `GrantFileProtocolExtraPrivileges` on (set in `package.json` `electronFuses`), and index 8 on. Index 8 is `WasmTrapHandlers` in `@electron/fuses` 2.1.x. The packager's enum stops at index 7, so BUILD-INFO prints `undefined is Enabled`. The byte is the upstream recommended ENABLE. See QA-INFO-001.

`better-sqlite3` is excluded from the asar (`package.json` `files` `!node_modules/better-sqlite3/**`). The Mac server is the bundled Node binary. Linux tests below used `better-sqlite3` unless `STUDIO_SQLITE=node` is named.

## Suite of the tagged commit

Worktree `/tmp/mk-src-v121` at `42d3fd5`, `npm ci`, Node v22.23.3. Commands and raw logs are in `logs/`. This host has Chrome at `/usr/bin/google-chrome-stable`, ffmpeg, and no `blender`, no `opencode`, and no `/workspace/tools`.

| Command | Exit | Count printed by the suite |
| --- | --- | --- |
| `npm run test:policy` | 0 | `46/46 passed` |
| `npm run test:security` | 0 | `{"passed":51,"failed":[]}` |
| `npm run test:opencode` | 0 | `{"passed":51,"failed":[]}` |
| `npm run test:runner` | 0 | 5 PASS lines, exit 0 (`scripts/runner-test.mjs` has five assertions) |
| `npm run test:3d` | 2 | `SKIP: opencode not found at /workspace/tools/oc/node_modules/.bin/opencode` |
| `npm run test:3c` | 2 | same SKIP, exit 2 |
| `node scripts/smoke.mjs http://127.0.0.1:8860 audit igor <fake>` with `CHROME=/usr/bin/google-chrome-stable` | 0 | `{"ok": true, "errors": []}` |

`scripts/desktop-test.mjs` is not an npm script. `node_modules/electron/dist/electron` is not present after `npm ci` in this environment, and the release `.app` is arm64 macOS. Desktop Electron was not launched.

The OpenCode suite's first two launches failed in this environment (fake `security` is `#!/usr/bin/env node`, and `lib/opencode-auth.js` spawns it with `PATH=/usr/bin:/bin`, where `node` was missing; a second launch also hit servers left on 8796/8797 by the crashed first process). After `/usr/bin/node` → `/exec-daemon/node` and those ports were free, the same command printed 51 passed, 0 failed. That pass uses `scripts/test-fixtures/fake-security.mjs` under `NODE_ENV=test`. It is not a macOS Keychain run.

Release-note counts that this host reproduced: security 51/51, opencode 51/51, policy 46/46, UI smoke ok. Release-note counts this host did not reproduce: `test:3c` 61/61 and `test:3d` 53/53, because both scripts exit 2 before any assertion when the OpenCode binary is missing.

## 1. Main app — pass

Server auth, sessions, CSRF, startup, and settings were exercised on Linux. The packaged `.app`, launchd, and cookie encryption at runtime were not.

Evidence:

- `logs/security.log`: setup with a fake password, `mk_session` HttpOnly + SameSite=Strict, 401 without a session, host rebinding 421, cross-origin 403, missing `X-Studio-Request` 403, CSP, path traversal, upload name sanitizing, SQLi stored as data, `codeApproved` stripped, OpenCode disabled so a shell payload stays `blocked`, meta secret absent from API and from the db file, session token stored only as `h:` + sha256, login 429 after repeated failures, listen address 127.0.0.1. Code: `server.js` lines 60–118, `lib/security.js` `hostCheck` / `csrfCheck`.
- Health of a fresh v1.2.1 process: `version` `1.2.1`, `db` `ok`, bound to `127.0.0.1:8860` (`logs/smoke.log` server was that process).
- `logs/smoke.log`: login, director chat, task form, news episode, social queue, settings, reports, EN/UK, 390×844 viewport. Playwright reported `ok: true` and `errors: []`.
- Settings round-trip is inside the security test (`PUT /api/meta/config` secret not returned) and the migration test (`integrations/ollama` model `qa-sentinel-model` still readable after upgrade).

Mac-only remainder: see the checklist (Gatekeeper, launchd, DevTools, cookie jar encryption).

## 2. OpenCode agent executor — not testable

Real Keychain and `sandbox-exec` require macOS. The Linux stand-in of the Keychain protocol passed. A real `opencode` binary was not on this host, so the executor process was not started.

Evidence that did run:

- `logs/opencode.log` 51/51: password stored via the fake `security -i` stdin protocol, absent from argv, SQLite, WAL, backups, logs, and API bodies; no Keychain → HTTP 409 and no fallback file; UI field cleared (Chrome). Implementation: `lib/opencode-auth.js` lines 1–40, service `MOONKATTY AI STUDIO`, account `opencode-server-password`.
- Master key on Linux is `data/secret.key` mode 0600 (`lib/keystore.js` lines 8–22). Darwin would use `/usr/bin/security` and rename an old file to `secret.key.migrated-to-keychain`. That branch was not executed.
- Default off: `logs/runner.log` line "OpenCode отключён (по умолчанию)". `runner.js` lines 45–57 refuse to spawn unless `STUDIO_OPENCODE=1`, and on non-darwin refuse unless `STUDIO_OPENCODE_UNSANDBOXED=1`.
- Policy limits: `logs/policy.log` 46/46. Shell always deny, path escape deny, `.blend` overwrite deny, OpenCode bash/webfetch/external_directory deny (`lib/policy.js`). Blender spawn is `shell: false` with a timeout (`lib/blender.js` lines 19–34). OpenCode CLI timeout in code is 15 minutes (`runner.js` line 60). Heavy work is one-at-a-time (`lib/heavy-lock.js`).

Code defect still present, not executed: QA-OC-001. The seatbelt profile allows writes under `/private/tmp` and `/private/var/folders` (`runner.js` lines 37–41). `docs/INSTALL_MAC.md` describes a deny of writes outside the task folder.

## 3. Blender automation — not testable

No Blender binary on this host (`command -v blender` empty, `/workspace/tools/blender-5.2.2-linux-x64/blender` absent). `test:3d` and `test:3c` exit 2 before calling Blender. Metal, EEVEE, and headless `Blender.app` were not run.

What the tagged source does, unread by a live process: `lib/blender.js` `detect()` runs `blender -b --factory-startup --version` and `probe.py`, rejects versions below the minimum in that file, and `runTemplate` only accepts template names matching `^[a-z_]+$` with argv and no shell. `blender_template` jobs go through `lib/services.js` `startTemplateJob` and the heavy lock. Policy test "vetted template → allow" / "generated Blender script → confirm" passed (`logs/policy.log`).

## 4. Video Factory — fail

The tagged build has no video renderer.

- `unzip` of `lib/services.js` contains zero `video_render` strings.
- `lib/services.js` lines 13–17 `TYPES`: `design3d`, `blender_template`, `opencode_task` (stub, status `failed` immediately), `render_segment` (stub, status `failed` immediately). `host3d.renderSegment` returns `null` (line 74).
- Live probe `logs/probes.json`: `POST /api/jobs` `type: "video_render"` with `{runId, preset, episodeRef}` → HTTP 400 `Неизвестный тип задания: video_render`. `render_segment` → HTTP 201 then job status `failed` with the reserved-stub error.

`a991e93` adds `video_render` with a stub executor whose message is `video_render: Не подключено…` and writes no files. That commit is not in this zip. There is no ffmpeg pipeline in the tagged server.

## 5. News Engine — not testable

The News Intelligence Engine is not in the tag. `git ls-tree 42d3fd5` has no `media-automation/src/news`. That tree exists on `a33a315` (`media-automation/src/news/engine.js` and the rss/verify/classify modules) and is re-imported by `fa0efc4`. Neither commit is in the tag.

What shipped is the existing news panel (episodes, pipeline stages in `public/core.js`, social queue). `logs/smoke.log` loaded hash `news` with an empty error list. That is the panel, not the unmerged engine. No outbound fetch to a news provider was attempted.

## 6. Approval Center — fail

3D review is locked to one route. Social queue status is not. Nothing in the probe contacted Meta; both publish calls returned before `graph()`.

3D path, pass:

- `POST /api/tasks` with `kind: "3d"` and `status: "done"` is stored as `queued` (`server.js` lines 360–367).
- `PUT` of that task's status → HTTP 403 `Статус 3D-задачи меняется только через 3D Studio`.
- Approve / rework / reject is `POST /api/jobs/:id/review` (`server.js` lines 324–337).

Social path, fail (QA-APR-001, QA-APR-002), from `logs/probes.json` against a fresh server with a loopback app token:

| Call | HTTP | Stored / error |
| --- | --- | --- |
| `POST /api/queue` news item, `status: "approved"`, `factCheck: "pending"`, no `sourceUrl` | 201 | `status: "approved"` |
| `PUT` the same shape onto a `pending_approval` row | 400 | `Новость не проверена…; Нет ссылки на источник…` |
| `PUT` `status: "published"` plus `publishedAt` and `externalId` | 200 | `status: "published"`, `publishedAt: null`, `externalId: null` (those two fields are stripped) |
| `POST /api/queue` `status: "retry"`, `nextRetryAt` in 2000 | 201 | stored as sent |
| `POST /api/queue/:id/publish` on the published row | 400 | `Нужно утверждение` |
| `POST /api/queue/:id/publish` on the illicit approved row | 400 | `Не подключено` |

Code: `server.js` lines 351–353 protect `queue.history`, `publishedAt`, `externalId`, and do not protect `status`. Lines 368–373 `POST` inserts the body with no guardrails. Lines 376–380 run `S.guardrails` and `S.dailyCheck` only when `PUT` sets `status === "approved"`. `meta.js` lines 154–165 `publish()` allows `approved` and `retry`. Lines 200–205 `tick()` publishes an approved row when the workspace has `autopublish` and `scheduledAt` is due, and publishes a `retry` row when `nextRetryAt` is due. The probe had no page token, so `blockReason` returned `Не подключено` and no Graph request was made. A connected workspace would pass that check.

`codeApproved` on tasks cannot be set through generic CRUD (security test, pass).

## 7. Shared memory — not testable

The tag has no shared-memory product module. A search of `42d3fd5` for `sharedMemory` / `shared memory` hits `process.memoryUsage`, the heavy-lock comment about 24 GB, the OpenCode password held in memory, and an entitlements comment. No `si_records` table is created.

Unmerged, not executed:

- `origin/feat/studio-intelligence` `studio-intelligence/src/memory.js` — records in `si_records`, namespaces `moonkatty_news` | `moonkatty_project` | `moonkatty_shared`, status `draft|approved|superseded|rejected` (`studio-intelligence/contracts/memory-record.schema.json`).
- `origin/feat/studio-operations` `lib/ops/memory.js` — host RAM statistics (vm_stat / `/proc/meminfo`), not a shared record store.

This server will not read or write those tables.

## 8. API compatibility with the unmerged branches — fail

Jobs API that the tag actually implements matches `docs/JOBS_API.md` at `42d3fd5`: create/get/list/cancel, public statuses, types `design3d`, `blender_template`, `opencode_task`, `render_segment`. Idempotency on `qa-mig-job-1` returned `existing: true` and the same `jobId` (`logs/migrate.log`).

Incompatible with the branches that are not merged:

| Caller | This build |
| --- | --- |
| `a991e93` `video_render` input `{runId, preset, episodeRef}`, idempotency `<runId>:<preset>` | HTTP 400 unknown type (`logs/probes.json`) |
| `a991e93` default executor | not present; the stub message is not reachable |
| `a33a315` `StudioJobQueueAdapter` with no client | throws `NotConnected` in that branch's own code; not loaded here |
| `a33a315` `supportedTypes` adds `video_render` only when `videoRender.hasExecutor()` is true (`media-automation/src/jobs/studio-adapter.js` lines 16–17) | this build exports no `videoRender`. `a991e93` exports `isStub` / `getExecutor`, not `hasExecutor`. Passing that module object as `videoRender` leaves `hasExecutor` undefined and `executor` undefined, so `supportedTypes` stays without `video_render` even after both commits land |
| `render_segment` / `StudioHost3D.renderSegment` | stub job `failed`, in-process `renderSegment()` returns `null` |
| News-launch and studio-intelligence contracts | no routes, no tables |

`opencode_task` and `render_segment` fail closed (status `failed`, task `blocked`) rather than running a shell. That part is compatible with the documented stubs.

## 9. DB migration from v1.1.2 — pass

An upgrade was run. Seeded rows survived. The app does not make the backup itself (QA-DB-001). Rollback that was tested is "put the copied file back".

Procedure (`/tmp/mk-audit/migrate.mjs`, log `logs/migrate.log`):

1. Start `3f9bd90` (`/tmp/mk-src-v112`) on an empty data dir with `STUDIO_ADMIN_PASSWORD` set to a fake value. Login HTTP 200.
2. Insert task `QA-MIG-TASK-keep` (`mvhskrp7830a6p`), queue `QA-MIG-QUEUE` status `pending_approval`, and set `integrations/ollama.model` to `qa-sentinel-model`.
3. Stop, `PRAGMA wal_checkpoint(TRUNCATE)`, copy `studio.db` to `backup-v112.sqlite`. Tables before upgrade: `items`, `meta`. No `jobs` table.
4. Start `42d3fd5` on that directory. Same password login HTTP 200. Task, queue, and model unchanged. `users` meta SHA-256 unchanged: `bd75fc5afe57218b53fe3f3e106474d9bfed66ce71cc224e1d6da8cbe17e1e90`.
5. `POST /api/jobs` `opencode_task` idempotency key `qa-mig-job-1` → `job_a7ed916edd7985cb`. Repeat POST → `existing: true`, same id.
6. Second boot of v1.2.1: login 200, that job still `failed` with the same id and key. `users` hash unchanged. Collection counts unchanged except `logs` 9 → 10 (the server appends a log on the new boot). Job row count stayed 1.
7. Open the upgraded directory with v1.1.2: login works, task still `QA-MIG-TASK-keep`. The `jobs` row is still in the file afterward (`oldKeepsJob` in the log). v1.1.2 does not drop the extra table.
8. Copy `backup-v112.sqlite` to a new directory and start v1.1.2: login works, task and model are back, `jobs` is absent.

Schema after upgrade (`PRAGMA table_info(jobs)` on the better-sqlite3 file): original job columns plus `resource_class`, `requires_node`, `idempotency_key`, `safe_to_retry INTEGER NOT NULL DEFAULT 1`, `input TEXT NOT NULL DEFAULT '{}'`, unique partial index `jobs_idem`. Source of the ALTER is `lib/jobs.js` lines 16–19, guarded by `PRAGMA table_info` so a second boot does not add the columns again.

Same backup file booted twice with `STUDIO_SQLITE=node` (the driver `lib/db.js` selects for Electron, and the one the Mac bundle must use because `better-sqlite3` is not in the asar): health `dbDriver: "node:sqlite"`, login 200, same task id and model, job `job_8998188c239c67c7` still present on the second boot, repeat create returns `existing: true`. Snapshot: `logs/node-sqlite-snapshot.json`. Node 22.23.3 printed `ExperimentalWarning: SQLite is an experimental feature`. The bundled server binary is Node 24.22.0 and was not executed.

Side effect, by design of `server.js` lines 88–89: agent `design3d` changes from `enabled: false`, `inDevelopment: true`, `status: "dev"` to `enabled: true`, `inDevelopment: false`, `status: "idle"`, and the role string gains "OpenCode-агент + Blender (headless)". The row is not deleted.

`/api/backup` (`server.js` line 129) dumps `core.COLLECTIONS` only. It does not include the `jobs` table or `meta` (`users`, `sessions`). There is no down migration and no automatic copy of `studio.db` before the ALTER.

## Mac checklist

Run on the Mac mini with fake passwords. Record macOS version. The existing long form is `docs/MAC_TEST_CHECKLIST.md` at this tag. Do these before treating the preview as installed:

1. Confirm the zip: `shasum -a 256 MOONKATTY-AI-STUDIO-1.2.1-arm64-mac.zip` prints `ae87d263c9aac16f929112a35401046833df96a578210b396d2e9c0aed7c8b42`.
2. Copy `~/Library/Application Support/MOONKATTY AI STUDIO/studio.db` and any `-wal`/`-shm` to a folder outside the app before the first 1.2.1 launch. After launch, log in with the existing password and confirm a known task title and the Ollama URL are still there. Quit, relaunch, confirm the same rows. To roll back, quit the app and `launchctl bootout gui/$UID/com.moonkatty.aistudio.server`, then put the copied db back.
3. Gatekeeper: opening the zip from Finder is expected to warn (ad-hoc, not notarized). `codesign --verify --deep --strict --verbose=2` on the `.app`. `npx @electron/fuses read --app "<app>"` should show RunAsNode disabled, cookie encryption enabled, NODE_OPTIONS disabled, inspect disabled, asar integrity enabled, only-load-from-asar enabled. Index 8 (`WasmTrapHandlers`) should read enabled. Confirm the About box shows version 1.2.1 and commit `42d3fd5`.
4. launchd: `launchctl print gui/$(id -u)/com.moonkatty.aistudio.server` state running, program path ends in `Contents/Resources/node/node`. `lsof -iTCP:8787 -sTCP:LISTEN` shows only `127.0.0.1`. Quit the window: `curl http://127.0.0.1:8787/api/health` still answers. `kill -9` the server pid: a new pid appears within about 10 seconds. Toggle start-at-login and confirm the plist appears and disappears under `~/Library/LaunchAgents/com.moonkatty.aistudio.server.plist`.
5. Keychain: first secret save creates generic password service `MOONKATTY AI STUDIO` account `studio-master-key`, and a pre-existing `secret.key` is renamed `secret.key.migrated-to-keychain`. Startup screen says the encryption key is macOS Keychain. OpenCode password account `opencode-server-password` round-trips (save, test connection against a local `opencode serve`, delete). `ps` during save does not show the password. `strings` on `studio.db` does not show the test secret. `grep` of Application Support and Logs does not show it.
6. Logout shows the password form and does not auto-login. Safari to `http://127.0.0.1:8787` asks for the password.
7. Blender: 3D Studio "Проверить" finds Blender 5.x, reports version and Python API. A headless EEVEE or Workbench render from the app uses Metal. Cancel during render removes the `blender` process. Relaunch during render resumes at the render stage. Ollama and Blender do not run at the same time (heavy lock). Approve / rework / reject only through the review buttons; a 3D task status does not change from the generic task form.
8. OpenCode stays blocked with "OpenCode отключён" until `enableOpenCode` is set. If you enable it on a test account, confirm `sandbox-exec` is the parent and that a write under `/private/tmp` is the case QA-OC-001 says is allowed. Writes into the studio db path should still fail.
9. Do not connect a Meta page on this build. If you already have one connected, disconnect it before leaving the machine unattended. QA-APR-001 is reachable by any local client that can read `app-token` or that has a session.
10. Confirm `POST /api/jobs` with `type: "video_render"` returns 400. That is the expected result of this zip.

## Defects, highest severity first

### QA-APR-001 — high — social queue can skip approval guardrails

Authenticated `POST /api/queue` stores `status: "approved"` or `status: "retry"` without `guardrails()` or `dailyCheck()`. `meta.tick` (`meta.js` lines 200–205) will `publish()` an approved row when autopublish is on and `scheduledAt` is due, and a retry row when `nextRetryAt` is due, once a workspace is connected. The UI Approve button uses `PUT`, which does run the guardrails. Repro is the table in item 6 and `logs/probes.json`. This probe did not send traffic to Meta (`Не подключено`).

### QA-APR-002 — medium — queue row can be marked published with no external post

`PUT /api/queue/:id` `{status:"published"}` returns 200 with `publishedAt` and `externalId` still null. `publish()` rejects that status (`Нужно утверждение`). The social UI treats `status === "published"` as a published post. Same probe log.

### QA-DB-001 — medium — upgrade does not snapshot the database

`lib/jobs.js` lines 16–19 run `ALTER TABLE` on startup with no copy of `studio.db`. `server.js` line 129 backup JSON omits `jobs` and `meta`. The experiment's rollback was a file copy made beforehand. Data loss was not observed when that copy existed.

### QA-OC-001 — medium — OpenCode seatbelt allows `/private/tmp`

`runner.js` lines 37–41 allow `file-write*` under `/private/tmp` and `/private/var/folders` in addition to the task directory. OpenCode is off unless `STUDIO_OPENCODE=1`. Not executed on macOS.

### QA-INFO-001 — low — BUILD-INFO names fuse index 8 `undefined`

The fuse wire byte is ENABLE (49). In current `@electron/fuses` that index is `WasmTrapHandlers`, which upstream sets to enabled. The installed packager enum has no name for it, so the text file says `undefined is Enabled`. Not a weakened fuse.

### Scope gaps (blocking only if this zip is asked to be those products)

- Video Factory / `video_render`: absent. Item 4. Commit `a991e93` is not in the tag.
- News Engine: absent. Item 5. Commits `a33a315` and `fa0efc4` are not in the tag.
- Shared memory (`si_records`, host memory sampler): absent. Item 7.
- `a33a315` looks for `videoRender.hasExecutor`; `a991e93` exports `isStub` instead. Item 8. Both commits are unmerged, so this is a merge hazard, not a bug inside `42d3fd5`.

No CRITICAL defect was observed in auth, CSRF, session storage, 3D status locking, or the v1.1.2 → v1.2.1 data upgrade.
