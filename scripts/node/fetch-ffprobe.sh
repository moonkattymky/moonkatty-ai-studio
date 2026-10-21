#!/bin/bash
# Optional: install a static ffprobe for MONITOR NODE (MacBook Pro 2015, macOS Monterey 12.7.6, x86_64) into ~/moonkatty-node/tools.
# Source: evermeet.cx static build (tessus), mirrored by ffbinaries-prebuilt on GitHub. Both hashes are PINNED: zip and binary.
# Verified at pin time: Mach-O x86_64, LC_BUILD_VERSION minos 10.13.0 (≤ 12.7.6), ffprobe 6.1, static (only system libs). GPL build.
# Homebrew is NOT used (Monterey is Tier 3/unsupported for Homebrew — builds from source, slow on 2 cores). No sudo. bash 3.2.
set -eu
URL="https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1/ffprobe-6.1-macos-64.zip"
ZIP_SHA=878ab8787ca6c48a11cb668c01d544be4c1bf655637d719cdf3b3179841545f2
BIN_SHA=82f8b544e9924aed20f691f4b1b1ad0ba7e31d2a2e856ac29a1b6a31537e7f1f
DEST="$HOME/moonkatty-node/tools"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
[ "${1:-}" = "--dry-run" ] && { echo "DRY-RUN: скачал бы $URL → $DEST/ffprobe (sha256 zip $ZIP_SHA, bin $BIN_SHA)"; exit 0; }
curl -fsSL -o "$T/f.zip" "$URL"
echo "$ZIP_SHA  $T/f.zip" | shasum -a 256 -c - >/dev/null || { echo "ОШИБКА: SHA-256 архива не совпадает — не устанавливаю"; exit 1; }
unzip -q "$T/f.zip" -d "$T" ffprobe
echo "$BIN_SHA  $T/ffprobe" | shasum -a 256 -c - >/dev/null || { echo "ОШИБКА: SHA-256 ffprobe не совпадает — не устанавливаю"; exit 1; }
if command -v lipo >/dev/null; then lipo -archs "$T/ffprobe" | grep -q x86_64 || { echo "ОШИБКА: не x86_64"; exit 1; }; fi
mkdir -p "$DEST"; install -m 755 "$T/ffprobe" "$DEST/ffprobe"; xattr -d com.apple.quarantine "$DEST/ffprobe" 2>/dev/null || true
"$DEST/ffprobe" -hide_banner -version | head -1; echo "OK: $DEST/ffprobe (sha256 $BIN_SHA)"
