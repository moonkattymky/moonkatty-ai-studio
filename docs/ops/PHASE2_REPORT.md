# Отчёт Phase 2 — feat/studio-operations

База: `origin/feat/opencode-auth` @ `3f9bd9038a3245a362b355565c4ba2a860c6ba3c` (= тег `v1.1.2-mac-preview`, установленная версия 1.1.2). main, feat/opencode-auth, feat/macos-app, feat/media-automation, feat/studio-intelligence не изменялись. Удалённого доступа не включалось, платных сервисов не использовалось, публикаций не было.

## Модули (все выключены по умолчанию; флаги `STUDIO_OPS_*` / desktop.json `ops*`)
| Модуль | Флаг | Суть |
|---|---|---|
| Watchdog | отдельный процесс | сервер/tick/Ollama/OpenCode/RAM/диск/зависшие процессы/очередь/ошибки; backoff + circuit breaker; ntfy/Telegram (выкл.) |
| Resource Manager | opsResources | допуск тяжёлых задач по давлению памяти, росту swap и **замеренным** footprint (пик×1,2); без калибровки — 1 тяжёлая задача; выгрузка моделей только по явному разрешению |
| Память как в Мониторе активности | всегда (`/api/system.memory`) | vm_stat + sysctl: App = internal − purgeable, Used = App + wired + compressed, Cached = external + purgeable, swap, pressure; Linux — MemAvailable/PSI |
| Loadtest | `scripts/ops/loadtest.mjs` | Ollama/Blender/FFmpeg по одному и комбинации; пик RSS дерева процессов, давление, swap, compressed, CPU, длительность; JSON+MD; автостоп; dry-run; импорт калибровки |
| Mobile Control Center | opsMobile | `/api/mobile/*`, scoped-токены mkm_ (SHA-256), `/mobile.html` |
| Security Center | opsSecurity | права агентов, подтверждение опасных операций паролем, allowlist URL интеграций (SSRF), защита от prompt-injection (план LLM ждёт одобрения), журнал действий с хеш-цепочкой, обезличенные 500 |
| Backup & Recovery | opsBackup | VACUUM INTO, манифест SHA-256, verify, test-restore во временную папку, ротация, secret.key только зашифрованным паролем |
| Update Manager | CLI `ops/update.js` | только проверка: origin, SHA-256, codesign/spctl, совместимость схемы, план отката; ничего не устанавливает |
| Cost Controller | opsCosts | журнал платных вызовов, бюджеты, блокировка сверх бюджета |
| Operations Dashboard | opsDashboard | раздел «Операции»: компоненты, задачи, ошибки, нагрузка, бэкапы, расходы, уведомления, права, узлы, деньги |
| Узлы MOONKATTY NODE | opsNodes (+opsNodesBind) | см. NODES_REPORT.md; главный экран `/studio.html` |
| Деньги | opsMoney | журнал actual/estimate/forecast, сделки, адаптеры (моки); read API `GET /api/ops/ledger` — см. MONETIZATION.md, MONETIZATION_CONTRACT.md |

## RAM: причина 95% vs ~67,5%
Панель считала `os.totalmem() − os.freemem()`; на macOS `freemem` = только «Pages free» и не учитывает кэш файлов/inactive. Теперь — формулы Монитора активности. Фикстура `test/fixtures/vm_stat-igor-24gb.txt` воспроизводит ваши цифры: Used 16,19 / 24 ГБ (67,5%), App 12,32, Cached 7,57, Compressed 747,7 МБ, Swap 29,3 МБ, давление green (`test/ops/memory.test.js`); тот же тест показывает, что старая формула давала > 95%. Показ: `/api/system`, панель (RAM + строка Pressure/App/Wired/Compressed/Cached/Swap), мобильная страница, «Операции».

## Тесты
`npm test`: node:test **104 pass / 0 fail / 1 skip** (skip — контракт с runner Grok #1 до появления его ветки) + security 51/51 + opencode-auth 51/51 + runner PASS. Отдельно: мульти-процессные тесты узлов с внедрением отказов, интеграционные тесты сервера с флагами, контрактные тесты (Grok #1 jobs, Studio 5 money), `scripts/ops/contract-against-branch.sh` (временный worktree). Скриншоты UI с симулированными узлами: `scripts/node/ui-shots.mjs`.
Не запускалось: desktop-test.mjs (нет Electron в среде), всё macOS-специфичное — на моках.

## Ответы a–h
**a) Коммит и ветка.** См. итоговое сообщение: последний коммит ветки `feat/studio-operations` — https://github.com/moonkattymky/moonkatty-ai-studio/tree/feat/studio-operations (SHA указан в финальном отчёте и `git log -1`).

**b) npm ci и тесты не трогают данные пользователя.** `npm ci` пишет только в `node_modules` репозитория (в package.json нет pre/postinstall). Все серверные тесты запускают `server.js` с `STUDIO_DATA_DIR` во временной папке: `test/helpers/server.js` (`assertSafeDir` отвергает всё вне tmp и любые пути с «Application Support»), старые скрипты — `/tmp/mk-sec-test`, `/tmp/mk-oc-test`, `/tmp/mk-runner-test`. Тест `test/ops/no-user-data.test.js` проверяет это для всех тестовых файлов. Узловые тесты — `mkdtemp`, loadtest-тесты — моки. Исправлять ничего не потребовалось, добавлена защита.

**c) Совместимость с установленной v1.1.2.** v1.1.2 = тег `v1.1.2-mac-preview` = `3f9bd90` (package.json 1.1.2) — это база ветки. desktop.json: v1.1.2 читает только известные ключи (`port, autoStartServer, startAtLogin, checkUpdates, enableOpenCode, allowedHosts`) — новые `ops*` игнорирует. Схема БД не менялась (таблицы `items`, `meta`); новые данные — в `<DATA>/ops/*` (файлы, v1.1.2 их не читает) и несколько ключей `meta` (мобильные токены, права) — игнорируются. Задачи со статусом `waiting_plan_approval` в v1.1.2 видны, но не исполняются; **задачи с полем `node` v1.1.2 выполнила бы локально как обычные** — перед откатом отмените их. Откат на v1.1.2 с данными новой сборки возможен.

**d) Бэкап и откат.** До изменений: `ditto` всей папки данных (MAC_SETUP_V2, этап 1). Средствами Ops: `node ops/backup.js create|verify|test-restore|restore <id> --to <пустая папка>`. Откат: остановить Watchdog и `tailscale serve reset`, поставить v1.1.2, при необходимости вернуть копию папки (этап «Откат»). Узлы: `uninstall.sh --rollback`, отзыв токена.

**e) Tailscale Serve.** Только tailnet (`serve`, не `funnel`; проверка `tailscale funnel status`); сервер по-прежнему слушает 127.0.0.1, Serve проксирует локально. Identity-заголовки Tailscale (`Tailscale-User-Login`) не используются для авторизации — всегда нужна собственная авторизация приложения (сессия/мобильный токен). Host allowlist: принимаются только имена `*.ts.net` из `allowedHosts` (DNS-rebinding защита сохраняется). ACL: разрешить доступ к Mac mini:443 только вашим устройствам (iPhone), узлам — только Mac mini:8790; запретить остальным; включить подтверждение новых устройств (device approval) и ключи с истечением.

**f) Права токенов.** iPhone: `read, tasks:control, materials:review, ops:read` (по умолчанию; `materials:publish` — только если явно указать), TTL 90 дней, хранится SHA-256, отзыв; доступ только к `/api/mobile/*` (нет generic CRUD, restore, reset, backup, /files, создания токенов, денег). Watchdog: `read, ops:read` — только чтение сводки. Узлы: `nk_…` — только Node API (`/api/nodes/*` на отдельном порту), в основном API 401.

**g) Хранение токенов.** Сервер хранит только SHA-256 (мобильные, узловые, сессии). Watchdog: Keychain `com.moonkatty.watchdog`; файл `watchdog.env` принимается только с правами 600 (иначе токен из файла отбрасывается). Узлы: Keychain `moonkatty-node-<id>`; `node-agent.env` — агент отказывается стартовать, если права шире 600. `secret.key`, `app-token`, ключ TLS узлов — 0600. Журналы — 0600.

**h) Последовательная установка с проверками.** `docs/ops/MAC_SETUP_V2.md` (PDF `MOONKATTY_Mac_Setup_v2.pdf`), узлы — `NODES_IMAC.md`, `NODES_MACBOOK.md`, `NODES_3MAC_TEST.md` (PDF `MOONKATTY_iMac_Setup.pdf`, `MOONKATTY_MacBook_Setup.pdf`).

## Loadtest — что прислать
`loadtest-report.json` и `loadtest-report.md` из папки, которую печатает скрипт (во временной папке, не в данных студии), + вывод `import`.

## Найдено и исправлено
Раздел «Операции» не появлялся в панели: `public/ops-ui.js` проверял `MODE === 'browser'` при загрузке, а app.js определяет режим асинхронно позже. Проверка убрана; подтверждено скриншотом `06-operations-panel-nodes-money.png`.

## Ограничения
macOS-части (vm_stat, launchd, Keychain, codesign, Tailscale, sips) — на моках/фикстурах; реальные ntfy/Telegram не отправлялись; калибровки нет до запуска loadtest на Mac; desktop-test не запускался; Storage на главном экране без разбивки по категориям; адаптеры монетизации — только интерфейсы/моки; GPG-проверка Node при наличии ключей.

## Изменённые файлы
Новые: `lib/ops/*` (backoff, state, notifier, probes, memory, watchdog, resource-manager, loadtest, mobile, security-center, protected, backup, costs, update, nodes, jobs-adapter, ledger, deals, monetization-adapters, index), `ops/{watchdog,backup,update,post-update-check}.js`, `node-agent/*`, `scripts/ops/{loadtest.mjs,contract-against-branch.sh}`, `scripts/node/*`, `deploy/com.moonkatty.{watchdog,node-agent}.plist`, `public/{mobile.html,mobile.js,ops-ui.js,studio.html,studio.css,studio.js}`, `test/{ops,contract,helpers,fixtures}/*`, `docs/ops/*`. Изменены минимально: `server.js`, `runner.js`, `public/app.js`, `public/index.html`, `desktop/main.js`, `desktop/service.js`, `package.json`, `.gitignore`.
