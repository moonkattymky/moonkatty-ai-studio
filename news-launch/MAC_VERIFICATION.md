# Mac mini verification

The corrected episode in `news-launch/artifacts/corrected-episode` was rendered on the Linux VM with Kokoro `am_michael` (provisional, not locked) and ffmpeg. Repeat the pipeline on the Mac mini against a database copy. Do not replace the installed AI STUDIO v1.1.2 build. Read `news-launch/COMPAT_v1.1.2.md` before the first run.

The earlier extractive episode in `news-launch/artifacts/test-episode` used Piper `en_US-ljspeech-high` and media headlines. That voice is female. The owner asked for an adult male American anchor. Do not treat LJ Speech as the locked voice. Its licence is fine. It does not fit the role. The fact-check of those three stories is `news-launch/artifacts/test-episode/FACTCHECK.md`.

Do not point `DB_PATH`, `--out`, or `--db` at the production database, `server/jobs`, or `server/blender`. This launch throws `studio_owned_path` if the output path is under those two trees. Do not publish from the Social queue. Do not checkout or commit on `main`, `feat/media-automation`, `feat/quality-automation`, `feat/macos-app`, `feat/opencode-auth`, or `feat/studio-operations`.

## 1. Isolated copy

v1.1.2 is tag `v1.1.2-mac-preview`, commit `3f9bd9038a3245a362b355565c4ba2a860c6ba3c` (`origin/feat/opencode-auth`). `main` is still package 1.0.0.

```bash
# Put the real studio.db path in SOURCE_DB. The script only reads it (sqlite3 .backup).
SOURCE_DB="/path/to/installed/studio.db" \
DEST_DIR="$HOME/moonkatty-news-scratch" \
  news-launch/bin/mac-isolated.sh --dry-run
```

`--dry-run` ingests RSS and stops after fact-check. It does not render, does not save an episode, and does not publish. Port 8787 is refused. The scratch directory must not be the folder that holds `SOURCE_DB`.

Rollback deletes only a directory this script marked:

```bash
DEST_DIR="$HOME/moonkatty-news-scratch" news-launch/bin/mac-isolated.sh --rollback
```

A copy of the database, taken before the news save, is `backup-before-run/studio.db` inside the scratch directory. Restoring that file over `studio.db` in the scratch directory rolls the copy back. It does not touch `SOURCE_DB`.

## 2. Voice — provisional male anchor

Kokoro-82M v1.0 weights are Apache-2.0. The three candidates are `am_michael`, `am_adam`, and `am_fenrir`. `am_michael` is the provisional default. It is not locked. Listen to `news-launch/artifacts/voice-samples/` before locking anything. Reject Piper `en_US-ryan-high` (CC BY-NC-SA) and `en_US-joe-medium` (Lessac fine-tune). Details: `news-launch/VOICE_REPORT.md`.

```bash
brew install espeak-ng
python3 -m pip install --user 'kokoro-onnx==0.4.9' soundfile
mkdir -p news-launch/models/kokoro
curl -fL --retry 3 -o news-launch/models/kokoro/kokoro-v1.0.onnx \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -fL --retry 3 -o news-launch/models/kokoro/voices-v1.0.bin \
  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Those files are gitignored. espeak-ng is GPL-3 and is a phonemizer. It is not vendored. Piper's optional comparison voice, if you still want the female sample, is `node news-launch/bin/ensure-tts.js` (macOS aarch64, `en_US-ljspeech-high` only). The installer rejects Lessac.

## 3. Ollama

Loopback only. Preferred model `qwen3:8b`. The client does not send `keep_alive: 0`. Leave the existing Ollama daemon running. Do not start the studio-operations resource manager in this shell.

## 4. Full isolated run

```bash
SOURCE_DB="/path/to/installed/studio.db" \
DEST_DIR="$HOME/moonkatty-news-scratch" \
  news-launch/bin/mac-isolated.sh
```

The command runs the reputable RSS list, fact-checks, asks Ollama `qwen3:8b` for the script, synthesizes MasterVoice Kokoro `am_michael` (candidate, not locked) through `SpeechComposer`, renders 1920×1080 and 1080×1920 with `NewsVideoFactory` at −16 LUFS, runs their QC, and saves the episode into the **copy** with `publish: false`. The Approval Center item is `pending`. Publisher posts are `dry_run`. The episode badge stays `pending_approval`. The social queue is not written. A story with no licensed still fails closed.

If Ollama is down, the script mode is `TEMPORARY_ADAPTER:extractive-headlines`. If fewer than three stories pass the RSS corroboration window, the command exits with `Refusing to invent news`.

The editorial MP4s already committed were not taken from that RSS selection. Alberta's winner line failed the primary-source check. To re-render those corrected lines on the Mac, without touching a database:

```bash
node news-launch/bin/render-corrected.js --out "$HOME/moonkatty-news-scratch/corrected"
```

## 5. Look, do not publish

```bash
DB_PATH="$HOME/moonkatty-news-scratch/studio.db" PORT=8791 HOST=127.0.0.1 node server.js
```

Open `http://localhost:8791`, not `http://127.0.0.1:8791`, if the installed app is already open on `127.0.0.1`. The session cookie is not scoped to a port. Log in on the preview. The Keychain item is not read. Check:

- Dashboard preview plays the 16:9 file and shows **Ждёт утверждения**.
- News shows both aspect ratios and the source links.
- Social → Единая очередь does not gain a row for this edition. Publisher state is `dry_run` in the episode directory. **Опубликовать** is not invoked.

Do not click **Подготовить выпуск** during a short look. That POST renders another episode and takes several minutes. Anonymous calls return 401.

Settings and job history on the copy stay. The preview can insert missing seed rows into the copy only. The production file is a different path.

## 6. Studio jobs and Blender

Do not create `server/jobs` or `server/blender`. When a studio client `{ createJob, getJob, cancelJob, listJobs }` exists, pass it as `studioJobClient`. Until then the probe records `TEMPORARY_ADAPTER:studio-job-queue-not-connected`. A 3D segment still requires the owner-approved master model in `HOST_3D_INTERFACE.md`.
