#!/usr/bin/env bash
# QA-UC-007 macOS check for OPS_UPDATE_KEYRING_DIR permissions. Read-only for the system: works ONLY in a fresh temp dir under
# $TMPDIR (mktemp), generates a throwaway Ed25519 PUBLIC key in memory (no private key is written), never reads real keys,
# never changes system settings, removes its temp dir at exit. Prints PASS/FAIL per case; exit 1 if any FAIL.
# Usage (from the repo root): bash scripts/mac-keyring-check.sh
set -u
cd "$(dirname "$0")/.." || exit 2
BASE=$(mktemp -d "${TMPDIR:-/tmp}/mk-keyring-check.XXXXXX") || exit 2
trap 'rm -rf "$BASE"' EXIT
FAILS=0; OS=$(uname -s)
# BSD stat (macOS) vs GNU stat (Linux): mode (octal perms) + owner uid
perm() { if [ "$OS" = Darwin ]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
owner() { if [ "$OS" = Darwin ]; then stat -f '%u' "$1"; else stat -c '%u' "$1"; fi; }
mkring() { # $1 = dir: writes <keyId>.pub.pem + keyring.json (public key only)
  mkdir -p "$1" && node -e '
const fs=require("fs"),c=require("crypto"),p=require("path");const d=process.argv[1];
const {publicKey}=c.generateKeyPairSync("ed25519");const id=c.createHash("sha256").update(publicKey.export({type:"spki",format:"der"})).digest("hex").slice(0,16);
fs.writeFileSync(p.join(d,"test-"+id+".pub.pem"),publicKey.export({type:"spki",format:"pem"}),{mode:0o600});
fs.writeFileSync(p.join(d,"keyring.json"),JSON.stringify({version:1,keys:{[id]:{file:"test-"+id+".pub.pem",set:"prod",status:"active"}},revoked:[]}),{mode:0o600});' "$1"
}
state() { node -e 'const U=require("./lib/ops/update-center.js");const s=U.signatureStatus(U.loadKeyrings({env:{OPS_UPDATE_KEYRING_DIR:process.argv[1]}}));console.log(s.state+"\t"+s.message)' "$1"; }
check() { # $1 name, $2 dir, $3 expected state
  local out st; out=$(state "$2"); st=${out%%$'\t'*}
  if [ "$st" = "$3" ]; then echo "PASS  $1 → $st  (${out#*$'\t'})"; else echo "FAIL  $1 → $st, ожидалось $3  (${out#*$'\t'})"; FAILS=$((FAILS+1)); fi
}
echo "ОС: $OS · uid $(id -u) · TMPDIR=${TMPDIR:-/tmp} → realpath $(cd "$BASE" && pwd -P)"
D="$BASE/ok"; mkring "$D"; chmod 700 "$D"
echo "      права $(perm "$D"), владелец uid $(owner "$D")"
check "0700, владелец — вы, путь через \$TMPDIR (на macOS /var → /private/var)" "$D" READY
check "0700, тот же путь через realpath" "$(cd "$D" && pwd -P)" READY
for m in 755 777 750; do X="$BASE/m$m"; mkring "$X"; chmod "$m" "$X"; check "права $m ($(perm "$X"))" "$X" BLOCKED; done
L="$BASE/link-dir"; ln -s "$D" "$L"; check "папка — символическая ссылка" "$L" BLOCKED
F="$BASE/link-file"; mkring "$F"; chmod 700 "$F"; P=$(ls "$F"/*.pub.pem); cp "$P" "$BASE/outside.pub.pem"; rm "$P"; ln -s "$BASE/outside.pub.pem" "$P"
check ".pub.pem — символическая ссылка наружу" "$F" BLOCKED
K="$BASE/link-ring"; mkring "$K"; chmod 700 "$K"; mv "$K/keyring.json" "$BASE/outside-keyring.json"; ln -s "$BASE/outside-keyring.json" "$K/keyring.json"
check "keyring.json — символическая ссылка" "$K" BLOCKED
W="$BASE/gw"; mkring "$W"; chmod 700 "$W"; chmod 666 "$W"/*.pub.pem; check "файл ключа доступен на запись всем (666)" "$W" BLOCKED
# ownership: a real foreign owner needs sudo — not done; simulate via the injectable uid
out=$(node -e 'const U=require("./lib/ops/update-center.js");console.log(U.signatureStatus(U.loadKeyrings({env:{OPS_UPDATE_KEYRING_DIR:process.argv[1]},uid:process.getuid()+4242})).state)' "$D")
if [ "$out" = BLOCKED ]; then echo "PASS  чужой владелец (симуляция uid) → BLOCKED"; else echo "FAIL  чужой владелец → $out"; FAILS=$((FAILS+1)); fi
echo "Итого: $([ $FAILS -eq 0 ] && echo 'ВСЕ PASS' || echo "FAIL: $FAILS")"; [ $FAILS -eq 0 ]
