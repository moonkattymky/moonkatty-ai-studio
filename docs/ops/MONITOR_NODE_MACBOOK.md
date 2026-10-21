# MOONKATTY MONITOR NODE на MacBook Pro 13" 2015 (macOS Monterey 12.7.6, Intel x86_64) — установка и проверка

- Пакет: **MOONKATTY NODE 0.2.0**, архив `moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz`.
- Профиль: **MONITOR NODE** (`role: monitor`).
- Каждый шаг заканчивается блоком **Проверка**. Пока проверка не прошла, дальше не идите.
- Права root не нужны. Узел не открывает портов наружу.

## 0. Железо, задачи, ограничения

| Параметр | Значение (подтверждено 21.10.2026) |
|---|---|
| Модель | MacBook Pro Retina 13", Early 2015 (MacBookPro12,1) |
| CPU | Intel Core i5 2,7 ГГц, **2 ядра** (x86_64) |
| RAM | 8 ГБ DDR3 |
| GPU | Intel Iris Graphics 6100 (узлом не используется) |
| macOS | **Monterey 12.7.6** (последняя версия macOS для этой модели) |
| Runtime | Node.js **22 LTS** (v22.23.3) darwin-x64, поддержка до 30.04.2027 |

**Что делает узел:**
- мониторит Mac mini: задача `studio.health` делает защищённый ping Node API и проверяет ваши URL;
- проверяет результаты: `result.verify` заново считает SHA-256 каждого артефакта с диска и сверяет его с адресом и с ожидаемым значением;
- делает технические проверки видео (`ffprobe.check`: кодек, разрешение, длительность, наличие аудио);
- выполняет `site.check`, `monitor.check`, `notify.send`, `stats.compute`, `backup.light`.

**Что запрещено кодом, а не только документацией:**
- тяжёлые AI-модели, Blender, рендер и OpenCode отклоняет сам агент. Переменная `NODE_ALLOW_HEAVY_AI=1` их не включает, а останавливает запуск;
- **X GROWTH по умолчанию выключен.** По умолчанию координатор не выдаёт `x.analytics` и `x.draft`, и агент их отклоняет;
- включается X GROWTH только двумя действиями сразу: явным списком caps при регистрации и `NODE_X_GROWTH=1` на узле. Даже тогда это только аналитика и черновики. Публикации, лайки, подписки, репосты, DM и ответы запрещены всегда, по правилам X.

### Совместимость с macOS 12.7.6 / x86_64

| Компонент | Вердикт | Доказательство |
|---|---|---|
| Node.js 22.23.3 LTS darwin-x64 (входит в пакет) | ✓ | BUILDING.md v22: macOS x64 ≥ 11.0. Заголовок Mach-O бинарника: `x86_64 minos 11.0.0 sdk 15.0.0` (проверяется `macho-minos.py` при сборке). SHA-256 совпадает с SHASUMS256.txt nodejs.org |
| Node.js 24 LTS | ✗ **запрещено** | Минимум macOS 13.5 (`minos 13.5.0`). `install.sh` не даст поставить пакет `darwin-x64` (Node 24) на macOS 12 |
| Node.js 20 | ✗ | Срок поддержки закончился 30.04.2026 |
| Electron в узле | не используется | Интерфейс узла — локальная страница http://127.0.0.1:8791 в Safari, Electron не нужен |
| Electron в студии (Mac mini) | 44.9.1 → **macOS ≥ 13** | В breaking-changes Electron: «Removed: macOS 12 support… macOS 13 or later will be required to run Electron v44.0.0 and higher». Поддержку macOS 11 убрали в v38, 10.15 — в v33. В `package.json` студии `minimumSystemVersion` исправлен с 12.0 на 13.0 |
| Electron, если когда-нибудь понадобится UI на MacBook | **рекомендуется 43.x (43.8.3, Node 24.22 внутри)** | Последняя линейка, которая работает на Monterey. Она поддерживается, пока актуальны 3 последние мажорные версии (сейчас 43–45). Когда выйдет v46, поддержка закончится, поэтому на MacBook рекомендуем веб-страницу, а не Electron |
| npm-зависимости агента | ✓ нет ни одной | Используются только встроенные модули Node (fs, os, path, crypto, http/https, zlib, child_process) |
| better-sqlite3 и другие нативные модули | ✓ не включены | Узлу они не нужны. better-sqlite3 11.10.0 ставится только на Mac mini |
| ffprobe 6.1 static (evermeet.cx / tessus) | ✓ | Источник: ffbinaries-prebuilt v6.1 на GitHub, копия сборки evermeet.cx. Mach-O `x86_64 minos 10.13.0`. Подключены только системные фреймворки (libSystem, Foundation, AVFoundation, VideoToolbox…), внешних dylib нет. SHA-256 zip `878ab878…45f2`, бинарника `82f8b544…7f1f` — оба закреплены в `fetch-ffprobe.sh`. Лицензия GPL |
| ffprobe из Homebrew | ✗ не рекомендуется | Monterey у Homebrew на Tier 3: пакеты собираются из исходников, на 2 ядрах это часы |
| vm_stat, df, sw_vers, sysctl, security, launchd LaunchAgent | ✓ | Входят в состав macOS 12 |
| Tailscale для macOS | ✓ | Работает на macOS 12+ |

### Память и CPU — измерения, по ним выставлены лимиты

Измерения сделаны скриптом `scripts/node/monitor-load-sim.mjs`:
- запускаются настоящий процесс агента на **Node 22.23.3** и настоящий координатор;
- агент привязан к **2 ядрам** (`taskset -c 0,1`, как i5 в MacBook);
- флаги те же, что в plist: `--max-old-space-size=128 --expose-gc`;
- RSS снимается каждые 100 мс, CPU берётся из /proc (вместе с дочерним ffprobe);
- данные лежат в `docs/ops/sim/monitor-node22-*.json`.

| Сценарий | Задач | Артефакты | Пик RSS | p95 | Простой | CPU в среднем (из 2 ядер) |
|---|---|---|---|---|---|---|
| Лёгкий фон (health, сайты, verify, ffprobe 20 с 720p, stats) | 150 | 1 × 8 МБ | **89 МБ** | 67 | 54 МБ | 7,7 % |
| Реалистичный (то же + проверка видео) | 50 | 3 × 128 МБ | **98 МБ** | 98 | 54 МБ | 22 % |
| Крупный артефакт | 15 | 1 × 500 МБ | **98 МБ** | 97 | 54 МБ | 22 % |

Артефакты скачиваются и хешируются **потоково**, поэтому файл в 500 МБ не увеличивает память. В старой версии файл целиком загружался в RAM, и RSS доходил до 585 МБ.

**Лимиты профиля MONITOR NODE:**
- V8 heap 128 МБ;
- **soft 160 МБ** (≈1,6 × пика). При превышении включается backpressure: GC, новые задачи не берутся;
- **hard 256 МБ**: выход 75, launchd перезапускает агент;
- одна задача за раз;
- файл не больше 4 ГБ;
- ffprobe запускается с `-threads 1` и таймаутом 120 с;
- **duty-cycle 0,5**: после задачи длительностью T агент отдыхает T. Без этого CPU в реалистичном сценарии был 41 % от 2 ядер, с ним 22 %;
- `Nice 10` и `LowPriorityIO` в plist.

Итого узел занимает не больше 0,25 ГБ из 8 ГБ и в среднем меньше половины одного ядра.

### Связь с центральной студией
Связь устроена так же, как у iMac:
- узел сам подключается к Mac mini (pull), сам ничего не слушает;
- `tailscale serve` на Mac mini даёт сертификат `*.ts.net` и работает только внутри tailnet. **Funnel не включать**, публичных портов нет. Запасной вариант — закреплённый самоподписанный сертификат;
- у каждого узла свой токен. На Mac mini хранится только его хеш, на MacBook токен лежит в Keychain, а `.env` имеет права 600;
- аренда и heartbeat, `idempotencyKey`, backoff от 1 до 60 с;
- **offline-очередь** `~/.moonkatty-node/outbox` (права 0600, не больше 200 результатов, хранение до 24 ч).

Отдельно есть **тест связи** `studio-connection-test.mjs`. Он только читает: не берёт задачи и не вызывает `/hello`, обращается только к `GET /api/nodes/ping`, который ничего не меняет. Токен в выводе маскируется. Режим `--dry-run` вообще не выходит в сеть.

---

## Шаг 1. Проверить MacBook (только чтение)
```
cd ~/Downloads && tar xzf moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz
bash moonkatty-node-0.2.0-darwin-x64-monterey/detect-specs.sh > ~/Desktop/moonkatty-specs-macbook.txt; grep -E "macos:|arch:|cores|ram_gb|verdict" ~/Desktop/moonkatty-specs-macbook.txt
```
**Проверка:**
- `macos: macOS 12.7.6`
- `arch: x86_64`
- `cores: 2`
- `ram_gb: 8`
- `verdict: … пакет darwin-x64-monterey (Node.js 22 LTS x64, мин. macOS 11)`

## Шаг 2. Tailscale
1. Установите Tailscale из App Store.
2. Войдите в ту же tailnet, что и Mac mini.

Mac mini уже настроен по [NEWS_NODE_IMAC.md](NEWS_NODE_IMAC.md), шаг 3: `tailscale serve --bg --https=8443 https+insecure://127.0.0.1:8790`.

**Проверка:**
- `tailscale status` показывает mac-mini;
- `tailscale ping mac-mini` проходит;
- на Mac mini `tailscale serve status` показывает `(tailnet only)`, Funnel нет.

## Шаг 3. Проверить целостность пакета
```
cd ~/Downloads && shasum -a 256 -c moonkatty-node-0.2.0-darwin-x64-monterey.tar.gz.sha256 && bash moonkatty-node-0.2.0-darwin-x64-monterey/install.sh --verify-only
```
**Проверка:**
- архив: `OK`, затем `OK` по MANIFEST;
- BUILDINFO: `Node.js v22.23.3 darwin-x64 (macOS >= 11.0)` и `mach-o: x86_64 minos 11.0.0`;
- `codesign bin/node: подпись Node.js действительна`.

## Шаг 4. Установить (без автозапуска, без sudo)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64-monterey/install.sh
~/moonkatty-node/bin/node -v
~/moonkatty-node/bin/node ~/moonkatty-node/app/agent.js --info | grep -E '"os"|"cpus"|"memTotal"'
```
**Проверка:**
- `v22.23.3`;
- `"os": "macOS 12.7.6"`, `"cpus": 4` (2 ядра × Hyper-Threading), `"memTotal": 8589934592`.

## Шаг 5. (по желанию) ffprobe для проверки видео
```
bash ~/moonkatty-node/fetch-ffprobe.sh --dry-run
bash ~/moonkatty-node/fetch-ffprobe.sh
```
**Проверка:**
- `ffprobe version 6.1-tessus …`;
- `OK: ~/moonkatty-node/tools/ffprobe (sha256 82f8b544…)`.

Если увидели «ОШИБКА: SHA-256 … не совпадает», ничего не установлено. Сообщите мне.

## Шаг 6. Регистрация узла (на Mac mini) и токен
На Mac mini (`APP` берётся как в инструкции iMac). X GROWTH не включаем, поэтому caps не указываем:
```
curl -s -X POST http://127.0.0.1:8787/api/ops/nodes -H 'x-studio-request: 1' -H 'content-type: application/json' -H "x-studio-app-token: $APP" -d '{"id":"macbook","role":"monitor","name":"MacBook Pro 13 2015"}'
```
В ответе в `caps` не должно быть `x.*`. Токен `nk_macbook.…` показывается один раз.

На MacBook:
```
security add-generic-password -s moonkatty-node-macbook -a node-token -w
open -e ~/.moonkatty-node/node-agent.env
```
В файле укажите:
- `NODE_ID=macbook`
- `NODE_PROFILE=monitor`
- `NODE_TLS_MODE=tailscale`
- `COORDINATOR_URL=https://mac-mini.<tailnet>.ts.net:8443`

**Проверка:**
- `ls -l ~/.moonkatty-node/node-agent.env` показывает `-rw-------`;
- `grep -c nk_ ~/.moonkatty-node/node-agent.env` выводит `0`.

## Шаг 7. Тест связи с центральной студией (только чтение)
```
~/moonkatty-node/bin/node ~/moonkatty-node/app/studio-connection-test.mjs --dry-run
~/moonkatty-node/bin/node ~/moonkatty-node/app/studio-connection-test.mjs
```
**Ожидаемый вывод** (без `--dry-run`):
```
PASS config: node-agent.env (chmod 600) + токен (Keychain/env) — node=macbook profile=monitor tls=tailscale token=nk_macbook.***
PASS адрес координатора: https и tailnet/частная сеть — https://mac-mini.<tailnet>.ts.net:8443
PASS DNS — mac-mini.<tailnet>.ts.net → 100.x.y.z
PASS TLS — TLSv1.3 CN=mac-mini.<tailnet>.ts.net до <дата> (цепочка доверена)
PASS без верного токена → 401 — HTTP 401
PASS с токеном GET /api/nodes/ping → 200 — HTTP 200 node=macbook role=monitor title=MONITOR NODE
PASS capabilities: нет heavy AI / Blender / render / OpenCode — monitor.check, site.check, studio.health, …
PASS X GROWTH — выключен (по умолчанию)
PASS Tailscale funnel выключен (на этом Mac)
ИТОГ: OK — связь с центральной студией безопасна и работает
```
Код выхода 0. Любой `FAIL` означает остановку. Обычные причины: TLS — включён MagicDNS/HTTPS? 401 — токен в Keychain?

## Шаг 8. Пробный запуск и тестовые задачи
```
~/moonkatty-node/bin/node --max-old-space-size=128 --expose-gc ~/moonkatty-node/app/agent.js
```
На Mac mini отправьте две задачи: `{"capability":"studio.health","input":{"urls":[]},"preferNode":"macbook"}` и `{"capability":"x.draft","input":{"topics":["тест"]}}`.

**Проверка:**
- `studio.health` получает статус `succeeded` с `ok: true`;
- `x.draft` координатор отклоняет: у узла нет этой capability;
- страница http://127.0.0.1:8791 показывает **MONITOR NODE**, Online.

Остановите агент: Ctrl+C.

## Шаг 9. Автозапуск (LaunchAgent пользователя)
```
bash ~/Downloads/moonkatty-node-0.2.0-darwin-x64-monterey/install.sh --autostart
```
Введите `yes`. Скрипт сообщит: `Профиль: monitor (V8 heap 128 MB)`.

**Проверка:**
- `launchctl print gui/$(id -u)/com.moonkatty.node-agent | grep -E 'state =|last exit'` показывает `state = running`;
- `grep -A1 max-old ~/Library/LaunchAgents/com.moonkatty.node-agent.plist` показывает 128;
- после перезагрузки узел снова Online.

## Шаг 10. Ресурсы и offline-очередь
1. Во время работы выполните `ps -o rss=,%cpu= -p $(pgrep -f moonkatty-node/app/agent.js)`.
2. Отключите Tailscale на минуту.

**Проверка:**
- RSS меньше 160000 КБ, CPU в среднем меньше 50 %;
- после восстановления связи в `~/.moonkatty-node/logs/agent.log` есть `нет связи … повтор`, затем узел Online;
- результаты из offline-очереди доставлены: в `actions.log` есть строка `offline-результат доставлен`.

---

## Откат и удаление
- **Остановить:** `launchctl bootout gui/$(id -u)/com.moonkatty.node-agent`.
  **Проверка:** `launchctl print …` отвечает «Could not find service».
- **Откатиться на прошлую версию:** `bash ~/moonkatty-node/uninstall.sh --rollback`.
  **Проверка:** `cat ~/moonkatty-node/BUILDINFO` показывает прежнюю версию.
- **Удалить программу**, сохранив конфиг и токен: `bash ~/moonkatty-node/uninstall.sh`.
  **Проверка:** `~/moonkatty-node` нет, plist удалён.
- **Удалить всё**, включая конфиг, outbox, ffprobe и токен в Keychain: `bash ~/moonkatty-node/uninstall.sh --purge`.
  **Проверка:** `~/.moonkatty-node` нет, `security find-generic-password -s moonkatty-node-macbook` выдаёт ошибку.
- **Отозвать токен** на Mac mini: `POST /api/ops/nodes/macbook/revoke`.
  **Проверка:** тест связи показывает `FAIL с токеном … HTTP 401`.

## Что проверено реально, а что смоделировано
- **Реально (Linux x64, в песочнице):**
  - код агента и координатора;
  - все тесты;
  - RSS и CPU на Node 22.23.3 с привязкой к 2 ядрам;
  - ffprobe (системный 7.1 в песочнице) на настоящем видео 720p;
  - тест связи по TLS с закреплённым сертификатом;
  - заголовки Mach-O у Node и ffprobe, SHA-256 пакета и MANIFEST.
- **Смоделировано, на MacBook не запускалось:**
  - macOS 12.7.6, launchd, Keychain, Tailscale serve, codesign;
  - сам ffprobe 6.1 для macOS: в песочнице проверены только его заголовки и хеши.

Ядра Broadwell 2015 года медленнее серверных, поэтому процент CPU на MacBook будет выше. Его ограничивает duty-cycle. Сверьте цифры на шаге 10.
