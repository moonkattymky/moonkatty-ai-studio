#!/bin/bash
# Builds Intel macOS (x64) artifacts of MOONKATTY NODE: tarball with official Node.js 22 LTS darwin-x64 (verified against
# nodejs.org SHASUMS256.txt, + GPG signature check when gpg and release keys are available), per-file MANIFEST.sha256, .sha256 of the tarball.
# Also a "js-only" tarball (no runtime) as a fallback for an older macOS with a separately installed Node 18.
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"; OUT="${OUT:-$ROOT/dist-node}"; NV="${NODE_VERSION:-}"; BASE=https://nodejs.org/dist
[ -n "$NV" ] || NV=$(curl -fsS "$BASE/latest-v22.x/SHASUMS256.txt" | sed -n 's/.*node-\(v22[0-9.]*\)-darwin-x64.tar.gz/\1/p' | head -1)
VER=$(node -p "require('$ROOT/node-agent/agent.js').VERSION"); NAME="moonkatty-node-$VER-darwin-x64"; W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$OUT" "$W/$NAME/bin" "$W/$NAME/app"; cd "$W"
curl -fsSO "$BASE/$NV/SHASUMS256.txt"; curl -fsSO "$BASE/$NV/node-$NV-darwin-x64.tar.gz"
grep " node-$NV-darwin-x64.tar.gz\$" SHASUMS256.txt | sha256sum -c - >/dev/null; SIG="sha256 OK"
if command -v gpg >/dev/null && curl -fsSO "$BASE/$NV/SHASUMS256.txt.sig" && gpg --verify SHASUMS256.txt.sig SHASUMS256.txt 2>/dev/null; then SIG="$SIG + GPG OK"; else SIG="$SIG (GPG: ключи релизов не импортированы — проверена только SHA-256)"; fi
tar -xzf "node-$NV-darwin-x64.tar.gz" "node-$NV-darwin-x64/bin/node" "node-$NV-darwin-x64/LICENSE"; cp "node-$NV-darwin-x64/bin/node" "$NAME/bin/node"; cp "node-$NV-darwin-x64/LICENSE" "$NAME/bin/NODE_LICENSE"
cp "$ROOT"/node-agent/{agent.js,status.html,node-agent.env.example} "$ROOT/deploy/com.moonkatty.node-agent.plist" "$NAME/app/"; cp "$ROOT"/scripts/node/{install.sh,uninstall.sh,detect-specs.sh} "$NAME/"
printf 'MOONKATTY NODE %s\nruntime: Node.js %s darwin-x64 (macOS >= 11), %s\nsource: %s @ %s\nbuilt: %s\n' "$VER" "$NV" "$SIG" "$(git -C "$ROOT" remote get-url origin)" "$(git -C "$ROOT" rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$NAME/BUILDINFO"
(cd "$NAME" && find . -type f ! -name MANIFEST.sha256 | sort | xargs shasum -a 256 > MANIFEST.sha256)
tar -czf "$OUT/$NAME.tar.gz" "$NAME"; (cd "$OUT" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
J="moonkatty-node-$VER-js-only"; mkdir -p "$J/app"; cp "$NAME"/app/* "$J/app/"; cp "$NAME"/*.sh "$J/"; (cd "$J" && find . -type f | sort | xargs shasum -a 256 > MANIFEST.sha256); tar -czf "$OUT/$J.tar.gz" "$J"; (cd "$OUT" && shasum -a 256 "$J.tar.gz" > "$J.tar.gz.sha256")
echo "Готово: $OUT"; ls -la "$OUT"; cat "$OUT"/*.sha256
