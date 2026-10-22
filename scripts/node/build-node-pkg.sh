#!/bin/bash
# Builds Intel macOS (x86_64) artifacts of MOONKATTY NODE (official Node.js darwin-x64 binary verified against nodejs.org
# SHASUMS256.txt + GPG with keys from github.com/nodejs/release-keys; real minimum macOS read from the Mach-O LC_BUILD_VERSION):
#   moonkatty-node-<v>-darwin-x64.tar.gz          Node 24 LTS (min macOS 13.5)  → iMac 2017, macOS Ventura 13.7.1 (NEWS NODE)
#   moonkatty-node-<v>-darwin-x64-monterey.tar.gz Node 22 LTS (min macOS 11)    → MacBook Pro 13" 2015, Monterey 12.7.6 (MONITOR NODE)
#   moonkatty-node-<v>-js-only.tar.gz             no runtime (fallback)
# Each tarball has MANIFEST.sha256 (per file) and a .sha256 next to it. Zero npm dependencies → no native modules to rebuild.
# Reproducible: same commit + same Node versions → byte-identical archives (SOURCE_DATE_EPOCH = commit time, sorted names,
# fixed mtime/owner/mode, gzip -n). Needs GNU tar (gtar on macOS). Node versions are pinned (override NODE24_VERSION/NODE22_VERSION).
# Never writes the git remote into artifacts (a credentialed remote would leak a token): source is a fixed public URL.
# JS_ONLY=1 builds only the js-only archive (no download; used by tests).
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; OUT="${OUT:-$ROOT/dist-node}"; BASE=https://nodejs.org/dist
PUBLIC_URL="https://github.com/moonkattymky/moonkatty-ai-studio"
NODE24_VERSION="${NODE24_VERSION:-v24.22.1}"; NODE22_VERSION="${NODE22_VERSION:-v22.23.4}"
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"; export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(git -C "$ROOT" log -1 --format=%ct HEAD)}"
BUILT="$(date -u -d "@$SOURCE_DATE_EPOCH" +%FT%TZ 2>/dev/null || date -u -r "$SOURCE_DATE_EPOCH" +%FT%TZ)"
TAR=tar; command -v gtar >/dev/null && TAR=gtar; "$TAR" --version 2>/dev/null | grep -q 'GNU tar' || { echo "нужен GNU tar (gtar)" >&2; exit 1; }
VER=$(node -p "require('$ROOT/node-agent/agent.js').VERSION"); W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT; mkdir -p "$OUT"; cd "$W"
pack() { local NAME="$1"
  (cd "$NAME" && find . -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | xargs shasum -a 256 > MANIFEST.sha256)
  "$TAR" --sort=name --mtime="@$SOURCE_DATE_EPOCH" --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' --format=gnu -cf - "$NAME" | gzip -n -9 > "$OUT/$NAME.tar.gz"
  (cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256"); }
appfiles() { mkdir -p "$1/app"; cp "$ROOT"/node-agent/{agent.js,enroll.js,enroll.html,status.html,logo.jpg,node-agent.env.example} "$ROOT/deploy/com.moonkatty.node-agent.plist" "$ROOT/scripts/node/studio-connection-test.mjs" "$1/app/"; cp "$ROOT"/scripts/node/{install.sh,uninstall.sh,detect-specs.sh,fetch-ffprobe.sh} "$1/"; }
GPGOK=0
if [ -z "${JS_ONLY:-}" ] && command -v gpg >/dev/null; then export GNUPGHOME="$W/gnupg"; mkdir -m 700 "$GNUPGHOME"
  if curl -fsSL https://github.com/nodejs/release-keys/archive/refs/heads/main.tar.gz | tar -xz -C "$W" && gpg -q --batch --import "$W"/release-keys-main/keys/*.asc 2>/dev/null; then GPGOK=1; fi; fi
build() { local NV="$1" SUF="$2"; local NAME="moonkatty-node-$VER-$SUF"
  mkdir -p "$NV" "$NAME/bin"; (cd "$NV" && curl -fsSO "$BASE/$NV/SHASUMS256.txt" && curl -fsSO "$BASE/$NV/node-$NV-darwin-x64.tar.gz" && grep " node-$NV-darwin-x64.tar.gz\$" SHASUMS256.txt | shasum -a 256 -c - >/dev/null)
  local SIG="sha256 OK (SHASUMS256 nodejs.org)"
  if [ "$GPGOK" = 1 ] && (cd "$NV" && curl -fsSO "$BASE/$NV/SHASUMS256.txt.sig" && gpg --batch --verify SHASUMS256.txt.sig SHASUMS256.txt 2>/dev/null); then SIG="$SIG + GPG OK (nodejs/release-keys)"; else SIG="$SIG (GPG: НЕ проверено)"; fi
  tar -xzf "$NV/node-$NV-darwin-x64.tar.gz" -C "$NV" "node-$NV-darwin-x64/bin/node" "node-$NV-darwin-x64/LICENSE"; cp "$NV/node-$NV-darwin-x64/bin/node" "$NAME/bin/node"; cp "$NV/node-$NV-darwin-x64/LICENSE" "$NAME/bin/NODE_LICENSE"
  local MACHO; MACHO=$(python3 "$ROOT/scripts/node/macho-minos.py" "$NAME/bin/node"); local MIN; MIN=$(echo "$MACHO" | sed -n 's/.*minos \([0-9]*\.[0-9]*\).*/\1/p')
  appfiles "$NAME"
  printf 'MOONKATTY NODE %s\nruntime: Node.js %s darwin-x64 (macOS >= %s), %s\nmach-o: %s\nsource: %s @ %s\nbuilt: %s (SOURCE_DATE_EPOCH=%s, время коммита)\n' "$VER" "$NV" "$MIN" "$SIG" "$MACHO" "$PUBLIC_URL" "$COMMIT" "$BUILT" "$SOURCE_DATE_EPOCH" > "$NAME/BUILDINFO"
  pack "$NAME"; echo "$NAME: $MACHO"; }
if [ -z "${JS_ONLY:-}" ]; then build "$NODE24_VERSION" darwin-x64; build "$NODE22_VERSION" darwin-x64-monterey; fi
J="moonkatty-node-$VER-js-only"; appfiles "$J"
printf 'MOONKATTY NODE %s\nruntime: нет (нужен свой Node.js >= 22)\nsource: %s @ %s\nbuilt: %s (SOURCE_DATE_EPOCH=%s, время коммита)\n' "$VER" "$PUBLIC_URL" "$COMMIT" "$BUILT" "$SOURCE_DATE_EPOCH" > "$J/BUILDINFO"
pack "$J"
echo "Готово: $OUT"; ls -la "$OUT"; cat "$OUT"/*.sha256
