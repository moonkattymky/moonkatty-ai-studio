#!/usr/bin/env bash
# TEST build only. Start OpenCode on 127.0.0.1:4097 with the password from the TEST Keychain item.
# Exact item (must match lib/studio-config.js TEST and lib/opencode-auth.js):
#   service (Where):  MOONKATTY AI STUDIO.test
#   account:          opencode-server-password
#   name / label:     MOONKATTY AI STUDIO.test — OpenCode
# The product name "MOONKATTY AI STUDIO TEST" is NOT the Keychain service.
# The password is exported into this process environment only. It is never printed, never passed in argv,
# and this script never binds or probes the production port.
set +x
set -euo pipefail
cd "$(dirname "$0")"
KC_SERVICE='MOONKATTY AI STUDIO.test'
KC_ACCOUNT='opencode-server-password'
HOST='127.0.0.1'
PORT='4097'
case "${OPENCODE_PORT:-}-${1:-}-${2:-}" in
  *4096*) echo "Отказ: порт рабочего OpenCode этот скрипт не использует."; exit 1;;
esac
# Ignore any caller port. The test instance is always 127.0.0.1:4097.
unset OPENCODE_PORT
OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || true)}"
if [[ -z "$OPENCODE_BIN" && -x "$HOME/.opencode/bin/opencode" ]]; then OPENCODE_BIN="$HOME/.opencode/bin/opencode"; fi
if [[ -z "$OPENCODE_BIN" || ! -x "$OPENCODE_BIN" ]]; then
  echo "Команда opencode не найдена. Установите OpenCode или задайте OPENCODE_BIN. Сервер не запущен."
  exit 1
fi
PW="$(/usr/bin/security find-generic-password -s "$KC_SERVICE" -a "$KC_ACCOUNT" -w 2>/dev/null || true)"
if [[ -z "${PW}" ]]; then
  echo "Пароль OpenCode не найден в Keychain."
  echo "Служба (service): ${KC_SERVICE}"
  echo "Учётная запись (account): ${KC_ACCOUNT}"
  echo "Название (label): ${KC_SERVICE} — OpenCode"
  echo "Сохраните пароль в тестовой студии: Настройки → OpenCode server. Без пароля сервер не запускается."
  exit 1
fi
export OPENCODE_SERVER_PASSWORD="$PW"
unset PW
export OPENCODE_SERVER_USERNAME="${OPENCODE_SERVER_USERNAME:-opencode}"
export OPENCODE_CONFIG="$PWD/opencode-studio.json"
export OPENCODE_DISABLE_AUTOUPDATE=1
exec "$OPENCODE_BIN" serve --hostname "$HOST" --port "$PORT"
