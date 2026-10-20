# Аудит архитектуры MOONKATTY AI STUDIO

Дата: 20 октября 2026. Ветка аудита: `feat/studio-intelligence`. База для чтения: `main` и остальные ветки `origin` на этот момент. Код других веток не изменялся.

Открытых pull request нет (`gh pr list` пуст). Релиз и сборка с этой ветки не выпускаются.

Номера разработчиков в репозитории не подписаны. Ниже — соответствие по содержимому веток, как его можно восстановить из кода.

## 1. Что лежит на `main`

Коммит `e87bd32` («Update live screenshots»). Версия в `package.json`: 1.0.0.

Панель управления агентами: Express 5 + `better-sqlite3`, фронтенд без сборщика в `public/` (`app.js`, `core.js`, `social.js`, `social-ui.js`, словарь RU/EN/UK). Точка входа — `server.js`.

Коллекции документов (JSON внутри одной таблицы) задаёт `public/core.js`: `workspaces`, `queue`, `utm`, `comments`, `agents`, `chat`, `campaigns`, `files`, `tasks`, `projects`, `episodes`, `channels`, `posts`, `logs`, `reports`, `integrations`.

Два проекта в сиде:

| id | Имя |
|---|---|
| `news` | MOONKATTY NEWS |
| `main` | MOONKATTY (игра, бренд, будущий $MKTY) |

Агенты: `director`, `news`, `video`, `social`, `pr`, `games`, `mkty`, `analytics`, `marketing`, `content`, `publishing`, `community`, `design3d`. Агент `design3d` выключен (`inDevelopment: true`).

Задача на `main`: `id`, `title`, `description`, `agentId`, `priority`, `status` (`queued` и далее), `project` (`news` или `main`), `schedule`, `source`. Планировщик `schedulerTick` только возвращает задачи в очередь по cron. Сам он ничего не исполняет. Director либо зовёт Ollama (`qwen3:8b`), либо правиловой `rulePlan`.

Конвейер выпуска в `core.PIPELINE`: поиск → фактчек → сценарий → перевод → озвучка → видеоряд → монтаж → проверка → публикация. Это статусы эпизода, не движок шагов.

## 2. Ветки

| Ветка | Кончик | Что это |
|---|---|---|
| `feat/macos-app` | `7967f0a` | Десктоп Electron, `runner.js` (исполнитель агентов), `lib/db.js`, Keychain, усиление HTTP. Теги `v1.1.0-mac-preview`, `v1.1.1-mac-preview`. |
| `feat/opencode-auth` | `3f9bd90` | Поверх macos-app: Basic Auth OpenCode только через Keychain (`lib/opencode-auth.js`). Тег `v1.1.2-mac-preview`. |
| `feat/media-automation` | `4537b7a` | News Intelligence Engine и Video Factory v0, свой JSON-файл состояния. Код в `media-automation/`, `server.js` не трогает. |
| `gh-pages` | `0e4d038` | Демо без сервера (localStorage). Не модуль разработчика. |
| `main` | `e87bd32` | Панель, описанная выше. |

Отдельной ветки Blender нет. Отдельной ветки автотестов нет. `feat/v1.2.0` на origin нет.

### Разработчик №1 — OpenCode, Blender, Agent Runtime

Исполнитель — `runner.js` на `feat/macos-app` (и тот же файл на `feat/opencode-auth`).

Контракт хоста: `{ get, put, list, log, core, meta, dataDir, brand }`. Методы: `start(agentId, user)`, `stop(agentId, user)`, `tick()`, `recover()`, `ollamaStatus()`, `opencodePath()`, `opencodeEnabled()`.

`tick` берёт агента со `status === 'working'` и задачу с `status === 'queued'` и тем же `agentId`. Приоритет: `urgent`, `high`, `normal`, `low`. Другие статусы исполнитель не берёт.

Статусы задачи, которые исполнитель пишет сам: `in_progress`, `done`, `waiting_approval`, `blocked`, `failed`. Поля: `result`, `model`, `error`, `blockedReason`, `startedAt`, `finishedAt`, `completedAt`. Задача кода: `kind === 'code'` и `codeApproved === true`, иначе блок. Одобрение кода — только `POST /api/tasks/:id/approve-code`. Общий `PUT /api/tasks/:id` поля `codeApproved*` срезает.

OpenCode по умолчанию выключен (`STUDIO_OPENCODE=1`). На macOS процесс идёт через `sandbox-exec`. На Linux без `STUDIO_OPENCODE_UNSANDBOXED=1` не стартует. Каталог задачи: `data/opencode-sandbox/<id задачи>`.

HTTP, которое добавляет эта ветка: `GET /api/runtime`, `POST /api/agents/:id/start`, `POST /api/agents/:id/stop`, `POST /api/tasks/:id/approve-code`.

Blender в коде нет. На ветке медиа есть заглушка `StubCharacter3D`: `capabilities()` и `renderSegment(...)`. Возврат `null` означает «3D-сегмента нет». Агент `design3d` в продукте выключен.

### Разработчик №2 — медиа и новости

Каталог `media-automation/`. Своих импортов из `server.js` нет.

`NewsEngine`: источники RSS, дедуп по нормализованному URL и Jaccard заголовков, подтверждение двумя источниками или одним официальным, статусы разбора `auto_approved | pending_approval | approved | rejected`. `approve(id, by)` / `reject(id, by, reason)` требуют человека. Состояние — `JsonStore` (отдельный JSON-файл, атомарная запись).

`VideoFactory`: сценарий `{ title, scenes:[{ text }] }`, TTS, SRT, ffmpeg, пресеты `youtube` / `shorts` / `tiktok` / `reels` / `fb_reels`. Музыка без поля `license` отклоняется.

`RenderQueue`: свой список `jobs` в том же JSON. Повторный `add` с тем же `id` идемпотентен. После падения `running` возвращается в `queued`. Параллельность по умолчанию 1.

В `docs/media-automation/ARCHITECTURE.md` явно не реализованы: издатель соцсетей, планировщик, центр утверждения как UI, аналитика, Brand/Project Memory, контроль бюджета. Там же сказано, что память бренда — интерфейс `get(projectId)`.

### Разработчик №3 — инфраструктура и безопасность

Отдельной ветки нет. Усиление лежит в `feat/macos-app` и `feat/opencode-auth`.

На `main` аутентификация уже есть и её нельзя дублировать:

- пароль: scrypt, `salt:hash`, в `meta.users`;
- сессия: cookie `mk_session` или `Authorization: Bearer`, TTL 30 дней, в памяти и в `meta.sessions`;
- первый администратор: `POST /api/auth/setup` или `STUDIO_ADMIN_USER` / `STUDIO_ADMIN_PASSWORD`;
- после входа все `/api/*`, кроме `/api/health` и `/api/auth/*`, требуют сессию;
- один пользователь, ролей агентов в HTTP нет.

На ветках macOS/OpenCode поверх этого:

- `lib/security.js`: allowlist Host, CSRF (`X-Studio-Request: 1` + Origin), CSP, редактирование секретов в журнале;
- сессии в базе хранятся как SHA-256, не открытым токеном;
- `lib/keystore.js`: мастер-ключ AES-256-GCM, порядок env → Keychain macOS → файл `secret.key`;
- `lib/opencode-auth.js`: пароль OpenCode только в Keychain, в API наружу уходит `hasPassword`, не сам пароль;
- локальный `app-token` только с loopback;
- `lib/db.js`: тот же файл SQLite, драйвер `better-sqlite3` или встроенный `node:sqlite`.

База на `main`: `data/studio.db` (переменная `DB_PATH`). Таблицы `items(col, id, data)` и `meta(k, v)`, WAL. Файлы панели: `data/files`. Это единственная база продукта.

### Разработчик №4 — автотесты

Своей ветки нет. Тесты разложены по чужим веткам:

- `main`: `npm run smoke` → `scripts/smoke.mjs` (Playwright, живой сервер);
- `feat/macos-app` и `feat/opencode-auth`: `scripts/security-test.mjs`, `scripts/runner-test.mjs`, `scripts/desktop-test.mjs`, `scripts/opencode-auth-test.mjs`;
- `feat/media-automation`: `node --test` и `node:test`, без нового тестового фреймворка в `package.json`.

Общего раннера на `main` нет: в `package.json` только `start` и `smoke`. Зависимость тестов — `playwright-core`.

## 3. Хранение

Одна SQLite-база панели. Медиа-ветка добавляет второй носитель — JSON `JsonStore` — и прямо пишет, что это отдельное состояние ради изоляции. При слиянии веток появятся два источника правды для сюжетов, очереди рендера и (если его туда положить) бренда.

Коллекция `files` на панели: `{ id, name, size, mime, url, project, createdAt }`. `project` — строка, по умолчанию `main`. Отдельной версии файла нет.

Секреты Meta (ветка `main`, `meta.js`) шифруются в той же базе. Их нельзя копировать в память знаний.

## 4. Утверждения, которые уже есть

Они не сведены в один журнал:

| Место | Что утверждается | Кто |
|---|---|---|
| `public/social.js` `guardrails` + `PUT /api/queue/:id` | пост: фактчек, источник, права на картинку, дедуп | пользователь панели |
| `NewsEngine.approve/reject` | сюжет новости | обязательный `by` |
| `runner.js` | черновик LLM → `waiting_approval`; код → `codeApproved` | человек, отдельная ручка для кода |
| эпизод `versions[lang][step]` | этап конвейера `todo/done` | общий CRUD |

Автопубликация на панели по умолчанию выключена. Исполнитель не публикует и не исполняет ответ модели как команду.

## 5. Пробелы

- Нет общей памяти решений, истории задач, ссылок на файлы, версий модели и публикаций.
- Нет разграничения MOONKATTY NEWS и MOONKATTY PROJECT внутри базы: у задачи есть `project`, но любой вошедший администратор видит все коллекции. Агенты не являются участниками доступа.
- Нет зависимостей между задачами. Исполнитель берёт первую подходящую `queued`.
- Нет идемпотентного ключа у задач панели. Дедуп есть у очереди постов (Jaccard / URL) и у `NewsEngine` / `RenderQueue`, но не у задач Director.
- Нет единого события прогресса. Журнал `logs` — текст, обрезка до 2000 записей.
- Отмена есть как статус `cancelled` в UI, но `runner.stop` возвращает задачу в `queued`, а не в `cancelled`.
- Brand Memory и проверки сходства кота не реализованы. Подменить файл кота через общий CRUD сейчас некому запретить на уровне реестра: реестра нет.
- Движка сценариев нет. `PIPELINE` — подписи колонок эпизода.
- Поиска по документам и решениям нет.

## 6. Риски пересечения

- Второй исполнитель задач сломает `runner.js`: два цикла будут брать одни и те же `queued`. Этот модуль исполнителя не создаёт.
- Вторая база или второй JSON-store разъедутся с `data/studio.db` и с `JsonStore` медиа-ветки.
- Второй логин разъедется с scrypt-сессиями и с Keychain.
- Правка `server.js`, `public/core.js`, `runner.js`, `lib/*`, `media-automation/*`, `meta.js` столкнётся с ветками №1–№3. Их файлы здесь не меняются.
- `package.json` на `feat/macos-app` переписан (Electron). Скрипт тестов в корневой `package.json` не добавлялся, чтобы не конфликтовать при слиянии.
- Память бренда, которую медиа-ветка описала как будущий `get(projectId)`, и реестр этой ветки — один и тот же будущий объект. Здесь только схема, без второго реестра в рантайме.
- Общий `PUT` по-прежнему может сменить `status` задачи. На macOS-ветке защищены `codeApproved*`, но не переход `waiting_approval` → `queued`. Пока в панели один администратор, это действие владельца. Когда у агента появится свой HTTP-доступ, этот переход надо закрыть на стороне исполнителя.

## 7. Что из этого следует для этой ветки

Память и поиск живут в том же файле `data/studio.db`, в таблицах с префиксом `si_`. Таблицы `items` и `meta` не переписываются.

Задача для исполнителя собирается адаптером в форму `runner.js` и не запускается отсюда. `codeApproved` адаптер не ставит в `true`.

Вход не реализуется. Участник получается из уже проверенной сессии `{ user, exp }`.

Сценарий по-прежнему не исполняется. Карточки активов и журнал утверждений после повторного осмотра пишутся в `si_*` и ничего не запускают. Это разобрано в разделе 8.

## 8. Повторный осмотр веток (активы, права, использование)

Дата повторного чтения: 20 октября 2026. Код чужих веток снова не менялся. Кончики: `feat/media-automation` `f4ef853`, новая `feat/studio-operations` `a8a7359`, `feat/macos-app` `7967f0a`, `feat/opencode-auth` `3f9bd90`, `main` `e87bd32`. Открыт только черновик PR этой ветки.

Что уже закрывает часть задачи и поэтому здесь не дублируется:

| Место | Что уже есть | Чего нет |
|---|---|---|
| `NewsEngine` (`mediaLicense` у сюжета) и `music.validateMusic` | лицензия в JSON-store медиа-ветки, музыка без лицензии не принимается | общей карточки файла, истории «где использован», дедупа по SHA-256 |
| `public/social.js` `guardrails` | права картинки поста: своё / лицензия / сгенерировано, дедуп очереди | реестра актива на все выпуски и версии |
| `video/qa.js`, `srtcheck.js` | кодек, размер, fps, звук, громкость LUFS, субтитры | битых кадров и проверки, что права лежат в общей памяти |
| пресеты `shorts` / `reels` и ffmpeg в Video Factory | сборка ролика 9:16 | автоматической нарезки длинного выпуска и запрета второй копии того же файла |
| `core.buildReport` | отчёт по задачам, журналу и выпускам панели | сводки по `si_*`, стоимости и здоровью из памяти |
| `feat/studio-operations` `/api/mobile/*`, `public/mobile.js` | телефон, токен `mkm_`, сторож, лимиты памяти Mac | чтения таблиц `si_*` |
| `runner.js`, `StubCharacter3D` / `Host3D` | исполнитель задач и постановка `render_segment` в очередь | мимики губ, глаз, головы и ушей; Blender в коде нет |

Общего модуля, который хранит источник, права, утверждение и историю использования каждого актива, в этих ветках нет. Он добавлен здесь, в тех же `si_*`, без второй базы и без вызова ffmpeg, Blender и мобильного экрана.

Контракты, которые чужие ветки будут читать и писать:

- №1 вызывает `approvedCharacterModel` и `prepareFacialUse`. Модель берётся из реестра бренда. Кадры не считаются.
- №2 вызывает `register` / `findReusable` / `recordUsage` (`shorts`, `reels`, `episode`, `publication`). Повтор файла не создаёт второй ряд.
- №3 читает `reports.daily` (`compact: true` для телефона). Цифры берутся из записанных строк. Пустая стоимость помечена `available: false`.
- №4 вызывает `qa.rightsForPublication` и `qa.recordFinding` (`sound`, `subtitles`, `format`, `corrupted_frames`, `rights`). Ответ `blocking` не публикует ролик.
