#!/usr/bin/env bash
# Native build on a Mac with Apple Silicon (recommended): produces .app, .zip and .dmg in dist/.
# Usage:  git clone https://github.com/moonkattymky/moonkatty-ai-studio && cd moonkatty-ai-studio
#         git checkout feat/macos-app && ./scripts/build-mac.sh
# Without an Apple Developer ID the app is ad-hoc signed (free). With one, set CSC_NAME / notarization env vars.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == "Darwin" ]] || { echo "Этот скрипт запускается на macOS. На Linux: scripts/package-mac-on-linux.sh"; exit 1; }
command -v node >/dev/null || { echo "Нужен Node.js 20+ (brew install node)"; exit 1; }
npm ci --ignore-scripts                      # no native module builds needed: the app uses node:sqlite
node node_modules/electron/install.js        # download the Electron binary
export CSC_IDENTITY_AUTO_DISCOVERY="${CSC_IDENTITY_AUTO_DISCOVERY:-false}"
npx electron-builder --mac zip dmg --arm64
# ad-hoc signature so Apple Silicon accepts the bundle seal (skip if signed with a Developer ID)
if [[ "$CSC_IDENTITY_AUTO_DISCOVERY" == "false" ]]; then
  codesign --force --deep --sign - "dist/mac-arm64/MOONKATTY AI STUDIO.app"
  codesign --verify --deep --strict --verbose=2 "dist/mac-arm64/MOONKATTY AI STUDIO.app"
  # rebuild zip/dmg from the re-signed app
  VER=$(node -p "require('./package.json').version")
  rm -f dist/*.zip dist/*.dmg
  ditto -c -k --keepParent "dist/mac-arm64/MOONKATTY AI STUDIO.app" "dist/MOONKATTY-AI-STUDIO-${VER}-arm64-mac.zip"
  hdiutil create -volname "MOONKATTY AI STUDIO" -srcfolder "dist/mac-arm64/MOONKATTY AI STUDIO.app" -ov -format UDZO "dist/MOONKATTY-AI-STUDIO-${VER}-arm64.dmg"
fi
ls -la dist/
