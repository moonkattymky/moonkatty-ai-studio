# Stage D — official 3D MOONKATTY host

This launch does not render a host. It does not invent a substitute cat. The episode profile uses `StubHost3D` (`name: host3d-stub`), which returns no segment. `NewsVideoFactory` then keeps the licensed stills and the title cards.

`feat/v1.2.0` is not on `origin`. Nothing in this branch creates or writes `server/jobs*` or `server/blender*`. Blender is not executed.

## Plug-in the studio already described

Copied read-only from `origin/feat/media-automation` @ `66d4b20` (that branch was not modified):

- `media-automation/src/jobs/port.js` — `createJob`, `getJob`, `cancelJob`, `listJobs`. Statuses: `queued`, `running`, `needs_approval`, `succeeded`, `failed`, `cancelled`. Heavy types include `render_segment` and `blender_template`.
- `media-automation/src/jobs/studio-adapter.js` — `StudioJobQueueAdapter`. It calls only an injected client. With no client it throws `NotConnectedError`. `runExclusive(spec, fn)` rejects an inline function, so this process cannot run Blender inside the queue call.
- `media-automation/src/host3d/index.js` — `QueuedHost3D.renderSegment({ script, audioPath, durationSec, aspect, outPath })` enqueues `render_segment` and waits for `{ videoPath }`. `StubHost3D` returns null.

The local file queue in `media-automation/src/jobs/local.js` was **not** imported. Pointing that queue at `server/jobs` would write the studio tree. This launch does not do that.

## What the studio side registers later

When `feat/v1.2.0` exists, that branch owns the handler. This launch will pass a client:

```js
{ createJob, getJob, cancelJob, listJobs }
```

`createJob({ type: 'render_segment', agent, input, timeoutSec, maxAttempts })` and the handler returns `{ videoPath }`. The handler may call the studio's own `blenderService.runTemplate`. That call stays in their process. This repo will not open their SQLite `jobs` / `job_events` tables and will not write `server/blender*`.

`input` for one segment:

| field | meaning |
| --- | --- |
| `script` | spoken line for this scene |
| `audioPath` | narration WAV already rendered by Piper |
| `durationSec` | scene length, including the factory's 0.3s pad |
| `aspect` | `16:9` or `9:16` |
| `outPath` | where the handler may write **its** segment, never under `server/jobs` or `server/blender` from this process |

## Owner approval gate

`news-launch/src/pipeline.js` refuses a host whose `capabilities().available` is true unless `capabilities().ownerApproval` contains both `approvedBy` and `modelHash`. The master model, costume, facial expressions, head motion, paw motion, and lip sync are the owner's approved asset. A missing record stops the launch. A queued host is still not used by the episode profile: that profile accepts only `host3d-stub`.

To turn the official host on later, all of the following have to be true:

1. The owner has approved one master model and recorded `approvedBy` plus `modelHash`.
2. `feat/v1.2.0` injects the job client. This branch does not construct `server/jobs` itself.
3. Their `render_segment` handler implements costume, expressions, head and paw motion, and lip sync against that master model.
4. The episode profile is changed in a later review to allow `QueuedHost3D` instead of `host3d-stub`.

Until then the bulletin is title cards, Piper narration, and burned-in subtitles.
