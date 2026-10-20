#!/usr/bin/env bash
# Native build on a Mac with Apple Silicon: .app, .zip and .dmg in dist/ (ad-hoc signed unless you have a Developer ID).
# Locally built apps are not quarantined, so Gatekeeper does not block them — review the code before building.
# See docs/BUILD_MAC.md.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || { echo "Нужен Mac с Apple Silicon. На Linux: scripts/package-mac-on-linux.sh"; exit 1; }
command -v node >/dev/null || { echo "Нужен Node.js 20+ (https://nodejs.org)"; exit 1; }
COMMIT=$(git rev-parse HEAD); export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
VER=$(node -p "require('./package.json').version"); APP="dist/mac-arm64/MOONKATTY AI STUDIO.app"
npm ci --ignore-scripts --no-audit --no-fund
scripts/fetch-node.sh
node -e "require('fs').writeFileSync('desktop/build-info.json', JSON.stringify({commit:'$COMMIT', builtAt:new Date($SOURCE_DATE_EPOCH*1000).toISOString(), electron:require('./package.json').build.electronVersion, node:'${NODE_VERSION:-v24.22.0}', builder:'macos'}))"
rm -rf dist
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
npx electron-builder --mac dir --arm64 --publish never
if [[ "$CSC_IDENTITY_AUTO_DISCOVERY" == "false" ]]; then
  codesign --force --deep --sign - "$APP"     # ad-hoc
fi
codesign --verify --deep --strict --verbose=2 "$APP"
ditto -c -k --keepParent "$APP" "dist/MOONKATTY-AI-STUDIO-${VER}-arm64-mac.zip"
hdiutil create -volname "MOONKATTY AI STUDIO" -srcfolder "$APP" -ov -format UDZO "dist/MOONKATTY-AI-STUDIO-${VER}-arm64.dmg"
( cd dist && shasum -a 256 *.zip *.dmg | tee SHA256SUMS.txt && for f in *.zip *.dmg; do shasum -a 256 "$f" > "$f.sha256"; done )
npx --yes @cyclonedx/cyclonedx-npm@4 --omit dev --output-format JSON --output-file dist/sbom.cdx.json >/dev/null 2>&1 || true
{ echo "MOONKATTY AI STUDIO ${VER} (macOS arm64, built on Mac)"; echo "commit: ${COMMIT}"; echo "SOURCE_DATE_EPOCH: ${SOURCE_DATE_EPOCH}"; cat dist/SHA256SUMS.txt; npx --yes @electron/fuses read --app "$APP" | grep -E "is (Enabled|Disabled)"; } > dist/BUILD-INFO.txt
cat dist/BUILD-INFO.txt
