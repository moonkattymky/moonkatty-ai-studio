#!/bin/bash
# Reproducible source zip of a commit: git archive (zip entries carry the commit time, order = tree order, no local state).
# Usage: bash scripts/node/source-zip.sh [commit] [outdir]  →  <outdir>/moonkatty-ai-studio-<short>.zip + .sha256
# Same commit → same bytes in any clone (git archive output depends only on the tree, commit time and prefix).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; C="$(git -C "$ROOT" rev-parse "${1:-HEAD}^{commit}")"; OUT="${2:-$ROOT/dist-node}"; S="${C:0:7}"; mkdir -p "$OUT"
git -C "$ROOT" -c core.autocrlf=false archive --format=zip -9 --prefix="moonkatty-ai-studio-$S/" -o "$OUT/moonkatty-ai-studio-$S.zip" "$C"
(cd "$OUT" && shasum -a 256 "moonkatty-ai-studio-$S.zip" > "moonkatty-ai-studio-$S.zip.sha256" && cat "moonkatty-ai-studio-$S.zip.sha256")
