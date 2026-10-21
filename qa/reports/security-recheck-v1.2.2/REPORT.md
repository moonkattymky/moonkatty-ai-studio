# Security recheck — v1.2.2-test

No tag named `v1.2.2-test` exists. No GitHub release asset exists for it. The isolated test build is the branch `feat/v1.2.2-test-isolated` at commit `f2440e111b8e8caaeda3fd799cee4b7652496c60` (2026-10-21 11:02:27 +0300, subject starts `v1.2.2-test: isolated TEST build flavor`). `package.json` version is `1.2.2-test`. This recheck ran that commit from a detached worktree. Nothing was merged and nothing was published. Fake password only. No call to Meta, Facebook, Instagram, or any other network publisher.

## Conclusions

**Blender on the Mac mini:** allowed only as a local render trial of the isolated test app (its own data directory, port 8687, Meta disconnected). It is not a sign-off. This host has no `blender` binary, so headless Blender was not run.

**Real social accounts:** not allowed. On the test flavor, `/api/queue/:id/publish`, `/api/comments/:id/reply`, and `meta.tick` do not publish. The same commit started with `node server.js` and no `STUDIO_FLAVOR` is flavor `prod`, and that flavor accepts a client-supplied `externalId` and leaves the publish route mounted. There is no packaged zip in this repo that bakes `studioFlavor: "test"`.

**What blocks a full launch:**

1. The git tree is not locked to the test flavor (`package.json` has no `studioFlavor`; `build.appId` is `com.moonkatty.aistudio`; `scripts/package-mac-on-linux.sh` defaults `FLAVOR` to `prod`). An unpackaged run is the production server.
2. On that production flavor, `PUT /api/queue/:id` with `status: "published"` and any matching `externalId` stores the row and does not check a platform response (QA-APR-002 is not closed for prod).
3. `POST /api/restore` after the owner types `ЗАМЕНИТЬ` writes queue `status: "published"` and a forged `externalId` with no fact-check and no platform call. Test flavor still will not call Graph.
4. Blender, real Keychain, launchd, and `sandbox-exec` were not executed.
5. `video_render` now exists and its default executor fails with `Не подключено`. It does not render.

## How this was run

`STUDIO_SRC=/tmp/mk-src-v122` (detached `f2440e1`, `npm ci`) and:

`node qa/reports/security-recheck-v1.2.2/approval-exploit.mjs`

Log: `logs/exploit.log`. Result line: `controlsPassed: 32`, `controlsFailed: []`, exit 0. Findings are listed separately; they are observed behaviors, not harness crashes.

Test flavor means `NODE_ENV=test` and `STUDIO_FLAVOR=test`, which is the only way this source tree becomes the isolated build (`lib/studio-config.js` lines 8–12). A packaged app would need `scripts/package-mac-on-linux.sh` with `FLAVOR=test`, which writes `extraMetadata.studioFlavor=test` (that script, lines 10–16). No such zip is in the repository or in `gh release list`.

## 1. Unauthorised bypass of Approval Center — FAIL

Unauthenticated `POST /api/queue` is HTTP 401. `POST /api/queue` cannot create `approved`, `published`, or `retry`: the body is forced to `pending_approval` and `nextRetryAt` is dropped (`server.js` lines 405–407). Evidence: `logs/exploit.log` lines 2–5. `PATCH /api/queue/:id` is HTTP 404.

A logged-in client can still write those statuses without the Approval Center PUT:

- `POST /api/restore` after `confirm: "ЗАМЕНИТЬ"` stored `qa-restore-published` with `status: "published"` and `externalId: "forged_from_restore"` (`logs/exploit.log` finding; `server.js` lines 164–174 copy collection objects as they are).
- `POST /api/comments` stored `status: "approved"` (`logs/exploit.log`). On the test flavor the reply route still returns 403, so that row was not sent.

No WebSocket handler exists. Grep of `put('queue'` / `status: 'published'` outside `public/` and the tests hits only `meta.js` lines 188 and 193, inside `publish()`, which the test flavor does not call. Job review (`server.js` lines 370–383) changes a 3D job, not the social queue. A 3D task `POST` with `status: "done"` is stored as `queued`, and `PUT` of that status is HTTP 403.

## 2. Fact-check before approval — PASS for news, not for other queue items

`PUT` `status: "approved"` on a news row with no `factCheck` and no `sourceUrl` returned HTTP 200 was the wrong experiment when those fields had been sent on `POST`. After posting a news row without them:

- `PUT {status:"approved"}` → HTTP 400 `Новость не проверена: этап «Проверка фактов» не пройден; Нет ссылки на источник (атрибуция обязательна)`.
- `PUT {status:"approved", factCheck:"passed"}` → HTTP 400 `Нет ссылки на источник`.
- `PUT` that also sends `factCheck:"passed"` and `sourceUrl` → HTTP 200 `approved`.

The gate is `server.js` lines 435–438 calling `public/social.js` `guardrails` lines 85–89. The same logged-in client supplies `factCheck`. There is no second principal. A `brand: "moonkatty"` item was approved with no fact-check field (HTTP 200). Fact-check is mandatory only when `brand` or `kind` is `news`.

On the test flavor, approval does not lead to a network publish (item 4).

## 3. Published requires a verified platform result — FAIL

Test flavor: `PUT {status:"published"}` → HTTP 400 `external_id_required`. Blank `externalId` → HTTP 400. `externalId: "forged_platform_id_1"` → HTTP 403 `publishing_disabled`. The row stayed `approved` with no `externalId` (`server.js` lines 408–411).

That is a disable switch, not a check of a platform body. `meta.js` lines 188–189 set `published` from `result.id || result.post_id` with no check that the id is non-empty, and that function was not invoked.

Prod flavor of this same commit (`STUDIO_FLAVOR=prod`, `NODE_ENV=test`): `PUT` with `externalId: "forged_on_prod_flavor"` returned HTTP 200 and stored `status: "published"`. No platform was contacted. `POST /publish` on that row returned HTTP 400 `Нужно утверждение`, which shows the route is mounted (it is not `publishing_disabled`).

Restore on the test flavor also stores `published` plus a forged `externalId` (item 1).

## 4. Publishing disabled on the test flavor — PASS

Health: `flavor: "test"`, `product: "MOONKATTY AI STUDIO TEST"`, `version: "1.2.2-test"`, `schemaVersion: 4`.

- `POST /api/queue/:id/publish` → HTTP 403 `publishing_disabled` (`server.js` line 137, before `meta.mountProtected`).
- `POST /api/comments/:id/reply` → HTTP 403 `publishing_disabled`.
- `PUT` published with a forged id → HTTP 403 `publishing_disabled`.
- An approved news row was still `approved` after the scheduler window. `server.js` line 472 skips `meta.tick()` when `CFG.IS_TEST`.

`node server.js` with no `STUDIO_FLAVOR` reported `flavor: "prod"`. Publishing is disabled only when the process is actually the test flavor.

## 5. Status-transition paths — PASS for the paths that were executed

| Path | What it writes | This run |
| --- | --- | --- |
| `server.js` 407 `POST /api/queue` | forces `pending_approval` | PASS, cannot set approved/published/retry |
| `server.js` 408–411 `PUT` published | requires `externalId`; test flavor 403 | PASS |
| `server.js` 435–446 `PUT` approved/retry | guardrails then save | news without fact-check 400; with client-supplied fact-check 200 |
| `server.js` 427–431 generic `POST /api/:col` | body as sent, except queue and 3D tasks | comments `POST` stored `approved` |
| `server.js` 164–174 restore | replaces collection JSON | stored `published` + forged `externalId` |
| `server.js` 370–383 `POST /api/jobs/:id/review` | 3D job `done` / `rejected` only from `waiting_approval` | not invoked (no finished 3D job). Generic 3D status PUT is 403 |
| `meta.js` 188 `publish()` success | `published` + `externalId` from Graph | not executed; test flavor returns 403 first |
| `meta.js` 193 `publish()` failure | `retry` or `failed` | not executed |
| `meta.js` 143 comment reply | `replied` | not executed; route 403 |
| `lib/services.js` video_render / stubs | job `failed` or `done` | video_render HTTP 201 then error `Не подключено` |

No socket server writes status.

## 6. Automatic DB backup before migration — PASS

QA-DB-001 does not reproduce as a missing backup. A v1-shaped database (tables `items` and `meta` only, task `QA-MIG-KEEP`) was opened by this server with `STUDIO_SQLITE=node`. `lib/db-backup.js` `backupBeforeMigration` (`server.js` lines 22–25) wrote `pre-migration-v1-to-v4-*.db` plus a `.sha256` sidecar that matches the file. Login with the same fake password returned HTTP 200. `GET /api/tasks/keep-me` still returned `QA-MIG-KEEP`.

## 7. OpenCode filesystem writes (QA-OC-001) — NOT VERIFIED at runtime

`runner.js` lines 39–40 no longer allow `/private/tmp` or `/private/var/folders`. The allow list is the task directory, `tmpDir(dir)` (`<sandbox>/.tmp`), `/dev/null`, `/dev/tty`, and the OpenCode cache directories under the home directory. The comment on line 40 names the old paths as removed. `sandbox-exec` was not run (this host is Linux). Enforcement of that profile is not verified.

OpenCode remains off unless `STUDIO_OPENCODE=1`, and on Linux it still refuses to start unless `STUDIO_OPENCODE_UNSANDBOXED=1` (`runner.js` lines 55–59).

## 8. Isolation from v1.1.2 — PASS for a test-flavor process

With `STUDIO_FLAVOR=test` and `HOME` pointed at a scratch directory, `STUDIO_DATA_DIR` inside `Library/Application Support/MOONKATTY AI STUDIO/` exited 78 with `PROD_PATH_REFUSED` (`lib/studio-config.js` lines 48–52, `server.js` lines 19–20). Log excerpt is in `logs/exploit.log`.

A process that is not the test flavor does not apply that guard. `node server.js` on this commit is flavor `prod` and will open whatever `STUDIO_DATA_DIR` it is given, including a copy of a v1.1.2 database (the migration test did that, on purpose, in a scratch directory).

## 9. Separate Keychain, bundle id, data dir, launchd, port — NOT VERIFIED on macOS

`lib/studio-config.js` lines 14–37, when flavor is `test`:

| | prod | test |
| --- | --- | --- |
| product / data-dir name | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO TEST` |
| app id | `com.moonkatty.aistudio` | `com.moonkatty.aistudio.test` |
| launchd | `com.moonkatty.aistudio.server` | `com.moonkatty.aistudio.test.server` |
| Keychain service | `MOONKATTY AI STUDIO` | `MOONKATTY AI STUDIO.test` |
| port | 8787 | 8687 |
| OpenCode URL | `127.0.0.1:4096` | `127.0.0.1:4097` |

Health on the test-flavor process returned the test product name. No Keychain item was created, no LaunchAgent was loaded, and no `.app` was built. `package.json` `build.appId` is still the production id until the packager is run with `FLAVOR=test`.

## 10. DB restore safety — FAIL

Passed controls (`server.js` lines 153–175):

- `POST /api/restore` with a `data` body and no token → HTTP 400 `confirm_required`.
- Wrong `confirm` → HTTP 400.
- Reusing the token → HTTP 403.
- A `pre-restore-*.db` file and matching `.sha256` were written before the replace.
- Queue id `../outside` did not create a file outside the data directory.

Failed validation: the prepared payload's queue row was stored as `published` with `externalId: "forged_from_restore"` and `factCheck: "pending"`. Restore does not re-run guardrails or the test-flavor publish block.

## 11. Secrets in process arguments — PASS for the spawn sites that were read

`lib/keystore.js` lines 21–23 and `lib/opencode-auth.js` lines 34–36 send `add-generic-password` on stdin of `security -i`. The secret is not an argv element of that add. `find-generic-password -w` is a flag; the secret comes back on stdout. `lib/blender.js` lines 22–23 use `shell: false` and an env of `PATH`, `HOME`, `LANG`, `TMPDIR` only. `runner.js` line 60 spawns OpenCode with `shell: false` and a reduced env. A live `ps` during `security -i` was not captured (no macOS `security` binary). `STUDIO_SECRET_KEY`, if an operator sets it, is in the server process environment (`lib/keystore.js` line 26), not in child argv.

## 12. Blender automation — NOT VERIFIED

`command -v blender` is empty. `apt-cache policy blender` printed nothing. `blender -b` was not run. `lib/blender.js` still shells out with `--factory-startup`, no shell, and a timeout. Whether a template produces a `.blend` and a PNG on this Linux host, or under Metal on the Mac mini, was not shown.

## 13. Test flavor cannot publish — PASS

Same evidence as item 4. Publish, reply, forged `PUT published`, and the scheduler did not publish. Restore can write the word `published` into SQLite and still gets HTTP 403 from `POST /publish`.

## Prior defects

| Id | This commit |
| --- | --- |
| QA-APR-001 | **PASS** (closed for `POST /api/queue`). `POST` with `status: "approved"` or `"retry"` is stored as `pending_approval`. `PUT` of `approved`/`retry` runs guardrails (`server.js` 405–407 and 435–438). |
| QA-APR-002 | **PASS on the test flavor** (`PUT` without `externalId` is 400; with one is 403 `publishing_disabled`). **FAIL on the prod flavor of this commit**: a client `externalId` is stored with no platform response. |
| QA-DB-001 | **PASS**. Pre-migration `VACUUM INTO` backup plus SHA-256 sidecar; seeded task and login survived. |
| QA-OC-001 | **Source change present** (`runner.js` 39–40). **Runtime NOT VERIFIED.** |
| QA-INFO-001 | **NOT VERIFIED.** No macOS binary and no BUILD-INFO in this commit. `package.json` `electronFuses` still has no `WasmTrapHandlers` key, which is what made the 1.2.1 BUILD-INFO line say `undefined`. |
| video_render HTTP 400 | **Does not reproduce.** `POST /api/jobs` `{type:"video_render", input:{runId,preset,episodeRef}}` returned HTTP 201. The job then failed with `video_render: Не подключено — исполнитель рендера видео (feat/media-automation) ещё не подключён к Studio; результат не создан`. `lib/video-render.js` lines 45–50 export `hasExecutor`. |

## Remaining vulnerabilities

1. **High — unpackaged or default-packaged run is the production flavor.** `package.json` has no `studioFlavor`. `node server.js` health is `flavor: "prod"`. `package-mac-on-linux.sh` line 10 defaults `FLAVOR` to `prod`. Publishing disable, the production-path guard, port 8687, and the `.test` Keychain service apply only after the flavor is actually test.
2. **High on the prod flavor — forged published row.** `PUT /api/queue/:id` `{status:"published", externalId:"forged_on_prod_flavor"}` returned HTTP 200. `meta.js` 188 does not require a non-empty platform id either, but that line was not reached.
3. **Medium — restore injects `published`.** Authenticated two-step restore wrote `status: "published"` and `externalId: "forged_from_restore"` with `factCheck: "pending"`. Test flavor did not call Graph afterward.
4. **Low — fact-check is the same client's field, and non-news skips it.** News approval without `factCheck: "passed"` and `sourceUrl` is HTTP 400. The approving request may set both. A brand item was approved with neither.
5. **Low on the test flavor — `POST /api/comments` can store `approved`.** Reply is 403, so it was not sent. On the prod flavor that POST plus the reply route is a comment-publish path that does not use a separate approve call.
6. **Not verified — seatbelt, Keychain, launchd, Blender, fuse wire.** No macOS execution.
