#!/bin/bash
# MOONKATTY NODE installer (runs ON the iMac/MacBook by the owner). bash 3.2. Installs into ~/moonkatty-node only.
# Never opens ports to the network, never touches system settings. Autostart (launchd) only with --autostart AND owner confirmation.
# Never needs sudo/root: everything lives in $HOME (LaunchAgent, not LaunchDaemon).
# Usage: bash install.sh --verify-only | bash install.sh [--autostart]
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"; DEST="$HOME/moonkatty-node"; CONF="$HOME/.moonkatty-node"
cd "$HERE"
echo "== Проверка целостности (SHA-256 каждого файла по MANIFEST.sha256)"
shasum -a 256 -c MANIFEST.sha256 >/dev/null || { echo "ОШИБКА: файлы пакета изменены/повреждены — установка отменена"; exit 1; }
echo "OK"
if command -v codesign >/dev/null 2>&1; then codesign -v bin/node 2>/dev/null && echo "codesign bin/node: подпись Node.js действительна" || echo "codesign bin/node: подпись не подтверждена (сверяйте SHA-256 с SHASUMS256 nodejs.org из BUILDINFO)"; fi
cat BUILDINFO
[ "${1:-}" = "--verify-only" ] && exit 0
NEED=$(sed -n 's/.*(macOS >= \([0-9.]*\)).*/\1/p' BUILDINFO | head -1); V=$(sw_vers -productVersion 2>/dev/null || echo 0)
if [ -n "$NEED" ] && [ "$(printf '%s\n%s\n' "$NEED" "$V" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" != "$NEED" ]; then echo "ОШИБКА: пакет требует macOS ≥ $NEED, здесь $V — возьмите пакет darwin-x64-macos11 (Node 22)"; exit 1; fi
[ "$(uname -m)" = "x86_64" ] || echo "ВНИМАНИЕ: $(uname -m) — пакет собран для Intel x86_64"
"$HERE/bin/node" -v >/dev/null || { echo "ОШИБКА: встроенный Node не запускается на этой macOS"; exit 1; }
if [ -d "$DEST" ]; then B="$DEST.backup-$(date +%Y%m%d-%H%M%S)"; echo "Предыдущая версия → $B (для отката)"; mv "$DEST" "$B"; fi
mkdir -p "$DEST" "$CONF/work" "$CONF/archive" "$CONF/outbox" "$CONF/logs"; chmod 700 "$CONF" "$CONF/outbox"
cp -R bin app "$DEST/"; cp MANIFEST.sha256 BUILDINFO uninstall.sh "$DEST/"
if [ ! -f "$CONF/node-agent.env" ]; then cp app/node-agent.env.example "$CONF/node-agent.env"; chmod 600 "$CONF/node-agent.env"; echo "Создан $CONF/node-agent.env (chmod 600) — заполните NODE_ID, COORDINATOR_URL, COORDINATOR_FINGERPRINT"; fi
echo "Установлено в $DEST. Проверка: $DEST/bin/node $DEST/app/agent.js --info"
if [ "${1:-}" = "--autostart" ]; then
  printf "Включить автозапуск MOONKATTY NODE при входе (launchd, только для вашего пользователя)? Введите yes: "; read ans
  [ "$ans" = "yes" ] || { echo "Автозапуск НЕ включён"; exit 0; }
  P="$HOME/Library/LaunchAgents/com.moonkatty.node-agent.plist"; mkdir -p "$HOME/Library/LaunchAgents"
  sed -e "s#/usr/local/bin/node#$DEST/bin/node#" -e "s#/Users/YOURUSER/moonkatty-node/agent.js#$DEST/app/agent.js#" -e "s#<string>news</string>#<string>${NODE_PROFILE:-news}</string>#" -e "s#/Users/YOURUSER#$HOME#g" app/com.moonkatty.node-agent.plist > "$P"
  plutil -lint "$P" && launchctl bootstrap "gui/$(id -u)" "$P" && echo "Автозапуск включён. Статус: launchctl print gui/$(id -u)/com.moonkatty.node-agent | grep state"
fi
