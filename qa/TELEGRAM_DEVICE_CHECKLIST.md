# Telegram WebView — manual device checklist

Automated Playwright runs use desktop Chrome (SwiftShader). They do not open Telegram, and they do not certify iOS or Android WebViews. Run this list on physical devices before calling a Horizons or @MoonKattyGameBot build shippable.

Do not post results to chats, stores, or social accounts from the QA automation. Record them in the bug report schema (`qa/interfaces/bug-report.schema.json`) and keep tokens out of the notes.

## Devices

Run at least:

- iPhone with current Telegram (iOS Safari WebView)
- a small Android phone (360–400 px wide) with current Telegram
- one Android phone with a gesture-nav bar and a display cutout

Note the Telegram version, OS version, and whether the client is Telegram or Telegram X.

## Before opening the game

- Install the build the way a player would (bot menu button or direct Mini App link). Do not use a desktop browser as a substitute for this list.
- Airplane mode once, then normal LTE, then a captive portal or a very slow link if you can share one safely.
- Cold start: force-quit Telegram, then open the Mini App. The in-game benchmark text says a cold start is required before comparing smoothness numbers. `physicalColdStartVerified` in the game's own benchmark stays false until a person does this.

## Horizons (`moonkatty-horizons-play`)

- Language picker on a truly fresh profile, then a second launch that skips it.
- Cover button "Start expedition" is visible above the home indicator and is not covered by Telegram's header.
- Intro cinema: tap advances, Skip works, sound toggle does not throw, and closing Telegram mid-cinema does not leave the joystick stuck.
- Left joystick walks. Lift the finger outside the stick (over Telegram's swipe-back edge) and confirm the cat stops. This is the failure the v66b comment in `game.js` describes.
- Two fingers: one on the joystick, one swiping the world. Releasing either finger must not leave the other stuck.
- Swipe the world through a full turn. The camera must not fight the finger, and a vertical swipe must not scroll the Telegram page.
- Safe area: joystick, jump, action, and the top resource row stay clear of the notch and the home indicator in portrait. Repeat in landscape if the build allows it.
- Jump, then open a story dialog while holding the stick. The stick must reset when the dialog opens.
- Background the app for 30 seconds. Progress remains, controls are released, and the daily/energy timers do not fast-forward as if the game had been running.
- Kill Telegram from the app switcher. Relaunch. Position, chapter, and inventory match the last save (`moonkatty-new-horizons-v02`).
- Low-memory device: set graphics to Smooth from the menu. Confirm the world still renders and the joystick still works.
- Rotate, or resize Telegram's half-screen sheet, and confirm the canvas resizes without a blank frame that never recovers.

## @MoonKattyGameBot (`moonkatty-game`)

- `Telegram.WebApp` is present: theme, expand, back button, and closing confirmation if the build enables them.
- A real `initData` session. Desktop stubs are not this test. Do not copy `initData` into tickets.
- LIFE #1 through a reload mid-mission, then a background/foreground during a timed section (reactor heat, void flight).
- Touch controls that the repo already flags as device-sensitive: antenna range, native range slider, life-1 geometry. The repo's own browser tests are Chromium, not Telegram.
- Reward buttons do nothing billable when the phone is offline. Moon Points are not money; still confirm a double tap does not duplicate a one-time grant after the server answers.
- Hebrew/Arabic: the page direction flips and the back button still closes the top sheet first.

## World preview / world3d

- WASD is irrelevant inside Telegram. Use the on-screen joystick and the jet button.
- Drag to orbit does not scroll the Telegram chat behind the Mini App.
- `?debug=1` camera buttons stay off in the player build.

## What to write down

For each failure: device, OS, Telegram version, build SHA, viewport (portrait/landscape), steps, and a screen recording from the device. Map it with `qa/interfaces/map-bug-to-task.mjs` when Stage C is allowed to create studio tasks. Until then, keep the JSON in the QA report folder only.
