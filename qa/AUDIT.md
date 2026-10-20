# Stage A — QA audit (read-only)

Date: 2026-10-20. Auditor: QA automation on `feat/quality-automation`. No game repo was modified, and nothing was deployed or posted.

Clone attempts used `git clone --depth 1` from this environment. `moonkattymky/moonkatty-horizons` returned GitHub "Repository not found" for both an anonymous URL and `gh repo view`. It is not in `gh repo list moonkattymky`. The playable Horizons build is the separate public repo below.

## 1. moonkattymky/moonkatty-horizons

| | |
| --- | --- |
| Default branch asked for | `master` |
| Access | Not cloneable. `gh repo view moonkattymky/moonkatty-horizons` → "Could not resolve to a Repository". |
| Stack | Unknown. No tree, README, package.json, or CI was readable. |
| Run locally | Not possible from this environment. |
| Tests / CI | Not visible. |
| Test hooks | Not visible. |
| Risks | Stage B cannot compile a test build from this source. A private repo would also be invisible to CI unless this studio's checkout token is granted access. |
| Missing for automation | The repository itself, plus whatever build script, seed flag, and headless WebGL notes live only there. |

The harness still tries `master` on every `npm run qa`. If the clone starts working, that tree is preferred and `npm run build` is executed when `package.json` has a `build` script.

## 2. moonkattymky/moonkatty-horizons-play

Playable MOONKATTY New Horizons ("9 Lives. One Moon."). Audited at `2df1c76f8a11a6150d4e750439b67fd9be63effa` (`build 20261017-98a: leaderboard shows total players`), branch `main`.

### Stack

Static site. No `package.json`, bundler, or TypeScript. `index.html` injects classic scripts in a fixed order (WebGL renderer, per-chapter worlds, `game.js`, cinema, growth, bike, HUD). Rendering is hand-written WebGL, not Three.js. UI is HTML dialogs over the canvas. Copy is in `i18n/*.js` (13 languages, RTL for Hebrew and Arabic). A service worker (`sw.js`) registers only on `https:` and is skipped with `?nosw`.

Save key: `localStorage['moonkatty-new-horizons-v02']` (`MoonCore.KEY`). Other keys: `moonkatty-lang`, `moonkatty-new-horizons-v02-quality`, `mk-qmanual`, `moonkatty-entered`, `moonkatty-sfx`, `moonkatty-music`, `moonkatty-cinema-sound`, `moonkatty-bike-v60`, `moonkatty-bots-v59`, `moonkatty-daily-v46`, `moonkatty-a11y`, `mk-err-q`.

### Run locally

```bash
git clone --depth 1 --branch main https://github.com/moonkattymky/moonkatty-horizons-play.git
cd moonkatty-horizons-play
python3 -m http.server 4173
# http://127.0.0.1:4173/?nolang&nointro&nosw
```

There is no compile step. Opening `index.html` as `file://` will break script loading. The Stage B harness serves the checkout with a small Node static server instead.

First launch shows a language dialog unless `moonkatty-lang` is set or the URL contains `nolang`. `#begin` starts the expedition. On a fresh save it also plays the chapter cinema (`MoonCinema`); `?nointro` skips only the very first intro, not the chapter opener. `MoonCinema.skip()` ends it and then runs the original begin handler.

Controls, from `game.js`:

- Keyboard: WASD and arrows are camera-relative. `E` activates. Space jumps, and becomes the jetpack after the engineer is repaired.
- Pointer: `#joystick` (`onpointerdown`) walks. Dragging `#world` changes `camYaw` / `camPitch` (about 0.005 rad per horizontal pixel).
- Touch: `touchstart`/`touchend` are a stuck-finger guard (v66b). The stick vector itself comes from pointer events.

Movement speed on foot is 3.7 m/s. The player is paused while any `<dialog open>` exists. Spawn for a new chapter 1 save is `x: 0, z: 12`. First quest target is the flight recorder at `MoonCore.POINTS.recorder` `[-5, -2]`.

### Tests / CI

No `.github/workflows`, no test script, no Playwright suite in the repo. `tools/` is absent. `window.MoonBench` is an in-game 10-minute walking histogram (menu → "Smoothness test"), not a CI job. Its report sets `physicalColdStartVerified: false` and says a real device cold start is still required.

### Hooks already on the page

| Object | Use |
| --- | --- |
| `window.MoonGame` | `state`, `player` (includes `x,z,alt,yaw,fuel,blocked`), `camYaw`, `running`, `renderer`, `save()`, `replace()`, `openDialog` |
| `window.MoonCore` | `quest(state)`, `POINTS`, `KEY`, `tick`, `claimDaily`, `interact` |
| `window.MoonCinema` | `playing`, `skip()`, `advance()`, `hold()` |
| `window.MoonBench` | rAF frame histogram while actually walking |
| `window.MoonReliability` | `bootFail`, offline bar, queued `pageerror`s in `mk-err-q` |
| `window.MoonBuild` | String `"v44"` in `index.html` |

`camPitch` is not exported. See `qa/proposals/horizons-optional-test-api.md`.

### Risks

- `window.MoonBuild` is `"v44"` while `reliability.js` and the cache-buster are `20261017-98a`. Benchmark rows from different days can look like the same build.
- Software WebGL (SwiftShader, headless Chrome) is not a phone GPU. FPS numbers from CI are not device FPS.
- Chapter 1 has a story dialog, not a puzzle. The puzzle widgets (relay tiles, chapter 4 power grid, alignment rings, forge lenses, aurora grid, gate rings, observatory stars) sit many objectives later. A short walker will not reach them.
- Joystick releases outside the stick are a known iOS/Telegram hazard (comment in `game.js` around the v66b guard). Desktop Chrome does not reproduce that gesture.
- Crew/cloud calls in `growth.js` expect Telegram `initData`. Without it the game keeps playing on local saves. Offline reward claims against a real server were not exercised.
- The world is large (`MoonCore.WORLD` is x −82..82, z −84..76). A straight-line walker can be blocked by terrain and look "stuck" without a navmesh.

### Missing for automation

- A cloneable source repo and a deterministic `npm run build`.
- One build id.
- Exported `camPitch` and a read-only `MoonTest.snapshot()` (proposal only).
- `?nocinema=1` so tests do not depend on skip timing.
- CI in the game repo. The studio workflow on `feat/quality-automation` is the stand-in and does not deploy.

## 3. moonkattymky/moonkatty-world-preview

3D test scene "Base Alpha". Audited at `7ecf6d5c8cf5126e75fc68c4efe2cd050ba0eb3f` (v73 moon creatures), branch `main`. No `package.json`, no `.github`.

### Stack

ES modules + vendored Three.js (`vendor/three`). Import map in `index.html`. Game logic under `src/game/` (quests, minigames, economy, storage, robots, creatures). Save key `mkty_world_v1`, separate from the Telegram game's `mkty_points`.

### Run locally

```bash
git clone --depth 1 https://github.com/moonkattymky/moonkatty-world-preview.git
cd moonkatty-world-preview
python3 -m http.server 47321
# http://127.0.0.1:47321/index.html?view=play
```

The port 47321 is what `tools/game_test.mjs` expects (`MKPORT`).

Desktop help text: WASD / arrows, Shift run, Space jump or jetpack, drag orbit, wheel zoom, `C` concept camera. Mobile: `#joy` and `#jump`.

### Tests / CI

`tools/*.mjs` are one-off Playwright scripts (playwright-core + system Chrome, SwiftShader flags). `tools/game_test.mjs` drives chapter 1 through `window.MK.game` (save migration, walking to the first crystal, activities) and writes screenshots under `renders/`. There is no npm script and no workflow that runs them. They were not executed in this audit.

### Hooks

`window.MK` in `src/main.js`: `ready`, `game` (`MK.game.state()`, `quest()`, `auto()`, `power()`, `robotState()`), `step(dt)`, `setView`, `anim()`, `camera`, `ctrl`. `?debug=1` is used by the game repo's copy to show dev camera buttons; this preview shows `#views` always.

`src/game/storage.js` documents a `LocalBackend` / `ApiBackend` split so localStorage can be swapped later.

### Risks

- Same scene was ported into `moonkatty-game` as `world3d/` (`Merge pull request #104`, `port/world-v73`). The two trees can drift. QA should say which SHA failed.
- `tools/game_test.mjs` hardcodes `/usr/bin/google-chrome`.
- No CI means a red `tools/` script is invisible.

### Missing

Wire `tools/game_test.mjs` to a workflow that does not deploy. Publish a single `window.MK.game.snapshot()` instead of the wide `window.MK` surface (it currently exposes the Three.js scene). Not done here; this repo is another developer's game tree.

## 4. moonkattymky/moonkatty-game

Telegram Mini App @MoonKattyGameBot. Audited at `a4859fc15e391f598724eb20806b5ba72dafbd67` (`Merge pull request #104 from moonkattymky/port/world-v73`).

### Stack

Static front end (vanilla JS, per-chapter controllers) plus `server/` (Telegram auth contract, rewards, referrals, mission-control edge function, Postgres admission). `package.json` name `moonkatty-9-lives`. Dev dependency `playwright@1.58.2` and `@electric-sql/pglite`. `world3d/` is the Three.js base scene.

### Run locally

```bash
git clone https://github.com/moonkattymky/moonkatty-game.git
cd moonkatty-game
npm ci
npx playwright install chromium
npm test
# a single browser journey:
node tests/continuation.cjs
```

The client is a static site; tests serve it on a random port. `CHROMIUM_PATH` and `MKTY_TEST_OUTPUT` are the documented knobs. Do not point tests at production rewards. Moon Points are not currency. This audit did not run the 142-file suite and did not start the backend.

### Tests / CI

`tests/` has 142 files. `npm test` is `node tests/run-all.cjs --jobs=3 --timeout=1500`. Workflows:

- `.github/workflows/model-tests.yml` — "Full game tests" on pull requests and `workflow_dispatch` (Playwright chromium, many UI journeys, artifact upload).
- `visual-preview.yml`, `crew-preview.yml`, `postgres-admission.yml`.
- `deploy-pages.yml` — deploys. QA must not call it.

The README is explicit that browser journeys use Chromium profiles, not physical phones or Telegram clients, and that solver times are not human playtime.

### Hooks

Per-feature test fixtures under `tests/fixtures/`. `world3d` exposes `window.MK` (same idea as the preview) and `?debug=1` shows camera buttons (`world3d/index.html`). `expedition-model.js` has `snapshot()` returning a detached copy. Server routes are documented in `server/README.md` (`POST /api/auth/telegram`, life complete, rewards, referrals). Client saves are versioned keys such as `mkty_story_plan_N_v1` and `mkty_expeditions_v1`.

### Risks

- Reward and referral tests must stay on fakes. A QA job with a real bot token would be a production write.
- `deploy-pages.yml` is easy to trigger by copying its `on:` block. The Horizons workflow in this studio repo does not deploy.
- Two products now contain a 3D world (Horizons WebGL, and world3d Three.js). Bugs must name which one.

### Missing

A shared bug record. The game repo stores failures as CI artifacts and markdown docs, not as studio tasks. That is the Stage C gap. Also still missing: physical Telegram certification (checklist in `qa/TELEGRAM_DEVICE_CHECKLIST.md`).

## 5. moonkattymky/moonkatty-site

Audited at `6f83ee81791b6a254d8dfbce88b2169f22995748` (`Redirect to https://moonkatty.com/`).

### Stack

Three HTML files (`index.html`, `404.html`, `exchange/index.html`) plus `robots.txt` and `.nojekyll`. Each page meta-refreshes and `location.replace`s to `https://moonkatty.com` (the exchange path keeps `/exchange/`).

### Run locally

Open `index.html`. No build. No server code.

### Tests / CI

None. No package.json.

### Hooks

None.

### Risks

The redirect is the product. A broken path rule would send every route to `/` or to a non-canonical host. There is no automated assertion.

### Missing

One Playwright test: each of `/` and `/exchange/` ends on the matching `moonkatty.com` URL, and other paths collapse to `/`. Not part of Stage B (Horizons only). No password, no form, nothing to post.

## 6. moonkatty-ai-studio (this repo)

Audited on `main` at `e87bd32` before this branch. Other developers' branches were listed with `git ls-tree` / `git show` and not checked out.

### Layout

Express 5 + better-sqlite3 (`server.js`), shared rules in `public/core.js` (also used by the browser demo), panel in `public/app.js`. Social/Meta lives in `public/social.js`, `public/social-ui.js`, `meta.js`. Collections:

`workspaces, queue, utm, comments, agents, chat, campaigns, files, tasks, projects, episodes, channels, posts, logs, reports, integrations`.

There is no `bugs` or `qaRuns` collection. Adding one means editing `COLLECTIONS` in `public/core.js`, which the media and desktop branches also edit. Stage A/B does not touch that file.

### Tasks and dashboard (existing contract)

`POST /api/tasks` persists the JSON body. The panel sends:

```json
{
  "title": "",
  "description": "",
  "agentId": "games",
  "project": "main",
  "priority": "low|normal|high|urgent",
  "status": "queued|in_progress|waiting_approval|done|cancelled|failed",
  "dueAt": null,
  "schedule": { "type": "none" }
}
```

`source` is already used (`director`, `social`). QA should use `source: "qa"` so rows are filterable. Agent `games` is seeded as "GAMES" for @MoonKattyGameBot. The rule planner routes `/игр|game|бот|@moonkattygamebot/` to that agent.

Dashboard (`VIEWS.dashboard` in `public/app.js`) counts tasks by status. Reports come from `core.buildReport` (real task and log rows only, no invented view counts). A QA card should follow that rule: pass/fail/not_tested counts from a run file, never a single score.

### Tests / CI in this repo

- `npm run smoke` → `scripts/smoke.mjs` (playwright-core, login, director chat, screenshots). It needs a running server plus a user and password. This audit did not run it and did not create an admin password.
- No `.github/workflows` on `main`. `deploy/pages-workflow.yml.example` is a sample Pages deploy. It was not enabled.
- Dev dependency: `playwright-core` (Chrome is supplied by the machine).

### Other branches (read-only, not modified)

`origin/feat/media-automation` — `media-automation/` news engine, video factory, `JsonStore` (`get/set/update`, atomic write). Architecture doc lists Publisher, Scheduler, Approval, Analytics as interfaces only. Tests: `media-automation/test/news.test.js`, `video.test.js`. Character3D is a stub so Blender work can plug in later. QA does not import that tree.

`origin/feat/macos-app` — Electron shell, Keychain, security headers, `docs/MAC_TEST_CHECKLIST.md`. QA does not add a desktop target and does not read Keychain.

`origin/feat/opencode-auth` — OpenCode Basic Auth. Out of scope.

### Where QA fits

QA stays under `qa/` and talks to the rest of the studio only through JSON documents:

- Bug: `qa/interfaces/bug-report.schema.json`
- Task body a future Stage C may `POST /api/tasks`: `qa/interfaces/map-bug-to-task.mjs` (`bugToTask`)
- Dashboard card a future report view can render: `qa/interfaces/dashboard-card.mjs` (`dashboardCard`)

`npm run qa:interfaces` checks those mappers without a browser and without the database.

Severity → task priority: blocker→urgent, major→high, minor→normal, trivial→low. Status on the new task is `queued`. Agent is `games` for the game repos and `pr` for the marketing site.

Example bug (shape only, not a measured defect):

```json
{
  "id": "QA-HZ-001",
  "title": "Player does not walk when W is held",
  "severity": "blocker",
  "status": "open",
  "repo": "moonkattymky/moonkatty-horizons-play",
  "commit": "<sha>",
  "viewport": "desktop",
  "checkId": "desktop.keyboard-move",
  "summary": "Holding W for 4 s left xz unchanged.",
  "expected": "xz changes. One sim step is about 0.17 m because dt is capped at 45 ms.",
  "actual": "moved 0 m",
  "repro": ["Serve the play build", "Click Start expedition", "Hold W for 4 seconds with no dialog open"],
  "evidence": ["qa/reports/<date>/screenshots/desktop-after-keyboard.png"],
  "foundAt": "2026-10-20T00:00:00.000Z",
  "source": "qa"
}
```

Example dashboard card fields: `source: "qa"`, `kind: "horizons-playtest"`, `counts: { pass, fail, not_tested }`, `openBugs[]`, `metrics` (load ms, fps sample, heap, latency). The `note` says the counts are check results, not a score.

Stage C can insert `qaRuns` into `COLLECTIONS` once the other branches have landed, or store the card as a `reports` row. Doing it in this branch would conflict with those editors.

## Content QC (added after the game audit)

News scripts and rendered video are checked under `qa/content/`. Studio 2 produces the script package. Studio 5 keeps the corrections log. The JSON shapes are `qa/CONTRACTS.md`. QA does not import `media-automation/`, does not write `server/jobs*` or `server/blender*` (owned on `feat/v1.2.0`), and does not publish. `npm run qa:content` is the test command. ffmpeg and ffprobe are the only media tools.

## Cross-repo gaps

1. Horizons source (`moonkatty-horizons`, `master`) is not available here. Automation targets the static play build until it is.
2. Horizons has hooks (`MoonGame`) but no CI. world-preview has hooks and manual scripts but no CI. moonkatty-game has CI and asks not to treat it as device certification. The site has neither tests nor hooks.
3. Nothing writes a bug into the studio task queue yet. The mapper is ready; the POST is Stage C, and it must stay on a local studio with a test user, not on a shared password.
4. Real Telegram WebViews are untested by every repo above. Checklist: `qa/TELEGRAM_DEVICE_CHECKLIST.md`.
