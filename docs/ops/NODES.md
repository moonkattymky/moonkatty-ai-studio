# MOONKATTY NODE — распределённые узлы (iMac NEWS NODE, MacBook MONITOR NODE)

Одно приложение **MOONKATTY NODE** (`node-agent/`), профиль задаётся при регистрации узла на Mac mini: `news` (iMac) или `monitor` (MacBook). Координатор — Mac mini (`lib/ops/nodes.js` внутри сервера студии, флаг `STUDIO_OPS_NODES=1` / `desktop.json: "opsNodes": true`). По умолчанию всё выключено.

## 1. Аудит существующей инфраструктуры (21.10.2026)
| Что | Состояние до этой работы |
|---|---|
| Сервер студии | Express 5, `server.js`, слушает **только 127.0.0.1:8787**; Host allowlist, CSRF-заголовок, app-token, сессии с хешем |
| Исполнитель агентов | `runner.js` (tick → admit → runTask; Ollama/OpenCode с подтверждением, sandbox-exec) — единственный рантайм |
| Очередь | задачи в SQLite `items(col='tasks')`, статусы queued/in_progress/waiting_approval/… ; распределённой очереди не было |
| Другие машины | не использовались; сетевых портов наружу нет; Tailscale — только для iPhone (`tailscale serve`, без funnel) |
| Секреты | Keychain (OpenCode, ключ шифрования), `secret.key`/`app-token` 0600 |
| Grok #1 (`feat/v1.2.0`) | ветки нет на origin; согласован контракт jobs + job_events (см. NODE_API_CONTRACT.md) |
| Уведомления | `lib/ops/notifier.js` (ntfy/Telegram, выкл. по умолчанию) — используется и для узлов |

## 2. Архитектура
- **Pull-модель**: узел сам ходит на Mac mini (`POST /api/nodes/pull`), Mac mini никогда не подключается к узлам. На узлах **нет входящих портов** (кроме страницы статуса на 127.0.0.1:8791).
- **Отдельный TLS-слушатель** только для Node API (`OPS_NODES_PORT`, по умолч. 8790). Основное приложение на LAN не публикуется: на этом порту отвечает лишь `/api/nodes/*`, остальное — 404.
- Привязка: `127.0.0.1` по умолчанию; LAN/Tailscale — только явно указанным адресом (`opsNodesBind`: 192.168.x.x / 10.x / 172.16–31.x / 100.64–127.x). `0.0.0.0` и публичные IP отвергаются кодом.
- **TLS с закреплённым сертификатом**: при первом запуске создаётся самоподписанный EC-сертификат `<DATA>/ops/nodes-tls.crt` (ключ 0600). Узел доверяет только этому сертификату (`ca`) и дополнительно сверяет SHA-256 отпечаток (`COORDINATOR_FINGERPRINT`). Подмена → `TLS pin mismatch`.
- **Токены узлов** `nk_<id>.<secret>`: показываются один раз, хранится только SHA-256, сравнение timing-safe, отзыв мгновенный. Токен узла не работает в основном API.
- **Allowlist возможностей** по профилю (NEWS: news.collect, rss.fetch, news.dedup, news.prepare, archive.store, image.light (sips), transfer.push, schedule.tick, telegram.notify; MONITOR: monitor.check, site.check, result.verify, ffprobe.check, stats.compute, notify.send, queue.inspect, backup.light, x.analytics, x.draft). Запрещены навсегда: opencode*, blender*, render*, ollama*, llm*, x.post/like/follow/repost/dm/reply.
- **Никакого shell с сервера**: агент выполняет только встроенные обработчики; файлы — только в `~/.moonkatty-node/work/job-*` и `archive/` (basename, без путей).
- **Секреты не уходят на узлы**: координатор отвергает input с полями password/secret/token/apiKey/credential/cookie и строки, похожие на Basic-auth/ключи. OpenCode/Blender/рендер/LLM-задачи (`opencode_task`, `blender_template`, `render_segment`, `requiresNode=mac-mini`, `gpu_heavy`, `llm`) всегда остаются на Mac mini.
- **Аренда + heartbeat + ack**: аренда 60 с, продлевается heartbeat (каждые ~20 с); завершение подтверждается leaseId; повторное подтверждение = `duplicate:true` (идемпотентно); устаревшая аренда → 409.
- **Идемпотентность**: `idempotencyKey` → повторная постановка возвращает ту же задачу.
- **Восстановление**: потеря узла/аренды/таймаут → повтор **только** для `safeToRetry: true` (до `maxAttempts`); иначе `needs_approval` + оповещение; повтор вручную (`/api/ops/nodes/jobs/:id/retry`).
- **Файлы**: контентная адресация по SHA-256; загрузка проверяется (несовпадение → 422, файл отвергнут); узел скачивает только файлы своей арендованной задачи и проверяет SHA-256; артефакты результата перепроверяются перед приёмом.
- **Маршрутизация по ресурсам**: capability + `requires {ramGB, diskGB, cpus, tools}` + свободный диск ≥ 2 ГБ; при наличии заметно более свободного узла задача отдаётся ему; `preferNode`.
- **Мониторинг и оповещения** (через существующий notifier): узел недоступен > 90 с, задача требует решения, мало RAM (<8%) или диска (<5 ГБ).
- **Команды из центра**: `run | pause | drain | stop` (`POST /api/ops/nodes/:id/command`). pause/drain — новые задачи не выдаются, текущая доделывается; stop — агент завершает работу с кодом 0 (launchd его не перезапускает).
- **Через runner.js**: задача студии с полем `node: { capability, input, safeToRetry }` исполняется обычным runner (статусы, логи, «Стоп»), который передаёт её узлу (`ctx.runViaNode`); остановка в панели отменяет задачу узла. Отдельного рантайма нет.
- **Журнал действий** узла: `~/.moonkatty-node/actions.log` (JSONL, 0600).

## 3. Рантайм для Intel Mac (проверено по nodejs.org BUILDING.md)
| macOS | Node.js | Решение |
|---|---|---|
| 13.5+ | 24 LTS / 22 LTS | встроенный Node 22 |
| 11–12 (iMac Monterey 12.5.1; MacBook 2015 максимум Monterey 12) | **22 LTS x64 (поддержка ≥ 11.0, Tier 1)**, поддержка до 04.2027 | пакет `moonkatty-node-<v>-darwin-x64.tar.gz` содержит официальный бинарник Node 22 x64 |
| 10.15 | 22 не поддерживается | запасной: обновить macOS до 12 (MacBook 2015 поддерживает), либо `js-only` пакет + Node 18 (EOL, только временно) |
| ≤10.14 | — | обновить macOS |
Node 24 требует macOS 13.5 — **не подходит** для этих Mac. SEA/pkg не используем: SEA требует переподписи бинарника, а официальный подписанный Node + наши JS-файлы с MANIFEST проще проверить. Код агента совместим с Node ≥ 16, без зависимостей.

## 4. Сборка, установка, обновление, откат
- `scripts/node/build-node-pkg.sh` — скачивает Node 22 x64, сверяет с `SHASUMS256.txt` (и GPG, если ключи импортированы), собирает tarball + `MANIFEST.sha256` (каждый файл) + `.sha256`.
- `install.sh --verify-only` — только проверка (SHA-256 всех файлов, codesign Node). `install.sh` — установка в `~/moonkatty-node` (старая версия → `~/moonkatty-node.backup-*`). `install.sh --autostart` — launchd **только после ввода `yes` владельцем**.
- Обновление: никогда не автоматическое; новая версия ставится тем же `install.sh` после проверки SHA-256 tarball против значения в ветке/отчёте.
- Откат: `uninstall.sh --rollback` (возврат предыдущей версии), `uninstall.sh` (удалить, конфиг сохраняется), `--purge` (всё).

## 5. Сеть и firewall
- Mac mini: включите Брандмауэр macOS (Системные настройки → Сеть → Брандмауэр), разрешите входящие для приложения студии; порт 8790 должен быть доступен **только в домашней сети/tailnet**. На роутере **не** делать проброс портов, UPnP выключить.
- Узлы: входящие порты не нужны; брандмауэр можно включить в режиме «Блокировать все входящие».
- Вариант Tailscale: `opsNodesBind` = Tailscale-IP Mac mini (100.x), узлы подключаются по нему; ACL tailnet: разрешить iMac/MacBook → Mac mini:8790, остальное запрещено. Funnel не использовать.
