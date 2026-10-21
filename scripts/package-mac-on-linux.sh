#!/usr/bin/env bash
# Reproducible-as-practical build of MOONKATTY AI STUDIO.app (Apple Silicon) on Linux.
# Output: dist/MOONKATTY-AI-STUDIO-<ver>-arm64-mac.zip (+ .sha256, MANIFEST.sha256, sbom.cdx.json, BUILD-INFO.txt)
# Needs: node 20+, rcodesign (ad-hoc signing on Linux). A .dmg cannot be made on Linux — use scripts/build-mac.sh on a Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "Рабочее дерево изменено — закоммитьте изменения перед сборкой"; exit 1; }
COMMIT=$(git rev-parse HEAD); export SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)
VER=$(node -p "require('./package.json').version"); APP="dist/mac-arm64/MOONKATTY AI STUDIO.app"; OUT="dist/MOONKATTY-AI-STUDIO-${VER}-arm64-mac.zip"
npm ci --ignore-scripts --no-audit --no-fund      # exact versions from package-lock.json; no install scripts
scripts/fetch-node.sh                             # official Node binary, SHA-256 verified
COMMIT="$COMMIT" node scripts/write-build-info.mjs --builder linux
rm -rf dist
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dir --arm64 --publish never
find "$APP" -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +
rcodesign sign "$APP"                              # ad-hoc (no Apple certificate)
for f in "$APP/Contents/MacOS/MOONKATTY AI STUDIO" "$APP/Contents/Resources/node/node"; do rcodesign print-signature-info "$f" | grep -E "^ *(flags|identifier):" | head -2; done
find "$APP" -exec touch -h -d "@${SOURCE_DATE_EPOCH}" {} +
python3 - "$APP" "$OUT" "$SOURCE_DATE_EPOCH" <<'PY'
import os, sys, zipfile, stat, time
app, out, epoch = sys.argv[1], sys.argv[2], int(sys.argv[3]); base = os.path.dirname(app)
dt = time.gmtime(max(epoch, 315532800))[:6]
entries = []
for root, dirs, files in os.walk(app, followlinks=False):
    for n in dirs + files: entries.append(os.path.join(root, n))
entries.append(app)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(entries):
        rel = os.path.relpath(p, base); st = os.lstat(p)
        if stat.S_ISLNK(st.st_mode):
            zi = zipfile.ZipInfo(rel, dt); zi.create_system = 3; zi.external_attr = (stat.S_IFLNK | 0o755) << 16; z.writestr(zi, os.readlink(p))
        elif stat.S_ISDIR(st.st_mode):
            zi = zipfile.ZipInfo(rel + '/', dt); zi.create_system = 3; zi.external_attr = (stat.S_IFDIR | 0o755) << 16; z.writestr(zi, b'')
        else:
            zi = zipfile.ZipInfo(rel, dt); zi.create_system = 3; zi.external_attr = ((st.st_mode & 0o777) | stat.S_IFREG) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
            with open(p, 'rb') as f: z.writestr(zi, f.read())
PY
( cd dist && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
( cd dist/mac-arm64 && find "MOONKATTY AI STUDIO.app" -type f -print0 | sort -z | xargs -0 sha256sum ) > dist/MANIFEST.sha256
npx --yes @cyclonedx/cyclonedx-npm@4 --omit dev --output-format JSON --output-file dist/sbom.cdx.json >/dev/null 2>&1 || echo "SBOM: не удалось сгенерировать"
FUSES=$(npx --yes @electron/fuses read --app "$APP" 2>&1 | grep -E "is (Enabled|Disabled)" || true)
cat > dist/BUILD-INFO.txt <<INFO
MOONKATTY AI STUDIO ${VER} (macOS arm64, ad-hoc signed, NOT notarized, built on Linux)
commit: ${COMMIT}
SOURCE_DATE_EPOCH: ${SOURCE_DATE_EPOCH} ($(date -u -d @${SOURCE_DATE_EPOCH} +%FT%TZ))
electron: $(node -p "require('./package.json').build.electronVersion")  electron-builder: $(node -p "require('electron-builder/package.json').version")  bundled node: ${NODE_VERSION:-v24.22.0}
zip sha256: $(cut -d' ' -f1 "$OUT.sha256")
fuses:
${FUSES}
INFO
cat dist/BUILD-INFO.txt
