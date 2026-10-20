# Repository audit — moonkatty-ai-studio (for feat/media-automation)

Date: 2026-10-21. Read-only audit; nothing outside `media-automation/` and `docs/media-automation/` is modified.

## Base
- Base branch: `main` @ `e87bd32f904faf676e8316fbf38ef8805727c7fc` (2026-10-20 17:31 +0300, "Update live screenshots"). 5 commits total on main.
- `feat/media-automation` branched from that commit.

## Other branches (read-only, not touched)
- `feat/v1.2.0` — **does not exist on origin** at audit time (`git ls-remote --heads` shows no such ref). Nothing to inspect; when it appears it must not be modified.
- `feat/opencode-auth` @ `3f9bd90` (2026-10-20 22:18 +0300) — OpenCode Basic Auth, Keychain.
- `feat/macos-app` @ `7967f0a` (2026-10-20 20:03 +0300).
- `gh-pages` @ `0e4d038`. Tags: `backup-pre-macos-app`, `v1.1.0-mac-preview`, `v1.1.1-mac-preview`, `v1.1.2-mac-preview`.

## Stack
- Node.js (box: v20.19.2), CommonJS (`"type": "commonjs"`).
- Backend: `server.js` (~255 lines) — Express 5 + better-sqlite3 (WAL), generic `items(col,id,data JSON)` + `meta` tables, DB at `data/studio.db`.
- `meta.js` — Meta (Facebook/Instagram) OAuth/Graph integration.
- Frontend: vanilla JS in `public/` (`app.js`, `core.js`, `social.js`, `social-ui.js`, i18n RU/EN/UK), no bundler. `core.js`/`social.js` are shared (UMD-style) between browser and server.
- Deploy: Dockerfile, docker-compose, launchd plist (`deploy/`), gh-pages workflow example.

## Tests
- No unit-test framework and no `test` script. Only `scripts/smoke.mjs` (Playwright headless UI smoke + screenshots against a running server).
- Our module uses the built-in `node:test` runner (zero new dependencies) via `node --test media-automation/test`.

## Organization notes
- Modules are flat files at root/public; UI sections already include `news`, `video`, `studio3d`, `social`, `analytics` (UI-level, mostly seed/demo data in `core.js`).
- Auth/security lives in `server.js` (sessions/login) and `meta.js` — **not changed**.
- New code is isolated in `media-automation/` with no imports from existing files and no changes to `package.json`, so it cannot affect the running app or other branches.
