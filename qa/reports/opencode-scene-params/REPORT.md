# OpenCode `scene_params.json` — v1.2.x

Target read in a detached worktree at `/tmp/mk-scene`, `origin/feat/v1.2.4-test-nodes` HEAD `6cf7c08a3e0447c0871ba01597d5ad150e99e47f`. `git status --porcelain` there was empty after the run. Nothing on that branch was modified. Nothing was merged and nothing was published. Passwords in the run are fake. No call was made to Meta, Facebook, Instagram, or Telegram. Ollama was not running.

The same `scene_params.json` path is on `origin/feat/v1.2.0` (`a3fd83a`) and `origin/feat/v1.2.2-test-isolated` (`a2a35c8`). `lib/executors/design3d.js` on v1.2.2-test and v1.2.4-test is the same blob (`0d0219416382`). Against v1.2.0 the only change in that file is the OpenCode URL default (`require('../studio-config.js').opencodeUrl` instead of a hardcoded `127.0.0.1:4096`), commit `f2440e1`.

## What the bug is

`lib/executors/design3d.js` `params()` stores schema-valid `cp.params` before the agent runs. `agent()` (lines 60–110) asks OpenCode to write exactly one file, `scene_params.json`, and then throws `Агент OpenCode не записал scene_params.json` when that path is missing. `validate()` (line 113) throws `scene_params.json — не JSON` when the file does not parse. Blender is the next stage. It reads `logs/params.validated.json`, which `validate()` writes, via `blender/templates/scene_basic.py`.

`docs/MAC_TEST_CHECKLIST.md` line 62 is still an open checkbox: a real `ollama/qwen2.5-coder:7b` was checked on Linux only with a mock LLM, and a model that does not call `write` fails with that error. `scripts/test-fixtures/mock-llm.mjs` is that double. It parses `FILE:` and `CONTENT:` out of the studio prompt and emits a `write` tool call. A reply with no tool call sends the text `3D task` or `Готово.` and writes nothing.

`skipAgent` (line 61) writes `scene_params.json` from `cp.params` and skips OpenCode. That path is the panel re-render. It is not the Director → OpenCode path.

No commit on these branches adds a fallback that writes the studio params when the agent skips the tool. `git log -S scene_params` finds the string introduced in `00b63fc` (v1.2.0 stages A+B) and carried in `42d3fd5` and the docs commit `a3fd83a`.

## What was run

Apt's `blender` candidate is `4.0.2+dfsg-1ubuntu8`. `lib/blender.js` requires Blender ≥ 4.2, so that package was not used. The official tarball `blender-4.2.9-linux-x64.tar.xz` from `download.blender.org` was unpacked to `/tmp/blender-4.2.9`. `blender -b --version` printed `Blender 4.2.9 LTS`. OpenCode is `opencode-ai@1.19.3` from npm, binary `/tmp/oc-install/node_modules/.bin/opencode`.

Harness: `node qa/reports/opencode-scene-params/run.mjs` with `SCENE_SRC=/tmp/mk-scene`. Log: `logs/harness.out`. Machine-readable rows: `logs/result.json`. The studio was plain Node, `NODE_ENV=test`, `STUDIO_FLAVOR=test`, `STUDIO_SQLITE=node`, data under `/tmp/mk-scene-run`. The product mock LLM and a chat-only mock both sat in front of the real `opencode serve`.

Blender detection through the studio: ok, `4.2.9 LTS`, engines `CYCLES`, `BLENDER_EEVEE_NEXT`, `BLENDER_WORKBENCH`. OpenCode health: `healthy: true`, version `1.19.3`, no-auth status 401.

### Phase A — the mock calls `write`

Task text: `Создай фиолетового кота MOONKATTY в студийном свете`. Ollama was down, so params were `rules`: subject `cat`, lighting `three_point`, Cycles `640×480`. The job reached `waiting_approval` at stage `verify`.

| File | Result |
| --- | --- |
| `scene_params.json` | present |
| `scene.blend` | 913264 bytes, magic `BLENDER` |
| `renders/preview.png` | 406166 bytes, PNG signature, 640×480 |
| `exports/scene.glb` | listed by the render result |

The job log says `OpenCode инструмент write: completed`, then Blender `scene_basic` build, then a second Blender process reopened the `.blend` and rendered with Cycles. Objects include `Head`, `Body`, `EarL`, `EarR`, `EyeL`, `EyeR`, `Tail`. The preview is a purple cat on a dark floor. Copy: `logs/preview.png`.

This is the path `scripts/design3d-test.mjs` already describes: real OpenCode executes the write, and the LLM is the mock because no Ollama model is on the box. Their full `test:3d` was not re-run here. It also cancels a 256-sample 1920×1080 render and resumes a 200-sample one. The happy-path files above are the scene the owner asked about.

### Phase B — the model only chats

The same server, with a mock that returns text and no tool call. The job status was `failed`, stage `agent`, error `Агент OpenCode не записал scene_params.json`. The event line is `Агент завершил работу. Инструменты: нет`. `scene_params.json`, `scene.blend`, and `preview.png` were absent. The params stage had already chosen `cat` / Cycles `640×480`. Blender was not started.

## What remains unverified

- A real Ollama model (`qwen2.5-coder:7b` or `qwen3:8b`) calling `write`. The checklist item is still open. This run used mocks.
- Blender.app on macOS, Metal, and EEVEE as the chosen engine. Detection listed `BLENDER_EEVEE_NEXT`. The render that ran was Cycles on Linux CPU.
- The studio's previously recorded Blender `5.2.2` at `/workspace/tools/blender-5.2.2-linux-x64/blender`. That path is not on this machine. 4.2.9 LTS is inside the ≥ 4.2 range the detector accepts.
- `sandbox-exec`, Keychain, and `launchd`. The Keychain stand-in was `scripts/test-fixtures/fake-security.mjs`.

## Result

**FAIL.** The missing-file failure is still the code, and no fix commit exists on the v1.2.x branches that were searched. When the test double does call `write`, the chain ends with a `.blend` and a PNG. When the model only chats, it ends with neither.

Blocking bug: `QA-3D-001`. Owner approval is not set.

**Allowed on the Mac mini:** the isolated test app may run one 3D trial after the checklist backup. If the job stops with `Агент OpenCode не записал scene_params.json`, Blender did not run; copy the job log and stop. Do not treat a mock-LLM pass as a real-model pass. Real publishing and real social accounts stay forbidden. macOS Blender.app and a live Ollama model were **NOT VERIFIED**.
