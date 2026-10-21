# Отчёт: распределённые узлы MOONKATTY NODE

## Что сделано
- **Одно приложение MOONKATTY NODE** (`node-agent/agent.js`, без зависимостей, Node ≥ 16; поставляется с Node 22 LTS x64): профили NEWS NODE (iMac) и MONITOR NODE (MacBook), автоопределение CPU/RAM/диска/модели/инструментов (ffprobe, ffmpeg, python3, sips, magick/convert, curl), pull-задачи, только разрешённые типы, рабочие папки `~/.moonkatty-node/{work,archive}`, загрузка результатов с SHA-256, страница статуса 127.0.0.1:8791 (вид по макету: CPU/RAM/Disk, News Collection, Recent Headlines / Quality Check, System Monitor, Recent Tasks, Current Task + Pause), журнал действий, восстановление после обрыва (экспоненциальная пауза до 60 с), команды центра pause/drain/stop.
- **Node Manager** на Mac mini (`lib/ops/nodes.js`): токены (SHA-256), allowlist по профилю, аренда+heartbeat+ack, идемпотентность, повтор только safeToRetry, маршрутизация по ресурсам, файлы по SHA-256, оповещения (узел недоступен, задача ждёт решения, мало ресурсов), отдельный TLS-порт с закреплённым сертификатом, привязка только к LAN/Tailscale-адресу.
- **Через runner.js** (задачи студии с `node: {...}`) и bridge для исполнителя Grok #1 (`ops.nodeBridge`), контракт `NODE_API_CONTRACT.md`.
- **Панель**: `/studio.html` — главный экран «MOONKATTY AI STUDIO / Main Server — Mac mini» по макету (меню, поиск, уведомления, System Status 3 Mac, Running Tasks, Recent Activity, Storage, Quick Actions), пункт «Computers (Nodes)» в основной панели, карточка узлов в «Операции», узлы в мобильной сводке.
- **Сборка Intel macOS**: `scripts/node/build-node-pkg.sh` → `moonkatty-node-0.1.0-darwin-x64.tar.gz` (+ `.sha256`, `MANIFEST.sha256`, BUILDINFO), `js-only` запасной; `install.sh --verify-only|--autostart`, `uninstall.sh --rollback|--purge`; `scripts/node/detect-specs.sh` (bash 3.2, только чтение).

## Совместимость macOS / рантайм
**Исправлено 2026-10-21:** iMac — Retina 5K 27" 2017, i5 3.4 GHz 4 ядра, 8 ГБ, Radeon Pro 570 4 ГБ, **macOS Ventura 13.7.1** (ранее ошибочно указывалась другая версия macOS). iMac → Node 24 LTS x64 (мин. macOS 13.5, поддержка до 04.2028), пакет `darwin-x64`; MacBook 2015 (макс. Monterey 12) → Node 22 LTS x64 (мин. macOS 11), пакет `darwin-x64-monterey`. Подробно: [NEWS_NODE_IMAC.md](NEWS_NODE_IMAC.md). При macOS 10.15 — обновить до 12 или временно `js-only` + Node 18 (EOL). SEA/pkg не используется (переподпись бинарника), вместо этого официальный подписанный Node + MANIFEST SHA-256.

## Тесты (локальная симуляция, мульти-процесс)
- `test/ops/nodes.test.js` — 10: токены/хеши/отзыв, allowlist, локальные типы и секреты не уходят, маршрутизация/ресурсы, идемпотентность, повторный ack, потеря узла (safe→requeue, unsafe→needs_approval+alert), heartbeat/таймаут, мало ресурсов, файлы (422 при подмене, 403 чужие), запрет 0.0.0.0/публичных IP, runViaNode + отмена, команды pause/drain/stop/run, профили.
- `test/ops/nodes.multiprocess.test.js` — 2 (3 процесса: координатор + iMac + MacBook, реальный TLS с pin): маршрутизация по профилю, self-report, ffprobe по реальному mp4 со скачиванием по SHA-256, X только черновики, неверный pin отвергнут, удалённый stop (exit 0); отказы: падение узла после аренды, дубль доставки ack, плохая контрольная сумма, обрыв сети (TCP-прокси) с повтором.
- `test/ops/nodes.integration.test.js` — реальный сервер с флагом: админ-API только владельцу, отдельный TLS-порт без основного приложения, ключ 0600, задача через runner.js на узел и обратно.
- `test/contract/studio-jobs.contract.test.js` — 6 (1 пропуск до появления ветки Grok #1); `scripts/ops/contract-against-branch.sh` проверен на feat/opencode-auth.

## Ограничения
- Реальные Mac не трогались; launchd/sips/Keychain/codesign на узлах — проверены только в коде и инструкциях.
- Прогресс задач — только если обработчик его сообщает (news.collect); иначе полоса пустая (не выдумываем).
- Storage на главном экране — только измеренные значения (диск, размер БД, число файлов); разбивки по категориям нет.
- Hero-картинка макета (кот-ведущий) заменена фирменным фоном — готового изображения в репозитории нет.
- GPG-проверка Node — только если ключи релизов импортированы; иначе SHA-256 по SHASUMS256.txt nodejs.org.
