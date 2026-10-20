#!/usr/bin/env bash
# Isolated preview of MOONKATTY NEWS on a COPY of the studio database.
# Does not replace the installed AI STUDIO v1.1.2 app.
# Does not call `security`. Does not unload Ollama. Does not publish.
# Does not write server/jobs or server/blender.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  SOURCE_DB=/path/to/studio.db DEST_DIR=$HOME/moonkatty-news-scratch \
    news-launch/bin/mac-isolated.sh [--dry-run] [--serve] [--rollback]

Reads SOURCE_DB once, via sqlite3 .backup, into DEST_DIR/studio.db.
The preview server listens on 127.0.0.1 port 8791 (override with PORT, never 8787).
Open the preview at http://localhost:8791 so the session cookie does not collide
with an app already open on http://127.0.0.1.

--dry-run   RSS ingest and fact-check only. No TTS, no video, no database save.
--serve     After a full run, start THIS checkout's server.js against the copy.
--rollback  Delete DEST_DIR only if this script created it (marker file). Never deletes SOURCE_DB.

Environment:
  SOURCE_DB   required for a copy (not required for --rollback)
  DEST_DIR    required scratch directory
  PORT        default 8791. 8787 is refused.
  ALLOW_NON_DARWIN=1   allow a syntax-style run off macOS. The owner's machine is Darwin.
EOF
}

DRY=0
SERVE=0
ROLLBACK=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --serve) SERVE=1 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" && "${ALLOW_NON_DARWIN:-}" != "1" ]]; then
  echo "Refusing: this preview is for the Mac mini. Set ALLOW_NON_DARWIN=1 only to inspect the script elsewhere." >&2
  exit 2
fi

: "${DEST_DIR:?Set DEST_DIR to a scratch directory}"
PORT="${PORT:-8791}"
if [[ "$PORT" == "8787" || "$PORT" == "0" ]]; then
  echo "Refusing port $PORT. The installed studio uses 8787. Use 8791." >&2
  exit 2
fi

case "$DEST_DIR" in
  *"/server/jobs"*|*"/server/blender"*) echo "Refusing studio-owned path $DEST_DIR" >&2; exit 2 ;;
esac

MARKER="$DEST_DIR/news-launch-isolated-scratch"

if [[ "$ROLLBACK" == "1" ]]; then
  if [[ ! -f "$MARKER" ]]; then
    echo "Refusing rollback: $DEST_DIR has no scratch marker. The original database was not touched." >&2
    exit 2
  fi
  rm -rf "$DEST_DIR"
  echo "Removed scratch directory $DEST_DIR. The source database was not deleted."
  exit 0
fi

: "${SOURCE_DB:?Set SOURCE_DB to the database to copy. This script only reads it.}"
if [[ ! -f "$SOURCE_DB" ]]; then
  echo "SOURCE_DB is not a file: $SOURCE_DB" >&2
  exit 2
fi
case "$SOURCE_DB" in
  *"/server/jobs"*|*"/server/blender"*) echo "Refusing studio-owned path $SOURCE_DB" >&2; exit 2 ;;
esac

SRC_REAL=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$SOURCE_DB")
DEST_PARENT=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$(dirname "$DEST_DIR")")
SRC_DIR=$(dirname "$SRC_REAL")
if [[ "$DEST_PARENT" == "$SRC_DIR" || "$DEST_DIR" == "$SRC_DIR" ]]; then
  echo "Refusing: DEST_DIR must not sit in the same directory as SOURCE_DB ($SRC_DIR)." >&2
  exit 2
fi

if [[ -e "$DEST_DIR" && ! -f "$MARKER" ]]; then
  echo "Refusing: $DEST_DIR already exists and is not a scratch directory created by this script." >&2
  exit 2
fi

if command -v lsof >/dev/null 2>&1; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Refusing: port $PORT is already in use. This script will not kill that process." >&2
    exit 2
  fi
fi

mkdir -p "$DEST_DIR"
printf 'created %s\nsource %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$SRC_REAL" > "$MARKER"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required so the copy uses .backup (a read of SOURCE_DB, including a live WAL)." >&2
  exit 2
fi
sqlite3 "$SRC_REAL" ".backup '$DEST_DIR/studio.db'"
mkdir -p "$DEST_DIR/backup-before-run"
cp "$DEST_DIR/studio.db" "$DEST_DIR/backup-before-run/studio.db"

# Do not inherit flags that unload Ollama or point at the installed data dir.
unset STUDIO_DATA_DIR || true
unset STUDIO_OPS_ENABLED || true
unset STUDIO_RESOURCE_MANAGER || true
export DB_PATH="$DEST_DIR/studio.db"
export PORT
export HOST=127.0.0.1
export OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$ROOT"

echo "Scratch DB: $DB_PATH"
echo "Source left unread-after-backup: $SRC_REAL"
echo "Ollama URL (loopback, no keep_alive unload): $OLLAMA_URL"
echo "This script does not run the security command and does not replace the installed build."

PREPARE=(node news-launch/bin/prepare.js --tts kokoro --voice am_michael --out "$DEST_DIR/episode" --db "$DB_PATH")
if [[ "$DRY" == "1" ]]; then
  node news-launch/bin/prepare.js --dry-run --out "$DEST_DIR/episode"
  echo "Dry run finished. No episode was saved. No video was rendered."
  exit 0
fi

"${PREPARE[@]}"

if [[ "$SERVE" == "1" ]]; then
  echo "Starting this checkout's server on http://127.0.0.1:$PORT"
  echo "Browse http://localhost:$PORT — do not use the same host as the installed app, or the session cookie will be shared."
  exec node server.js
fi

echo "Preview files: $DEST_DIR/episode"
echo "Queue rows on the COPY are pending_approval. Do not publish."
echo "Rollback: DEST_DIR='$DEST_DIR' $0 --rollback"
