# Mac mini verification

The test episode in `news-launch/artifacts/test-episode` was rendered on the Linux VM (Piper `en_US-ljspeech-high`, ffmpeg). Repeat it on the Mac mini without touching production data or the studio job tree.

Do not point `DB_PATH`, `--out`, or `--db` at a production database, `server/jobs`, or `server/blender`. This launch throws `studio_owned_path` if the output path is under those two trees. Do not publish from the Social queue. Do not checkout or commit on `main`, `feat/media-automation`, `feat/quality-automation`, `feat/macos-app`, or `feat/v1.2.0`.

## 1. Throwaway database

```bash
export DB_PATH="$HOME/moonkatty-news-scratch/studio.db"
export PORT=8791
export HOST=127.0.0.1
mkdir -p "$(dirname "$DB_PATH")"
```

`HOST` stays on loopback. Leave the production launchd service and its database alone.

## 2. Piper (commercial-use voice)

The Mac mini is arm64. Use the aarch64 build, not the Linux binary from this VM.

```bash
node news-launch/bin/ensure-tts.js
```

On macOS that downloads `piper_macos_aarch64.tar.gz` from Piper release `2023.11.14-2` and the voice `en_US-ljspeech-high`. The installer rejects a model card that is not public-domain LJ Speech, and it rejects Lessac and other non-commercial voices. The binary is gitignored under `news-launch/models/`.

`en_US-lessac-*` is research-only. Do not switch the voice.

## 3. Ollama

The launch talks only to loopback (`127.0.0.1`, `localhost`, or `::1`), default `http://127.0.0.1:11434`. Preferred model is `qwen3:8b`. If that daemon is down, or the draft fails the grounding check, the script is `TEMPORARY_ADAPTER:extractive-headlines`: publisher names and headlines copied verbatim. The VM episode used that adapter (`reason: fetch failed`) because Ollama is not installed here.

## 4. Produce the bulletin

```bash
node news-launch/bin/prepare.js \
  --prompt "Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях" \
  --out "$HOME/moonkatty-news-scratch/episode" \
  --db "$DB_PATH"
```

The command ingests the reputable RSS list, keeps a story only when two different publishers agree, writes the English script, synthesizes Piper, renders 1920×1080 and 1080×1920, loudness-normalizes, and runs ffprobe/ffmpeg QC. It saves the episode into the throwaway database with `publish: false` and queue status `pending_approval`.

If fewer than three stories have two publishers inside seven days, the command exits with `Refusing to invent news` and writes no episode.

## 5. Look, do not publish

```bash
DB_PATH="$DB_PATH" PORT=8791 HOST=127.0.0.1 node server.js
```

Open `http://127.0.0.1:8791`, create or enter the local admin (password is not stored in this repo). Check:

- Dashboard preview plays the 16:9 file and shows **Ждёт утверждения**.
- News shows both aspect ratios, the source links, and the Piper script.
- Social → Единая очередь shows the items as **На утверждении**. **Опубликовать** stays disabled.

The same hold is `POST /api/news/prepare` with the session cookie and body `{ "text": "Подготовь выпуск MOONKATTY NEWS о трёх важных мировых событиях" }`. Anonymous calls return 401. The button **Подготовить выпуск** calls that route and takes several minutes.

## 6. Studio jobs and Blender

Do not create `server/jobs` or `server/blender` for this launch. When `feat/v1.2.0` injects `{ createJob, getJob, cancelJob, listJobs }`, pass it as `studioJobClient`. Until then the probe records `TEMPORARY_ADAPTER:studio-job-queue-not-connected`. A 3D segment still requires the owner-approved master model described in `HOST_3D_INTERFACE.md`.
