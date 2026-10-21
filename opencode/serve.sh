#!/usr/bin/env bash
# Start the local OpenCode server for MOONKATTY AI STUDIO (macOS).
# The password is read from the macOS Keychain (the item the studio settings saved) into the ENVIRONMENT of the
# opencode process only — never into argv, files or logs. Config: opencode/opencode-studio.json (permission policy).
set -euo pipefail
cd "$(dirname "$0")"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || echo "$HOME/.opencode/bin/opencode")}"
# Keychain service / port per build flavor (must match lib/studio-config.js). TEST build: MK_FLAVOR=test ./serve.sh
if [[ "${MK_FLAVOR:-prod}" == "test" ]]; then KC_SERVICE='MOONKATTY AI STUDIO.test'; DEF_PORT=4097; else KC_SERVICE='MOONKATTY AI STUDIO'; DEF_PORT=4096; fi
PW="$(/usr/bin/security find-generic-password -s "$KC_SERVICE" -a 'opencode-server-password' -w 2>/dev/null || true)"
[[ -n "$PW" ]] || { echo "Пароль OpenCode не найден в Keychain. Сохраните его в студии: Настройки → OpenCode server."; exit 1; }
export OPENCODE_SERVER_PASSWORD="$PW"; unset PW
export OPENCODE_CONFIG="$PWD/opencode-studio.json" OPENCODE_DISABLE_AUTOUPDATE=1
exec "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "${OPENCODE_PORT:-$DEF_PORT}"
