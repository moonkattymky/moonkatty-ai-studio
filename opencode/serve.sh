#!/usr/bin/env bash
# Start the local OpenCode server for MOONKATTY AI STUDIO (macOS).
# The password is read from the macOS Keychain (the item the studio settings saved) into the ENVIRONMENT of the
# opencode process only — never into argv, files or logs. Config: opencode/opencode-studio.json (permission policy).
set +x
set -euo pipefail
cd "$(dirname "$0")"
# TEST build must use serve-test.sh (Keychain "MOONKATTY AI STUDIO.test" / opencode-server-password, port 4097 only).
if [[ "${MK_FLAVOR:-prod}" == "test" ]]; then exec "$PWD/serve-test.sh"; fi
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || echo "$HOME/.opencode/bin/opencode")}"
KC_SERVICE='MOONKATTY AI STUDIO'
KC_ACCOUNT='opencode-server-password'
DEF_PORT=4096
if [[ "${OPENCODE_PORT:-$DEF_PORT}" == "4097" ]]; then echo "Порт 4097 — тестовый. Для него: MK_FLAVOR=test $0"; exit 1; fi
PW="$(/usr/bin/security find-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w 2>/dev/null || true)"
[[ -n "$PW" ]] || { echo "Пароль OpenCode не найден в Keychain (service «${KC_SERVICE}», account «${KC_ACCOUNT}»). Сохраните его в студии: Настройки → OpenCode server. Без пароля сервер не запускается."; exit 1; }
export OPENCODE_SERVER_PASSWORD="$PW"; unset PW
export OPENCODE_CONFIG="$PWD/opencode-studio.json" OPENCODE_DISABLE_AUTOUPDATE=1
exec "$OPENCODE_BIN" serve --hostname 127.0.0.1 --port "${OPENCODE_PORT:-$DEF_PORT}"
