# MOONKATTY NODE 0.2.2 — установка и откат (iMac NEWS NODE / MacBook MONITOR NODE)

Сборки берутся ТОЛЬКО из `/workspace/dist-node-final2/` (ветка `feat/nodes-022-final`, коммит указан в `BUILDINFO` каждого архива).
Архивы 0.2.2 со старого коммита `db4720b` использовать НЕЛЬЗЯ: в них нет `enroll.js` (агент не стартует) и есть ошибка подписи загрузки файлов.

| Машина | Профиль | macOS | Архив | Node |
|---|---|---|---|---|
| iMac 2017 | NEWS NODE | Ventura 13.7.1 (нужно ≥ 13.5) | `moonkatty-node-0.2.2-darwin-x64.tar.gz` | 24 LTS |
| MacBook Pro 13" 2015 | MONITOR NODE | Monterey 12.7.6 (нужно ≥ 11) | `moonkatty-node-0.2.2-darwin-x64-monterey.tar.gz` | 22 LTS |
| любая (запасной) | — | нужен свой Node ≥ 22 | `moonkatty-node-0.2.2-js-only.tar.gz` | — |

## Перед установкой
1. Сверьте SHA-256 архива: `shasum -a 256 -c moonkatty-node-0.2.2-<...>.tar.gz.sha256` → `OK`.
2. Mac mini (координатор) работает, доступен по Tailscale; на узле Tailscale включён. Funnel и публичные порты НЕ нужны и не включаются.
3. Права администратора (sudo) НЕ нужны. Gatekeeper/карантин НЕ отключать: `install.sh` сам ничего не отключает.

## Установка (от обычного пользователя)
```
tar -xzf moonkatty-node-0.2.2-<...>.tar.gz && cd moonkatty-node-0.2.2-<...>
bash install.sh --verify-only   # только проверка MANIFEST и macOS
bash install.sh                 # установка без автозапуска
bash install.sh --autostart     # + LaunchAgent (по подтверждению владельца)
```
Скрипт проверяет `MANIFEST.sha256` и версию macOS, ставит в `~/moonkatty-node`, конфиг в `~/.moonkatty-node` (папка 0700, `node-agent.env` 0600),
при `--autostart` — LaunchAgent пользователя `~/Library/LaunchAgents/com.moonkatty.node-agent.plist` (KeepAlive только при сбое, Umask 077, лимит кучи 192 МБ).
Если macOS блокирует `bin/node` («не удалось проверить разработчика») — откройте Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть» для этого файла. Gatekeeper целиком не отключать.

## Подключение (одноразовый код)
1. Mac mini → Студия → «Компьютеры» → «Подключить компьютер» → профиль NEWS (iMac) или MONITOR (MacBook). Код живёт 5 минут и хранится только в памяти: после перезапуска студии нужен новый код.
2. На узле откройте `http://127.0.0.1:8791` (`NODE_STATUS_PORT`) (страница только на loopback), введите адрес координатора и код. Проверьте отпечаток TLS-сертификата с показанным на Mac mini.
3. На Mac mini нажмите «Подтвердить» (нужен пароль владельца). Токен и ключ устройства сохраняются в Связке ключей (`moonkatty-node-<id>` / `moonkatty-node-device`), не в файлах.
4. Статус: тот же `http://127.0.0.1:8791`, журналы `~/.moonkatty-node/logs/agent.log` и `agent.err.log`.

## Обновление
Повторный `bash install.sh` из нового архива: предыдущая версия переносится в `~/moonkatty-node.backup-<дата>`.

## Откат
- К предыдущей версии: `bash ~/moonkatty-node/uninstall.sh --rollback` (возвращает последний `~/moonkatty-node.backup-*`; автозапуск при этом выключается — включите снова `bash install.sh --autostart` из восстановленной папки; Связка ключей не трогается).
- Остановить и удалить программу, сохранив подключение: `bash ~/moonkatty-node/uninstall.sh`.
- Полное удаление: `bash ~/moonkatty-node/uninstall.sh --purge` — удаляет `~/.moonkatty-node`, токен и ключ устройства из Связки ключей. Затем на Mac mini → «Компьютеры» → «Отозвать» этот узел (обязательно: отзыв делается на координаторе).
- Если узел потерян/скомпрометирован: «Отозвать» на Mac mini сразу; для нового подключения — новый код.

## Что проверено и что нет
Linux-симуляция (3 процесса, поддельная Связка ключей, заглушки `launchctl`/`sw_vers`) — см. `docs/NODES_022_FINAL_RU.md`.
На реальных Mac НЕ проверено: настоящая Связка ключей, launchd, Gatekeeper, `sips` (image.light), `ditto` (archive), Tailscale между машинами.
