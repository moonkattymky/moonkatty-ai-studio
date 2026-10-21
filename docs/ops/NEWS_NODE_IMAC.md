# MOONKATTY NEWS NODE на iMac 2017 (macOS Ventura 13.7.1, Intel x86_64) — установка и проверка

Версия пакета: **MOONKATTY NODE 0.2.0**, профиль **NEWS NODE** (`role: news`), архив `moonkatty-node-0.2.0-darwin-x64.tar.gz`.
Каждый шаг заканчивается блоком **Проверка**. Не переходите к следующему шагу, пока проверка не прошла. Ничего не ставится от root, порты в интернет не открываются.

## 0. Что это и на каком железе

| Параметр | Значение (подтверждено владельцем 21.10.2026) |
|---|---|
| Модель | iMac Retina 5K, 27", 2017 (iMac18,3) |
| CPU | Intel Core i5 3,4 ГГц, 4 ядра (x86_64) |
| RAM | 8 ГБ DDR4 |
| GPU | Radeon Pro 570 4 ГБ (узлом не используется) |
| macOS | **Ventura 13.7.1** (в старых документах была ошибочно указана другая версия, это исправлено) |
| Runtime | Node.js **24 LTS** darwin-x64 (v24.22.0), официально от macOS 13.5, поддержка до 30.04.2028 |

Что делает NEWS NODE: забирает RSS и официальные ленты, собирает новости, удаляет дубли, делает лёгкую подготовку (нормализация заголовков, источники), архивирует, может уменьшать картинки через `sips` и безопасно передаёт результат на Mac mini.
Чего он **не делает никогда** (это зашито в профиль кода, а не только в документацию): тяжёлые AI-модели (ollama/llm/ai.*/model.*/whisper/sd/comfy), Blender, рендер, OpenCode, публикации и лайки в X. Агент сам отклоняет такие задачи, даже если координатор их пришлёт, а переменные `NODE_ALLOW_HEAVY_AI=1` и `NODE_ALLOW_BLENDER=1` не включают их, а останавливают запуск с ошибкой.
Пароли OpenCode и секреты соцсетей на узел не передаются: координатор отклоняет задачи с полями-секретами.

### Совместимость зависимостей (x86_64, macOS 13.7.1, Node 24)

| Компонент | Используется на iMac? | Совместимость | Доказательство |
|---|---|---|---|
| Node.js 24.22.0 darwin-x64 | да (входит в пакет) | ✓ | BUILDING.md v24.x: macOS x64 `>= 13.5`, Tier 1; в Mach-O заголовке бинарника `x86_64 minos 13.5.0 sdk 15.0.0` (проверяется `scripts/node/macho-minos.py` при сборке); SHA-256 совпадает с SHASUMS256.txt nodejs.org |
| Node.js 20 LTS | нет | ✗ не берём | End-of-life с 30.04.2026, обновлений безопасности нет |
| Node.js 22 LTS | нет (для MacBook 2015) | ✓ запасной вариант | minos 11.0, пакет `darwin-x64-macos11`, поддержка до 30.04.2027 |
| npm-зависимости агента | **нет ни одной** | ✓ | `agent.js` использует только встроенные модули: fs, os, path, crypto, https, http, zlib, child_process |
| Нативные модули (better-sqlite3 и т.п.) | **нет** | ✓ нечего пересобирать | better-sqlite3 11.10.0 есть только на Mac mini (optional). Готовых сборок для darwin-x64 под Node 24 (ABI v137) у него нет, есть только для node v108/115/127/131, поэтому в узел он сознательно не включён. Дедупликация идёт в памяти (Set по SHA-256), offline-очередь хранится в JSON-файлах |
| `/usr/bin/vm_stat`, `/bin/df`, `/usr/bin/sw_vers`, `/usr/sbin/sysctl`, `/usr/bin/security` | только чтение | ✓ | Входят в состав macOS 13 |
| `sips` | только для `image.light` | ✓ | Входит в состав macOS |
| launchd LaunchAgent | да | ✓ | Ключи `KeepAlive/SuccessfulExit`, `ThrottleInterval`, `ProcessType`, `LowPriorityIO` есть в macOS 10.10+ |
| Tailscale (на iMac и Mac mini) | да | ✓ | Клиент Tailscale для macOS поддерживает macOS 12+ |

### Бюджет памяти (8 ГБ), значения взяты из измерений

Замер делался скриптом `scripts/node/news-load-sim.mjs`. Он запускает настоящий процесс агента, настоящий координатор (на 127.0.0.1) и локальный RSS-сервер. RSS процесса агента снимается каждые 100 мс. Флаги те же, что в plist: `--max-old-space-size=192 --expose-gc`. Результаты лежат в `docs/ops/sim/*.json`.

| Сценарий (Node 24.22, x64) | Задач | Лента | Пик RSS | p95 | p50 | Простой |
|---|---|---|---|---|---|---|
| Реалистичный: 50 лент × 200 новостей (≈350 КБ), ⅓ дублей | 20 | 50×200 | **167 МБ** | 164 | 151 | 58 МБ |
| Длительный | 60 | 50×200 | **172 МБ** | 168 | 156 | 58 МБ |
| Стресс: 50 лент × 650 новостей (≈1,8 МБ каждая) | 10 | 50×650 | **303 МБ** | 303 | 293 | 58 МБ |
| Для сравнения: Node 20, реалистичный | 20 | 50×200 | 148 МБ | 146 | 133 | 55 МБ |

Лимиты профиля NEWS NODE выбраны по этим замерам:
- V8 heap не больше 192 МБ.
- **soft 260 МБ RSS** (примерно 1,5 × реалистичного пика). Выше этого порога включается backpressure: агент запускает GC и не берёт новые задачи. Если RSS не опустится за 30 с, агент выходит с кодом 75 без активной аренды, и launchd перезапускает чистый процесс. В стресс-сценарии так было 2 раза, все 10 задач выполнены.
- **hard 384 МБ RSS**: при превышении сразу выход 75 с перезапуском.
- Одна задача за раз. Не больше 50 лент на задачу, 2 МБ на ленту и 5000 уникальных новостей на задачу; лишнее возвращается частичным результатом с полем `truncated`, а не падением.
- Результат больше 256 КБ отправляется как gzip-артефакт с проверкой SHA-256, а не телом JSON (у координатора лимит 1 МБ).
- Offline-очередь: не больше 200 результатов, хранятся не дольше 24 ч.

Итого узел занимает не больше 0,4 ГБ из 8 ГБ даже в худшем случае. macOS и браузеру остаётся больше 7 ГБ.

### Безопасная связь с Mac mini

- Узел никого не слушает в сети: он сам подключается к Mac mini (pull) и опрашивает очередь. Страница статуса открывается только на `127.0.0.1:8791`.
- Вариант **A (рекомендуется): Tailscale**. На Mac mini работает `tailscale serve`: HTTPS с сертификатом `*.ts.net`, доступ только внутри вашей tailnet. **Funnel не включать, публичных портов нет.** На узле `NODE_TLS_MODE=tailscale`, обычная проверка сертификата; адрес должен заканчиваться на `.ts.net`, иначе агент не запустится.
- Вариант B: адрес Tailscale 100.x или LAN, самоподписанный сертификат координатора, закреплённый по отпечатку SHA-256 (`NODE_TLS_MODE=pinned`).
- Каждый узел получает свой токен (`nk_imac.…`). Координатор хранит только его SHA-256 (файл chmod 600). На iMac токен лежит в Keychain, а `node-agent.env` имеет права 600 (иначе агент не запустится). Токен можно отозвать.
- Повторы: аренда и heartbeat, `idempotencyKey`, экспоненциальный backoff от 1 до 60 с. Если связи нет в момент сдачи результата, он сохраняется в `~/.moonkatty-node/outbox` (0600) и досылается позже с тем же `leaseId`. Повтор подтверждается идемпотентно, устаревший (409) удаляется.

---

## Шаг 1. Проверить iMac (только чтение)
На iMac откройте Терминал и выполните:
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64/detect-specs.sh > ~/Desktop/moonkatty-specs-imac.txt; grep -E "macos:|arch:|ram_gb|verdict" ~/Desktop/moonkatty-specs-imac.txt
```
(сначала распакуйте архив, см. шаг 4, или скопируйте `detect-specs.sh` отдельно).
**Проверка:** `macos: macOS 13.7.1`, `arch: x86_64`, `ram_gb: 8`, `verdict: … пакет darwin-x64 (Node.js 24 LTS, мин. macOS 13.5)`. Если увидели другое, остановитесь.

## Шаг 2. Tailscale на обоих Mac
1. Установите Tailscale из App Store на Mac mini и на iMac и войдите в **одну** учётную запись (tailnet).
2. В админке Tailscale (DNS) включите **MagicDNS** и **HTTPS Certificates**.

**Проверка (на iMac):** `tailscale status` показывает mac-mini. `tailscale ping mac-mini` отвечает. `tailscale funnel status` должен ответить, что funnel не настроен.

## Шаг 3. Координатор на Mac mini за `tailscale serve`
1. Закройте студию (Cmd+Q). В `~/Library/Application Support/MOONKATTY AI STUDIO/desktop.json` добавьте `"opsNodes": true`. `opsNodesBind` **не указывайте**: Node API должен слушать только `127.0.0.1:8790`. Запустите студию.
2. Только внутри tailnet, без funnel:
```
tailscale serve --bg --https=8443 https+insecure://127.0.0.1:8790
tailscale serve status
```
(`https+insecure` относится только к петле 127.0.0.1 внутри Mac mini. Снаружи работает настоящий сертификат `*.ts.net`.)

**Проверка (Mac mini):** `lsof -nP -iTCP:8790 -sTCP:LISTEN` показывает `127.0.0.1:8790`, а **не** `*:8790`. `tailscale serve status` показывает `https://mac-mini.<tailnet>.ts.net:8443 (tailnet only)`. Слова `Funnel on` быть не должно.
**Проверка (iMac):** `curl -s -o /dev/null -w '%{http_code}\n' https://mac-mini.<tailnet>.ts.net:8443/api/nodes/hello -X POST` возвращает `401` (без токена доступа нет, TLS работает).

## Шаг 4. Пакет: перенести и проверить целостность
На Mac mini, в репозитории, на ветке `feat/studio-operations`: `bash scripts/node/build-node-pkg.sh`. Можно взять и готовый архив. Перенесите на iMac `moonkatty-node-0.2.0-darwin-x64.tar.gz` и `.sha256` (AirDrop).
```
cd ~/Downloads && shasum -a 256 -c moonkatty-node-0.2.0-darwin-x64.tar.gz.sha256 && tar xzf moonkatty-node-0.2.0-darwin-x64.tar.gz && bash moonkatty-node-0.2.0-darwin-x64/install.sh --verify-only
```
**Проверка:** `…tar.gz: OK`, затем `OK` (MANIFEST) и BUILDINFO с `Node.js v24.22.0 darwin-x64 (macOS >= 13.5)` и `mach-o: x86_64 minos 13.5.0`. Строка `codesign bin/node: подпись Node.js действительна`. Если видите слово «ОШИБКА», остановитесь.

## Шаг 5. Установить (без автозапуска, без sudo)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64/install.sh
~/moonkatty-node/bin/node -v
~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js --info | grep -E '"os"|"arch"|"cpus"|"memTotal"'
```
**Проверка:** `v24.22.0`; `"os": "macOS 13.7.1"`, `"arch": "x64"`, `"cpus": 4`, `"memTotal": 8589934592`. Появились папки `~/moonkatty-node` и `~/.moonkatty-node/{work,archive,outbox,logs}`.

## Шаг 6. Зарегистрировать узел и сохранить токен
На Mac mini:
```
DATA="$HOME/Library/Application Support/MOONKATTY AI STUDIO"; APP=$(cat "$DATA/app-token")
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"id":"imac","role":"news","name":"iMac 27 2017"}'
```
Токен `nk_imac.…` показывается **один раз**. Перенесите его на iMac вручную и никуда не пересылайте. На iMac:
```
security add-generic-password -s moonkatty-node-imac -a node-token -w
open -e ~/.moonkatty-node/node-agent.env
```
В `node-agent.env` укажите: `NODE_ID=imac`, `NODE_PROFILE=news`, `NODE_TLS_MODE=tailscale`, `COORDINATOR_URL=https://mac-mini.<tailnet>.ts.net:8443`.
**Проверка:** `ls -l ~/.moonkatty-node/node-agent.env` показывает `-rw-------`. `security find-generic-password -s moonkatty-node-imac -a node-token >/dev/null && echo keychain-ok` выводит `keychain-ok`. `grep -c nk_ ~/.moonkatty-node/node-agent.env` выводит `0` (токена в файле нет).

## Шаг 7. Пробный запуск вручную
```
~/moonkatty-node/bin/node --max-old-space-size=192 --expose-gc ~/moonkatty-node/app/agent.js
```
**Проверка:** строка `node-agent 0.2.0 imac → https://mac-mini…ts.net:8443 (Node v24.22.0, darwin/x64)`. Нет строк `токен отклонён` и `нет связи`. Страница http://127.0.0.1:8791 показывает **NEWS NODE**, Online. На Mac mini в «Computers (Nodes)» узел iMac в статусе Online. Остановите агент Ctrl+C.

## Шаг 8. Тест: сбор новостей и защита профиля
На Mac mini (`APP` из шага 6):
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/jobs -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" \
  -d '{"capability":"news.collect","input":{"feeds":[{"url":"https://feeds.bbci.co.uk/news/world/rss.xml","source":"BBC"}]},"idempotencyKey":"imac-test-1","safeToRetry":true,"maxAttempts":3,"preferNode":"imac"}'
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/jobs -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"capability":"blender.render","input":{}}'
```
Агент должен работать (шаг 7 или 9).
**Проверка:** первая задача через 5–20 с получает статус `succeeded` на `imac`, а заголовки видны на 127.0.0.1:8791. Повторная отправка с тем же `idempotencyKey` возвращает `"duplicate": true`. Вторая задача отклоняется с ответом `capability не разрешена для узлов`.

## Шаг 9. Автозапуск (LaunchAgent пользователя, не root)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64/install.sh --autostart
```
Введите `yes`. Plist устанавливается в `~/Library/LaunchAgents/com.moonkatty.node-agent.plist` со следующими параметрами: RunAtLoad, KeepAlive (перезапуск после сбоя и выхода 75, но не после команды `stop`), ThrottleInterval 30 с, Nice 10, логи в `~/.moonkatty-node/logs/`.
**Проверка:** `launchctl print gui/$(id -u)/com.moonkatty.node-agent | grep -E 'state =|last exit'` показывает `state = running`. `tail -3 ~/.moonkatty-node/logs/agent.log` показывает строку старта. `ps -o rss=,command= -p $(pgrep -f moonkatty-node/app/agent.js)` показывает RSS меньше 260000 КБ. Перезагрузите iMac: узел снова Online.

## Шаг 10. Проверка offline-очереди и повторов
1. На iMac выключите Tailscale (меню → Disconnect) примерно на 1 минуту, потом включите.

**Проверка:** в `agent.log` появились строки `нет связи … повтор через 1/2/4… с`, после включения статус снова Online. Если в момент обрыва задача была на сдаче, в `~/.moonkatty-node/actions.log` есть строка `offline-результат доставлен`.

## Шаг 11. Ресурсы под нагрузкой
Отправьте 5 задач `news.collect` по 20–50 вашим лентам. Во время работы выполните `ps -o rss= -p $(pgrep -f moonkatty-node/app/agent.js)`.
**Проверка:** значение меньше 260000 (260 МБ). В «Мониторинге системы» узел занимает меньше 0,4 ГБ, давление памяти зелёное.

---

## Откат и удаление
- **Временно остановить:** `launchctl bootout gui/$(id -u)/com.moonkatty.node-agent`. **Проверка:** `launchctl print gui/$(id -u)/com.moonkatty.node-agent` отвечает «Could not find service».
- **Откатиться на предыдущую версию** (её сохраняет `install.sh` в `~/moonkatty-node.backup-*`): `bash ~/moonkatty-node/uninstall.sh --rollback`, затем включите автозапуск старым пакетом. **Проверка:** `~/moonkatty-node/BUILDINFO` показывает прежнюю версию.
- **Удалить программу**, сохранив конфиг и токен: `bash ~/moonkatty-node/uninstall.sh`. **Проверка:** `ls ~/moonkatty-node` отвечает «No such file», plist в `~/Library/LaunchAgents` отсутствует.
- **Удалить полностью** (конфиг, архив, outbox, токен из Keychain): `bash ~/moonkatty-node/uninstall.sh --purge`. **Проверка:** `ls ~/.moonkatty-node` отвечает «No such file», `security find-generic-password -s moonkatty-node-imac` выдаёт ошибку.
- **Отозвать токен** на Mac mini: `curl -s -X POST http://127.0.0.1:8787/api/ops/nodes/imac/revoke -H 'x-studio-request: 1' -H "x-studio-app-token: $APP"`. **Проверка:** агент пишет `токен отклонён`.
- **Закрыть доступ** на Mac mini: `tailscale serve --https=8443 off` и `"opsNodes": false` в desktop.json. **Проверка:** `tailscale serve status` пуст.

## Что реально проверено и что смоделировано
- **Проверено реально (Linux x64, в песочнице):** код агента и координатора; тесты (node:test, security, opencode, runner); RSS под нагрузкой на Node 24.22.0 и 20.19.2; целостность пакета (SHA-256 и MANIFEST); заголовок Mach-O бинарника Node (x86_64, minos 13.5.0).
- **Смоделировано / не запускалось на iMac:** запуск на macOS 13.7.1, launchd, Keychain, `tailscale serve`, `sips`, `vm_stat`. RSS на macOS может отличаться от Linux примерно на 10–20 %, поэтому лимиты взяты с запасом. Перед включением автозапуска сверьте шаг 11 с этими цифрами.
