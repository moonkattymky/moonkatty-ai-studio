# Compatibility with AI STUDIO v1.1.2

Checked 20 October 2026 against the git history. This branch was not booted on the Mac mini. Nothing here was installed over a running app.

## Where 1.1.2 lives

`main` is package version **1.0.0**. The running Mac build the owner described is not that commit.

| Ref | Commit | package.json version |
| --- | --- | --- |
| `main` | `e87bd32` (this branch's base is that line, plus the news commits) | 1.0.0 |
| tag `v1.1.2-mac-preview` | `3f9bd9038a3245a362b355565c4ba2a860c6ba3c` | **1.1.2** |
| `origin/feat/opencode-auth` | `3f9bd9038a3245a362b355565c4ba2a860c6ba3c` (same commit as the tag) | 1.1.2 |
| `origin/feat/studio-operations` | `a8a735930ebcc3c24058541c1e64b04918c30881` | 1.1.2, docs and ops commits **after** the tag |
| `origin/feat/macos-app` | not the 1.1.2 tag | 1.1.1 at the time it was inspected |

`v1.1.2-mac-preview` is the commit to treat as the installed preview. Its `package.json` description is "control panel (web + macOS desktop)" and `main` is `desktop/main.js`. It contains `desktop/` and `lib/opencode-auth.js`.

`feat/studio-operations` is ahead of that tag. One of those later commits unloads Ollama (`keep_alive: 0`) inside a resource manager. This news launch does not start that code and does not set an ops flag.

This news branch stays on the 1.0.0 version line in `package.json`. It does not pretend to be 1.1.2.

## Do not replace the running build

Copying this branch's `server.js` over the 1.1.2 file would drop all of the following, which exist on the tag and not on this branch:

- OpenCode password storage in the macOS Keychain (`lib/opencode-auth.js`)
- CSRF: `Origin` plus `X-Studio-Request` on state-changing `/api` calls
- hashed session ids (`h:` + sha256). Only the hash is stored
- host check and security headers
- `STUDIO_DATA_DIR`, `runner.js`, and the desktop app token

The isolated preview runs **this checkout's** `server.js` against a **database copy** on port **8791**. The installed process on port 8787 is left running. No file in the installed app bundle is overwritten.

## OpenCode Keychain

On the tag, the password lives only in the macOS Keychain:

- service: `MOONKATTY AI STUDIO`
- account: `opencode-server-password`
- written with `security -i` on stdin, hex-encoded (`-X`), never in argv
- never written to SQLite, JSON, logs, or env files
- no fallback store on Linux

`news-launch/bin/mac-isolated.sh` does not invoke `security`. This branch has no `lib/opencode-auth.js`, so starting its server cannot read or rewrite that Keychain item. Do not set `STUDIO_KEYCHAIN`. Do not run a test that calls `setPassword`.

## Ollama

The news client talks only to loopback (`127.0.0.1`, `localhost`, or `::1`), default `http://127.0.0.1:11434`. Preferred model `qwen3:8b`. The chat body is `{ model, stream: false, format: 'json', messages }`. It does **not** send `keep_alive: 0`, so this launch does not unload the model.

Do not enable the studio-operations resource manager in the same shell. That code path is the one that unloads Ollama.

If the daemon is down, or the draft fails grounding, the RSS pipeline labels the script `TEMPORARY_ADAPTER:extractive-headlines` and copies headlines. It does not invent a third story. The corrected MP4s in git were not produced that way. They use `llm.mode: "editor"` because Ollama is not installed on the VM that rendered them. On the Mac, the isolated script runs the RSS pipeline through Ollama first.

## Database

v1.1.2 and this branch both store rows in `items (col, id, data)` and `meta (k, v)`. This branch's server runs:

```sql
CREATE TABLE IF NOT EXISTS items ...
CREATE TABLE IF NOT EXISTS meta ...
```

It does not drop tables, does not alter columns, and does not delete job history. There is no migration script because the launch does not change the schema.

Startup on a copy can still **insert** rows:

- If `meta.seeded` is missing, it inserts the seed set. A copy of a real studio database already has `seeded`, so this does not run.
- `missingSeed` can insert missing default agents, channels, workspaces, or integrations. It does not delete existing rows.
- A new login writes a session into the **copy**. v1.1.2 stores only hashed session ids. This branch stores the raw token. Cookies from the installed app will not authenticate on the preview. Log in again on the preview.

The session cookie is `mk_session` on `Path=/` with no port. `http://127.0.0.1:8791` and `http://127.0.0.1:8787` share it. Open the preview as `http://localhost:8791` if the installed app is on `127.0.0.1`, or the reverse. Logging into the preview on the same host replaces the production session cookie in that browser.

`sqlite3 .backup` is a read of the source, including a live WAL. The script refuses to place the scratch directory in the same folder as the source. Rollback deletes only a directory that contains `news-launch-isolated-scratch`. It never deletes `SOURCE_DB`.

`openStudio` / `saveToStudio` add an episode, one approval task, and two queue rows (`pending_approval`, `scheduledAt: null`, `publish: false`). They do not call the publisher.

## What a future mount into 1.1.2 would need

Not done in this branch. If `POST /api/news/prepare` is later added to the 1.1.2 server, that server's CSRF check requires `Origin` and `X-Studio-Request` on the POST. This branch's server does not have that check. The isolated preview therefore does not send those headers. Do not point the preview at port 8787.

Hashed sessions and the Keychain module have to stay in the 1.1.2 process. The news route can be mounted beside them later. That change belongs on the desktop branch, with the owner, and is not part of this draft.

## Isolated command

```bash
SOURCE_DB="$HOME/Library/Application Support/MOONKATTY AI STUDIO/studio.db" \
DEST_DIR="$HOME/moonkatty-news-scratch" \
  news-launch/bin/mac-isolated.sh --dry-run
```

Replace `SOURCE_DB` with the real file if the installed app stores it somewhere else (`STUDIO_DATA_DIR` on 1.1.2, otherwise `data/studio.db` next to that server). The path above is an example of a location to look, not a path this repo creates.

```bash
SOURCE_DB="/actual/path/studio.db" DEST_DIR="$HOME/moonkatty-news-scratch" \
  news-launch/bin/mac-isolated.sh
```

That runs News → fact-check → script (Ollama `qwen3:8b` when it answers) → Kokoro `am_michael` → both MP4s → QC → save on the copy with approval still holding. Then, if you want the UI:

```bash
SOURCE_DB="/actual/path/studio.db" DEST_DIR="$HOME/moonkatty-news-scratch" \
  news-launch/bin/mac-isolated.sh --serve
```

`--serve` on a second invocation will copy the database again and render again. To only start the server after a finished run:

```bash
DB_PATH="$HOME/moonkatty-news-scratch/studio.db" PORT=8791 HOST=127.0.0.1 node server.js
```

Rollback:

```bash
DEST_DIR="$HOME/moonkatty-news-scratch" news-launch/bin/mac-isolated.sh --rollback
```

Kokoro and espeak-ng have to be installed first. Steps are in `MAC_VERIFICATION.md`. The corrected editorial MP4s already in the repo do not require Ollama. Re-rendering those exact lines on the Mac is:

```bash
node news-launch/bin/render-corrected.js --out "$HOME/moonkatty-news-scratch/corrected"
```

That command does not open the production database.
