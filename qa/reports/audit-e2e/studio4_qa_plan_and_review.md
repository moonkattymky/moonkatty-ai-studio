# ⚠ ВЕРДИКТ STUDIO 4 ПО ДЕФЕКТУ STUDIO 2 (confirm:true обходит одобрение владельца) — QA-E2E-001: ПОДТВЕРЖДЁН, серьёзность HIGH (не Critical)
Код (3b72817): `lib/world/permissions.js:16-18` — `gate()`: tier 'owner' → `needs_owner` только если `confirm !== true`; `confirm` приходит из тела запроса клиента в двух маршрутах:
- `POST /api/world/action` — `lib/world/index.js:176` (`req.body?.confirm === true`) → `act()` `:197-204`. Для paid_ads/spending/editorial_publication/mass_mailing/outreach_new_clients/contracts/payment_settings ответ `executed:false` (внешнего вызова нет), но журнал пишет `owner … allow`; для `critical_settings` ответ `executed:true`.
- `POST /api/world/savings` — `lib/world/index.js:190-195` — с `confirm:true` цель накоплений (critical_settings) **записывается сразу**, минуя Approval Center (`/api/world/approvals/:id`, `:177-186`).
Остальные вызовы `gate()` (`index.js:73,115,118,126,131,144` и др.) передают `confirm:true` жёстко, но только для AUTO-действий (analysis/drafts/qc/internal_reports) — на них confirm не влияет; это не обход.
Что выполняется ДО gate: сессия или app-token (`server.js:190`, без входа → 401), CSRF-проверка (без X-Studio-Request/Origin → 403). Approval Center НЕ вызывается — проверки, что есть одобренная запись world_approvals, нет.
Доказательство (локальный TEST-сервер 127.0.0.1:8687, временный data dir, без внешних вызовов, 19:38 IDT):
- без входа → 401; без CSRF-заголовка → 403;
- `savings {target_usd:5}` → 403 needs_owner (создана заявка); `savings {target_usd:999999, confirm:true}` → 200 `{"item":"Mac Studio","target_usd":999999}` — применено без одобрения;
- `action paid_ads` → 403 needs_owner; `action paid_ads, confirm:true` → 200 `executed:false`, журнал: `paid_ads owner allow`;
- `action critical_settings, confirm:true` → 200 `executed:true`; `action fake_views, confirm:true` → 403 forbidden (запрещённые не обходятся).
Почему HIGH, а не Critical: нужен авторизованный сеанс (приложение однопользовательское — сеанс принадлежит владельцу или держателю app-token), внешних действий (оплата/реклама/публикация) в коде нет (`executed:false`), UI `confirm:true` в эти маршруты не шлёт (grep public/*.js). Но инвариант «owner-действие только через Approval Center» нарушен, журнал аудита фальсифицирует «одобрено владельцем», а любой агент/скрипт/скомпрометированный app-token обходит двухшаговое одобрение. Как только owner-действия станут исполняться — станет Critical. Рекомендация: игнорировать `confirm` из тела, разрешать owner-tier только по id одобренной записи world_approvals (+ тест на обход). Статус world-модулей понижается до TESTED (не INTEGRATED) до исправления.

# MOONKATTY AI STUDIO v1.3.1-test — независимый план QA (END-TO-END) и проверка отчётов Studio 2/3/5 и соцсетей

Аудитор: Studio 4 (независимый QA, Grok Bot). Коммит: `3b72817d8c2a1af49d08c3f5d752f8e65dcaf0ef` (свежий клон без токена). Режим: только чтение, код продукта не менялся, публикаций нет.
Вердикты строго: PASS / FAIL / BLOCKED / NOT TESTED. Всё, что требует реального Mac mini M5 Pro, iPhone 16 Pro или реальных каналов, — BLOCKED, пока нет доказательств.

## 0. Уровни статуса и критерии приёмки
Каждый уровень требует выполнения всех предыдущих. Понижать статус при любой регрессии.

| Уровень | Критерий приёмки | Обязательные доказательства |
|---|---|---|
| IMPLEMENTED | Реальный код в репозитории на коммите (не UI-заглушка, не `implemented:false`, не `NOT_CONNECTED`); путь вызывается из сервера/CLI | file:line, коммит |
| TESTED | Unit/интеграционные тесты покрывают успех и отказ; прогон на Node 22 даёт 0 fail; пропуски обоснованы | лог прогона с числами pass/fail/skip |
| INTEGRATED | Модуль подключён в собранном приложении (есть в app.asar, маршрут смонтирован, flavor разрешает); e2e через HTTP API/UI на тестовом сервере 8687 | asar list, curl/Playwright-лог, скриншоты smoke |
| VERIFIED ON DEVICE | Проверено на реальном Mac mini M5 Pro (и iPhone 16 Pro, если применимо) установленной сборкой с проверенным SHA-256 | вывод mac-diagnose (txt), скриншоты, реальные выходные файлы (.blend/.png/.mp4), логи, codesign-вывод, дата/время |
| PRODUCTION READY | Письменное разрешение Игоря; бэкап БД и Keychain; проверенный откат; prod v1.1.2 (8787) не затронут; мониторинг | разрешение Игоря, путь к бэкапу, протокол отката |

Запрещено: ставить VERIFIED ON DEVICE без файлов с устройства; ставить PRODUCTION READY для TEST-сборки (flavor test по определению не prod).

## 1. Перечень модулей (по коду 3b72817)
| Модуль | Код | Тесты (npm) |
|---|---|---|
| Ядро сервера, auth, сессии, CSRF, host-check, STUDIO_ALLOWED_HOSTS | `server.js`, `lib/security.js` | test:security |
| Изоляция TEST/prod (порты 8687/8787, bundle id, Keychain, data dir) | `lib/studio-config.js`, `desktop/flavor-guard.js` | test:isolation |
| БД, бэкап/restore | `lib/db.js`, `lib/db-backup.js` | test:security, isolation |
| Keychain | `lib/keystore.js`, `lib/opencode-auth.js` | test:opencode |
| OpenCode 4097 (test) / 4096 (prod) | `lib/opencode-serve.js`, `lib/opencode-client.js`, `opencode/*.sh` | test:opencode-serve, test:opencode-json |
| Политика агентов | `lib/policy.js` | test:policy |
| 3D: scene_params → .blend → PNG | `lib/executors/design3d.js`, `lib/scene-params.js`, `lib/blender.js`, `lib/workspace.js`, `blender/templates` | test:3d |
| Видео-рендер | `lib/video-render.js` (стаб), реальный исполнитель подключён в `server.js:152-157`; `media-automation/src/video`, `src/jobs/video-render-executor.js` | scripts/video-render-test.mjs, video-render-wiring-test.mjs |
| Задачи/очередь | `lib/jobs.js`, `lib/services.js`, `runner.js` | test:runner |
| Публикация/Approval/печать публикации | `server.js:45-90,200,509+`, `meta.js` (prod-only), `media-automation/src/publish`, `src/approval` | test:publish-guard, media-automation/test |
| World: AI CEO, QC/Creative Director, Revenue, Growth/Marketing, Audience, Mission, Memory | `lib/world/*.js` | test:world |
| Финансы (ledger) | `lib/world/revenue.js` | test:world |
| Память / Studio Intelligence | `studio-intelligence/src/*`, `lib/world/memory-adapter.js` | studio-intelligence tests |
| Игры (@MoonKattyGameBot, только ссылка/раздел UI) | `public/app.js:354-355` | нет |
| Узлы (Node API 8690 test) | `lib/ops/nodes*.js`, `node-agent/` | test:nodes, test:ops, test:ops:studio |
| Update Center | `lib/ops/update*.js` | test:update-center |
| Desktop (Electron, location-check, диагностика) | `desktop/*.js`, `scripts/mac-diagnose.*` | test:location, test:diagnose |
| Память хоста | `lib/host-memory.js` | test:memory |
| PWA/UI, i18n | `public/*` | smoke (Playwright) |

## 2. План по модулям (unit / integration / e2e / security / on-device)
Общие правила on-device: тестовая сборка на 8687, prod v1.1.2 на 8787 не трогать (до и после: `lsof -iTCP:8787 -sTCP:LISTEN`, хеш prod БД и `ls -la` prod .app без изменений); OpenCode test только 4097, 4096 не запускать/не зондировать; Keychain только service `MOONKATTY AI STUDIO.test`.

### 2.1 Сервер, безопасность, изоляция
- Unit: test:security (52), test:isolation (65) — 0 fail.
- Integration: поднять TEST-сервер (NODE_ENV=test STUDIO_FLAVOR=test, временный data dir), проверить 401 без сессии, 403 CSRF без X-Studio-Request/Origin, 421/403 на чужой Host.
- E2E: smoke Playwright (логин, все разделы, director chat, en/uk).
- Security: сервер слушает только 127.0.0.1; лимит логина 429; секреты не в ответах/логах; egress allowlist в TEST без соцсетей (`lib/egress.js:13-15`).
- On-device (Mac mini): `lsof` — 8687 только 127.0.0.1; 8787 принадлежит v1.1.2 и не изменился; mac-diagnose txt.
- iPhone 16 Pro: Tailscale HTTPS (`tailscale serve` только для веб-панели) → имя `*.ts.net` в STUDIO_ALLOWED_HOSTS / desktop.json allowedHosts (`desktop/main.js:36`, только `*.ts.net`); вход, PWA «На экран Домой», работа офлайн-заглушки; чужой Host → отказ. Доказательства: скриншоты с iPhone + лог сервера.

### 2.2 OpenCode + Ollama
- Unit: test:opencode (51), test:opencode-serve (21), test:opencode-json (22).
- Integration: POST /api/opencode/serve: 403 в prod-flavor; порт 4096 отклоняется; пароль только в env процесса.
- On-device: `ollama list` содержит qwen3:8b и qwen2.5-coder:7b; `lsof -iTCP:4097` = 127.0.0.1; 4096 не тронут; `ps eww` не показывает пароль в argv; проверка Keychain-элемента `MOONKATTY AI STUDIO.test`/`opencode-server-password`.

### 2.3 3D-конвейер (scene_params → .blend → PNG/GLB)
- Unit: test:3d, scene-params строгая схема; запасной путь (fallback) помечен `paramsBy:+fallback`, нарушения безопасности останавливают задачу.
- Integration: задание design3d на тестовом сервере с поддельным Blender → статусы этапов.
- On-device: Blender 5.2.2 (`blender --version`), реальный проект: `projects3d/<id>/v001/scene_params.json`, `scene.blend`, `renders/preview.png`, `exports/scene.glb` — размеры >0, PNG открывается, .blend открывается в Blender; права 0700. Без этих файлов — не VERIFIED.
- Запрет: никаких записей в server/blender*.

### 2.4 NEWS / видео
- `video_render`: стаб `lib/video-render.js` заменяется реальным исполнителем (`server.js:152-157`), но UI-кнопки отключены (`public/app.js:369`), а эпизод JSON пишет только неподключённый orchestrator → частично INTEGRATED (только API). Тесты: проверить реальный рендер с ffmpeg+TTS (на Linux — espeak-ng, на Mac — say).
- Критерий VERIFIED: реальный mp4 (ffprobe: длительность, кодек, разрешение), источник новостей, субтитры/озвучка, файл на диске Mac.

### 2.5 Агенты (AI CEO, Marketing, Revenue, Creative Director)
- Код: `lib/world/ceo.js` (AI CEO), `lib/world/growth.js`/`index.js` (marketing), `lib/world/revenue.js`, `lib/world/qc.js` (Creative Director).
- Unit: test:world. Integration: маршруты world (`server.js:501`) с авторизацией. E2E: решения агентов попадают только в Approval Center, без автопубликации и без трат денег.
- On-device: реальный прогон с Ollama qwen3:8b, лог решений, отсутствие внешних действий.

### 2.6 Финансы
- Правила (код `lib/world/revenue.js:1-2,14,31,74`): доход = только `payout_confirmed` + payout_id + не demo; просмотры/охват/показы отвергаются; оценки (estimate) никогда не суммируются с подтверждёнными; отсутствие данных = «НЕТ ДАННЫХ», не 0.
- Тесты: двойной учёт (один payout_id дважды → отказ/одна запись), views как доход → ошибка, estimate не в кассе, валюты/центы без плавающей ошибки.
- On-device: сверка с реальной выплатой (скрин кабинета платформы) — BLOCKED до данных Игоря.

### 2.7 Память / Studio Intelligence
- Unit: тесты studio-intelligence (memory, retrieval, qa-memory, migrate-v3, db-snapshot).
- Integration: memory-adapter в world; секреты не попадают в память (`studio-intelligence/src/secrets.js`).
- On-device: перезапуск приложения → память сохраняется; бэкап/restore.

### 2.8 Игры
- Код: только ссылка/раздел UI на @MoonKattyGameBot (`public/app.js:354-355`); доход раздела games — через ledger. Статус максимум IMPLEMENTED (UI). Проверка: ссылка, отсутствие фейковых метрик.

### 2.9 Узлы
- test:nodes 52, test:ops 119/0/2, test:ops:studio 2/0/2. Известное QA-131-002: узлы 0.2.2 с 1.3.1-test не соединять (upload unauthorized, нет replay floor). On-device: iMac/MacBook — BLOCKED.

### 2.10 Desktop/Gatekeeper/codesign/Update Center
- On-device: `codesign --verify --deep --strict --verbose=2`, `codesign -dv` (Identifier=com.moonkatty.aistudio.test, Signature=adhoc), первый запуск через «Всё равно открыть»; без `xattr -d`/`spctl --master-disable`. App Translocation диалог (QA-131-001). Update Center в TEST не проверяет обновления.

## 3. Чек-листы полной готовности каналов (по 10 шагов)
Общее: только тестовые каналы/аккаунты; реальная публикация — только с явного разрешения Игоря. **Шаги 1–10 с реальными платформами = BLOCKED** до разрешения Игоря и включения публикации (в TEST-сборке публикатор не загружается: `server.js:137-140`, `/publish` → 403 `server.js:200`).

Шаблон (Telegram):
1. Подключить бота (токен @BotFather → Keychain, не в БД/логах).
2. Выбрать канал (тестовый).
3. Проверить права (getChatMember: бот — админ с правом публикации).
4. Создать пост (текст/медиа).
5. Предпросмотр (dry_run/preview).
6. Одобрить в Approval Center (pending_approval → approved только владельцем).
7. Опубликовать (live-гейт: account.live + MA_PUBLISH_LIVE_<P>=owner-approved + reviewStatus=approved).
8. Получить подтверждение и message id от API.
9. Увидеть в истории (запись с печатью публикации, `server.js:45-72`).
10. Получить статистику (для Telegram — только число подписчиков; просмотры не доход).

| Канал | 1 Подключение | 2 Канал/аккаунт | 3 Права | 4 Пост | 5 Превью | 6 Approval | 7 Публикация | 8 ID | 9 История | 10 Статистика | Сейчас (код) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Telegram | CLI bot token | chatId | getChatMember | sendMessage/Photo/Video | dry_run | да | experimental OFF | message_id | queue | memberCount | TESTED (моки), не INTEGRATED в TEST |
| YouTube NEWS | OAuth PKCE (CLI) | youtube-news | scopes | videos.insert | dry_run | да | private по умолчанию | videoId | queue | YT Analytics v2 | TESTED (моки) |
| YouTube MOONKATTY (project) | OAuth PKCE | youtube-project | scopes | videos.insert | dry_run | да | private | videoId | queue | YT Analytics | TESTED (моки) |
| TikTok | **нет OAuth** | tiktok-news | — | init/PUT | dry_run | да | SELF_ONLY | publish_id | queue | video.query | IMPLEMENTED частично |
| Instagram | meta.js OAuth (prod-only) | IG business | /me/permissions | container | dry_run | да | media_publish | media id | sealed queue | insights | prod-only, без функц. тестов |
| Facebook | meta.js OAuth (prod-only) | Page | /debug_token | /photos,/videos,/feed | dry_run | да | Graph | post id | sealed queue | page insights | prod-only, без функц. тестов |
| X | **нет OAuth** | x-news | — | /2/tweets | dry_run | да | experimental OFF; платный API | tweet id | queue | public_metrics | TESTED (моки) |
| Сайт moonkatty.com | нет | — | — | — | — | — | — | — | — | — | NOT IMPLEMENTED (`registry.js:10` implemented:false) |

Для каждого канала VERIFIED ON DEVICE требует: скриншот поста на тестовом канале, ID из API, запись в истории, снимок статистики, разрешение Игоря. До этого — BLOCKED.

## 4. Текущие вердикты Studio 4 по коду 3b72817 (из прогонов r1/r2 сегодня)
Автотесты (Node 22): security 52/0, isolation 65/0, location 26/0, policy 46/46, publish-guard 59/0, opencode 51/0, opencode-serve 21/21, opencode-json 22/22, nodes 52/0, ops 119/0/2, ops:studio 2/0/2, update-center 79/0, smoke ok — **PASS**. Zip 9af58270…a1a8 воспроизводим побайтно — **PASS**. Всё on-device (Mac mini, iPhone, Gatekeeper, codesign) — **BLOCKED**. Реальные публикации — **BLOCKED** (нет разрешения Игоря; в TEST отключено). Отчёты в `qa/reports/v1.3.1-test*`.

## 5. Проверка отчётов других студий
(обновляется по мере появления отчётов)

### 5.1 `/workspace/out/v1.3.1-test/SOCIAL_AUDIT_RU.md` (найден, 19:02 IDT) — вердикт: **PASS** (утверждения подтверждаются, статусы не завышены)
| Утверждение отчёта | Проверка по 3b72817 | Итог |
|---|---|---|
| В TEST `meta.js` не загружается (заглушка) | `server.js:136-140` | CONFIRMED |
| `meta.js` падает вне prod | `meta.js:10` | CONFIRMED |
| Соцсети исключены из egress в TEST | `lib/egress.js:13-15` | CONFIRMED |
| «Social publisher is not mounted» | `server.js:501` | CONFIRMED |
| Live-гейт: live + env owner-approved + approved | `media-automation/src/publish/publisher.js:26-29,51-52`; DEFAULT_ACCOUNTS live:false `:77-86` (`:81` — telegram) | CONFIRMED с оговоркой: вместо env принимается также `liveFlags[platform]===true` (программный флаг) — альтернативный путь, отчёт его не упоминает (незначительно) |
| X/Telegram experimental | `platforms/registry.js:8-9`, `publish/index.js:5-6` | CONFIRMED |
| Сайт не реализован | `platforms/registry.js:10` implemented:false | CONFIRMED |
| Telegram setup: формат токена, getMe, getChat, getChatMember, Keychain | `media-automation/src/auth/telegram-setup.js:3-12` | CONFIRMED |
| Нет OAuth TikTok/X; есть только YouTube OAuth | `media-automation/src/auth/` = index, telegram-setup, youtube-oauth | CONFIRMED |
| YouTube по умолчанию private; данные канала (channels.list) не реализованы | `publish/adapters/youtube.js:10`; grep channels.list — нет | CONFIRMED |
| TikTok SELF_ONLY | `publish/adapters/tiktok.js:7,11` | CONFIRMED |
| app.asar: 919 записей, нет meta.js, publish/auth/analytics/bin | `asar list` zip 9af58270…: 919 записей, 0 совпадений | CONFIRMED |
| Число тестов media-automation | не перезапускалось Studio 4 | UNVERIFIABLE (в рамках срока) |
Завышения статусов нет: отчёт использует «ТОЛЬКО ТЕСТЫ»/«НЕ РЕАЛИЗОВАНО», ничего не заявлено как VERIFIED ON DEVICE. Реальные публикации — BLOCKED.

### 5.2 `/workspace/out/audit-e2e/studio3_news_video_3d.md` (найден 19:33 IDT) — вердикт: **PASS** (точный, статусы не завышены)
| Утверждение | Проверка по 3b72817 | Итог |
|---|---|---|
| Реальный исполнитель video_render подключён, LLM-хука нет, jobsapi выкл | `server.js:152-157` (`const llm = null`) | CONFIRMED |
| Кнопки «Рендер»/«Экспорт» disabled; субтитры «в разработке» | `public/app.js:369`, `:373` | CONFIRMED |
| В UI нет вызовов `video_render` | grep public/*.js → 0 | CONFIRMED |
| Эпизод читается из `<dataDir>/media/episodes/<ref>.json`, пишет только orchestrator | `video-render-executor.js:20-22`, `orchestrator.js:76`; grep orchestrator/src/news в server.js, lib/ → пусто | CONFIRMED |
| Без TTS — «No TTS engine available» | `media-automation/src/video/tts.js:132` (отчёт: 122-133) | CONFIRMED |
| «Автопоиск новостей» disabled | `public/app.js:317` | CONFIRMED |
| Агент news: черновик с «Требуется фактчек», waiting_approval | `runner.js:85,89-91` | CONFIRMED |
| «Автопубликация» disabled | `public/app.js:596` | CONFIRMED |
| render_segment / host3d — заглушки | `lib/services.js:17,103` | CONFIRMED |
| Blender ≥4.2 | `lib/blender.js:5` MIN=[4,2] | CONFIRMED |
| Тесты 45/45 и 8/8 на стабах; design3d-test SKIP | не перезапускалось Studio 4 | UNVERIFIABLE (согласуется с r1: 3D-тесты требуют Blender/OpenCode) |
| asar совпадает побайтно по 9 файлам | Studio 4 независимо: asar 919 записей из того же zip | CONFIRMED частично (побайтное сравнение 9 файлов не повторялось) |
Расхождений нет. VERIFIED ON DEVICE явно указан как «нет» для всех функций — корректно. Поправка в плане Studio 4 (раздел 2.4) внесена по этому отчёту.

### 5.3 `/workspace/out/v1.3.1-test/AUDIT_GOTOVNOSTI_RU.md` (аудит готовности Studio) — вердикт: **PASS** с 1 расхождением в статусе (NEWS)
| Утверждение | Проверка по 3b72817 | Итог |
|---|---|---|
| Вход/сессии `server.js:170-197` | `server.js:170-172` auth/status, auth/setup | CONFIRMED |
| AI CEO: 3 задачи, без внешних действий | `lib/world/ceo.js:4-6` build(), задачи source=ceo | CONFIRMED |
| Creative Director (QC) | `lib/world/index.js:77` register('creative') → qc.score | CONFIRMED |
| Утверждение очереди с guardrails | `server.js:543-547` | CONFIRMED |
| Publish 403 в TEST | `server.js:200` | CONFIRMED |
| NEWS UI `app.js:314-349`, ручные стадии | `public/app.js:314-316,317` | CONFIRMED (код); статус UI-ONLY — DISCREPANCY, см. §6 |
| NEWS-агент `runner.js:85` | `runner.js:85,89-91` | CONFIRMED |
| VIDEO: исполнитель подключён `server.js:153-157`, кнопки disabled `app.js:369` | там же | CONFIRMED |
| 3D полный цикл `server.js:435-499`, design3d.js | `server.js:435-447` маршруты studio3d | CONFIRMED |
| Update Center выключен без STUDIO_OPS_UPDATE=1 | `lib/ops/update-center-mount.js:8` | CONFIRMED |
| Integrations test `server.js:376`, rulePlan `core.js:140` | там же | CONFIRMED |
| Итого INTEGRATED 0 / VERIFIED ON DEVICE 0 / PRODUCTION READY 0; на Mac не проверялось | соответствует отсутствию доказательств | CONFIRMED (честно, без завышения) |
| Числа pass тестов (security, memory, nodes) | совпадают с прогонами Studio 4 r1/r2 (security 52/0, nodes 52/0) | CONFIRMED |

### 5.4 `/workspace/out/v1.3.1-test/ui-route-crosscheck.txt` (кнопки UI → маршруты) — вердикт: **PASS**
- GENERIC-маршруты: `server.js:504` GET /api/:col, `:505` GET /api/:col/:id, `:536` POST, `:542` PUT, `:557` DELETE — CONFIRMED.
- studio3d: POST run `app.js:565`→`server.js:435`, GET status →`:445`, PUT settings →`:447` — CONFIRMED.
- 7 MISSING (все в `public/social-ui.js`: /api/meta/ws/*, /api/queue/X/publish, /api/comments/X/reply) — CONFIRMED как ожидаемое поведение TEST: meta.js не монтируется (`server.js:136-140`), а publish/reply явно отвечают 403 (`server.js:200`). Уточнение: последние два не «отсутствуют», а перехватываются 403-гардом в TEST — в отчёте стоит пометить это, иначе выглядит как битая кнопка (незначительно).
- `GET /api/meta/config` помечен GENERIC → `:505` — CONFIRMED (обслуживается общим маршрутом коллекций, а не meta.js).

## 6. Решение Studio 4 по спорным статусам (Studio vs Studio 3), по определениям раздела 0
**NEWS — решение: IMPLEMENTED (частично); не UI-ONLY и не TESTED.**
- Против UI-ONLY: выпуски сохраняются на сервере через общий CRUD — POST/PUT/DELETE /api/episodes `public/app.js:333,338,340,342,347` → `server.js:536,542,557`; NEWS-агент реально вызывает Ollama и создаёт черновик со статусом waiting_approval (`runner.js:85,89-91`). Это реальный код с серверной стороной.
- Против более высокого: автоматизация (поиск/фактчек/перевод/orchestrator) к серверу не подключена (grep orchestrator/src/news в server.js, lib/ → пусто), кнопка «Автопоиск» disabled (`public/app.js:317`), выделенных тестов NEWS в Studio нет → TESTED не достигнут. Studio 3 прав (его итог: «IMPLEMENTED (частично), не INTEGRATED»); формулировка Studio «UI-ONLY» занижает статус ручного CRUD, но верно указывает, что конвейер новостей в сборку не входит.

**3D — решение: TESTED (частично); не INTEGRATED.**
- TESTED: компоненты покрыты проходящими тестами — test:opencode-json 22/22 (разбор scene_params/запасной путь design3d), test:opencode-serve 21/21 (прогоны Studio 4 r1/r2). Полный e2e `scripts/design3d-test.mjs` (`package.json:18` test:3d) на Linux SKIP без opencode/Blender.
- Не INTEGRATED: по определению раздела 0 (и Studio) INTEGRATED требует прогнанного в собранном приложении цикла UI→сервер→исполнитель→реальный Blender. Проводка есть (`public/app.js:565` → `server.js:435` → runner → `lib/executors/design3d.js` → `lib/blender.js`), но ни разу не исполнена с реальным Blender — нет .blend/PNG/GLB-доказательств. Studio прав; «INTEGRATED» у Studio 3 — завышение (Studio 3 сам указывает, что тест SKIP).
- Чтобы перейти в INTEGRATED: прогнать test:3d с Blender ≥4.2 + opencode serve (Linux CI или Mac) и приложить файлы; для VERIFIED ON DEVICE — тот же прогон на Mac mini M5 Pro с Blender 5.2.2 (BLOCKED).

### 5.5 `/workspace/out/audit-e2e/studio2_agents.md` (найден 19:37 IDT) — вердикт: **PASS по сути, FAIL по статусам** (главный дефект подтверждён; 2 ярлыка INTEGRATED завышены; ошибки в тестах и номерах строк)
| Утверждение | Проверка по 3b72817 | Итог |
|---|---|---|
| confirm:true из клиента обходит одобрение владельца | `lib/world/permissions.js:16-18`, `lib/world/index.js:176,190-195,197-204`; доказано на TEST-сервере (см. начало файла, QA-E2E-001) | CONFIRMED (серьёзность HIGH); ссылка `permissions.js:39-46` — DISCREPANCY (файл 25 строк) |
| jobs на SQLite, статусы | `lib/jobs.js:7-8` | CONFIRMED |
| Типы jobs, заглушки opencode_task/render_segment | реально `lib/services.js:13-17` (TYPES), host3d `:103`; отчёт: `:68-75`, `:71-72`, `:158` | CONFIRMED по сути, номера строк — DISCREPANCY |
| video_render подключён, llm=null, jobsapi выкл | `server.js:152-157` | CONFIRMED |
| POST /api/jobs всегда agent:'design3d' | `server.js:421` | CONFIRMED |
| OpenCode в runner выкл по умолчанию (STUDIO_OPENCODE=1) | `runner.js:28,47` | CONFIRMED |
| publishing/community без публикации, шаблонные ответы | `runner.js:78-83`; 403 в TEST `server.js:200` | CONFIRMED |
| AI CEO — шаблон из 3 задач, без LLM | `lib/world/ceo.js:10-15`, runner `index.js:73` | CONFIRMED |
| Marketing — только sample-снапшот (mock) | `lib/world/platform-read.js:31-38` → `createReadApi()` без провайдеров; `media-automation/fixtures/platforms-snapshot.sample.json:5` «SAMPLE: every platform is dataMode=mock» | CONFIRMED |
| Live-режим: owner-флаг + одобрение live_mode | `media-automation/src/platforms/registry.js:20-25` | CONFIRMED |
| Доход = income+confirmed+payout_id+не demo; оценки отдельно; просмотры отвергаются | `lib/world/revenue.js:74-76`, `lib/world/index.js:150` | CONFIRMED |
| test:world FAIL (ECONNREFUSED) | прогон Studio 2 на Node 20.19.2; Studio 4 на Node 22.23.4: **62 PASS / 0 FAIL** | DISCREPANCY (ошибка окружения, не продукта) |
| test:publish-guard FAIL (ERR_UNKNOWN_BUILTIN_MODULE) | требует Node 22 (node:sqlite); Studio 4: 59/0 PASS | DISCREPANCY (ошибка окружения) |
| asar побайтно совпадает с исходниками | Studio 4 не повторял побайтно; asar 919 записей из того же zip | UNVERIFIABLE (частично) |
| Ни один модуль не VERIFIED ON DEVICE | доказательств с устройств нет | CONFIRMED |

**Ярлыки INTEGRATED Studio 2 против определений раздела 0** (INTEGRATED = TESTED + e2e по HTTP в собранном приложении с реальным исполнителем):
- «AI-агенты / jobs — INTEGRATED (частично)»: **не подтверждается → TESTED (частично)**. HTTP-маршруты и SQLite-очередь реальны, но реальные исполнители (Ollama, Blender, ffmpeg+TTS) ни разу не прогнаны e2e: test:runner мокает Ollama, video — фейковая фабрика (сам Studio 2 это пишет), design3d e2e SKIP.
- «Revenue Director — INTEGRATED (локально)»: **не подтверждается → TESTED**. Ledger и импорт CSV покрыты test:world (62/0 на Node 22), но внешних источников выплат нет, owner-гейт обходится (QA-E2E-001); пока дефект не исправлен, уровень выше TESTED не допускается.
- «AI CEO — IMPLEMENTED», «Marketing — IMPLEMENTED, данные MOCK»: занижены, фактически **TESTED** (test:world 62/0 покрывает world-модули), но с оговоркой: Marketing работает только на mock-данных.
