#!/usr/bin/env bash
# v1.2.4-test: compatibility check of OUR coordinator (lib/ops) with the REAL NODE 0.2.2 agent package + Studio 3's own node tests.
# Usage: scripts/node-022-compat.sh [/path/to/moonkatty-node-0.2.2-js-only.tar.gz] [studio3-ref]
# Builds a throw-away harness in a temp dir: lib/ → this checkout's lib (unchanged), node-agent/ → app/ of the verified package,
# rest of the tree (tests, fixtures, scripts, docs) = Studio 3 at <studio3-ref>; only lib/ops/{nodes,node-enroll,state}.js are ours. Nothing is installed; fake Keychain only.
set -euo pipefail
cd "$(dirname "$0")/.."
PKG="${1:-/workspace/dist-node/moonkatty-node-0.2.2-js-only.tar.gz}"; REF="${2:-db4720b}"
( cd "$(dirname "$PKG")" && sha256sum -c "$(basename "$PKG").sha256" )
H=$(mktemp -d /tmp/node022-compat-XXXX); trap 'rm -rf "$H"' EXIT
tar --no-same-owner -xzf "$PKG" -C "$H"; P=$(ls -d "$H"/moonkatty-node-*/); ( cd "$P" && sha256sum -c --quiet MANIFEST.sha256 )
mkdir -p "$H/h"; git archive "$REF" | tar -x -C "$H/h"                      # Studio 3 tree at REF (its tests, fixtures, scripts, docs)
for f in nodes.js node-enroll.js state.js; do cp "lib/ops/$f" "$H/h/lib/ops/$f"; done   # swap in OUR coordinator only
rm -rf "$H/h/node-agent"; cp -r "$P/app" "$H/h/node-agent"; cp "$P"/*.sh "$H/h/scripts/node/" 2>/dev/null || true   # REAL 0.2.2 agent from the package
( cd "$H/h" && git init -q && git add -A && git -c user.name=h -c user.email=h@x commit -qm harness )   # some Studio 3 tests use git ls-files
grep -q "const VERSION = '0.2.2'" "$H/h/node-agent/agent.js" || { echo "agent is not 0.2.2" >&2; exit 1; }
echo "agent: $(grep -o "const VERSION = '[^']*'" "$H/h/node-agent/agent.js") from $(basename "$PKG"); Studio 3 tests @ $REF; coordinator: $(git rev-parse --short HEAD)$( [[ -n "$(git status --porcelain)" ]] && echo '+dirty')"
cd "$H/h" && node --test test/ops/enroll.test.js test/ops/news-node.test.js test/ops/monitor-node.test.js test/ops/nodes.test.js test/ops/nodes.multiprocess.test.js
