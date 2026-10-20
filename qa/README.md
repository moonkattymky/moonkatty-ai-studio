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
