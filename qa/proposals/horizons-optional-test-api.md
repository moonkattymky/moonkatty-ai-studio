# Optional Horizons test API (proposal only)

Do not apply this to `moonkatty-horizons` or `moonkatty-horizons-play`. Those repos are owned by the game developers. The Stage B harness reads the objects the play build already publishes and does not inject this file.

## What already exists (read-only)

`moonkatty-horizons-play/game.js` assigns:

```js
window.MoonGame = {
  get state() { return state; },
  get player() { return player; },
  get renderer() { return renderer; },
  get camYaw() { return camYaw; },
  get running() { return running; },
  save, hud, toast, openDialog, resetControls, replace, refresh
};
```

`window.MoonCore` exposes `quest`, `POINTS`, `KEY`, `tick`, `claimDaily`. `window.MoonCinema.skip()` already exists for menu and screenshot tooling. `window.MoonBench` records an rAF histogram while the player is moving. `window.MoonReliability.bootFail` covers a failed script.

Gaps the harness hit:

- `camPitch` is closed over inside `game.js`. Pitch had to be inferred from `renderer.eye`.
- There is no stable build id. `index.html` sets `window.MoonBuild = "v44"` while asset URLs use `?v=20261017-98a` and `reliability.js` uses `BUILD = '20261017-98a'`.
- No query flag skips the chapter-opener cinema without calling `MoonCinema.skip()`. `?nointro` skips only the first-launch intro. `?nolang` skips only the language gate.
- Quest targets are readable, but there is no "distance to current target" helper, so every tool re-implements `POINTS` + `quest().targets`.

## Proposed addition

A single optional script, loaded only when the URL contains `qa=1`. It must not change rules, rewards, or saves. It only aliases data the page already has.

```html
<script>
if (/[?&]qa=1(?:&|$)/.test(location.search)) {
  addEventListener('load', function () {
    var tries = 0;
    (function wait() {
      if (!window.MoonGame || !window.MoonCore) {
        if (++tries < 200) return setTimeout(wait, 50);
        return;
      }
      window.MoonTest = {
        version: 1,
        build: document.documentElement.dataset.build || window.MoonBuild || '',
        snapshot: function () {
          var g = window.MoonGame, p = g.player, s = g.state, q = window.MoonCore.quest(s);
          var id = q && q.targets && q.targets[0];
          var pt = id && window.MoonCore.POINTS[id];
          return {
            running: !!g.running,
            chapter: s.chapter,
            questId: q && q.id,
            x: p.x, z: p.z, alt: p.alt, yaw: p.yaw,
            camYaw: g.camYaw,
            camPitch: g.camPitch,
            blocked: !!p.blocked,
            fuel: p.fuel,
            target: pt ? { id: id, x: pt[0], z: pt[1] } : null,
            dialogs: [].map.call(document.querySelectorAll('dialog[open]'), function (d) { return d.id; })
          };
        }
      };
    })();
  });
}
</script>
```

To make `camPitch` visible, add `get camPitch(){ return camPitch; }` next to the existing `get camYaw()` in `game.js`. Do not add a setter, teleport, or `completeQuest()`.

Also set one build string in three places that already disagree:

- `index.html` `window.MoonBuild`
- `reliability.js` `BUILD`
- the `?v=` cache buster

Suggested query flags, all optional:

| Flag | Effect |
| --- | --- |
| `qa=1` | Publish `window.MoonTest` |
| `nointro` | Already shipped. Skips the first-launch intro. |
| `nolang` | Already shipped. Skips the first-run language gate. |
| `nocinema=1` | Proposed. Do not wrap `#begin` with the chapter opener. |

No save migration. No new network endpoint.
