#!/bin/bash
# Rollback/removal of MOONKATTY NODE. Keeps ~/.moonkatty-node (token/config/archive) unless --purge.
P="$HOME/Library/LaunchAgents/com.moonkatty.node-agent.plist"
launchctl bootout "gui/$(id -u)/com.moonkatty.node-agent" 2>/dev/null; rm -f "$P"
B=$(ls -d "$HOME"/moonkatty-node.backup-* 2>/dev/null | tail -1)
if [ "${1:-}" = "--rollback" ] && [ -n "$B" ]; then rm -rf "$HOME/moonkatty-node"; mv "$B" "$HOME/moonkatty-node"; echo "Откат на $B выполнен (автозапуск выключен — включите заново install.sh --autostart из старого пакета или launchctl bootstrap)"; exit 0; fi
rm -rf "$HOME/moonkatty-node"; echo "MOONKATTY NODE удалён (конфигурация, токен в Keychain и архив сохранены; полное удаление: --purge)."; [ "${1:-}" = "--purge" ] && { ID=$(sed -n "s/^NODE_ID=//p" "$HOME/.moonkatty-node/node-agent.env" 2>/dev/null); rm -rf "$HOME/.moonkatty-node"; security delete-generic-password -s "moonkatty-node-${ID:-imac}" -a node-token >/dev/null 2>&1; echo "Конфигурация, архив и токен из Keychain удалены."; }
