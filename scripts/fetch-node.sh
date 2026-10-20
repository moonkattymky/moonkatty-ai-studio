#!/usr/bin/env bash
# Download the official Node.js binary for macOS arm64 that runs the background server (so the Electron
# RunAsNode fuse can be disabled). Verified against the SHA-256 in the official SHASUMS256.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE_VERSION="${NODE_VERSION:-v24.22.0}"   # same major/minor as Electron 44's embedded Node
NAME="node-${NODE_VERSION}-darwin-arm64"
OUT="build/node/darwin-arm64"; mkdir -p "$OUT" build/node/cache
cd build/node/cache
[[ -f SHASUMS256-${NODE_VERSION}.txt ]] || curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o "SHASUMS256-${NODE_VERSION}.txt"
[[ -f "${NAME}.tar.gz" ]] || curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NAME}.tar.gz" -o "${NAME}.tar.gz"
grep " ${NAME}.tar.gz\$" "SHASUMS256-${NODE_VERSION}.txt" | sha256sum -c -
tar -xzf "${NAME}.tar.gz" "${NAME}/bin/node" "${NAME}/LICENSE"
cd - >/dev/null
cp "build/node/cache/${NAME}/bin/node" "$OUT/node"; cp "build/node/cache/${NAME}/LICENSE" "$OUT/LICENSE"; chmod 755 "$OUT/node"
echo "Node ${NODE_VERSION} darwin-arm64 → $OUT/node"
