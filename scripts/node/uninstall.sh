#!/bin/bash
# Rollback/removal of MOONKATTY NODE. Keeps ~/.moonkatty-node (token/config/archive) unless --purge.
P="$HOME/Library/LaunchAgents/com.moonkatty.node-agent.plist"
launchctl bootout "gui/$(id -u)/com.moonkatty.node-agent" 2>/dev/null; rm -f "$P"
B=$(ls -d "$HOME"/moonkatty-node.backup-* 2>/dev/null | tail -1)
if [ "${1:-}" = "--rollback" ] && [ -n "$B" ]; then rm -rf "$HOME/moonkatty-node"; mv "$B" "$HOME/moonkatty-node"; echo "Откат на $B выполнен (автозапуск выключен — включите заново install.sh --autostart из старого пакета или launchctl bootstrap)"; exit 0; fi
rm -rf "$HOME/moonkatty-node"; echo "MOONKATTY NODE удалён."; [ "${1:-}" = "--purge" ] && rm -rf "$HOME/.moonkatty-node" && echo "Конфигурация и архив удалены."
