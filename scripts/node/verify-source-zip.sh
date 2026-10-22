#!/bin/bash
# Verifies a source zip against a commit independent of the git version that wrote it: every file's git blob hash must equal
# the blob in the commit tree, and the file sets must match. Usage: bash scripts/node/verify-source-zip.sh <zip> [commit]
set -euo pipefail
ZIP="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; ROOT="$(git rev-parse --show-toplevel)"; C="$(git -C "$ROOT" rev-parse "${2:-HEAD}^{commit}")"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT; (cd "$T" && unzip -q "$ZIP"); P="$(ls "$T")"
git -C "$ROOT" ls-tree -r "$C" | awk '$2=="blob"{print $3"\t"$4}' | LC_ALL=C sort > "$T.want"
(cd "$T/$P" && find . -type f | sed 's#^\./##' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\t%s\n' "$(git hash-object "$f")" "$f"; done) | LC_ALL=C sort > "$T.got"
if diff -q "$T.want" "$T.got" >/dev/null; then echo "OK: $(wc -l < "$T.got") файлов совпадают с $C"; rm -f "$T.want" "$T.got"; else diff "$T.want" "$T.got" | head; rm -f "$T.want" "$T.got"; exit 1; fi
