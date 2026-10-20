# MOONKATTY — установка Studio Operations на Mac mini (v2, пошагово с проверками)

Ветка `feat/studio-operations` (не main). Всё новое выключено, пока вы не включите флаг. После **каждого** этапа — **Проверка**; если она не прошла, остановитесь и пришлите вывод.
В каждом новом окне Терминала сначала:
```
DATA="$HOME/Library/Application Support/MOONKATTY AI STUDIO"; REPO="$HOME/moonkatty-ai-studio"
```

## Этап 1. Резервная копия (до любых изменений)
Закройте приложение (Cmd+Q), затем:
```
ditto "$DATA" "$HOME/MOONKATTY-backup-$(date +%Y%m%d-%H%M)"
ls -d "$HOME"/MOONKATTY-backup-* | tail -1
```
**Проверка:** папка есть, внутри `studio.db`: `ls -l "$(ls -d "$HOME"/MOONKATTY-backup-* | tail -1)/studio.db"`.

## Этап 2. Код ветки и тесты (данные не трогаются: тесты работают только во временных папках /tmp)
```
cd "$REPO" && git fetch origin && git checkout feat/studio-operations && git pull --ff-only && git log -1 --format='%h %s'
npm ci && npm test 2>&1 | tail -6
```
**Проверка:** `# fail 0` и `{"passed":51,"failed":[]}`; `ls "$DATA"` не изменился (время изменения studio.db прежнее: `stat -f %Sm "$DATA/studio.db"`).

## Этап 3. Сборка и установка приложения
```
cd "$REPO" && bash scripts/build-mac.sh
```
Установите собранное приложение как обычно (docs/BUILD_MAC.md). **Проверка:** приложение открывается, данные на месте, `curl -s http://127.0.0.1:8787/api/health` → `ok`.

## Этап 4. Включить модули в desktop.json
Закройте приложение. `open -e "$DATA/desktop.json"` и добавьте нужные поля (остальные не трогать):
```
"opsResources": true,
"opsDashboard": true,
"opsSecurity": true,
"opsBackup": true,
"opsMoney": true,
"opsMobile": true,
"allowedHosts": ["ВАШ-MAC.ВАШ-TAILNET.ts.net"]
```
(`opsNodes`/`opsNodesBind` — см. NODES_IMAC.md, шаг 2.) Запустите приложение.
**Проверка:**
```
APP=$(cat "$DATA/app-token"); curl -s http://127.0.0.1:8787/api/ops/status -H 'x-studio-request: 1' -H "x-studio-app-token: $APP"
```
во `flags` нужные значения `true`. В панели появились «Операции» (и «Computers (Nodes)» при opsNodes).

## Этап 5. Память как в Мониторе активности
```
curl -s http://127.0.0.1:8787/api/system -H 'x-studio-request: 1' \
  -H "x-studio-app-token: $APP" > /tmp/sys.json
python3 -m json.tool /tmp/sys.json | grep -A16 '"memory"'
```
**Проверка:** значения в байтах (÷ 1073741824 = ГБ): `used`, `app`, `wired`, `compressed`, `cached`, `swapUsed`, `pressure`, `usedPct` совпадают с «Мониторинг системы → Память» (±0,3 ГБ): Используется, Кэшированные файлы, Память приложений, Сжатая, Использовано подкачки, Давление памяти. (Раньше панель показывала ~95% из-за `os.freemem()`, который не учитывал кэш.)

## Этап 6. Калибровка Resource Manager (loadtest)
Пока калибровки нет: тяжёлые задачи (Ollama/Blender/FFmpeg) — **строго по одной**, и не стартуют при давлении памяти не «зелёном» или растущем swap. Произвольных лимитов ГБ нет.
1) Пробный прогон без нагрузки: `node "$REPO/scripts/ops/loadtest.mjs" --dry-run`
2) Реальный замер (закройте тяжёлые программы; займёт 10–20 мин; запускает только свои процессы и только их останавливает; автостоп при красном давлении или росте swap > 1024 МБ):
```
node "$REPO/scripts/ops/loadtest.mjs" --model qwen3:8b --blender /Applications/Blender.app/Contents/MacOS/Blender --ffmpeg /opt/homebrew/bin/ffmpeg
```
(модель — любая из `ollama list`). Отчёт: путь печатается в конце (`/tmp/moonkatty-loadtest-…/loadtest-report.md` и `.json`) — не в данных студии.
3) Импорт: `node "$REPO/scripts/ops/loadtest.mjs" import /tmp/moonkatty-loadtest-…/loadtest-report.json` и перезапуск приложения.
**Проверка:** в «Операции → Нагрузка» режим `calibrated`, у классов лимиты «N ГБ» (= пик × 1,2). Пришлите мне оба файла отчёта.
Выгрузка моделей Ollama (`keep_alive:0`) и остановка чужих процессов **выключены**; выгрузка — только с подтверждением паролем в панели.

## Этап 7. Токены iPhone и Watchdog
```
curl -s -X POST http://127.0.0.1:8787/api/ops/mobile-tokens -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"label":"iPhone Igor","ttlDays":90}'
curl -s -X POST http://127.0.0.1:8787/api/ops/mobile-tokens -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"label":"watchdog","ttlDays":365,"scopes":["read","ops:read"]}'
```
Токен Watchdog — в Keychain: `security add-generic-password -s com.moonkatty.watchdog -a watchdog -w` (вставьте `mkm_…`).
**Проверка:** `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer mkm_…" http://127.0.0.1:8787/api/tasks` → `401` (мобильный токен не даёт общего доступа).

## Этап 8. Watchdog (launchd)
```
mkdir -p "$HOME/.moonkatty" && cp "$REPO/deploy/com.moonkatty.watchdog.plist" "$HOME/Library/LaunchAgents/" && open -e "$HOME/Library/LaunchAgents/com.moonkatty.watchdog.plist"
```
Замените `YOURUSER` на `$(whoami)`, сохраните. Секреты уведомлений (если нужны) — в `~/.moonkatty/watchdog.env` с `chmod 600`.
```
node "$REPO/ops/watchdog.js" --once
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.moonkatty.watchdog.plist"
launchctl print gui/$(id -u)/com.moonkatty.watchdog | grep -E 'state|last exit'
```
**Проверка:** `--once` печатает проверки server/ollama/memory/disk = ok; `state = running`. Отключение: `launchctl bootout gui/$(id -u)/com.moonkatty.watchdog`.

## Этап 9. iPhone через Tailscale (только tailnet, без funnel)
```
tailscale serve --bg --https=443 http://127.0.0.1:8787
tailscale serve status
tailscale funnel status
```
**Проверка:** serve указывает на 127.0.0.1:8787; funnel — «No funnel» / выключен. На iPhone (в Tailscale) откройте `https://ВАШ-MAC.ВАШ-TAILNET.ts.net/mobile.html`, вставьте токен iPhone — видны агенты, задачи, память. Отключение: `tailscale serve reset`.

## Этап 10. Резервная копия средствами Ops и проверка восстановления
```
cd "$REPO" && STUDIO_DATA_DIR="$DATA" node ops/backup.js create && STUDIO_DATA_DIR="$DATA" node ops/backup.js list
```
**Проверка:** `verify` и `test-restore` последней копии — `ok` (`node ops/backup.js verify <id>`, `node ops/backup.js test-restore <id>`; test-restore восстанавливает во временную папку, а не поверх данных).

## Откат (в любой момент)
1. Отменить/остановить задачи с полем node (старая версия выполнила бы их локально). 2. `launchctl bootout gui/$(id -u)/com.moonkatty.watchdog`; `tailscale serve reset`. 3. Поставить прежнее приложение v1.1.2. 4. Флаги в desktop.json можно оставить — v1.1.2 их игнорирует. 5. При проблемах с данными: закрыть приложение и вернуть копию этапа 1: `mv "$DATA" "$DATA.bad" && ditto "$HOME/MOONKATTY-backup-…" "$DATA"`.

## Что прислать
Выводы проверок этапов 2, 4, 5 (+ скрин Монитора активности), 6 (оба отчёта loadtest), 7 (код 401), 8, 9 (`serve status`, `funnel status`), 10. Без токенов, паролей и app-token.
