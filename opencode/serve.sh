#!/usr/bin/env bash
# Start the local OpenCode server for MOONKATTY AI STUDIO (macOS).
# The password is read from the macOS Keychain (the item the studio settings saved) into the ENVIRONMENT of the
# opencode process only — never into argv, files or logs. Config: opencode/opencode-studio.json (permission policy).
set -euo pipefail
cd "$(dirname "$0")"
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || echo "$HOME/.opencode/bin/opencode")}"
PW="$(/usr/bin/security find-generic-password -s 'MOONKATTY AI STUDIO' -a 'opencode-server-password' -w 2>/dev/null || true)"
[[ -n "$PW" ]] || { echo "Пароль OpenCode не найден в Keychain. Сохраните его в студии: Настройки → OpenCode server."; exit 1; }
export OPENCODE_SERVER_PASSWORD="$PW"; unset PW
export OPENCODE_CONFIG="$PWD/opencode-studio.json" OPENCODE_DISABLE_AUTOUPDATE=1
exec "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "${OPENCODE_PORT:-4096}"
