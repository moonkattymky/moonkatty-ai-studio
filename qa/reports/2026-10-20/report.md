# MOONKATTY Horizons — QA run 2026-10-20

Measured on this machine. There is no quality score.

- Started: 2026-10-20T22:35:46.218Z
- Finished: 2026-10-20T22:51:18.995Z
- Seed: 20261020
- Game repo: moonkattymky/moonkatty-horizons-play `2df1c76f8a11a6150d4e750439b67fd9be63effa`
- Branch requested: main
- Commit subject: build 20261017-98a: leaderboard shows total players
- Build step: no package.json — serving the checkout as a static build
- Source fallback: yes — moonkatty-horizons was not cloneable, horizons-play was served
- Prepare notes: moonkatty-horizons: Cloning into '/workspace/qa/.cache/moonkatty-horizons'... | moonkatty-horizons-play@2df1c76f8a11 (main)
- Served: http://127.0.0.1:43495/
- Browser: 154.0.8037.92 executable=/usr/bin/google-chrome-stable
- Graphics: Chrome SwiftShader via --use-gl=angle --use-angle=swiftshader; game quality forced to low through localStorage moonkatty-new-horizons-v02-quality + mk-qmanual; deviceScaleFactor 1 on every viewport
- Video: `video/iphone-14.webm` (full 113 s phone run) and `video/desktop-throttled.webm` (full throttled load). The desktop session recording was 597 s and 224 MB, which is over GitHub's 100 MB file limit, so `video/desktop-opening.webm` is the first 90 s of that file (stream copy, not a re-encode).

## Check results

| Check | Status | Detail |
| --- | --- | --- |
| desktop.boot | pass | world running in 11870 ms, webgl=true, canvas 1440x900, quality=low, MoonBuild=v44 |
| desktop.build-id | fail | window.MoonBuild is "v44" and MoonReliability.BUILD is "20261017-98a". index.html sets MoonBuild while asset URLs and reliability.js use the other id. |
| desktop.keyboard-move | pass | W moved the player 0.33 m in 4 s via in-page-KeyboardEvent (0.083 m/s wall clock). CDP keyboard first moved 0.17 m. Key events: [{"key":"w","code":"KeyW","trusted":true}]. Sim dt is capped at 45 ms, so a slow frame moves about 0.17 m. |
| desktop.camera-yaw-360 | pass | pointer-drag accumulated \|Δyaw\|=6.701 rad (full turn is 6.283) |
| desktop.camera-pitch | pass | vertical drag moved the camera eye by 4.499 world units (camPitch itself is not exported) |
| desktop.joystick-pointer | pass | pointer hold on #joystick for 2.5 s moved 0.44 m (1 pointerdown event(s) reached the stick) |
| desktop.hud-inside-viewport | pass | joystick and action buttons are inside 1440x900 |
| desktop.menus | pass | menu=true (ok) cards=true (ok) map=true (ok) |
| desktop.daily-reward-gate | pass | claim with no completed daily steps left crystals/metal unchanged (0/0). Feedback: (empty) |
| desktop.build-locked | pass | Builder stayed closed. Toast: First find the blueprint archive in the second life. |
| desktop.jump | pass | Space changed altitude 0.000 -> 0.156 after 1 frames / 172 ms (dialogs none, running=true). Jetpack stays locked until the engineer is repaired; Space sets velocity and the next sim frame (dt capped at 45 ms) applies it. |
| desktop.scan-button | pass | Scanner toast: Scanner: 14 m radius. Check the marked area. |
| desktop.mission-walk | not_tested | target recorder, start 14.1 m, end 4.0 m, stuck events 0, quest=recorder, recorder=false |
| desktop.story-dialog | not_tested | The recorder interaction was not reached, so the story dialog and later puzzles (relay, power grid, ring alignment, forge, aurora, gate, stars) were not played |
| desktop.economy-timer | not_tested | productionAt stayed 1792536259604. 2 frames in 5526 ms. Core.tick waits for 1 s of sim time and each frame caps dt at 45 ms, so this window held at most 0.09 s of sim time. |
| desktop.fuel-regen | pass | MoonGame.player.fuel set to 40 (existing public object) and read 40.90 after 2 frames / 5846 ms at alt 0.00. Regen is 10 points per sim second; dt cap 45 ms means this window could add at most about 0.90 points. Original fuel was 100.0. |
| desktop.save-load | pass | localStorage moonkatty-new-horizons-v02 round-tripped xz within 0.0000 m after reload (saved -3.35,1.62 → -3.35,1.62) |
| desktop.input-latency | pass | Median 2660.3 ms from synthetic keydown to xz change > 0.04 m (3 samples: 1608.9, 2676.5, 2660.3). This is frame delay inside the page, not hardware input delay. |
| desktop.fps | pass | rAF while holding W: 0.349 fps, avg 2866.5 ms, p95 2866.5 ms, max 2866.5 ms over 1 frames. Software WebGL (SwiftShader) and quality=low. |
| desktop.js-heap | pass | usedJSHeapSize 168561486 bytes, total 243779738, limit 4395630592 (Chrome performance.memory, --enable-precise-memory-info) |
| desktop.console-errors | pass | No pageerror or console error captured (0 failed requests ignored as transport) |
| iphone-14.boot | pass | running in 5782 ms, quality=low, canvas 390x844 |
| iphone-14.joystick-touch | pass | Touch input moved 0.75 m |
| iphone-14.joystick-pointer | pass | Pointer-drag joystick moved 0.58 m on a touch viewport (1 pointerdown event(s) on #joystick, before the touch probe) |
| iphone-14.camera-yaw-360 | pass | accumulated \|Δyaw\|=7.488 rad |
| iphone-14.hud-inside-viewport | pass | controls inside 390x844 (deviceScaleFactor 1) |
| iphone-14.menus | pass | menu=true (ok) cards=true (ok) map=true (ok) |
| iphone-14.daily-reward-gate | pass | claim with no completed daily steps left crystals/metal unchanged (0/0). Feedback: (empty) |
| iphone-14.build-locked | pass | Builder stayed closed. Toast: First find the blueprint archive in the second life. |
| iphone-14.jump | pass | Space changed altitude 0.000 -> 0.156 after 1 frames / 84 ms (dialogs none, running=true). Jetpack stays locked until the engineer is repaired; Space sets velocity and the next sim frame (dt capped at 45 ms) applies it. |
| iphone-14.scan-button | pass | Scanner toast: Scanner: 14 m radius. Check the marked area. |
| iphone-14.console-errors | pass | No pageerror or console error captured (0 failed requests ignored as transport) |
| pixel-7.boot | pass | running in 5814 ms, quality=low, canvas 412x915 |
| pixel-7.joystick-touch | pass | Touch input moved 0.63 m |
| pixel-7.joystick-pointer | pass | Pointer-drag joystick moved 0.75 m on a touch viewport (1 pointerdown event(s) on #joystick, before the touch probe) |
| pixel-7.camera-yaw-360 | pass | accumulated \|Δyaw\|=6.592 rad |
| pixel-7.hud-inside-viewport | pass | controls inside 412x915 (deviceScaleFactor 1) |
| pixel-7.menus | pass | menu=true (ok) cards=true (ok) map=true (ok) |
| pixel-7.daily-reward-gate | pass | claim with no completed daily steps left crystals/metal unchanged (0/0). Feedback: (empty) |
| pixel-7.build-locked | pass | Builder stayed closed. Toast: First find the blueprint archive in the second life. |
| pixel-7.jump | pass | Space changed altitude 0.000 -> 0.156 after 1 frames / 62 ms (dialogs none, running=true). Jetpack stays locked until the engineer is repaired; Space sets velocity and the next sim frame (dt capped at 45 ms) applies it. |
| pixel-7.scan-button | pass | Scanner toast: Scanner: 14 m radius. Check the marked area. |
| pixel-7.console-errors | pass | No pageerror or console error captured (0 failed requests ignored as transport) |
| small-phone.boot | pass | running in 5646 ms, quality=low, canvas 360x740 |
| small-phone.joystick-touch | pass | Touch input moved 0.91 m |
| small-phone.joystick-pointer | pass | Pointer-drag joystick moved 0.81 m on a touch viewport (1 pointerdown event(s) on #joystick, before the touch probe) |
| small-phone.camera-yaw-360 | pass | accumulated \|Δyaw\|=6.912 rad |
| small-phone.hud-inside-viewport | pass | controls inside 360x740 (deviceScaleFactor 1) |
| small-phone.menus | pass | menu=true (ok) cards=true (ok) map=true (ok) |
| small-phone.daily-reward-gate | pass | claim with no completed daily steps left crystals/metal unchanged (0/0). Feedback: (empty) |
| small-phone.build-locked | pass | Builder stayed closed. Toast: First find the blueprint archive in the second life. |
| small-phone.jump | pass | Space changed altitude 0.000 -> 0.156 after 1 frames / 63 ms (dialogs none, running=true). Jetpack stays locked until the engineer is repaired; Space sets velocity and the next sim frame (dt capped at 45 ms) applies it. |
| small-phone.scan-button | pass | Scanner toast: Scanner: 14 m radius. Check the marked area. |
| small-phone.console-errors | pass | No pageerror or console error captured (0 failed requests ignored as transport) |
| network.throttled-load | pass | Throttled load reached MoonGame and #begin in 8760 ms. {"moon":true,"begin":true,"error":""} |
| network.unstable-script | pass | Aborting game.js (1 request(s), seed 20261020) showed #boot-fail. Text: 🐱‍🚀 The game did not load Something went wrong while loading. Try again — your progress is safe. Try again |

## Metrics

```json
{
  "loadMs": {
    "desktop": 11870,
    "iphone-14": 5782,
    "pixel-7": 5814,
    "small-phone": 5646
  },
  "fps": {
    "frames": 1,
    "budgetMs": 4000,
    "elapsedMs": 5562.4,
    "avgFrameMs": 2866.5,
    "fps": 0.349,
    "maxFrameMs": 2866.5,
    "p95FrameMs": 2866.5,
    "method": "requestAnimationFrame for a fixed wall-clock budget while the page is in the foreground"
  },
  "heap": {
    "available": true,
    "usedJSHeapSize": 168561486,
    "totalJSHeapSize": 243779738,
    "jsHeapSizeLimit": 4395630592
  },
  "inputLatencyMs": {
    "samplesMs": [
      1608.9,
      2676.5,
      2660.3
    ],
    "medianMs": 2660.3
  },
  "network": {
    "throttledLoadMs": 8760
  }
}
```

## Bugs found

### QA-HZ-001 — window.MoonBuild does not match the asset build id

- Severity: minor
- Viewport: desktop
- Check: desktop.build-id
- Expected: The label in window.MoonBuild matches MoonReliability.BUILD
- Actual: MoonBuild=v44 reliability=20261017-98a
- Repro:
  1. Open the play build
  2. Read window.MoonBuild
  3. Read window.MoonReliability.BUILD
  4. Compare with the ?v= query on game.js

## Not tested

- **desktop.mission-walk**: target recorder, start 14.1 m, end 4.0 m, stuck events 0, quest=recorder, recorder=false
- **desktop.story-dialog**: The recorder interaction was not reached, so the story dialog and later puzzles (relay, power grid, ring alignment, forge, aurora, gate, stars) were not played
- **desktop.economy-timer**: productionAt stayed 1792536259604. 2 frames in 5526 ms. Core.tick waits for 1 s of sim time and each frame caps dt at 45 ms, so this window held at most 0.09 s of sim time.

## Steps (repro log)

### desktop
- GET http://127.0.0.1:43495/?nolang&nointro&nosw
- clicked #begin, skipped chapter cinema via MoonCinema.skip()
- W 4000 ms via in-page-KeyboardEvent, moved 0.333 m, cdp 0.166 m, events [{"key":"w","code":"KeyW","trusted":true}]
- camera swipes yaw deltas rad [1.675, 1.675, 1.675, 1.675] accumulated 6.701; vertical drag eye delta 4.49935701339098
- pointer joystick up 1200 ms, moved 0.440 m
- #menu open=true dialogs=chapters 
- #cards open=true dialogs=cards 
- claim daily feedback="" crystals 0->0
- map open=true dialogs=world-map 
- scan toast="Scanner: 14 m radius. Check the marked area."
- build dialog=false toast="First find the blueprint archive in the second life."
- space jump alt 0.000 -> 0.156 after 1 frames / 172 ms
- waited 80417 ms for the jump to land (alt 0.00)
- steer toward recorder at -5,-2 from dist 14.1 for 180 s (slow frames, dt cap 45 ms)
- fuel forced 40 -> 40.90 over 2 frames (alt 0.00)
- save/load local delta 0.000 m
- input latency samples [{"ms":1608.9,"moved":0.167,"method":"synthetic KeyboardEvent keydown until player xz changes by > 0.04 m"},{"ms":2676.5,"moved":0.167,"method":"synthetic KeyboardEvent keydown until player xz changes by > 0.04 m"},{"ms":2660.3,"moved":0.167,"method":"synthetic KeyboardEvent keydown until player xz changes by > 0.04 m"}]
- fps 0.349 heap 168561486

### iphone-14
- GET http://127.0.0.1:43495/?nolang&nointro&nosw
- clicked #begin, skipped chapter cinema via MoonCinema.skip()
- pointer joystick before touch moved 0.576 m, pointerdowns 1
- touch joystick moved 0.749 m
- camera swipes yaw deltas rad [1.248, 1.248, 1.248, 1.248, 1.248, 1.248] accumulated 7.488; vertical drag eye delta 2.258064618064676
- #menu open=true dialogs=chapters 
- #cards open=true dialogs=cards 
- claim daily feedback="" crystals 0->0
- map open=true dialogs=world-map 
- scan toast="Scanner: 14 m radius. Check the marked area."
- build dialog=false toast="First find the blueprint archive in the second life."
- space jump alt 0.000 -> 0.156 after 1 frames / 84 ms

### pixel-7
- GET http://127.0.0.1:43495/?nolang&nointro&nosw
- clicked #begin, skipped chapter cinema via MoonCinema.skip()
- pointer joystick before touch moved 0.750 m, pointerdowns 1
- touch joystick moved 0.632 m
- camera swipes yaw deltas rad [1.318, 1.318, 1.318, 1.318, 1.318] accumulated 6.592; vertical drag eye delta 2.4536948598441013
- #menu open=true dialogs=chapters 
- #cards open=true dialogs=cards 
- claim daily feedback="" crystals 0->0
- map open=true dialogs=world-map 
- scan toast="Scanner: 14 m radius. Check the marked area."
- build dialog=false toast="First find the blueprint archive in the second life."
- space jump alt 0.000 -> 0.156 after 1 frames / 62 ms

### small-phone
- GET http://127.0.0.1:43495/?nolang&nointro&nosw
- clicked #begin, skipped chapter cinema via MoonCinema.skip()
- pointer joystick before touch moved 0.815 m, pointerdowns 1
- touch joystick moved 0.907 m
- camera swipes yaw deltas rad [1.152, 1.152, 1.152, 1.152, 1.152, 1.152] accumulated 6.912; vertical drag eye delta 1.3816061620258109
- #menu open=true dialogs=chapters 
- #cards open=true dialogs=cards 
- claim daily feedback="" crystals 0->0
- map open=true dialogs=world-map 
- scan toast="Scanner: 14 m radius. Check the marked area."
- build dialog=false toast="First find the blueprint archive in the second life."
- space jump alt 0.000 -> 0.156 after 1 frames / 63 ms

### network
- CDP network: 250 ms latency, 2.0 Mbit/s down, 0.75 Mbit/s up
- abort every request whose URL matches game.js (seeded failure of the world script)

## Studio payloads

`dashboard-card.json` and `proposed-tasks.json` in this folder are proposals. They were not posted to the studio API.
