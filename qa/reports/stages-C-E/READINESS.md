# Stages C–E readiness

Branch `feat/quality-automation`. Nothing was published. No other branch was modified.

Regression finished `2026-10-21T11:27:40.983Z`. Measured checks: **71 pass, 0 fail, 3 not tested**. `testsGreen` is true. These counts are check results. Release gate decision: **NO-GO**.

Evidence: `qa/reports/stages-C-E/regression.json`, `dashboard.html`, `gate.json`.

## Items

### Bug registry — done

`qa/bugs/registry.json` holds 10 entries under `qa/bugs/schema.json`. `npm run qa:bugs` printed `{"ok":true,"bugs":10,"counts":{"open":5,"qa_verified":4,"blocked":1}}`. `qa/bugs/test/registry.test.mjs` passed (duplicate add refused; `qa_verified` leaves `ownerApproval` false; `owner_approved` sets the flag).

| Id | Status | Severity |
| --- | --- | --- |
| QA-HZ-001 | open | low |
| QA-APR-001 | qa_verified | high |
| QA-APR-002 | qa_verified | medium |
| QA-DB-001 | qa_verified | medium |
| QA-OC-001 | blocked | medium |
| QA-INFO-001 | qa_verified | low |
| QA-CMT-001 | open | low |
| QA-SEC-001 | open | low |
| QA-SEC-002 | open | low |
| QA-SEC-003 | open | info |

No entry is `owner_approved`. QA-CMT-001, QA-SEC-001, QA-SEC-002, and QA-SEC-003 are the v1.2.3 residuals that had no id in the earlier reports.

### Fix workflow — done

`qa/bugs/FIX-WORKFLOW.md` records the path OpenCode proposal → isolated test → QA verify → owner approve. QA does not run OpenCode and does not set `owner_approved`. The owner approve step stays with the owner.

### Video QC — partial

The checker and the npm script are done. `npm run qa:video` is `node qa/content/video-qc.mjs --self-test`. The self-test (`video/self-test.json`) is 6 pass, 0 fail:

- 1920×1080 moving picture with a fitting SRT passes (EBU R128 integrated −21.8 LUFS on that sine, loudness range 0 LU, true peak −16.1 dBFS).
- A static picture is a frozen frame (2 s, limit 0.2 s).
- A black 1080×1920 picture fails the black-frame limit (96%).
- 320×240 fails the allowed rasters 1080×1920 and 1920×1080.
- An SRT cue at 9–10 s on a 2 s file fails sync.
- A loudness window of −70 to −60 LUFS fails the measured −21.8 LUFS.

`qa/content/news-launch-spec.json` is the delivery window for a real folder: those two rasters, duration, EBU R128 programme target −23 LUFS ± 1, sibling SRT, black frames, frozen frames. `node qa/content/video-qc.mjs --dir <folder>` applies it.

The news-launch scan is blocked. `video/news-launch.json` is mode `no-artifacts` (pass 0, fail 0, not tested 1). There is no `news-launch/` directory and no rendered mp4/srt in this repo. That scan waits on the owner for the final voice and the Blender master model.

### Website tester — done

`npm run qa:site` read `https://moonkatty.com` with Playwright and Chrome. GET only. Result in `site/site.json`: 40 pass, 0 fail, 1 not tested.

- Homepage HTTP 200. `hreflang` has en, ru, uk, es, pt, de, fr, it, tr, he, ar, ko, zh, plus x-default.
- Each `?lang=` page shows `[data-i="nv_about"]` as the live dictionary string (pt `Sobre nós`, he `עלינו`). `html lang` matches the code. `he` and `ar` set `dir=rtl`. The other eleven set `dir=ltr`.
- Same-origin links `/`, `/exchange/`, `/terms`, `/privacy` returned 200. Telegram and YouTube and TikTok returned 200. `https://x.com/moonkattymky` returned 403 and is the one not-tested row.
- Mobile viewport 390×844: `scrollWidth` 390, `clientWidth` 390. Screenshot `site/mobile.png`.
- Home, each language page, and the mobile page recorded no page errors. Resource-load noise was ignored.

### Studio API smoke — done

`npm run qa:api` started this branch’s `server.js` on a scratch database at `127.0.0.1` with a fake password. `api/smoke.json`: 6 pass, 0 fail.

- `GET /api/health` 200, `ok` true, version `1.0.0`.
- `GET /api/auth/status` `needsSetup` true.
- `POST /api/auth/setup` 200 and a session cookie.
- `GET /api/tasks` 200 and an array.
- Unauthenticated `POST /api/tasks` 401.
- The server log did not name a social host. No publish call was made.

### Regression runner — done

`npm run qa:regression` ran the registry validate, registry tests, content tests (13), interface self-check, release-gate tests, video self-test, news-launch scan, API smoke, and the site tester. Horizons was recorded and left unrun (`not tested` 1), because `moonkattymky/moonkatty-horizons` is not cloneable here. The 2026-10-20 play-build report remains the horizons evidence. Aggregate: 71 pass, 0 fail, 3 not tested.

### Quality dashboard — done

`npm run qa:dashboard` wrote `dashboard.html` from `regression.json`. The table columns are suite, run, pass, fail, not tested, and note. The page states that the counts are check results and are not a quality score. Headless Chrome opened the file and showed “Pass 71, fail 0, not tested 3”. Screenshot `dashboard.png`.

### Release gate — done as a script; this run is NO-GO

`npm run qa:gate` applies four criteria and prints GO only when all four hold: security `PASS`, tests green, fact-check done, owner approval flag. `qa/release/test/gate.test.mjs` covers the GO case and the committed flags.

This run (`gate.json`, `2026-10-21T11:28:19.503Z`):

| Criterion | Result |
| --- | --- |
| security | pass — `PASS`, scoped to the v1.2.3-test prerelease recheck (`qa/reports/security-recheck-v1.2.3/REPORT.md`, commit `10a5fb8`) |
| tests | pass — green (71 pass, 0 fail) |
| fact-check | fail — `qa/release/flags.json` has `factCheckDone: false` |
| owner approval | fail — `ownerApproval: false` |

Decision: **NO-GO**. Reasons: fact-check is not done; owner approval flag is not set. A full production launch was not given a security PASS in the v1.2.3 report.

## Blocked on the owner

- **Voice.** No final voice track, so the news-launch loudness and subtitle scan has no programme file.
- **Master model.** The Blender master model is outside this stage. No news-launch render was produced here.
- **Logo.** No logo file was supplied. This stage did not grade a logo.
- **Horizons access.** `moonkattymky/moonkatty-horizons` returned “Repository not found”. QA-HZ-001 stays open. The horizons suite was not re-run.
- **Mac.** QA-OC-001 stays `blocked` until `sandbox-exec` runs. Keychain, launchd, and Gatekeeper were not executed on this Linux host. QA-SEC-002’s full close waits on Developer ID and notarization.
