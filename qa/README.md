# QA

Stage A audit: [AUDIT.md](AUDIT.md).

Stage B command, from the studio repo root:

```bash
npm run qa
```

That checks the studio task/dashboard payloads, clones MOONKATTY Horizons (or the playable build if the source repo is not readable), serves it on 127.0.0.1, and writes `qa/reports/<date>/`.

`npm run qa:horizons` skips the payload self-check. `npm run qa:interfaces` runs only the self-check.

Chrome is launched with SwiftShader. Override the binary with `CHROME_PATH`. Video capture needs Playwright's ffmpeg (`node node_modules/playwright-core/cli.js install ffmpeg`). `QA_SEED` and `QA_DATE` pin the report name.

The GitHub workflow `.github/workflows/qa-horizons.yml` runs on `feat/quality-automation` and on `workflow_dispatch`. It does not deploy.

Physical Telegram checks: [TELEGRAM_DEVICE_CHECKLIST.md](TELEGRAM_DEVICE_CHECKLIST.md).

Content QC (news scripts and rendered video) is separate from the game harness. Contracts for Studio 2 and Studio 5 are in [CONTRACTS.md](CONTRACTS.md). `npm run qa:content` runs those tests. The correction procedure is [content/CORRECTIONS.md](content/CORRECTIONS.md).

This branch does not write `server/jobs*` or `server/blender*`. That queue and the Blender jobs belong to `feat/v1.2.0`.

Stages C–E stay under `qa/` and do not post into the studio:

```bash
npm run qa:bugs
npm run qa:video
npm run qa:site
npm run qa:api
npm run qa:regression
npm run qa:dashboard
npm run qa:gate
```

`qa:bugs` checks `qa/bugs/registry.json`. The fix path is [bugs/FIX-WORKFLOW.md](bugs/FIX-WORKFLOW.md). `qa:video` self-tests the news-launch checks; pass a folder with `node qa/content/video-qc.mjs --dir <folder>` when renders exist. `qa:site` reads the public site only. `qa:api` starts this branch’s server on a scratch database. `qa:gate` prints GO or NO-GO from security, tests, fact-check, and the owner flag. Counts in the dashboard are check results.
