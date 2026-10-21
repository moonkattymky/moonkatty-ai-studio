#!/bin/bash
# Builds Intel macOS (x86_64) artifacts of MOONKATTY NODE (official Node.js darwin-x64 binary verified against nodejs.org
# SHASUMS256.txt, + GPG when release keys are present; real minimum macOS read from the Mach-O LC_BUILD_VERSION):
#   moonkatty-node-<v>-darwin-x64.tar.gz          Node 24 LTS (min macOS 13.5)  → iMac 2017, macOS Ventura 13.7.1 (NEWS NODE)
#   moonkatty-node-<v>-darwin-x64-monterey.tar.gz Node 22 LTS (min macOS 11)    → MacBook Pro 13" 2015, Monterey 12.7.6 (MONITOR NODE)
#   moonkatty-node-<v>-js-only.tar.gz             no runtime (fallback)
# Each tarball has MANIFEST.sha256 (per file) and a .sha256 next to it. Zero npm dependencies → no native modules to rebuild.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; OUT="${OUT:-$ROOT/dist-node}"; BASE=https://nodejs.org/dist
VER=$(node -p "require('$ROOT/node-agent/agent.js').VERSION"); W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; mkdir -p "$OUT"; cd "$W"
build() { local MAJ="$1" SUF="$2" NV="${3:-}"; local NAME="moonkatty-node-$VER-$SUF"
  [ -n "$NV" ] || NV=$(curl -fsS "$BASE/latest-v$MAJ.x/SHASUMS256.txt" | sed -n "s/.*node-\(v$MAJ[0-9.]*\)-darwin-x64.tar.gz/\1/p" | head -1)
  mkdir -p "$NV" "$NAME/bin" "$NAME/app"; (cd "$NV" && curl -fsSO "$BASE/$NV/SHASUMS256.txt" && curl -fsSO "$BASE/$NV/node-$NV-darwin-x64.tar.gz" && grep " node-$NV-darwin-x64.tar.gz\$" SHASUMS256.txt | sha256sum -c - >/dev/null)
  local SIG="sha256 OK (SHASUMS256 nodejs.org)"
  if command -v gpg >/dev/null && (cd "$NV" && curl -fsSO "$BASE/$NV/SHASUMS256.txt.sig" && gpg --verify SHASUMS256.txt.sig SHASUMS256.txt 2>/dev/null); then SIG="$SIG + GPG OK"; else SIG="$SIG (GPG: ключи релизов не импортированы)"; fi
  tar -xzf "$NV/node-$NV-darwin-x64.tar.gz" -C "$NV" "node-$NV-darwin-x64/bin/node" "node-$NV-darwin-x64/LICENSE"; cp "$NV/node-$NV-darwin-x64/bin/node" "$NAME/bin/node"; cp "$NV/node-$NV-darwin-x64/LICENSE" "$NAME/bin/NODE_LICENSE"
  local MACHO; MACHO=$(python3 "$ROOT/scripts/node/macho-minos.py" "$NAME/bin/node"); local MIN; MIN=$(echo "$MACHO" | sed -n 's/.*minos \([0-9]*\.[0-9]*\).*/\1/p')
  cp "$ROOT"/node-agent/{agent.js,status.html,logo.jpg,node-agent.env.example} "$ROOT/deploy/com.moonkatty.node-agent.plist" "$ROOT/scripts/node/studio-connection-test.mjs" "$NAME/app/"; cp "$ROOT"/scripts/node/{install.sh,uninstall.sh,detect-specs.sh,fetch-ffprobe.sh} "$NAME/"
  printf 'MOONKATTY NODE %s\nruntime: Node.js %s darwin-x64 (macOS >= %s), %s\nmach-o: %s\nsource: %s @ %s\nbuilt: %s\n' "$VER" "$NV" "$MIN" "$SIG" "$MACHO" "$(git -C "$ROOT" remote get-url origin)" "$(git -C "$ROOT" rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$NAME/BUILDINFO"
  (cd "$NAME" && find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | xargs shasum -a 256 > MANIFEST.sha256)
  tar -czf "$OUT/$NAME.tar.gz" "$NAME"; (cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256"); echo "$NAME: $MACHO"; }
build 24 darwin-x64 "${NODE24_VERSION:-}"
build 22 darwin-x64-monterey "${NODE22_VERSION:-}"
J="moonkatty-node-$VER-js-only"; mkdir -p "$J/app"; cp "moonkatty-node-$VER-darwin-x64"/app/* "$J/app/"; cp "moonkatty-node-$VER-darwin-x64"/*.sh "$J/"; (cd "$J" && find . -type f | LC_ALL=C sort | xargs shasum -a 256 > MANIFEST.sha256); tar -czf "$OUT/$J.tar.gz" "$J"; (cd "$OUT" && shasum -a 256 "$J.tar.gz" > "$J.tar.gz.sha256")
echo "Готово: $OUT"; ls -la "$OUT"; cat "$OUT"/*.sha256
