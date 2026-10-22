# MOONKATTY NODE 0.2.2 — установка, проверка и откат (iMac NEWS NODE / MacBook MONITOR NODE)

Версия инструкции: r5. Архивы собраны воспроизводимо из коммита `11f6618eed6ce93392ed2e472267d530fc2ce6f8` (ветка `feat/nodes-022-final`);
коммит с этой инструкцией отличается от него только документацией. Брать ТОЛЬКО эти архивы (`/workspace/dist-node-final5/`
или пакет `nodes-022-final-r5`). Все более ранние архивы 0.2.2 (db4720b, f66e798, 907610a, 5bd0d84, e36420e) — не использовать.

| Машина | Профиль | Архив | SHA-256 | Node | macOS |
|---|---|---|---|---|---|
| iMac 2017 (Intel), Ventura 13.7.1 | NEWS NODE | `moonkatty-node-0.2.2-darwin-x64.tar.gz` | `f084c92651058dcf599d81234ef25ffb15167db8f6900cf571c73decf0f24227` | v24.22.1 | ≥ 13.5 |
| MacBook Pro 13" 2015 (Intel), Monterey 12.7.6 | MONITOR NODE | `moonkatty-node-0.2.2-darwin-x64-monterey.tar.gz` | `db42b61b9bd160f2d4333d9d46f0307a2aba468442d53104d3197cf6a6c82db4` | v22.23.4 | ≥ 11.0 |
| запасной вариант | — | `moonkatty-node-0.2.2-js-only.tar.gz` | `048606f4ae3041ab4d69981fcbad9216cfb41783854bfba2bac7b69b9ea99473` | свой ≥ 22 | — |

## Требования
- **Координатор (Mac mini):** установленная студия v1.3.0-test с включёнными узлами (раздел «Компьютеры»), Tailscale подключён. Ничего в Tailscale не меняем: **без Funnel, без публичных портов, Serve для узлов не настраивается**. Node API координатора слушает только Tailscale-адрес 100.x (порт показан в панели; test — 8690, prod — 8790) со своим сертификатом, который узел закрепляет по SHA-256. Если на Mac mini уже есть `tailscale serve` для веб-панели/iPhone (порт 8787, `docs/CONNECT_MAC.md`) — это отдельная настройка студии, её не трогать; узлы через неё не ходят.
- **iMac:** Intel x86_64, macOS ≥ 13.5 (есть 13.7.1), ≥ 4 ГБ RAM, ~250 МБ на диске, Tailscale в том же tailnet.
- **MacBook:** Intel x86_64, macOS ≥ 11 (есть 12.7.6), ≥ 4 ГБ RAM, ~250 МБ на диске (+~80 МБ ffprobe), Tailscale в том же tailnet.
- **Права:** обычный пользователь; sudo/администратор НЕ нужен. Gatekeeper, SIP, карантин — не отключать.
- **Время:** часы на всех машинах синхронизированы автоматически (окно подписи ±30 с).
- **GNU tar (`gtar`)** нужен только тем, кто САМ собирает архивы (`scripts/node/build-node-pkg.sh`); для установки не нужен.
- Время: ~1 ч на машину вместе с проверками.

## Общие шаги (выполнять на iMac, затем на MacBook)
Каждый шаг заканчивается проверкой. Если проверка не прошла — остановиться и перейти к разделу «Откат».

**Шаг 1. Скопировать архив на машину** (AirDrop/флешка/scp внутри tailnet) в `~/Downloads`.
Проверка: `cd ~/Downloads && shasum -a 256 moonkatty-node-0.2.2-<...>.tar.gz` → значение совпадает с таблицей выше ПОЛНОСТЬЮ.

**Шаг 2. Распаковать и проверить пакет без установки.**
```
tar -xzf moonkatty-node-0.2.2-<...>.tar.gz && cd moonkatty-node-0.2.2-<...>
bash install.sh --verify-only
```
Проверка: «OK» после проверки MANIFEST; `codesign bin/node: подпись Node.js действительна`; BUILDINFO показывает Node и коммит `11f6618…`.

**Шаг 3. Установить (без автозапуска).** `bash install.sh`
Проверка: `~/moonkatty-node/bin/node -v` → v24.22.1 (iMac) / v22.23.4 (MacBook); `ls -ld ~/.moonkatty-node` → `drwx------`; `ls -l ~/.moonkatty-node/node-agent.env` → `-rw-------`.
Если macOS пишет «не удалось проверить разработчика» для `bin/node`: Системные настройки → Конфиденциальность и безопасность → «Всё равно открыть» ТОЛЬКО для этого файла. Gatekeeper целиком не отключать.

**Шаг 4. Проверить Tailscale до координатора.** На Mac mini в «Компьютеры» посмотреть адрес и порт Node API и отпечаток сертификата (SHA-256).
Проверка на узле: `nc -vz 100.x.y.z <порт>` → succeeded. С другой сети без Tailscale порт недоступен.

**Шаг 5. Подключить по одноразовому коду.**
1. Mac mini → «Компьютеры» → «Подключить компьютер» → роль `news` (iMac) или `monitor` (MacBook) → пароль владельца + ПОДКЛЮЧИТЬ. Появится код (5 минут, одноразовый).
2. На узле: `~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js` → «Узел не подключён. Откройте http://127.0.0.1:8791».
3. В браузере узла открыть `http://127.0.0.1:8791`, ввести `https://100.x.y.z:<порт>`, отпечаток и код. Код не вводить в командную строку и никуда не пересылать.
4. Mac mini → заявка «pending» → сверить имя машины → «Подтвердить устройство» (пароль + ПОДТВЕРДИТЬ).
Проверка: страница узла — «подключено»; `security find-generic-password -s moonkatty-node-<id> -a node-token` находит запись (значение НЕ выводить: без `-w`); `grep -c nk_ ~/.moonkatty-node/node-agent.env` → 0 (токена в файле нет); `ls -l ~/.moonkatty-node/device.json` → `-rw-------`.

**Шаг 6. Первый запуск.** Остановить агент (Ctrl+C) и запустить снова: `~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js`.
Проверка: на Mac mini узел «Online», версия 0.2.2, профиль верный; `http://127.0.0.1:8791` показывает статус; `lsof -nP -iTCP -sTCP:LISTEN | grep node` → только `127.0.0.1:8791`.

**Шаг 7. Проверка задачи** (см. разделы по машинам ниже).

**Шаг 8. Автозапуск (по желанию владельца).** Остановить ручной запуск, затем `bash install.sh --autostart` из папки пакета → ввести `yes`.
Проверка: `launchctl print gui/$(id -u)/com.moonkatty.node-agent | grep state` → running; после перезагрузки/повторного входа узел снова Online. LaunchAgent — только для пользователя (`~/Library/LaunchAgents`), не LaunchDaemon.

**Шаг 9. Проверка отзыва (рекомендуется один раз).** Mac mini → «Отозвать» узел → через ≤ 1 мин узел «Отозван», агент пишет «токен отклонён». Затем удалить и подключить заново (Шаг 5) или выполнить откат.

## iMac — NEWS NODE
- Архив `moonkatty-node-0.2.2-darwin-x64.tar.gz`, SHA-256 `f084c92651058dcf599d81234ef25ffb15167db8f6900cf571c73decf0f24227`, Node v24.22.1.
- Шаг 7: с Mac mini запустить задачу `news.collect` с 1–2 RSS-лентами → результат с элементами, без ошибок; `news.dedup` → дубли удалены.
- Память: в статусе узла RSS ≤ 384 МБ (лимит профиля); при превышении задачи отклоняются, агент не падает.
- Уведомления (если нужны): `NODE_NTFY_URL` (https, ntfy) в `~/.moonkatty-node/node-agent.env`. Это не Telegram API. Функции X выключены по умолчанию — не включать.

## MacBook — MONITOR NODE
- Архив `moonkatty-node-0.2.2-darwin-x64-monterey.tar.gz`, SHA-256 `db42b61b9bd160f2d4333d9d46f0307a2aba468442d53104d3197cf6a6c82db4`, Node v22.23.4.
- После Шага 3 (по желанию): `bash ~/moonkatty-node/fetch-ffprobe.sh` — ставит статический ffprobe с закреплёнными SHA-256 в `~/moonkatty-node/tools` (без Homebrew и sudo). Проверка: скрипт печатает OK и версию ffprobe.
- Шаг 7: задача `ffprobe.check` на маленьком видео → succeeded на `macbook`.
- Память: RSS ≤ 256 МБ, одновременно 1 задача (профиль monitor, куча V8 128 МБ при автозапуске).
- Автозапуск: на Monterey install.sh сам выбирает профиль `monitor`.

## Откат
| Ситуация | Команда | Проверка |
|---|---|---|
| Вернуть предыдущую версию | `bash ~/moonkatty-node/uninstall.sh --rollback` | `~/moonkatty-node/bin/node -v` = прежняя; автозапуск выключен — включить `bash install.sh --autostart` из восстановленной папки |
| Остановить и удалить программу, сохранив подключение | `bash ~/moonkatty-node/uninstall.sh` | `launchctl print gui/$(id -u)/com.moonkatty.node-agent` → не найдено |
| Удалить полностью | `bash ~/moonkatty-node/uninstall.sh --purge`, затем на Mac mini «Отозвать» | нет `~/.moonkatty-node`; `security find-generic-password -s moonkatty-node-<id> -a node-token` → не найдено; узел «Отозван» |
| Узел потерян/скомпрометирован | Mac mini → «Отозвать» сразу | узел «Отозван»; новое подключение — только новым кодом |
| Перезапуск Mac mini | ничего | узел сам возвращается Online (после быстрого перезапуска — запросы повторяются через 3 с) |

## Чего НЕ делать
Не включать Tailscale Funnel, не настраивать `tailscale serve` для узлов (и не менять существующий Serve веб-панели), не использовать `NODE_TLS_MODE=tailscale` (агент 0.2.2 r5 его отклоняет), не открывать порты в LAN/интернет, не отключать Gatekeeper/SIP/карантин (`spctl --master-disable`, `xattr -dr`), не ставить через sudo, не хранить токен в файлах (`NODE_TOKEN=`), не вводить одноразовый код в командную строку, не включать функции X.

## Проверено / не проверено
Linux-симуляция (3 процесса, поддельная Связка ключей, заглушки `launchctl`/`sw_vers`) — см. `docs/NODES_022_FINAL_RU.md`. На реальных Mac НЕ проверено: Связка ключей, launchd, Gatekeeper, `sips` (image.light), `ditto` (archive), Tailscale между машинами, fsync на диске Mac mini — это и есть цель испытания по этой инструкции.
