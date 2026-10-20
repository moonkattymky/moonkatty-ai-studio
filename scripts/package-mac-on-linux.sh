#!/usr/bin/env bash
# Build an UNSIGNED (ad-hoc signed) Apple Silicon .app on Linux and zip it with symlinks preserved.
# Requires: node, npm deps installed, rcodesign (https://github.com/indygreg/apple-platform-rs) on PATH.
# DMG cannot be produced on Linux (electron-builder needs macOS `sips`/`hdiutil`) — use scripts/build-mac.sh on a Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p "require('./package.json').version")
APP="dist/mac-arm64/MOONKATTY AI STUDIO.app"
rm -rf dist/mac-arm64
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64
# ad-hoc signature over the whole bundle (no Apple certificate): required on Apple Silicon for a consistent seal
rcodesign sign "$APP"
rcodesign print-signature-info "$APP/Contents/MacOS/MOONKATTY AI STUDIO" | grep -E "flags|identifier" # rcodesign verify is unreliable for ad-hoc signatures
OUT="dist/MOONKATTY-AI-STUDIO-${VER}-arm64-mac.zip"
python3 - "$APP" "$OUT" <<'PY'
import os, sys, zipfile, stat
app, out = sys.argv[1], sys.argv[2]; base = os.path.dirname(app)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(app, followlinks=False):
        for name in sorted(dirs + files):
            p = os.path.join(root, name); rel = os.path.relpath(p, base); st = os.lstat(p)
            if stat.S_ISLNK(st.st_mode):
                zi = zipfile.ZipInfo(rel); zi.create_system = 3; zi.external_attr = (stat.S_IFLNK | 0o755) << 16; z.writestr(zi, os.readlink(p))
            elif stat.S_ISDIR(st.st_mode):
                zi = zipfile.ZipInfo(rel + '/'); zi.create_system = 3; zi.external_attr = (stat.S_IFDIR | 0o755) << 16; z.writestr(zi, b'')
            else:
                zi = zipfile.ZipInfo.from_file(p, rel); zi.create_system = 3; zi.external_attr = (st.st_mode & 0xFFFF) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
                with open(p, 'rb') as f: z.writestr(zi, f.read())
PY
( cd dist && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
ls -la "$OUT"; cat "$OUT.sha256"
